// Lavoro "brand": quali modelli il marchio vende oggi in Italia.

import { containsName, sameSite, snippetAround } from '../text.mjs';

const MAX_LINKS = 500;
const BODY_TYPES = 'city, hatchback, sedan, wagon, suv, crossover, mpv, coupe, convertible, pickup, van, other';

/** I link utili da mostrare all'AI: dello stesso sito, con un testo, niente immagini. */
export function usefulLinks(page, baseUrl) {
  return page.links
    .filter((l) => sameSite(l.href, baseUrl) && !/\.(jpe?g|png|webp|gif|svg|mp4|zip)(\?|$)/i.test(l.href))
    .sort((a, b) => Number(b.text !== '') - Number(a.text !== ''))
    .slice(0, MAX_LINKS);
}

function brandPrompt(task, page, links) {
  return `TASK: brand-models
Sei un assistente che estrae dati da pagine web. Rispondi SOLO con un oggetto JSON.

Marchio: ${task.brand}
Questi sono i link trovati nella pagina ${page.url} del sito ufficiale italiano del marchio.
Modelli già in archivio (se sono gli stessi modelli, usa gli stessi nomi): ${task.knownModels.length ? task.knownModels.join(', ') : 'nessuno'}

Individua i MODELLI di AUTOVETTURE NUOVE oggi in vendita in Italia (la gamma attuale).
Escludi: veicoli commerciali e furgoni, usato, km 0, noleggio, flotte, accessori, modelli solo "in arrivo", serie passate.
Ogni modello una volta sola, con il nome commerciale SENZA il marchio (es. "Panda", non "Fiat Panda").
Carrozzerie vendute con un nome diverso (es. "Classe C Station Wagon") sono modelli separati.

Per ogni modello:
- name: il nome del modello
- linkIndex: il numero [n] del link della sua pagina nella lista qui sotto (oppure null)
- bodyType: uno tra ${BODY_TYPES}
Se dalla lista non si capisce la gamma, metti in rangePageIndex il numero del link della pagina "gamma" / "tutti i modelli"; altrimenti null.

Formato: {"models": [{"name": "...", "linkIndex": 12, "bodyType": "city"}], "rangePageIndex": null}

LINK:
${links.map((l, i) => `[${i}] ${l.text || '(senza testo)'} | ${l.href}`).join('\n')}`;
}

/**
 * Le proposte dell'AI diventano dati solo se il nome del modello compare davvero nella pagina
 * (nel testo del link o nel testo della pagina): la citazione la costruisco io, non l'AI.
 */
function collectModels(answer, page, links, sourceIndex, found, issues) {
  for (const m of Array.isArray(answer?.models) ? answer.models : []) {
    const name = typeof m?.name === 'string' ? m.name.trim() : '';
    if (!name || found.has(name.toLowerCase())) {
      continue;
    }
    const link = Number.isInteger(m.linkIndex) ? links[m.linkIndex] : undefined;
    const quote = link && containsName(link.text, name) ? link.text : snippetAround(page.text, name);
    if (!quote || !containsName(quote, name)) {
      issues.push(`modello "${name}": il nome non compare nella pagina`);
      continue;
    }
    found.set(name.toLowerCase(), { name, url: link?.href ?? null, bodyType: m.bodyType ?? null, q: quote, s: sourceIndex });
  }
}

export async function researchBrand(task, { pages, llm, log }) {
  const sources = [];
  const issues = [];
  const found = new Map();

  const home = await pages.get(task.url);
  sources.push({ url: home.url, title: home.title || `${task.brand} – sito ufficiale`, kind: 'official_site' });
  let links = usefulLinks(home, task.url);
  log(`  ${home.url}: ${links.length} link`);
  const answer = await llm.json(brandPrompt(task, home, links));
  collectModels(answer, home, links, 0, found, issues);

  // pochi modelli trovati e l'AI indica una pagina "gamma": provo anche quella
  const range = Number.isInteger(answer?.rangePageIndex) ? links[answer.rangePageIndex] : undefined;
  if (found.size < 3 && range && llm.remaining > 0) {
    const page = await pages.get(range.href);
    sources.push({ url: page.url, title: page.title || `${task.brand} – gamma`, kind: 'official_site' });
    links = usefulLinks(page, task.url);
    log(`  ${page.url}: ${links.length} link`);
    collectModels(await llm.json(brandPrompt(task, page, links)), page, links, sources.length - 1, found, issues);
  }

  log(`  ${found.size} modelli`);
  return { task: { type: 'brand', id: task.id }, ok: true, sources, models: [...found.values()], agentIssues: issues };
}
