import { bootstrapApplication } from '@angular/platform-browser';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import '@angular/compiler';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { firebaseConfig } from './environments/firebase';

registerLocaleData(localeFr);

// Initialise Firebase au bootstrap de l'application (réutilise si déjà initialisé)
if (!getApps().length) {
  initializeApp(firebaseConfig);
} else {
  getApp();
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
