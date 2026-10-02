// Research agent di Confronto auto: chiede all'API cosa ricercare, legge i siti ufficiali, manda i risultati.
// Si avvia da GitHub Actions ogni 30 minuti (vedi .github/workflows/research-agent.yml).

import { appendFile } from 'node:fs/promises';
import { Api } from './api.mjs';
import { loadConfig } from './config.mjs';
import { BudgetExhausted, Llm, LlmUnavailable, RateLimited } from './llm.mjs';
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

  // prima di prenotare lavori controllo di avere almeno un servizio AI configurato
  const llm = new Llm(config.llmProviders, config.maxLlmCalls, log);
  log(`Servizi AI: ${config.llmProviders.map((p) => `${p.name} (${p.model})`).join(' → ')}`);

  const { tasks, features } = await api.work(config.maxTasks);
  if (tasks.length === 0) {
    log('Niente da ricercare adesso');
    return;
  }
  log(`${tasks.length} lavori: ${tasks.map((t) => (t.type === 'brand' ? t.brand : `${t.brand} ${t.model}`)).join(', ')}`);

  const pages = new PageFetcher({ browser: config.browser, userAgent: config.userAgent, log });
  await pages.init();
  const done = new Set();
  let quotaFinished = false;

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
        if (error instanceof RateLimited) {
          // quota gratuita finita su tutti i servizi: inutile continuare oggi
          log(`  ${error.message}`);
          summary.push([label, 'rimandato · quota AI finita', '']);
          quotaFinished = true;
          break;
        }
        if (error instanceof BudgetExhausted) {
          log(`  interrotto: ${error.message}`);
          break;
        }
        if (error instanceof LlmUnavailable) {
          // chiavi o modelli dell'AI non validi: mi fermo e lo segnalo, i lavori restano da fare
          log(`  AI non utilizzabile: ${error.message}`);
          summary.push([label, `interrotto · ${error.message}`, '']);
          process.exitCode = 1;
          break;
        }
        log(`  errore: ${error.message}`);
        result = { task: { type: task.type, id: task.id }, ok: false, error: error.message.slice(0, 500) };
      }

      done.add(task);
      if (config.dryRun) {
        console.log(JSON.stringify(result, null, 2));
        const found = !result.ok
          ? `errore: ${result.error}`
          : task.type === 'brand'
            ? `${result.models.length} modelli: ${result.models.map((m) => m.name).join(', ')}`
            : `${result.variants.length} versioni, ${result.powertrains.length} motori, ${result.features.length} dotazioni`;
        summary.push([label, `prova (non inviato) · ${found}`, result.agentIssues?.length ?? '']);
        continue;
      }
      const response = await api.submit(result);
      const problems = (response.issues ?? []).length;
      log(`  -> ${response.status}${problems ? `, ${problems} segnalazioni` : ''}`);
      summary.push([label, result.ok ? response.status : `${response.status} · ${result.error}`, problems]);
    }
  } finally {
    await pages.close();
    // i lavori prenotati ma non fatti tornano subito disponibili (invece di restare bloccati 2 ore)
    const left = tasks.filter((t) => !done.has(t));
    if (left.length > 0) {
      await api.release(left).catch((error) => log(`Non riesco a liberare i lavori: ${error.message}`));
    }
  }

  log(`Fatto: ${summary.length} lavori, ${llm.calls} chiamate all'AI (ultima usata: ${llm.current})`);
  // riepilogo nella pagina dell'esecuzione su GitHub
  if (process.env.GITHUB_STEP_SUMMARY) {
    // una cella di tabella Markdown: niente a capo né "|", e non troppo lunga
    const cell = (value) => String(value).replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 300);
    const rows = summary.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n');
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `| Lavoro | Esito | Segnalazioni |\n|---|---|---|\n${rows}\n\nChiamate all'AI: ${llm.calls} · servizio: ${llm.current}\n\n`,
    );
  }
  // codice 3 = quota AI finita: il workflow smette di fare altri giri
  if (quotaFinished) {
    process.exitCode = 3;
  }
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
