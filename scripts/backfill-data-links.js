// scripts/backfill-data-links.js
// ─────────────────────────────────────────────────────────────────────────────
// Corrige les liaisons manquantes dans Firestore :
//   1. Remplit coproprietaireId manquant sur les dettes (depuis l'appartement)
//   2. Remplit coproprietaireId manquant sur les paiements (depuis l'appartement)
//   3. Corrige les montants incohérents (paye + restant ≠ original)
//   4. Corrige les statuts incohérents (PAYEE avec restant > 0, etc.)
//
// Usage :
//   node scripts/backfill-data-links.js              # Mode DRY-RUN (défaut)
//   node scripts/backfill-data-links.js --apply       # Applique les corrections
//
// Pré-requis : npm install firebase-admin
//              Placer serviceAccountKey.json à la racine du projet
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const fs    = require('fs');

const DRY_RUN = !process.argv.includes('--apply');

// ── Init Firebase Admin ─────────────────────────────────────────────────────
const keyPath = './serviceAccountKey.json';
if (!fs.existsSync(keyPath)) {
  console.error('❌ Fichier serviceAccountKey.json introuvable.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

// ── Helpers ─────────────────────────────────────────────────────────────────
async function loadCollection(name) {
  const snap = await db.collection(name).get();
  const map = {};
  snap.forEach(doc => { map[doc.id] = { id: doc.id, ...doc.data() }; });
  return map;
}

// Firestore batch limit = 500, on utilise 400 par sécurité
const BATCH_LIMIT = 400;
async function commitBatches(ops) {
  console.log(`   Écriture de ${ops.length} document(s)…`);
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = ops.slice(i, i + BATCH_LIMIT);
    for (const { ref, data } of chunk) {
      batch.update(ref, data);
    }
    await batch.commit();
    console.log(`   ✓ Batch ${Math.floor(i / BATCH_LIMIT) + 1} (${chunk.length} docs) committée`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function backfill() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  BACKFILL DES LIAISONS  —  ${DRY_RUN ? '🔍 MODE DRY-RUN' : '⚡ MODE APPLY'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('ℹ️  Aucune modification ne sera écrite en base.');
    console.log('   Relancez avec --apply pour appliquer les corrections.\n');
  }

  // 1. Charger les données
  console.log('⏳ Chargement des collections…');
  const [users, appartements, dettes, paiements] = await Promise.all([
    loadCollection('users'),
    loadCollection('appartements'),
    loadCollection('dettes'),
    loadCollection('paiements'),
  ]);
  const userIds = new Set(Object.keys(users));
  const aptMap  = appartements;

  console.log(`   users: ${Object.keys(users).length}, appartements: ${Object.keys(aptMap).length}`);
  console.log(`   dettes: ${Object.keys(dettes).length}, paiements: ${Object.keys(paiements).length}\n`);

  // Construire un index userId → [appartementIds]
  const userToApts = {};
  for (const apt of Object.values(aptMap)) {
    const propId = apt.proprietaireId || apt.proprietaire_id || '';
    const locId  = apt.locataireId   || apt.locataire_id   || '';
    if (propId) {
      if (!userToApts[propId]) userToApts[propId] = [];
      userToApts[propId].push(apt.id);
    }
    if (locId && locId !== propId) {
      if (!userToApts[locId]) userToApts[locId] = [];
      userToApts[locId].push(apt.id);
    }
  }

  const ops = [];
  let stats = {
    detteCoproFilled: 0,
    detteAptFilled: 0,
    detteAmountFixed: 0,
    detteStatusFixed: 0,
    paiementCoproFilled: 0,
    skippedNoApt: 0,
    skippedNoOwner: 0,
  };

  // ── 2. Corriger les dettes ────────────────────────────────────────────────
  console.log('── CORRECTION DES DETTES ───────────────────────────────────');

  for (const d of Object.values(dettes)) {
    const updates = {};
    const aptId  = d.appartementId || '';
    const copro  = d.coproprietaireId || '';

    // 2a. Remplir coproprietaireId manquant
    if (!copro && aptId && aptMap[aptId]) {
      const apt = aptMap[aptId];
      const ownerId = apt.proprietaireId || apt.proprietaire_id
                   || apt.locataireId    || apt.locataire_id    || '';
      if (ownerId && userIds.has(ownerId)) {
        updates.coproprietaireId = ownerId;
        stats.detteCoproFilled++;
      } else if (ownerId) {
        // Le proprietaireId existe mais n'est pas dans users — on le met quand même
        updates.coproprietaireId = ownerId;
        stats.detteCoproFilled++;
        console.log(`   ⚠ Dette ${d.id}: proprietaire "${ownerId}" pas dans users, mais assigné`);
      } else {
        stats.skippedNoOwner++;
      }
    } else if (!copro && !aptId) {
      stats.skippedNoApt++;
    }

    // 2a-2. Si l'appartementId est manquant mais le coproprietaireId existe,
    // tenter d'inférer l'appartement à partir de userToApts si la correspondance est unique.
    if ((!aptId || aptId === '') && copro) {
      const candidates = userToApts[copro] || [];
      if (candidates.length === 1) {
        updates.appartementId = candidates[0];
        stats.detteAptFilled++;
        console.log(`   ⚠ Dette ${d.id}: appartementId absent — inféré et rempli (${candidates[0]})`);
      }
    }

    // 2b. Corriger les montants incohérents
    const orig    = Number(d.montant_original || 0);
    const paye    = Number(d.montant_paye     || 0);
    const restant = Number(d.montant_restant  || 0);
    if (orig > 0 && Math.abs((paye + restant) - orig) > 0.01) {
      // Recalculer restant basé sur paye
      const correctRestant = Math.max(0, orig - paye);
      updates.montant_restant = correctRestant;
      stats.detteAmountFixed++;
      console.log(`   💰 Dette ${d.id}: restant ${restant} → ${correctRestant} (paye=${paye}, orig=${orig})`);
    }

    // 2c. Corriger le statut
    const effectiveRestant = updates.montant_restant !== undefined ? updates.montant_restant : restant;
    const effectivePaye    = paye;
    const currentStatut    = d.statut || '';

    if (orig > 0 && effectiveRestant <= 0 && effectivePaye >= orig && currentStatut !== 'PAYEE') {
      updates.statut = 'PAYEE';
      updates.date_solde = updates.date_solde || new Date().toISOString();
      stats.detteStatusFixed++;
      console.log(`   🔄 Dette ${d.id}: ${currentStatut} → PAYEE (restant=0)`);
    } else if (orig > 0 && effectiveRestant > 0 && effectivePaye > 0 && currentStatut === 'PAYEE') {
      updates.statut = 'PARTIELLEMENT_PAYEE';
      stats.detteStatusFixed++;
      console.log(`   🔄 Dette ${d.id}: PAYEE → PARTIELLEMENT_PAYEE (restant=${effectiveRestant})`);
    } else if (orig > 0 && effectiveRestant > 0 && effectivePaye <= 0 && currentStatut === 'PAYEE') {
      updates.statut = 'IMPAYEE';
      stats.detteStatusFixed++;
      console.log(`   🔄 Dette ${d.id}: PAYEE → IMPAYEE (aucun paiement)`);
    }

    if (Object.keys(updates).length > 0) {
      ops.push({ ref: db.collection('dettes').doc(d.id), data: updates });
    }
  }

  console.log(`\n   Résumé dettes :`);
  console.log(`     coproprietaireId rempli   : ${stats.detteCoproFilled}`);
  console.log(`     montant corrigé           : ${stats.detteAmountFixed}`);
  console.log(`     statut corrigé            : ${stats.detteStatusFixed}`);
  console.log(`     ignoré (pas d'apt)        : ${stats.skippedNoApt}`);
  console.log(`     ignoré (apt sans proprio) : ${stats.skippedNoOwner}\n`);

  // ── 2b. Lier paiements existants aux dettes (si non alloués)
  console.log('── RATTACHEMENT DES PAIEMENTS AUX DETTES (DRY-RUN montre les changements) ──');
  for (const d of Object.values(dettes)) {
    const aptId = d.appartementId || '';
    if (!aptId) continue; // sans appartement on ne peut pas rattacher

    const annee = Number(d.annee || 0);
    const mois  = Number(d.mois || 0);
    if (!annee || !mois) continue;

    const start = new Date(annee, mois - 1, 1).toISOString();
    const next = new Date(annee, mois, 1).toISOString();

    // Rechercher paiements pour cet appartement sur la période
    const matchingPayments = Object.values(paiements).filter(p => {
      try {
        if ((p.appartementId || '') !== aptId) return false;
        const date = new Date(p.date || p.createdAt || '');
        if (isNaN(date.getTime())) return false;
        return date.toISOString() >= start && date.toISOString() < next;
      } catch { return false; }
    });

    // Ne prendre que les paiements non alloués (allocations vides)
    const free = matchingPayments.filter(p => !p.allocations || p.allocations.length === 0);
    const total = free.reduce((s, p) => s + Number(p.amount || 0), 0);

    if (total > 0) {
      const ids = free.map(p => p.id);
      ops.push({ ref: db.collection('dettes').doc(d.id), data: {
        montant_paye: Number(total),
        montant_restant: Math.max(0, Number(d.montant_original || 0) - Number(total)),
        paiement_ids: ids,
        statut: (Number(d.montant_original || 0) - Number(total)) <= 0 ? 'PAYEE' : (Number(total) > 0 ? 'PARTIELLEMENT_PAYEE' : d.statut)
      }});
      console.log(`   🔗 Dette ${d.id}: rattachement ${ids.length} paiement(s) → ${total} DT`);
    }
  }

  // ── 3. Corriger les paiements ─────────────────────────────────────────────
  console.log('── CORRECTION DES PAIEMENTS ────────────────────────────────');

  for (const p of Object.values(paiements)) {
    const copro = p.coproprietaireId || '';
    const aptId = p.appartementId    || '';

    if (!copro && aptId && aptMap[aptId]) {
      const apt = aptMap[aptId];
      const ownerId = apt.proprietaireId || apt.proprietaire_id
                   || apt.locataireId    || apt.locataire_id    || '';
      if (ownerId) {
        ops.push({
          ref: db.collection('paiements').doc(p.id),
          data: { coproprietaireId: ownerId },
        });
        stats.paiementCoproFilled++;
      }
    }
  }

  console.log(`   coproprietaireId rempli : ${stats.paiementCoproFilled}\n`);

  // ── 4. Appliquer ou résumer ───────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  TOTAL CORRECTIONS À APPLIQUER : ${ops.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (ops.length === 0) {
    console.log('✅ Rien à corriger !');
    return;
  }

  if (DRY_RUN) {
    console.log('🔍 MODE DRY-RUN — aucune écriture effectuée.');
    console.log('   Relancez avec :  node scripts/backfill-data-links.js --apply\n');

    // Écrire le plan dans un fichier
    const plan = ops.map(op => ({
      path: op.ref.path,
      updates: op.data,
    }));
    const planPath = `./scripts/backfill-plan-${Date.now()}.json`;
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    console.log(`📄 Plan de correction écrit dans : ${planPath}`);
  } else {
    console.log('⚡ Application des corrections…\n');
    await commitBatches(ops);
    console.log('\n✅ Toutes les corrections ont été appliquées !');
    console.log('   Relancez audit-data-links.js pour vérifier.\n');
  }
}

backfill().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
