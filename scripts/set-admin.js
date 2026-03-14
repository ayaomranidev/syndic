// scripts/set-admin.js
// Usage: node set-admin.js <USER_UID>
// Requires: npm install firebase-admin
// Place your service account JSON as ./serviceAccountKey.json next to this file.

const admin = require('firebase-admin');
const fs = require('fs');

const keyPath = './serviceAccountKey.json';
if (!fs.existsSync(keyPath)) {
  console.error('Missing serviceAccountKey.json. Download it from Firebase Console > Project settings > Service accounts');
  process.exit(1);
}

const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function setAdmin(uid) {
  try {
    await admin.auth().setCustomUserClaims(uid, { isAdmin: true });
    console.log('isAdmin set for', uid);
    // Optionally update a Firestore doc (users collection) to reflect admin role
    const db = admin.firestore();
    await db.collection('users').doc(uid).set({ selectedRole: 'ADMIN' }, { merge: true });
    console.log('Firestore profile updated for', uid);
  } catch (err) {
    console.error('Error setting admin claim:', err);
    process.exit(1);
  }
}

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node set-admin.js <USER_UID>');
  process.exit(1);
}

setAdmin(uid).then(() => process.exit(0));
