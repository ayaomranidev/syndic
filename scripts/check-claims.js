// scripts/check-claims.js
// Usage: node check-claims.js <USER_UID>
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

async function checkClaims(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    console.log('User:', user.uid, user.email);
    console.log('Custom Claims:', user.customClaims || {});
    // Also check Firestore doc
    const db = admin.firestore();
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) console.log('Firestore profile:', doc.data());
    else console.log('No Firestore profile found for', uid);
  } catch (err) {
    console.error('Error fetching user:', err);
    process.exit(1);
  }
}

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node check-claims.js <USER_UID>');
  process.exit(1);
}

checkClaims(uid).then(() => process.exit(0));
