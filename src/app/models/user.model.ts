// ==================== WARN-1 FIX : Rôles alignés avec le cahier des charges ====================
// Les rôles ADMIN et ADMIN_RESIDENCE sont ajoutés.
// - ADMIN         : accès total à toutes les résidences (global)
// - ADMIN_RESIDENCE : admin limité à SA résidence (residenceId obligatoire)
// Les anciens rôles (ADMIN, TRESORIER, PRESIDENT, GARDIEN) sont conservés.

export type UserRole =
  | 'ADMIN_RESIDENCE'   // ← WARN-1 : ajout (accès limité à une résidence)
  | 'ADMIN'             // rôle générique conservé pour rétrocompatibilité
  | 'COPROPRIETAIRE'
  | 'LOCATAIRE'
  | 'TRESORIER'
  | 'PRESIDENT'
  | 'GARDIEN';

export type UserStatus = 'active' | 'inactive';

export interface User {
  id: string | number;
  email: string;
  fullname?: string;
  name: string;
  role?: UserRole;
  roles: UserRole[];
  availableRoles?: UserRole[];
  status: UserStatus;

  // ── WARN-2 FIX : residenceId est requis pour ADMIN_RESIDENCE ────────────
  // Pour les autres rôles le champ est optionnel.
  // Le service charge et dette l'utilise pour filtrer par résidence.
  residenceId?: string;       // ← clé de filtrage par résidence (Firestore docId)
  // ─────────────────────────────────────────────────────────────────────────

  residence?: string;         // Nom lisible (affiché en UI)
  batiment?: string;
  lot?: string;
  etage?: number;
  hasParking?: boolean;
  hasAscenseur?: boolean;
  immeubleId?: string;
  isOwner?: boolean;
  notes?: string;
  phone?: string;
  firstname?: string;
  lastname?: string;
  appartementId?: string | number | null;
  firebaseUid?: string;
  date_entree?: string;
  date_sortie?: string;
  createdAt?: string | number | Date | null;
  updatedAt?: string | number | Date | null;
}

export interface UserStats {
  total: number;
  actifs: number;
  adminResidences: number;   // ← WARN-1
  admins: number;
  coproprietaires: number;
  locataires: number;
}

// ── Garde utilitaire ────────────────────────────────────────────────────────

/** Retourne true si l'utilisateur a un accès admin global (toutes résidences). */
export function isGlobalAdmin(user: User): boolean {
  return (user.roles || []).includes('ADMIN');
}

/**
 * Retourne true si l'utilisateur est administrateur d'une résidence spécifique.
 * Pour ADMIN global, toujours true (accès universel).
 */
export function isAdminForResidence(user: User, residenceId: string): boolean {
  if (isGlobalAdmin(user)) return true;
  return (
    (user.roles || []).includes('ADMIN_RESIDENCE') &&
    user.residenceId === residenceId
  );
}