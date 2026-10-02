# Confronto auto

App per decidere quale auto NUOVA comprare e come configurarla: costo totale di possesso anno per anno,
con ogni dato accompagnato da fonte e affidabilità (🟢 ufficiale · 🟡 verificato · 🟠 stima · 🔴 mancante).

Pubblicata su https://www.gianlucadario.com/extra/confronto-auto/

## Struttura

| Cartella   | Cosa contiene                                                                 |
|------------|-------------------------------------------------------------------------------|
| `src/`     | frontend Angular 21 + Material                                                |
| `api/`     | backend PHP + MySQL (va caricato così com'è in `/extra/confronto-auto/api/`)  |
| `agent/`   | Research agent (Node), gira su GitHub Actions: vedi `agent/README.md`         |
| `.github/` | workflow del Research agent, ogni 30 minuti                                   |

## Sviluppo

```bash
npm install
npx ng serve
```

Il proxy (`proxy.conf.json`) manda le chiamate `/extra/confronto-auto/api` al server vero.

## Pubblicazione

1. `npx ng build` e carica il contenuto di `dist/confronto-auto/browser/` in `/extra/confronto-auto/`.
2. Carica `api/` in `/extra/confronto-auto/api/`. `api/private/config.php` non è nel repository
   (contiene le password): si crea copiando `api/private/config.example.php`.
3. Apri `…/api/migrate.php` (con la `maintenance_key`) per creare o aggiornare le tabelle,
   e la prima volta `…/api/setup.php` (con la `setup_key`) per creare l'amministratore.
