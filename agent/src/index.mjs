// Research agent di Confronto auto: chiede all'API cosa ricercare, legge i siti ufficiali, manda i risultati.
// Si avvia da GitHub Actions ogni 30 minuti (vedi .github/workflows/research-agent.yml).

import { appendFile } from 'node:fs/promises';
import { Api } from './api.mjs';
import { loadConfig } from './config.mjs';
import { BudgetExhausted, Llm, RateLimited } from './llm.mjs';
import { PageFetcher } from './pages.mjs';
import { researchBrand } from './tasks/brand.mjs';
import { researchModel } from './tasks/model.mjs';

const log = (message) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

// chiamate all'AI che servono, al minimo, per un lavoro
const MIN_CALLS = { brand: 1, model: 1 };

async function main() {
  const config = loadConfig();
  const api = new Api(config);
  const startedAt = Date.now();
  const summary = [];

  if (process.argv.includes('--peek')) {
    // usato dal workflow: se non c'è niente da fare, non installo nemmeno il browser
    const due = await api.due();
    console.log(due);
    return;
  }

  const { tasks, features } = await api.work(config.maxTasks);
  if (tasks.length === 0) {
    log('Niente da ricercare adesso');
    return;
  }
  log(`${tasks.length} lavori: ${tasks.map((t) => (t.type === 'brand' ? t.brand : `${t.brand} ${t.model}`)).join(', ')}`);

  const llm = new Llm(config.llm, config.maxLlmCalls, log);
  const pages = new PageFetcher({ browser: config.browser, userAgent: config.userAgent, log });
  await pages.init();

  try {
    for (const task of tasks) {
      const label = task.type === 'brand' ? `Marchio ${task.brand}` : `${task.brand} ${task.model}`;
      if (llm.remaining < MIN_CALLS[task.type]) {
        log(`Chiamate all'AI finite: ${label} resta per la prossima esecuzione`);
        break;
      }
      if (Date.now() - startedAt > config.maxRunMinutes * 60_000) {
        log('Tempo massimo raggiunto');
        break;
      }

      log(label);
      let result;
      try {
        result = task.type === 'brand' ? await researchBrand(task, { pages, llm, log }) : await researchModel(task, { pages, llm, features, log });
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          // non è colpa del sito: il lavoro resta prenotato e verrà ripreso più tardi
          log(`  interrotto: ${error.message}`);
          break;
        }
        log(`  errore: ${error.message}`);
        result = { task: { type: task.type, id: task.id }, ok: false, error: error.message.slice(0, 500) };
      }

      if (config.dryRun) {
        console.log(JSON.stringify(result, null, 2));
        summary.push([label, 'prova (non inviato)', '']);
        continue;
      }
      const response = await api.submit(result);
      const problems = (response.issues ?? []).length;
      log(`  -> ${response.status}${problems ? `, ${problems} segnalazioni` : ''}`);
      summary.push([label, response.status, problems]);
    }
  } finally {
    await pages.close();
  }

  log(`Fatto: ${summary.length} lavori, ${llm.calls} chiamate all'AI`);
  // riepilogo nella pagina dell'esecuzione su GitHub
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = summary.map((r) => `| ${r.join(' | ')} |`).join('\n');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `| Lavoro | Esito | Segnalazioni |\n|---|---|---|\n${rows}\n\nChiamate all'AI: ${llm.calls}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
