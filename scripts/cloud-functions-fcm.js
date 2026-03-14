/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  Cloud Function : Envoyer une notification push FCM                    ║
 * ║  quand une nouvelle alerte est créée dans Firestore                    ║
 * ║                                                                        ║
 * ║  Déployez avec :                                                       ║
 * ║    firebase deploy --only functions                                    ║
 * ║                                                                        ║
 * ║  Prérequis :                                                           ║
 * ║    cd functions && npm install firebase-admin firebase-functions        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp }     = require('firebase-admin/app');
const { getFirestore }      = require('firebase-admin/firestore');
const { getMessaging }       = require('firebase-admin/messaging');

initializeApp();

const db        = getFirestore();
const messaging = getMessaging();

/**
 * Triggered quand un nouveau document est ajouté à la collection `alertes`.
 * Lit les tokens FCM du destinataire et envoie une notification push.
 */
exports.onNewAlerte = onDocumentCreated('alertes/{alerteId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const alerte = snap.data();
  const destinataireId = alerte.destinataireId;

  // Si pas de destinataire spécifique, on peut envoyer à tous
  // (ou ignorer pour le moment)
  if (!destinataireId) {
    console.log('Alerte broadcast (pas de destinataire spécifique):', alerte.titre);
    return;
  }

  // 1. Récupérer les tokens FCM du destinataire
  const tokensSnap = await db
    .collection('fcm_tokens')
    .where('userId', '==', destinataireId)
    .get();

  if (tokensSnap.empty) {
    console.log(`Aucun token FCM pour l'utilisateur ${destinataireId}`);
    return;
  }

  const tokens = tokensSnap.docs.map((doc) => doc.data().token);

  // 2. Construire le message FCM
  const typeIcons = {
    'IMPAYÉ': '💳', 'BUDGET': '💰', 'REUNION': '📅',
    'DOCUMENT': '📄', 'MAINTENANCE': '🔧', 'SYSTEME': '⚙️', 'VOTE': '🗳️',
  };

  const message = {
    notification: {
      title: alerte.titre || 'SyndicPro',
      body:  alerte.message || 'Nouvelle notification',
    },
    data: {
      type:     alerte.type || 'SYSTEME',
      priorite: alerte.priorite || 'NORMALE',
      entityId: alerte.entityId || '',
      lienUrl:  alerte.lienUrl || '/notification',
      alerteId: event.params.alerteId,
    },
    webpush: {
      notification: {
        icon:  '/favicon.ico',
        badge: '/favicon.ico',
        tag:   `alerte-${alerte.type || 'general'}`,
      },
      fcmOptions: {
        link: alerte.lienUrl || '/notification',
      },
    },
  };

  // 3. Envoyer à chaque token
  const sendResults = await Promise.allSettled(
    tokens.map((token) =>
      messaging.send({ ...message, token }).catch(async (err) => {
        // Si le token est invalide, le supprimer de Firestore
        if (
          err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/registration-token-not-registered'
        ) {
          console.log(`Token invalide supprimé: ${token.substring(0, 20)}...`);
          await db.collection('fcm_tokens').doc(token).delete();
        }
        throw err;
      })
    )
  );

  const success = sendResults.filter((r) => r.status === 'fulfilled').length;
  const failed  = sendResults.filter((r) => r.status === 'rejected').length;

  console.log(
    `Notification FCM envoyée pour alerte "${alerte.titre}": ${success} succès, ${failed} échecs`
  );
});

/**
 * (Optionnel) Cloud Function planifiée pour vérifier les paiements en retard
 * et créer des alertes automatiquement.
 *
 * Décommentez et adaptez selon vos besoins :
 */
/*
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.checkOverduePayments = onSchedule('every day 09:00', async () => {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0]; // yyyy-mm-dd

  const paiementsSnap = await db
    .collection('paiements')
    .where('status', '==', 'pending')
    .get();

  for (const doc of paiementsSnap.docs) {
    const p = doc.data();
    const dueDate = p.dueDate; // format JJ/MM/AAAA ou yyyy-mm-dd

    // Convertir dueDate en comparable
    let dueDateIso = dueDate;
    if (dueDate && dueDate.includes('/')) {
      const [d, m, y] = dueDate.split('/');
      dueDateIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    if (dueDateIso && dueDateIso < todayStr) {
      // Marquer en retard
      await doc.ref.update({ status: 'overdue', updatedAt: new Date().toISOString() });

      // Créer une alerte
      await db.collection('alertes').add({
        type: 'IMPAYÉ',
        priorite: 'HAUTE',
        titre: `Retard de paiement — ${p.payer || 'Inconnu'}`,
        message: `Le paiement de ${(p.amount || 0).toFixed(2)} MAD (échéance ${dueDate}) est en retard.`,
        lienUrl: '/paiements',
        lienLabel: 'Voir les paiements',
        lue: false,
        destinataireId: p.coproprietaireId || '',
        entityId: doc.id,
        entityType: 'paiement',
        createdAt: new Date(),
      });

      console.log(`Paiement ${doc.id} marqué en retard, alerte créée.`);
    }
  }
});
*/
