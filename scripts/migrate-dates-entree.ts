/**
 * Script de migration : ajoute date_entree aux utilisateurs existants.
 *
 * Pour les utilisateurs qui n'ont pas de date_entree, on utilise leur createdAt
 * comme valeur par défaut. Si createdAt n'existe pas non plus, on met la date courante.
 *
 * Usage :
 *   npx ts-node scripts/migrate-dates-entree.ts
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { firebaseConfig } from '../src/environments/firebase';

async function migrate() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const usersCol = collection(db, 'users');
  const snapshot = await getDocs(usersCol);

  let updated = 0;
  let skipped = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();

    if (data['date_entree']) {
      skipped++;
      continue;
    }

    // Utiliser createdAt comme date d'emménagement par défaut
    let dateEntree: string;
    const createdAt = data['createdAt'];
    if (createdAt) {
      const d = typeof createdAt === 'string'
        ? createdAt
        : createdAt.toDate
          ? createdAt.toDate().toISOString()
          : new Date().toISOString();
      dateEntree = d.split('T')[0]; // YYYY-MM-DD
    } else {
      dateEntree = new Date().toISOString().split('T')[0];
    }

    const ref = doc(db, 'users', docSnap.id);
    await updateDoc(ref, { date_entree: dateEntree });
    updated++;
    console.log(`✅ ${docSnap.id} → date_entree = ${dateEntree}`);
  }

  console.log(`\nMigration terminée : ${updated} mis à jour, ${skipped} déjà renseignés.`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error('❌ Erreur migration :', err);
  process.exit(1);
});
