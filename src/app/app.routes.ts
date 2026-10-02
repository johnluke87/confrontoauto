import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/guards';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Accedi · Confronto auto',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'Registrati · Confronto auto',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register-page/register-page').then((m) => m.RegisterPage),
  },
  {
    // tutte le pagine riservate stanno dentro la "cornice" con la barra in alto
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        title: 'Confronto auto',
        loadComponent: () => import('./pages/home-page/home-page').then((m) => m.HomePage),
      },
      {
        path: 'settings',
        title: 'Impostazioni · Confronto auto',
        loadComponent: () => import('./pages/settings-page/settings-page').then((m) => m.SettingsPage),
      },
      {
        path: 'catalog',
        title: 'Archivio · Confronto auto',
        loadComponent: () => import('./pages/catalog-page/catalog-page').then((m) => m.CatalogPage),
      },
      {
        path: 'catalog/model/:id',
        title: 'Scheda modello · Confronto auto',
        loadComponent: () => import('./pages/model-page/model-page').then((m) => m.ModelPage),
      },
      {
        path: 'admin/imports',
        title: 'Revisione · Confronto auto',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/admin-imports-page/admin-imports-page').then((m) => m.AdminImportsPage),
      },
      {
        path: 'admin/brands',
        title: 'Marchi · Confronto auto',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/admin-brands-page/admin-brands-page').then((m) => m.AdminBrandsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
