// scripts/migrate-payments.js
// Migration Firestore -> aligne la collection "paiements" avec les docs "users" (copro/locataire)
// Exécution :
//   - Ajouter GOOGLE_APPLICATION_CREDENTIALS vers un compte de service avec accès Firestore
//   - npm i firebase-admin
//   - node scripts/migrate-payments.js

const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Génère les mois Jan 2025 -> Fév 2026 (14 mois)
function buildMonths() {
  const start = new Date(2025, 0, 1);
  const months = [];
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(key);
  }
  return months;
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (typeof value === 'number') return new Date(value);
  const s = String(value).split('T')[0];
  const parts = s.split(/[-/]/).map(Number);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (s.includes('-')) return new Date(a, b - 1, c);
    return new Date(c, b - 1, a);
  }
  return null;
}

function creationMonthKey(doc) {
  const d = toDate(
    doc.createdAt ||
      doc.creationDate ||
      doc.createdAtTimestamp ||
      doc.created_at ||
      doc.created_at_timestamp
  );
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getLastDayOfMonth(monthKey) {
  const [year, month] = monthKey.split('-').map((v) => Number(v));
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

const months = buildMonths();

async function main() {
  const usersSnap = await db.collection('users').get();
  let batch = db.batch();
  let writes = 0;

  for (const docSnap of usersSnap.docs) {
    const u = docSnap.data();
    const roles = Array.isArray(u.roles)
      ? u.roles.map((r) => String(r).toUpperCase())
      : [String(u.role || '').toUpperCase()];
    if (!roles.some((r) => r.includes('COPRO') || r.includes('LOCATAIRE'))) continue;

    const apartment = String(u.apartment || u.appartement || u.appt || u.numero || '00');
    const floor = String(u.floor || u.etage || 'RDC');
    const owner = String(u.owner || u.fullName || u.name || u.displayName || u.payer || 'Inconnu');
    const locataire = u.locataire || u.tenant || null;
    const phone = String(u.phone || u.phoneNumber || '');
    const email = u.email || '';
    const hasParking = Boolean(u.hasParking || u.parking);
    const baseCharge = Number(u.baseCharge ?? u.charge ?? 150 + (hasParking ? 25 : 0));
    const batiment = u.batiment || u.residence || u.block || u.bloc || 'Tasnim C1';
    const startMonth = creationMonthKey(u) || months[0];

    const rowId = `${floor}-${apartment}`;

    for (const m of months) {
      const ref = db.collection('paiements').doc(`${rowId}-${m}`);
      const isAfterCreation = !startMonth || m >= startMonth;

      const payload = {
        apartment,
        floor,
        owner,
        locataire,
        phone,
        email,
        hasParking,
        baseCharge,
        batiment,
        monthKey: m,
        dueDate: getLastDayOfMonth(m),
        amount: isAfterCreation ? baseCharge : 0,
        status: 'unpaid',
        datePaiement: '',
        modePaiement: 'carte',
        reference: '',
        recuUrl: '',
        updatedAt: FieldValue.serverTimestamp(),
      };

      batch.set(ref, payload, { merge: true });
      writes += 1;

      if (writes >= 450) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    }
  }

  if (writes > 0) await batch.commit();
  console.log('Migration terminée');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
