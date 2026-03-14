// scripts/audit-data-links.js
// ─────────────────────────────────────────────────────────────────────────────
// Audite les liaisons entre collections Firestore :
//   users ↔ appartements ↔ dettes ↔ paiements ↔ paiement_allocations
//
// Usage :  node scripts/audit-data-links.js
// Pré-requis : npm install firebase-admin
//              Placer serviceAccountKey.json à la racine du projet
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const fs    = require('fs');

// ── Init Firebase Admin ─────────────────────────────────────────────────────
const keyPath = './serviceAccountKey.json';
if (!fs.existsSync(keyPath)) {
  console.error('❌ Fichier serviceAccountKey.json introuvable.');
  console.error('   Téléchargez-le depuis Firebase Console > Paramètres > Comptes de service');
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

function percent(n, total) {
  if (total === 0) return '0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function audit() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AUDIT DES LIAISONS DE DONNÉES  —  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Charger toutes les collections
  console.log('⏳ Chargement des collections…');
  const [users, appartements, dettes, paiements, allocations, charges] =
    await Promise.all([
      loadCollection('users'),
      loadCollection('appartements'),
      loadCollection('dettes'),
      loadCollection('paiements'),
      loadCollection('paiement_allocations'),
      loadCollection('charges'),
    ]);

  const userIds  = new Set(Object.keys(users));
  const aptIds   = new Set(Object.keys(appartements));
  const detteIds = new Set(Object.keys(dettes));
  const payIds   = new Set(Object.keys(paiements));

  console.log(`   users              : ${userIds.size}`);
  console.log(`   appartements       : ${aptIds.size}`);
  console.log(`   dettes             : ${detteIds.size}`);
  console.log(`   paiements          : ${payIds.size}`);
  console.log(`   paiement_allocations: ${Object.keys(allocations).length}`);
  console.log(`   charges            : ${Object.keys(charges).length}\n`);

  const issues = [];

  // ── 2. Appartements sans proprietaireId / locataireId ─────────────────────
  console.log('── APPARTEMENTS ────────────────────────────────────────────');
  let aptSansProp = 0, aptPropInvalide = 0, aptLocInvalide = 0;
  for (const apt of Object.values(appartements)) {
    const propId = apt.proprietaireId || apt.proprietaire_id || '';
    const locId  = apt.locataireId   || apt.locataire_id   || '';
    if (!propId && !locId) {
      aptSansProp++;
      issues.push({ collection: 'appartements', docId: apt.id, issue: 'Ni proprietaireId ni locataireId' });
    } else {
      if (propId && !userIds.has(propId)) {
        aptPropInvalide++;
        issues.push({ collection: 'appartements', docId: apt.id, issue: `proprietaireId "${propId}" absent de users` });
      }
      if (locId && !userIds.has(locId)) {
        aptLocInvalide++;
        issues.push({ collection: 'appartements', docId: apt.id, issue: `locataireId "${locId}" absent de users` });
      }
    }
  }
  console.log(`   Sans proprio/locataire : ${aptSansProp} / ${aptIds.size}  (${percent(aptSansProp, aptIds.size)})`);
  console.log(`   proprietaireId invalide: ${aptPropInvalide}`);
  console.log(`   locataireId invalide   : ${aptLocInvalide}\n`);

  // ── 3. Dettes ─────────────────────────────────────────────────────────────
  console.log('── DETTES ──────────────────────────────────────────────────');
  let dSansCopro = 0, dCoproInvalide = 0, dSansApt = 0, dAptInvalide = 0;
  let dMontantIncorrect = 0, dStatutIncorrect = 0;
  for (const d of Object.values(dettes)) {
    const copro = d.coproprietaireId || '';
    const aptId = d.appartementId    || '';
    if (!copro) {
      dSansCopro++;
      issues.push({ collection: 'dettes', docId: d.id, issue: 'coproprietaireId vide' });
    } else if (!userIds.has(copro)) {
      dCoproInvalide++;
      issues.push({ collection: 'dettes', docId: d.id, issue: `coproprietaireId "${copro}" absent de users` });
    }
    if (!aptId) {
      dSansApt++;
      issues.push({ collection: 'dettes', docId: d.id, issue: 'appartementId vide' });
    } else if (!aptIds.has(aptId)) {
      dAptInvalide++;
      issues.push({ collection: 'dettes', docId: d.id, issue: `appartementId "${aptId}" absent de appartements` });
    }
    // Vérifier cohérence montant
    const paye    = Number(d.montant_paye    || 0);
    const restant = Number(d.montant_restant || 0);
    const orig    = Number(d.montant_original || 0);
    if (orig > 0 && Math.abs((paye + restant) - orig) > 0.01) {
      dMontantIncorrect++;
      issues.push({
        collection: 'dettes', docId: d.id,
        issue: `Montant incohérent: paye(${paye}) + restant(${restant}) = ${paye + restant} ≠ original(${orig})`
      });
    }
    // Vérifier statut vs montant
    if (d.statut === 'PAYEE' && restant > 0.01) {
      dStatutIncorrect++;
      issues.push({ collection: 'dettes', docId: d.id, issue: `Statut PAYEE mais restant = ${restant}` });
    }
    if ((d.statut === 'IMPAYEE' || d.statut === 'EN_RETARD') && restant <= 0 && orig > 0) {
      dStatutIncorrect++;
      issues.push({ collection: 'dettes', docId: d.id, issue: `Statut ${d.statut} mais restant = 0 (devrait être PAYEE)` });
    }
  }
  console.log(`   Sans coproprietaireId  : ${dSansCopro} / ${detteIds.size}  (${percent(dSansCopro, detteIds.size)})`);
  console.log(`   coproprietaireId invalide: ${dCoproInvalide}`);
  console.log(`   Sans appartementId     : ${dSansApt}`);
  console.log(`   appartementId invalide : ${dAptInvalide}`);
  console.log(`   Montant incohérent     : ${dMontantIncorrect}`);
  console.log(`   Statut incorrect       : ${dStatutIncorrect}\n`);

  // ── 4. Paiements ──────────────────────────────────────────────────────────
  console.log('── PAIEMENTS ───────────────────────────────────────────────');
  let pSansCopro = 0, pCoproInvalide = 0, pSansApt = 0;
  for (const p of Object.values(paiements)) {
    const copro = p.coproprietaireId || '';
    const aptId = p.appartementId    || '';
    if (!copro) {
      pSansCopro++;
      issues.push({ collection: 'paiements', docId: p.id, issue: 'coproprietaireId vide' });
    } else if (!userIds.has(copro)) {
      pCoproInvalide++;
      issues.push({ collection: 'paiements', docId: p.id, issue: `coproprietaireId "${copro}" absent de users` });
    }
    if (!aptId) {
      pSansApt++;
      // Not necessarily an issue — some paiements may not have appartementId
    }
  }
  console.log(`   Sans coproprietaireId   : ${pSansCopro} / ${payIds.size}  (${percent(pSansCopro, payIds.size)})`);
  console.log(`   coproprietaireId invalide: ${pCoproInvalide}`);
  console.log(`   Sans appartementId      : ${pSansApt}\n`);

  // ── 5. Allocations orphelines ─────────────────────────────────────────────
  console.log('── ALLOCATIONS ─────────────────────────────────────────────');
  let allocOrphanDette = 0, allocOrphanPay = 0;
  for (const a of Object.values(allocations)) {
    if (a.detteId && !detteIds.has(a.detteId)) {
      allocOrphanDette++;
      issues.push({ collection: 'paiement_allocations', docId: a.id, issue: `detteId "${a.detteId}" introuvable` });
    }
    if (a.paiementId && !payIds.has(a.paiementId)) {
      allocOrphanPay++;
      issues.push({ collection: 'paiement_allocations', docId: a.id, issue: `paiementId "${a.paiementId}" introuvable` });
    }
  }
  console.log(`   detteId orphelin    : ${allocOrphanDette}`);
  console.log(`   paiementId orphelin : ${allocOrphanPay}\n`);

  // ── 6. Users sans appartement associé ─────────────────────────────────────
  console.log('── USERS ───────────────────────────────────────────────────');
  let usersWithApt = 0, usersAptInvalide = 0;
  let usersSansRoles = 0;
  for (const u of Object.values(users)) {
    const aptId = u.appartementId || '';
    if (aptId) {
      usersWithApt++;
      if (!aptIds.has(aptId)) {
        usersAptInvalide++;
        issues.push({ collection: 'users', docId: u.id, issue: `appartementId "${aptId}" absent de appartements` });
      }
    }
    if (!u.roles || (Array.isArray(u.roles) && u.roles.length === 0)) {
      usersSansRoles++;
    }
  }
  console.log(`   Avec appartementId  : ${usersWithApt} / ${userIds.size}`);
  console.log(`   appartementId invalide: ${usersAptInvalide}`);
  console.log(`   Sans aucun rôle     : ${usersSansRoles}\n`);

  // ── 7. Cohérence croisée : dette.coproprietaireId vs apt.proprietaireId ──
  console.log('── COHÉRENCE CROISÉE ───────────────────────────────────────');
  let crossMismatch = 0;
  for (const d of Object.values(dettes)) {
    const aptId = d.appartementId || '';
    const copro = d.coproprietaireId || '';
    if (aptId && copro && aptIds.has(aptId)) {
      const apt = appartements[aptId];
      const propId = apt.proprietaireId || apt.proprietaire_id || '';
      const locId  = apt.locataireId   || apt.locataire_id   || '';
      if (copro !== propId && copro !== locId) {
        crossMismatch++;
        issues.push({
          collection: 'dettes', docId: d.id,
          issue: `coproprietaireId "${copro}" ne correspond ni au proprio "${propId}" ni au locataire "${locId}" de l'apt ${aptId}`
        });
      }
    }
  }
  console.log(`   Dette↔Apt mismatch  : ${crossMismatch}\n`);

  // ── Résumé ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  TOTAL PROBLÈMES DÉTECTÉS : ${issues.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (issues.length > 0) {
    // Écrire le rapport détaillé dans un fichier
    const report = {
      date: new Date().toISOString(),
      totalIssues: issues.length,
      summary: {
        appartements: { sansPropriétaire: aptSansProp, propInvalide: aptPropInvalide, locInvalide: aptLocInvalide },
        dettes: { sansCopro: dSansCopro, coproInvalide: dCoproInvalide, sansApt: dSansApt, aptInvalide: dAptInvalide, montantIncorrect: dMontantIncorrect, statutIncorrect: dStatutIncorrect },
        paiements: { sansCopro: pSansCopro, coproInvalide: pCoproInvalide },
        allocations: { detteOrphelin: allocOrphanDette, paiementOrphelin: allocOrphanPay },
        croise: { mismatch: crossMismatch },
      },
      issues,
    };
    const reportPath = `./scripts/audit-report-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`📄 Rapport détaillé écrit dans : ${reportPath}`);

    // Top 20 issues
    console.log('\n── Premiers 20 problèmes ──');
    issues.slice(0, 20).forEach((iss, i) => {
      console.log(`  ${i + 1}. [${iss.collection}] ${iss.docId} → ${iss.issue}`);
    });
    if (issues.length > 20) console.log(`  … et ${issues.length - 20} autres.`);
  } else {
    console.log('✅ Aucun problème de liaison détecté !');
  }
}

audit().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
