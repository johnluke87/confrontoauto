// Lavoro "model": versioni, prezzi, motori, misure e dotazioni di un modello.

import { containsName, sameSite } from '../text.mjs';
import { verifyEvidence } from '../verify.mjs';
import { usefulLinks } from './brand.mjs';

const MAX_EXTRA_PAGES = 4;
const MAX_TOTAL_CHARS = 160_000;

// parole che di solito portano a listini, schede tecniche e dotazioni
const KEYWORDS = [
  [/listino|price.?list|prezzi/i, 'official_pricelist', 5],
  [/scheda.?tecnica|dati.?tecnici|caratteristiche.?tecniche|specifiche|technical/i, 'official_spec', 4],
  [/allestiment|versioni|dotazion|equipaggiament/i, 'official_spec', 3],
  [/configura/i, 'official_configurator', 2],
];

/** Punteggio "a regole" di un link: serve a scegliere senza spendere una chiamata all'AI quando è evidente. */
function scoreLink(link, model) {
  const haystack = `${link.text} ${decodeURIComponent(link.href)}`;
  let score = 0;
  let kind = 'official_site';
  for (const [regex, k, points] of KEYWORDS) {
    if (regex.test(haystack)) {
      if (points > score) {
        kind = k;
      }
      score += points;
    }
  }
  if (/\.pdf(\?|$)/i.test(link.href)) {
    score += 2;
  }
  if (containsName(haystack, model)) {
    score += 2;
  }
  return { ...link, score, kind };
}

function linksPrompt(task, page, links) {
  return `TASK: model-links
Rispondi SOLO con un oggetto JSON.
Questa è la pagina ${page.url} del sito ufficiale italiano: auto ${task.brand} ${task.model}.
Scegli al massimo ${MAX_EXTRA_PAGES} link, tra quelli qui sotto, dove è più probabile trovare per QUESTO modello:
listino prezzi (anche PDF), dati tecnici (misure, motori, consumi), allestimenti e dotazioni di serie/optional.
Non scegliere pagine di altri modelli, finanziamenti, noleggio, usato, concessionari, accessori.
Formato: {"pages": [{"index": 3, "kind": "official_pricelist" | "official_spec" | "official_configurator" | "official_site"}]}

LINK:
${links.map((l, i) => `[${i}] ${l.text || '(senza testo)'} | ${l.href}`).join('\n')}`;
}

function extractPrompt(task, docs, features) {
  const perDoc = Math.floor(MAX_TOTAL_CHARS / docs.length);
  return `TASK: model-extract
Estrai i dati dell'auto ${task.brand} ${task.model}, venduta NUOVA in Italia, dai testi delle FONTI qui sotto
(pagine e listini del sito ufficiale). Rispondi SOLO con un oggetto JSON.

REGOLE (importantissime):
1. Usa SOLO informazioni scritte nelle fonti. Se un dato non c'è, OMETTI il campo. Mai stimare, mai usare conoscenze tue.
2. Ogni dato è un oggetto {"v": valore, "q": "citazione", "s": numero della fonte}:
   - "q" = un pezzo di testo COPIATO ESATTAMENTE (carattere per carattere) dalla fonte "s", massimo 200 caratteri, che contiene il valore;
   - un programma controllerà che la citazione sia davvero nella fonte: se non c'è, il dato viene buttato.
3. Numeri come numeri JSON (24950, non "24.950 €"). Prezzi in euro IVA inclusa, scritti nella fonte: mai calcolarli
   (niente "IVA esclusa x 1,22"). Se un valore è un intervallo (es. "5,3/5,4" o "121-122"), usa il più alto.
   Usa i prezzi del LISTINO ufficiale, non quelli in promozione ("da ... €", "con finanziamento", "con rottamazione",
   "offerta"): se c'è solo un prezzo promozionale, ometti il prezzo.
4. Nomi di allestimenti e motorizzazioni come scritti nel listino. Una "versione" = un allestimento con una motorizzazione e il suo prezzo.
5. Solo ${task.model}: ignora altri modelli citati nelle pagine.

CAMPI:
- model: bodyType (city|hatchback|sedan|wagon|suv|crossover|mpv|coupe|convertible|pickup|van|other), generation (testo breve)
- specs (misure comuni a tutte le versioni): lengthMm, widthMm, heightMm, wheelbaseMm, trunkL (bagagliaio in litri), trunkMaxL (con sedili abbattuti), seats, doors, weightKg, tireSize
- trims: elenco dei nomi degli allestimenti (stringhe)
- powertrains: [{name (stringa), fuel (petrol|diesel|lpg|cng|mild_hybrid|full_hybrid|plugin_hybrid|electric), cylinders, displacementCc, powerKw, powerCv, gearbox (manual|automatic), gears, drive (fwd|rwd|awd), timing (belt|chain|none), consumptionWltp (combinato), consumptionUnit (l_100km|kg_100km|kwh_100km), electricConsumptionWltp (kWh/100 km delle plug-in), batteryKwh, electricRangeKm, co2GKm, euroClass, tankL, lpgTankL}]
- variants: [{trim (stringa), powertrain (stringa, uguale a un name di powertrains), listPrice (prezzo di listino IVA inclusa, SENZA messa su strada; ometti se il listino riporta solo il chiavi in mano), onRoadPrice (prezzo "chiavi in mano" IVA inclusa, cioè con messa su strada), priceValidFrom (data "AAAA-MM-GG" di validità del listino) e le misure se diverse da specs}]
- packages: [{trim, name, price, features: [codici]}]
- features: [{trim, code, availability (standard|optional|package), q, s, price (solo se optional), package (nome del pacchetto, se availability = package)}]
  Codici delle dotazioni (usa SOLO questi; se una dotazione non c'è nell'elenco, ignorala):
${features.map((f) => `  ${f.code} = ${f.name}`).join('\n')}

Esempio di formato:
{"model": {"bodyType": {"v": "city", "q": "la city car", "s": 0}},
 "specs": {"lengthMm": {"v": 3705, "q": "Lunghezza 3.705 mm", "s": 1}},
 "trims": ["Pop", "Icon"],
 "powertrains": [{"name": "1.0 Hybrid 70 CV", "fuel": {"v": "mild_hybrid", "q": "1.0 Hybrid 70 CV", "s": 0}, "powerKw": {"v": 51, "q": "51 kW (70 CV)", "s": 1}}],
 "variants": [{"trim": "Pop", "powertrain": "1.0 Hybrid 70 CV", "listPrice": {"v": 15950, "q": "Pop 1.0 Hybrid 70 CV 15.950", "s": 0}}],
 "packages": [],
 "features": [{"trim": "Icon", "code": "rear_parking_sensors", "availability": "standard", "q": "Sensori di parcheggio posteriori", "s": 2}]}

${docs.map((d, i) => `===== FONTE ${i} (${d.kind}) ${d.url}\n${d.text.slice(0, perDoc)}\n===== FINE FONTE ${i}`).join('\n\n')}`;
}

