/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  parametres.component.ts — SyndicPro                                    ║
 * ║  Dark/Light mode · Notifications · Langue · Thème accent · Sécurité     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { ProfileService } from '../../../profile/services/profile';

// ─────────────────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type Theme      = 'light' | 'dark' | 'system';
export type AccentColor = 'emerald' | 'blue' | 'violet' | 'rose' | 'orange' | 'amber';
export type Language   = 'fr' | 'ar' | 'en';
export type FontSize   = 'sm' | 'md' | 'lg';

export interface NotifSettings {
  emailPaiements:  boolean;
  emailRelances:   boolean;
  emailReunions:   boolean;
  emailRapports:   boolean;
  pushPaiements:   boolean;
  pushRelances:    boolean;
  pushReunions:    boolean;
  freqRelance:     'immediate' | 'quotidienne' | 'hebdomadaire';
  heurePush:       string;
}

export interface ParametresState {
  theme:       Theme;
  accent:      AccentColor;
  langue:      Language;
  fontSize:    FontSize;
  compact:     boolean;
  animations:  boolean;
  notifs:      NotifSettings;
  autoLogout:  number; // minutes (0 = désactivé)
  dateFmt:     'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd';
  currency:    'DT' | 'EUR' | 'USD';
}

const DEFAULT_SETTINGS: ParametresState = {
  theme:      'light',
  accent:     'emerald',
  langue:     'fr',
  fontSize:   'md',
  compact:    false,
  animations: true,
  notifs: {
    emailPaiements: true,
    emailRelances:  true,
    emailReunions:  true,
    emailRapports:  false,
    pushPaiements:  true,
    pushRelances:   false,
    pushReunions:   true,
    freqRelance:    'quotidienne',
    heurePush:      '09:00',
  },
  autoLogout: 30,
  dateFmt:    'dd/MM/yyyy',
  currency:   'DT',
};

const STORAGE_KEY = 'syndicpro_parametres';

