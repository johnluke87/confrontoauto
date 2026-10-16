// Consumi REALI dai dati ufficiali UE (vedi eea.mjs): scarica il file dell'EEA (una volta: poi resta nella cache),
// abbina ogni nostro motore alle auto vere uguali e manda i consumi all'API.
// Gira su GitHub Actions ogni settimana (.github/workflows/real-consumption.yml). In locale:
//   CA_API_URL=... CA_AGENT_TOKEN=... DRY_RUN=1 node src/real-consumption.mjs
// Facoltativi: EEA_DATASET (pagina del dataset, cambia ogni anno), EEA_CACHE_DIR (default .cache).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Api } from './api.mjs';
import { aggregate, DEFAULT_DATASET, downloadLines, indexGroups, locateDataset, matchPowertrain } from './eea.mjs';

const log = (message) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
const env = (name, fallback) => (process.env[name] ? process.env[name].trim() : fallback);
const USER_AGENT = env('AGENT_USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
const BATCH = 2000;

async function loadGroups(dataset) {
  const dir = env('EEA_CACHE_DIR', '.cache');
  const file = `${dir}/eea-${dataset.year}-${dataset.token}.json.gz`;
  try {
    const groups = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'));
    log(`Dati EEA ${dataset.year} dalla cache (${Object.keys(groups).length} gruppi)`);
    return groups;
  } catch {
    // non c'è: lo scarico
  }
  log(`Scarico e leggo i dati EEA ${dataset.year} (circa 2 GB, qualche minuto)…`);
  const { groups, read, kept } = await aggregate(downloadLines(dataset, USER_AGENT), (n, k) => log(`  ${n.toLocaleString('it')} righe lette, ${k.toLocaleString('it')} usate`));
  log(`Fatto: ${read.toLocaleString('it')} auto, ${kept.toLocaleString('it')} usate, ${Object.keys(groups).length} gruppi`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, gzipSync(JSON.stringify(groups)));
  return groups;
}

async function main() {
  const datasetUrl = env('EEA_DATASET', DEFAULT_DATASET);
  const dataset = await locateDataset(datasetUrl, USER_AGENT);
  const groups = await loadGroups(dataset);
  if (process.argv.includes('--aggregate-only')) {
    return; // usato dal workflow per preparare la cache
  }

  const api = new Api({ apiUrl: env('CA_API_URL', '').replace(/\/+$/, ''), agentToken: env('CA_AGENT_TOKEN', ''), userAgent: USER_AGENT });
  const powertrains = await api.request('/agent/powertrains');
  const index = indexGroups(groups);
  const items = powertrains.map((pt) => matchPowertrain(pt, index));

  const counts = { version: 0, model: 0, brand: 0, none: 0 };
  for (const item of items) {
    counts[item.level ?? 'none']++;
  }
  log(`${powertrains.length} motori: ${counts.version} con la stessa versione, ${counts.model} con lo stesso modello, ${counts.brand} con la marca, ${counts.none} senza dati (elettriche, GPL, metano o modelli troppo nuovi)`);

  if (env('DRY_RUN') === '1') {
    for (const item of items.filter((i) => i.level).slice(0, 30)) {
      const pt = powertrains.find((p) => p.id === item.powertrainId);
      console.log(`${pt.brand} ${pt.model} ${pt.name}: ${JSON.stringify(item)}`);
    }
    return;
  }

  const source = { title: `EEA – consumi reali dai contatori di bordo (OBFCM), auto ${dataset.year}, licenza CC-BY 4.0`, url: datasetUrl };
  let saved = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const response = await api.request('/agent/real-consumption', { method: 'POST', body: JSON.stringify({ source, items: items.slice(i, i + BATCH) }) });
    saved += response.saved;
  }
  log(`Salvati ${saved} consumi reali`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Consumi reali EEA ${dataset.year}: ${powertrains.length} motori · stessa versione ${counts.version} · stesso modello ${counts.model} · marca ${counts.brand} · senza dati ${counts.none}\n`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
