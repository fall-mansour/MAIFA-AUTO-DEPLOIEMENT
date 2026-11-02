import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './auth.interceptor';

// Mois, jours et séparateurs de milliers en français.
// Sans cela, le pipe date affiche « September » et le pipe number
// sépare les milliers par des virgules : 1,250,000 au lieu de 1 250 000.
registerLocaleData(localeFr, 'fr-FR');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),

    // withInterceptors : ajoute le jeton à chaque appel vers notre API
    //                    et ferme la session sur un 401 expiré
    // withFetch       : API native, recommandée avec le SSR
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),

    // Locale appliquée à tous les pipes date, number et currency
    { provide: LOCALE_ID, useValue: 'fr-FR' },
  ],
};
