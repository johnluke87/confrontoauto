// Consumi REALI dai dati ufficiali UE: l'Agenzia europea dell'ambiente (EEA) pubblica ogni anno il consumo letto dai
// contatori di bordo (OBFCM) di milioni di auto immatricolate in Europa, con marca, modello, kW e cilindrata di ognuna.
// Licenza CC-BY 4.0. Qui: lettura del file (2 GB, riga per riga), raggruppamento e abbinamento ai nostri motori.
// Elettriche pure, GPL e metano non ci sono (o l'EEA stessa non li usa): restano al WLTP.

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

export const DEFAULT_DATASET = 'https://sdi.eea.europa.eu/data/13e6fad9-149c-4b86-9d83-cdf3569ccfee';

// ---- testo ----

/** "Citroën ë-C4" -> "CITROEN E-C4" */
function plain(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

const BRAND_ALIASES = { VW: 'VOLKSWAGEN', MERCEDES: 'MERCEDESBENZ', MERCEDESAMG: 'MERCEDESBENZ', LYNKANDCO: 'LYNKCO', DSAUTOMOBILES: 'DS' };

export function brandKey(name) {
  const key = plain(name).replace(/&/g, 'AND').replace(/[^A-Z0-9]/g, '').replace(/^LYNKANDCO$/, 'LYNKCO');
  return BRAND_ALIASES[key] ?? key;
}

// parole che nei nomi dei modelli non distinguono niente
const NOISE = new Set(['CLASSE', 'CLASS', 'SERIE', 'SERIES', 'NUOVA', 'NUOVO', 'NEW', 'THE', 'ALL']);

/** "T-Roc" -> ["TROC"], "ID.3" -> ["ID3"], "Serie 3 Touring" -> ["3", "TOURING"] */
export function tokens(text) {
  return plain(text)
    .replace(/([A-Z0-9])[-.]([A-Z0-9])/g, '$1$2')
    .split(/[^A-Z0-9]+/)
    .filter((t) => t && !NOISE.has(t));
}

/** Il nome commerciale senza la marca davanti ("TOYOTA COROLLA" -> ["COROLLA"]). */
export function modelTokens(commercialName, brand) {
  const brandWords = new Set(tokens(brand));
  const words = tokens(commercialName);
  while (words.length > 1 && brandWords.has(words[0])) {
    words.shift();
  }
  return words;
}

/** Un token del nostro modello corrisponde a uno del nome UE; "3" (Serie 3) va bene anche con "320D". */
function tokenMatches(ours, theirs) {
  return ours === theirs || (/^\d$/.test(ours) && new RegExp(`^${ours}\\d\\d[A-Z]*$`).test(theirs));
}

// ---- CSV ----

/** Una riga CSV con i campi tra virgolette ("XG1TJ(JP,M)"). */
export function parseCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const num = (value) => {
  const n = Number(value);
  return value === '' || value === 'NULL' || !Number.isFinite(n) ? null : n;
};

// kg di CO₂ per litro: per ricavare il consumo WLTP dalla CO₂ quando la colonna del consumo è vuota
const CO2_PER_LITRE = { petrol: 2.31, diesel: 2.64 };

// ---- raggruppamento ----

// i numeri di ogni gruppo: [auto, litri, km, Σ(WLTP × km), km con WLTP, kWh dalla presa, km con kWh, km elettrici, km con km elettrici]
const N = 0, FUEL = 1, DIST = 2, WLTP = 3, WLTP_DIST = 4, GRID = 5, GRID_DIST = 6, EV = 7, EV_DIST = 8;

/**
 * Raggruppa le auto per marca | modello | benzina/diesel | tipo (M normale, H ibrida, P plug-in) | kW | cilindrata.
 * Tiene solo le auto che l'EEA stessa usa nei calcoli ("Used in calculation" = 1) e con dati sensati.
 * @param {AsyncIterable<string>} lines le righe del CSV, intestazione compresa
 */
export async function aggregate(lines, onProgress = () => {}) {
  const groups = new Map();
  let at = null; // nome colonna -> posizione
  let columns = 0;
  let read = 0;
  let kept = 0;
  for await (const raw of lines) {
    if (!at) {
      const header = parseCsvLine(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
      columns = header.length;
      at = Object.fromEntries(header.map((name, i) => [name, i]));
      continue;
    }
    if (++read % 500_000 === 0) {
      onProgress(read, kept);
    }
    const v = parseCsvLine(raw);
    if (v.length !== columns) {
      continue;
    }
    // row['Ft'] = il valore della colonna Ft di questa riga
    const row = new Proxy(v, { get: (values, name) => values[at[name]] });
    if (row['Used in calculation'] !== '1') {
      continue;
    }
    const ft = row.Ft?.toLowerCase();
    const fm = row.Fm?.toUpperCase();
    const base = ft === 'petrol' || ft === 'petrol/electric' ? 'petrol' : ft === 'diesel' || ft === 'diesel/electric' ? 'diesel' : null;
    if (!base || !['M', 'H', 'P'].includes(fm)) {
      continue;
    }
    const fuel = num(row['Total fuel consumed (lifetime) (l)']);
    const dist = num(row['Total distance travelled (lifetime) (km)']);
    if (fuel === null || dist === null || dist < 500) {
      continue;
    }
    const l100 = (fuel / dist) * 100;
    if (l100 > 30 || l100 < (fm === 'P' ? 0.3 : 2)) {
      continue;
    }
    const key = [brandKey(row.Mk), modelTokens(row.Cn, row.Mk).join(' '), base, fm, num(row['Ep (KW)']) ?? '', num(row['Ec (cm3)']) ?? ''].join('|');
    let g = groups.get(key);
    if (!g) {
      g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      groups.set(key, g);
    }
    g[N]++;
    g[FUEL] += fuel;
    g[DIST] += dist;
    const co2 = num(row['Ewltp (g/km)']);
    const wltp = num(row['Fuel consumption']) || (co2 ? co2 / 10 / CO2_PER_LITRE[base] : null);
    if (wltp) {
      g[WLTP] += wltp * dist;
      g[WLTP_DIST] += dist;
    }
    const grid = num(row['Total grid energy into the battery (lifetime) (kWh)']);
    if (fm === 'P' && grid !== null) {
      g[GRID] += grid;
      g[GRID_DIST] += dist;
    }
    const ev = num(row['Total distance travelled in charge depleting operation with engine off (lifetime) (km)']);
    if (fm === 'P' && ev !== null && ev <= dist) {
      g[EV] += ev;
      g[EV_DIST] += dist;
    }
    kept++;
  }
  return { groups: Object.fromEntries(groups), read, kept };
}

// ---- download ----

/** La cartella condivisa dell'EEA (Nextcloud): trova il file delle auto, l'anno e come scaricarlo. */
export async function locateDataset(datasetUrl, userAgent) {
  // senza Accept e Accept-Language il server risponde 403
  const page = await fetch(datasetUrl, { headers: { 'User-Agent': userAgent, Accept: 'text/html', 'Accept-Language': 'en' }, redirect: 'follow' });
  const html = await page.text();
  const token = /sharingToken"[^>]*?value="([^"]+)"/.exec(html)?.[1] ?? /\/s\/([A-Za-z0-9]+)/.exec(html)?.[1];
  if (!token) {
    throw new Error(`Non trovo la cartella dei dati in ${datasetUrl}`);
  }
  const origin = new URL(page.url).origin;
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64');
  const listing = await fetch(`${origin}/datashare/public.php/webdav/`, {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '1', 'User-Agent': userAgent },
  });
  const xml = await listing.text();
  const file = [...xml.matchAll(/<d:href>([^<]*?(\d{4})_Cars_Raw\.csv)<\/d:href>/g)][0];
  if (!file) {
    throw new Error('Nella cartella EEA non c\'è il file *_Cars_Raw.csv');
  }
  return { url: origin + file[1], year: Number(file[2]), auth, token };
}

/** Le righe del CSV direttamente dalla rete, senza salvarlo (2 GB). */
export async function* downloadLines({ url, auth }, userAgent) {
  const response = await fetch(url, { headers: { Authorization: auth, 'User-Agent': userAgent } });
  if (!response.ok || !response.body) {
    throw new Error(`Download dei dati EEA: HTTP ${response.status}`);
  }
  yield* createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
}

// ---- abbinamento ai nostri motori ----

const DIESEL_NAME = /diesel|\b(tdi|dci|cdi|crdi|hdi|bluehdi|multijet|ecoblue|jtd|jtdm|d-4d|skyactiv-d)\b/i;

// quante auto servono per fidarsi: stessa versione, stesso modello (rapporto reale/WLTP), stessa marca (rapporto)
const MIN_VERSION = 20;
const MIN_MODEL = 50;
const MIN_BRAND = 200;

/** Prepara i gruppi per marca, per cercarli velocemente. */
export function indexGroups(groups) {
  const byBrand = new Map();
  for (const [key, sums] of Object.entries(groups)) {
    const [brand, model, base, fm, kw, cc] = key.split('|');
    if (!byBrand.has(brand)) {
      byBrand.set(brand, []);
    }
    byBrand.get(brand).push({ model: model ? model.split(' ') : [], base, fm, kw: kw === '' ? null : Number(kw), cc: cc === '' ? null : Number(cc), sums });
  }
  return byBrand;
}

function total(list) {
  const t = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const g of list) {
    g.sums.forEach((value, i) => (t[i] += value));
  }
  return t;
}

/**
 * Il consumo reale di un nostro motore.
 * @param {{id:number, brand:string, model:string, name:string, fuel:string, powerKw:number|null, powerCv:number|null, displacementCc:number|null}} pt
 * @returns {{powertrainId:number, level:string|null, vehicles?:number, realConsumption?:number|null, realKwh100km?:number|null, realEvShare?:number|null, factor?:number|null}}
 */
export function matchPowertrain(pt, index) {
  const none = { powertrainId: pt.id, level: null };
  if (!['petrol', 'diesel', 'mild_hybrid', 'full_hybrid', 'plugin_hybrid'].includes(pt.fuel)) {
    return none;
  }
  const base = pt.fuel === 'diesel' || DIESEL_NAME.test(pt.name ?? '') ? 'diesel' : 'petrol';
  // le mild hybrid l'UE le conta a volte come normali, a volte come ibride
  const fms = pt.fuel === 'full_hybrid' ? ['H'] : pt.fuel === 'plugin_hybrid' ? ['P'] : ['M', 'H'];
  const plugin = pt.fuel === 'plugin_hybrid';
  const sameFuel = (index.get(brandKey(pt.brand)) ?? []).filter((g) => g.base === base && fms.includes(g.fm));
  if (sameFuel.length === 0) {
    return none;
  }

  // il modello: tutte le parole del nostro nome nel nome UE; se nessuno, basta la prima ("Golf Variant" -> "GOLF")
  const ours = tokens(pt.model);
  const has = (g, words) => words.length > 0 && words.every((w) => g.model.some((t) => tokenMatches(w, t)));
  let sameModel = sameFuel.filter((g) => has(g, ours));
  if (sameModel.length === 0 && ours.length > 1) {
    sameModel = sameFuel.filter((g) => has(g, ours.slice(0, 1)));
  }

  const kw = pt.powerKw ?? (pt.powerCv === null ? null : pt.powerCv * 0.7355);
  const cc = pt.displacementCc;
  const sameVersion =
    kw === null
      ? []
      : sameModel.filter((g) => g.kw !== null && Math.abs(g.kw - kw) <= Math.max(3, kw * 0.03) && (cc === null || g.cc === null || Math.abs(g.cc - cc) <= 60));

  const result = (level, list, absolute) => {
    const t = total(list);
    const real = (t[FUEL] / t[DIST]) * 100;
    const wltp = t[WLTP_DIST] > 0 ? t[WLTP] / t[WLTP_DIST] : null;
    const round = (n, d) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
    return {
      powertrainId: pt.id,
      level,
      vehicles: t[N],
      realConsumption: absolute ? round(real, 2) : null,
      // plug-in: il rapporto con il WLTP "pesato" non dice niente
      factor: !plugin && wltp ? round(real / wltp, 3) : null,
      realKwh100km: plugin && t[GRID_DIST] > 0 ? round((t[GRID] / t[GRID_DIST]) * 100, 2) : null,
      realEvShare: plugin && t[EV_DIST] > 0 ? round(t[EV] / t[EV_DIST], 3) : null,
    };
  };

  if (total(sameVersion)[N] >= MIN_VERSION) {
    return result('version', sameVersion, true);
  }
  if (total(sameModel)[N] >= MIN_MODEL) {
    return result('model', sameModel, plugin);
  }
  if (!plugin && total(sameFuel)[N] >= MIN_BRAND) {
    return result('brand', sameFuel, false);
  }
  return none;
}
