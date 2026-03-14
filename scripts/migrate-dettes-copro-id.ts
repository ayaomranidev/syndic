// scripts/migrate-dettes-copro-id.ts
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  writeBatch,
  doc,
  query,
  where
} from 'firebase/firestore';
import { firebaseConfig } from '../src/environments/firebase';

async function migrateDettesCoproprietaireId() {
  console.log('🚀 Début de la migration des dettes...');
  
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  // 1. Récupérer tous les appartements
  const appartementsSnapshot = await getDocs(collection(db, 'appartements'));
  const appartementsMap = new Map();
  
  appartementsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    appartementsMap.set(doc.id, {
      proprietaireId: data.proprietaireId || data.proprietaire || null,
      locataireId: data.locataireId || data.locataire || null,
      numero: data.numero || 'Inconnu'
    });
  });
  
  console.log(`📊 ${appartementsMap.size} appartements chargés`);
  
  // 2. Récupérer toutes les dettes
  const dettesSnapshot = await getDocs(collection(db, 'dettes'));
  console.log(`📊 ${dettesSnapshot.size} dettes à analyser`);
  
  const batch = writeBatch(db);
  let modifiees = 0;
  let ignorees = 0;
  
  for (const detteDoc of dettesSnapshot.docs) {
    const dette = detteDoc.data();
    const detteId = detteDoc.id;
    
    // Si déjà un coproprietaireId valide, on passe
    if (dette.coproprietaireId && dette.coproprietaireId.trim() !== '' && dette.coproprietaireId !== 'inconnu') {
      ignorees++;
      continue;
    }
    
    // Chercher l'appartement correspondant
    const appartementId = dette.appartementId;
    if (!appartementId) {
      console.warn(`⚠️ Dette ${detteId} sans appartementId`);
      ignorees++;
      continue;
    }
    
    const appartement = appartementsMap.get(appartementId);
    if (!appartement) {
      console.warn(`⚠️ Appartement ${appartementId} non trouvé pour dette ${detteId}`);
      ignorees++;
      continue;
    }
    
    // Déterminer le copropriétaire
    let coproId = appartement.proprietaireId || appartement.locataireId;
    
    if (!coproId) {
      console.warn(`⚠️ Appartement ${appartementId} (${appartement.numero}) sans propriétaire ni locataire`);
      
      // Chercher dans les utilisateurs par numéro d'appartement (fallback)
      const usersQuery = query(
        collection(db, 'users'),
        where('lot', '==', appartement.numero)
      );
      const usersSnapshot = await getDocs(usersQuery);
      
      if (!usersSnapshot.empty) {
        coproId = usersSnapshot.docs[0].id;
        console.log(`  → Trouvé utilisateur ${coproId} pour lot ${appartement.numero}`);
      } else {
        // Dernier recours : utiliser l'ID de l'appartement
        coproId = `appt_${appartementId}`;
        console.warn(`  → Utilisation fallback: ${coproId}`);
      }
    }
    
    // Mettre à jour la dette
    const detteRef = doc(db, 'dettes', detteId);
    batch.update(detteRef, {
      coproprietaireId: coproId,
      updated_at: new Date().toISOString(),
      notes: dette.notes 
        ? `${dette.notes} [Migré: coproId ajouté]` 
        : '[Migré: coproId ajouté]'
    });
    
    modifiees++;
    console.log(`✅ Dette ${detteId} mise à jour avec coproId: ${coproId}`);
  }
  
  // Exécuter le batch
  if (modifiees > 0) {
    await batch.commit();
    console.log(`✅ Migration terminée: ${modifiees} dettes modifiées, ${ignorees} ignorées`);
  } else {
    console.log('✅ Aucune dette à migrer');
  }
  
  process.exit(0);
}

// Exécuter
migrateDettesCoproprietaireId().catch(error => {
  console.error('❌ Erreur lors de la migration:', error);
  process.exit(1);
});