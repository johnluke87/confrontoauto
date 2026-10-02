# Research agent

Il programma che tiene aggiornato l'archivio di Confronto auto. Gira **gratis** su GitHub Actions
(`.github/workflows/research-agent.yml`) ogni 30 minuti.

## Come lavora

1. Chiede all'API cosa c'è da ricercare (`GET /agent/work`): prima i marchi attivi, poi i modelli,
   ognuno al massimo una volta ogni 30 giorni (`research_interval_days` in `config.php`).
2. **Marchio**: apre il sito ufficiale e chiede all'AI quali link sono i modelli in vendita.
3. **Modello**: apre la pagina del modello, sceglie listino, dati tecnici e dotazioni (con regole
   semplici, o con l'AI se non sono evidenti) e chiede all'AI di estrarre i dati, **ognuno con la
   citazione esatta** dalla pagina.
4. **Controllo con codice, non con l'AI**: ogni citazione deve comparire davvero nel testo scaricato,
   altrimenti il dato si butta.
5. Manda il risultato all'API (`POST /agent/results`). Il server ricontrolla: fonte sul dominio ufficiale,
   numero presente nella citazione, valori plausibili, kW/CV coerenti. Se qualcosa non torna
   (prezzi cambiati più del 15%, modelli spariti, troppi scarti, nessuna fonte ufficiale) l'import
   va nella pagina **Revisione** dell'app e aspetta un amministratore.

Il programma rispetta `robots.txt`, fa una pausa tra due pagine dello stesso sito, rifiuta i cookie
non necessari e si presenta come `ConfrontoAutoBot`.

## Configurazione su GitHub

Repository → Settings → Secrets and variables → Actions:

| Tipo     | Nome             | Valore                                                                       |
|----------|------------------|------------------------------------------------------------------------------|
| Secret   | `CA_AGENT_TOKEN` | lo stesso `agent_token` di `api/private/config.php`                          |
| Secret   | `GEMINI_API_KEY` | chiave gratuita da https://aistudio.google.com/apikey                        |
| Variable | `CA_API_URL`     | (facoltativa) default `https://www.gianlucadario.com/extra/confronto-auto/api` |
| Variable | `MAX_LLM_CALLS`  | (facoltativa) chiamate all'AI per esecuzione, default 5                       |
| Variable | `LLM_MODEL`      | (facoltativa) default `gemini-2.5-flash`                                     |

Con 48 esecuzioni al giorno e 5 chiamate ciascuna si resta sotto il limite giornaliero gratuito di Gemini.
Per un altro servizio gratuito compatibile OpenAI (Groq, OpenRouter): `LLM_PROVIDER=openai`,
`LLM_BASE_URL`, `LLM_MODEL` e il secret `LLM_API_KEY`.

## Prova in locale

```bash
npm install
npx playwright install chromium
CA_API_URL=... CA_AGENT_TOKEN=... GEMINI_API_KEY=... DRY_RUN=1 node src/index.mjs
```

`DRY_RUN=1` stampa i risultati invece di mandarli. `BROWSER=fetch` evita il browser (solo siti HTML semplici).
Test: `npm test`.
