import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

// numeri e date all'italiana (1.234,56 · 2/10/26)
registerLocaleData(localeIt);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