export async function researchModel(task, { pages, llm, features, log }) {
  const issues = [];

  // 1) la pagina del modello: quella in archivio, oppure la cerco tra i link della home del marchio
  let modelUrl = task.url;
  if (!modelUrl) {
    const home = await pages.get(task.brandUrl);
    const candidates = usefulLinks(home, task.brandUrl).filter((l) => containsName(l.text, task.model) || containsName(l.href, task.model));
    candidates.sort((a, b) => a.href.length - b.href.length);
    modelUrl = candidates[0]?.href;
    if (!modelUrl) {
      throw new Error(`Pagina del modello ${task.model} non trovata sul sito`);
    }
  }
  const main = await pages.get(modelUrl);
  const docs = [{ url: main.url, title: main.title || `${task.brand} ${task.model}`, kind: 'official_site', text: main.text }];
  log(`  ${main.url}: ${main.text.length} caratteri, ${main.links.length} link`);

  // 2) le pagine con listino / dati tecnici / dotazioni
  const links = [
    ...usefulLinks(main, task.brandUrl ?? modelUrl),
    // i PDF dei listini a volte stanno su un altro dominio (CDN): li tengo, il server li segnerà come non ufficiali se serve
    ...main.links.filter((l) => /\.pdf(\?|$)/i.test(l.href) && !sameSite(l.href, task.brandUrl ?? modelUrl)),
  ].map((l) => scoreLink(l, task.model));

  // c'è un link evidente al listino di questo modello? Allora scelgo io (con i migliori altri), risparmio una chiamata
  const ranked = links.filter((l) => l.href !== main.url && l.score >= 4).sort((a, b) => b.score - a.score);
  let chosen;
  if (ranked[0]?.score >= 7 || llm.remaining < 2) {
    chosen = ranked.slice(0, MAX_EXTRA_PAGES);
  } else {
    const shortlist = links.filter((l) => l.href !== main.url).sort((a, b) => b.score - a.score).slice(0, 300);
    const answer = await llm.json(linksPrompt(task, main, shortlist));
    chosen = (Array.isArray(answer?.pages) ? answer.pages : [])
      .map((p) => (Number.isInteger(p?.index) && shortlist[p.index] ? { ...shortlist[p.index], kind: p.kind ?? shortlist[p.index].kind } : null))
      .filter(Boolean)
      .slice(0, MAX_EXTRA_PAGES);
  }

  for (const link of chosen) {
    if (docs.some((d) => d.url === link.href)) {
      continue;
    }
    try {
      const page = await pages.get(link.href);
      if (page.text.length > 200) {
        docs.push({
          url: page.url,
          title: page.title || link.text || page.url,
          kind: page.kind === 'pdf' && link.kind === 'official_site' ? 'official_pricelist' : link.kind,
          text: page.text,
          // linkato dalla pagina del modello: se è un PDF su un altro dominio (es. CDN del gruppo) il server lo sa
          linkedFrom: 0,
        });
        log(`  + ${page.url} (${page.kind}, ${page.text.length} caratteri)`);
      }
    } catch (error) {
      issues.push(`pagina non letta ${link.href}: ${error.message}`);
    }
  }

  // 3) estrazione e 4) verifica delle citazioni
  const answer = await llm.json(extractPrompt(task, docs, features));
  issues.push(...verifyEvidence(answer, docs));
  log(`  estratti: ${answer.powertrains?.length ?? 0} motori, ${answer.variants?.length ?? 0} versioni, ${answer.features?.length ?? 0} dotazioni; scartati ${issues.length}`);

  return {
    task: { type: 'model', id: task.id },
    ok: true,
    sources: docs.map(({ url, title, kind, linkedFrom }) => ({ url, title, kind, linkedFrom })),
    model: { ...(answer.model ?? {}), url: main.url },
    specs: answer.specs ?? {},
    trims: answer.trims ?? [],
    powertrains: answer.powertrains ?? [],
    variants: answer.variants ?? [],
    packages: answer.packages ?? [],
    features: answer.features ?? [],
    agentIssues: issues,
  };
}