// ─────────────────────────────────────────────────────────────────────────────
//  COMPOSANT
// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-parametres',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parametres.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParametresComponent implements OnInit {

  private readonly profileSvc = inject(ProfileService);

  // ── État ─────────────────────────────────────────────────────────────────
  readonly settings   = signal<ParametresState>({ ...DEFAULT_SETTINGS });
  readonly activeTab  = signal<'apparence' | 'notifications' | 'langue' | 'securite' | 'avance'>('apparence');
  readonly saving     = signal(false);
  readonly saved      = signal(false);
  readonly showResetConfirm = signal(false);

  // Sécurité
  readonly pwCurrent  = signal('');
  readonly pwNew      = signal('');
  readonly pwConfirm  = signal('');
  readonly pwError    = signal('');
  readonly pwSaving   = signal(false);
  readonly pwSaved    = signal(false);
  readonly showPwCurrent = signal(false);
  readonly showPwNew     = signal(false);

  // ── Options ──────────────────────────────────────────────────────────────

  readonly themes: { val: Theme; icon: string; label: string; desc: string }[] = [
    { val: 'light',  icon: '☀️', label: 'Clair',   desc: 'Interface lumineuse' },
    { val: 'dark',   icon: '🌙', label: 'Sombre',  desc: 'Interface sombre' },
    { val: 'system', icon: '🖥️', label: 'Système', desc: 'Suit votre OS' },
  ];

  readonly accents: { val: AccentColor; label: string; bg: string; ring: string }[] = [
    { val: 'emerald', label: 'Émeraude', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
    { val: 'blue',    label: 'Bleu',     bg: 'bg-blue-500',    ring: 'ring-blue-500'    },
    { val: 'violet',  label: 'Violet',   bg: 'bg-violet-500',  ring: 'ring-violet-500'  },
    { val: 'rose',    label: 'Rose',     bg: 'bg-rose-500',    ring: 'ring-rose-500'    },
    { val: 'orange',  label: 'Orange',   bg: 'bg-orange-500',  ring: 'ring-orange-500'  },
    { val: 'amber',   label: 'Ambre',    bg: 'bg-amber-500',   ring: 'ring-amber-500'   },
  ];

  readonly languages: { val: Language; flag: string; label: string; native: string }[] = [
    { val: 'fr', flag: '🇫🇷', label: 'Français',  native: 'Français'  },
    { val: 'ar', flag: '🇹🇳', label: 'Arabe',     native: 'العربية'   },
    { val: 'en', flag: '🇬🇧', label: 'Anglais',   native: 'English'   },
  ];

  readonly fontSizes: { val: FontSize; label: string; px: string }[] = [
    { val: 'sm', label: 'Petite',  px: '13px' },
    { val: 'md', label: 'Normale', px: '15px' },
    { val: 'lg', label: 'Grande',  px: '17px' },
  ];

  readonly autoLogoutOptions = [
    { val: 0,   label: 'Jamais' },
    { val: 15,  label: '15 minutes' },
    { val: 30,  label: '30 minutes' },
    { val: 60,  label: '1 heure' },
    { val: 120, label: '2 heures' },
  ];

  readonly dateFormats: { val: ParametresState['dateFmt']; label: string; example: string }[] = [
    { val: 'dd/MM/yyyy', label: 'JJ/MM/AAAA', example: '15/06/2025' },
    { val: 'MM/dd/yyyy', label: 'MM/JJ/AAAA', example: '06/15/2025' },
    { val: 'yyyy-MM-dd', label: 'ISO 8601',   example: '2025-06-15' },
  ];

  readonly currencies: { val: ParametresState['currency']; symbol: string }[] = [
    { val: 'DT',  symbol: 'DT' },
    { val: 'EUR', symbol: '€'  },
    { val: 'USD', symbol: '$'  },
  ];

  // ── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit() {
    this.loadSettings();
    this.applyTheme(this.settings().theme);
  }

  // ── Chargement / Sauvegarde ──────────────────────────────────────────────

  private loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ParametresState>;
        this.settings.set({ ...DEFAULT_SETTINGS, ...parsed, notifs: { ...DEFAULT_SETTINGS.notifs, ...parsed.notifs } });
      }
    } catch {
      this.settings.set({ ...DEFAULT_SETTINGS });
    }
  }

  async saveSettings() {
    this.saving.set(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings()));
      this.applyTheme(this.settings().theme);
      this.applyFontSize(this.settings().fontSize);
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 3000);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Thème ─────────────────────────────────────────────────────────────────

  setTheme(t: Theme) {
    this.settings.update(s => ({ ...s, theme: t }));
    this.applyTheme(t);
  }

  private applyTheme(theme: Theme) {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  }

  setAccent(a: AccentColor) {
    this.settings.update(s => ({ ...s, accent: a }));
    // Applique la couleur CSS variable sur :root
    const colors: Record<AccentColor, string> = {
      emerald: '#10b981', blue: '#3b82f6', violet: '#8b5cf6',
      rose: '#f43f5e',    orange: '#f97316', amber: '#f59e0b',
    };
    document.documentElement.style.setProperty('--color-primary', colors[a]);
  }

  setFontSize(f: FontSize) {
    this.settings.update(s => ({ ...s, fontSize: f }));
    this.applyFontSize(f);
  }

  private applyFontSize(f: FontSize) {
    const sizes: Record<FontSize, string> = { sm: '13px', md: '15px', lg: '17px' };
    document.documentElement.style.setProperty('--font-size-base', sizes[f]);
    document.documentElement.style.fontSize = sizes[f];
  }

  // ── Langue ───────────────────────────────────────────────────────────────

  setLanguage(l: Language) {
    this.settings.update(s => ({ ...s, langue: l }));
    document.documentElement.lang = l;
    document.documentElement.dir  = l === 'ar' ? 'rtl' : 'ltr';
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  updateNotif<K extends keyof NotifSettings>(key: K, val: NotifSettings[K]) {
    this.settings.update(s => ({
      ...s,
      notifs: { ...s.notifs, [key]: val },
    }));
  }

  toggleAllEmail(on: boolean) {
    this.settings.update(s => ({
      ...s,
      notifs: { ...s.notifs, emailPaiements: on, emailRelances: on, emailReunions: on, emailRapports: on },
    }));
  }

  toggleAllPush(on: boolean) {
    this.settings.update(s => ({
      ...s,
      notifs: { ...s.notifs, pushPaiements: on, pushRelances: on, pushReunions: on },
    }));
  }

  get allEmailOn(): boolean {
    const n = this.settings().notifs;
    return n.emailPaiements && n.emailRelances && n.emailReunions && n.emailRapports;
  }

  get allPushOn(): boolean {
    const n = this.settings().notifs;
    return n.pushPaiements && n.pushRelances && n.pushReunions;
  }

  // ── Mot de passe ──────────────────────────────────────────────────────────

  async changePassword() {
    this.pwError.set('');
    if (!this.pwCurrent()) { this.pwError.set('Entrez votre mot de passe actuel'); return; }
    if (this.pwNew().length < 8) { this.pwError.set('Le nouveau mot de passe doit faire au moins 8 caractères'); return; }
    if (this.pwNew() !== this.pwConfirm()) { this.pwError.set('Les mots de passe ne correspondent pas'); return; }

    this.pwSaving.set(true);
    try {
      await this.profileSvc.changePassword(this.pwCurrent(), this.pwNew());
      this.pwSaved.set(true);
      this.pwCurrent.set(''); this.pwNew.set(''); this.pwConfirm.set('');
      setTimeout(() => this.pwSaved.set(false), 3000);
    } catch (err) {
      const error = err as any;
      const msg = error?.code === 'auth/wrong-password' ? 'Mot de passe actuel incorrect'
                : error?.code === 'auth/weak-password'  ? 'Mot de passe trop faible'
                : error?.message || 'Erreur lors du changement de mot de passe';
      this.pwError.set(msg);
    } finally {
      this.pwSaving.set(false);
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  resetToDefaults() {
    this.settings.set({ ...DEFAULT_SETTINGS });
    localStorage.removeItem(STORAGE_KEY);
    this.applyTheme('light');
    this.applyFontSize('md');
    document.documentElement.style.removeProperty('--color-primary');
    this.showResetConfirm.set(false);
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 3000);
  }

  // ── Helpers UI ────────────────────────────────────────────────────────────

  readonly today = new Date().toLocaleDateString('fr-TN', { day: '2-digit', month: 'long', year: 'numeric' });

  setTab(t: 'apparence' | 'notifications' | 'langue' | 'securite' | 'avance') {
    this.activeTab.set(t);
  }

  getNotifBool(key: string): boolean {
    return !!(this.settings().notifs as unknown as Record<string, unknown>)[key];
  }

  pwStrength(): { label: string; pct: number; color: string } {
    const p = this.pwNew();
    if (!p) return { label: '', pct: 0, color: '' };
    let score = 0;
    if (p.length >= 8)  score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (score <= 2) return { label: 'Faible',    pct: 33,  color: 'bg-red-500' };
    if (score <= 3) return { label: 'Moyen',     pct: 66,  color: 'bg-amber-400' };
    return              { label: 'Fort',        pct: 100, color: 'bg-emerald-500' };
  }
}