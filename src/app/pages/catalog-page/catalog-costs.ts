// Stima dei costi di possesso di una versione, anno per anno per 15 anni. Funzioni "pure": niente Angular, facili da provare.
// I costi seguono i parametri dei calcoli (pagina Impostazioni) con le regole del tuo Excel: i lavori a km (gomme, freni,
// frizione) si pagano nell'anno in cui si superano i km dell'intervallo, non "un po' ogni anno".
// I ricambi sono SOLO MATERIALE (i lavori li fai tu) e costano di più o di meno secondo l'auto: i parametri valgono per
// l'auto di riferimento e qui li adatto a ogni versione. GPL e metano invece vanno in officina autorizzata (manodopera compresa).

import { FuelGroup, Parameter, RoadTaxRule } from '../../models/catalog';
import { CatalogRow } from '../../models/catalog-row';

export const YEARS = 15;

/** I valori che l'utente può cambiare in alto nell'Archivio. */
export interface CostInputs {
  petrol: number;
  diesel: number;
  lpg: number;
  cng: number;
  electricity: number;
  kmYear: number;
  // consumo reale in % del WLTP (100 = come il WLTP)
  realPct: number;
  wallbox: boolean;
}

export type CostInputKey = keyof CostInputs;

// Se un parametro manca anche sul server uso questi (i prezzi sono quelli che mi hai dato il 13/10/2026)
export const FALLBACK_INPUTS: CostInputs = {
  petrol: 2.0,
  diesel: 2.2,
  lpg: 0.8,
  cng: 1.55,
  electricity: 0.3,
  kmYear: 17500,
  realPct: 100,
  wallbox: true,
};

const INPUT_PARAMETERS: Partial<Record<CostInputKey, string>> = {
  petrol: 'fuel_price_petrol',
  diesel: 'fuel_price_diesel',
  lpg: 'fuel_price_lpg',
  cng: 'fuel_price_cng',
  electricity: 'electricity_price_home',
  kmYear: 'km_year',
  realPct: 'real_consumption_factor_pct',
};

/** I valori di partenza delle caselle in alto: i parametri del server, oppure quelli di riserva. */
export function defaultInputs(parameters: Parameter[]): CostInputs {
  const result = { ...FALLBACK_INPUTS };
  for (const [key, code] of Object.entries(INPUT_PARAMETERS) as [CostInputKey, string][]) {
    const value = parameters.find((p) => p.code === code)?.value;
    if (value !== null && value !== undefined) {
      (result as Record<CostInputKey, number | boolean>)[key] = value;
    }
  }
  return result;
}

/** Tutto quello che serve al calcolo, preparato una volta per tutte le righe. */
export interface CostContext {
  inputs: CostInputs;
  // codice parametro -> valore (solo quelli non mancanti)
  params: Map<string, number>;
  // le regole del bollo della regione dell'utente
  roadTax: RoadTaxRule[];
}

export function costContext(inputs: CostInputs, parameters: Parameter[], roadTax: RoadTaxRule[]): CostContext {
  const params = new Map<string, number>();
  for (const p of parameters) {
    if (p.value !== null) {
      params.set(p.code, p.value);
    }
  }
  return { inputs, params, roadTax };
}

export interface CarCosts {
  energyYear: number;
  // i dati che mancavano e ho stimato (es. "consumo ricavato dalla CO₂")
  guesses: string[];
  // il consumo usato (per 100 km) e da dove viene
  per100: number | null;
  energyNote: string | null;
  // costo di gestione (tutto tranne l'acquisto) di ogni anno, dal 1° al 15°
  years: number[];
}

export type CostFields = Pick<CatalogRow, 'energyYear' | 'runningYear' | 'running10' | 'running15' | 'total10' | 'total15' | 'costNote' | 'costGuessed' | 'usedConsumption'>;

export const NO_COSTS: CostFields = {
  energyYear: null,
  runningYear: null,
  running10: null,
  running15: null,
  total10: null,
  total15: null,
  costNote: null,
  costGuessed: false,
  usedConsumption: null,
};

/** Le colonne dei costi di una riga: gestione = tutto tranne l'acquisto; totale = prezzo + gestione. */
export function costFields(row: CatalogRow, ctx: CostContext): CostFields {
  const costs = carCosts(row, ctx);
  if (!costs) {
    return { ...NO_COSTS, costNote: 'Versione non ancora ricercata' };
  }
  const sum = (n: number) => costs.years.slice(0, n).reduce((a, b) => a + b, 0);
  const running10 = sum(10);
  const running15 = sum(15);
  const price = row.onRoadPrice ?? row.listPrice;
  const notes = [...(costs.energyNote ? [costs.energyNote] : []), ...costs.guesses, ...(price === null ? ['manca il prezzo: niente totali'] : [])];
  return {
    costNote: notes.length ? notes.join(' · ') : null,
    costGuessed: costs.guesses.length > 0,
    usedConsumption: costs.per100 === null ? null : Math.round(costs.per100 * 10) / 10,
    energyYear: Math.round(costs.energyYear),
    runningYear: Math.round(running10 / 10),
    running10: Math.round(running10),
    running15: Math.round(running15),
    total10: price === null ? null : Math.round(price + running10),
    total15: price === null ? null : Math.round(price + running15),
  };
}

/** Costi anno per anno. null = versione non ancora ricercata. I dati che mancano li stimo (vedi fillGaps). */
export function carCosts(original: CatalogRow, ctx: CostContext): CarCosts | null {
  if (original.variantId === null) {
    return null;
  }
  const { row, guesses } = fillGaps(original);
  const kw = row.powerKw!;
  const energy = yearlyEnergy(row, ctx);
  const energyYear = energy?.cost ?? 0;
  const p = (code: string, fallback = 0) => ctx.params.get(code) ?? fallback;
  const km = ctx.inputs.kmYear;
  const fuel = row.fuel;
  const electric = fuel === 'electric';
  const pluggable = electric || fuel === 'plugin_hybrid';
  // con la frenata rigenerativa pastiglie e dischi durano circa il doppio (stima)
  const regenerative = pluggable || fuel === 'full_hybrid';
  const roadTax = roadTaxRule(ctx.roadTax, fuel);
  const parts = partsFactor(row.weightKg, kw);
  const insurance = p('insurance_year') * insuranceFactor(row, kw);
  const tires = p('tire_set_price') * tireFactor(row.tireSize, parts);

  // quante volte si superano i km di un intervallo durante l'anno y (1 = primo anno)
  const kmEvents = (y: number, everyKm: number) => (everyKm > 0 ? Math.floor((y * km) / everyKm) - Math.floor(((y - 1) * km) / everyKm) : 0);
  const every = (y: number, years: number) => years > 0 && y % years === 0;

  const years: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    let cost = energyYear + insurance + p('unexpected_year');
    cost += roadTax ? yearlyRoadTax(kw, roadTax, y) : 0;
    cost += superbollo(kw, p('superbollo_eur_kw'), y);
    if (y <= p('service_years')) {
      cost += p('service_price');
    }
    // revisione: la prima al 4° anno, poi ogni 2
    if (y >= 4 && (y - 4) % 2 === 0) {
      cost += p('revision_price');
    }
    cost += kmEvents(y, p('tire_set_every_km')) * tires;
    cost += kmEvents(y, p('brakes_every_km') * (regenerative ? 2 : 1)) * p('brakes_job') * parts;
    if (row.gearbox === 'manual' && !electric) {
      cost += kmEvents(y, p('clutch_every_km')) * p('clutch_job') * parts;
    }
    // cinghia: anche se non sappiamo com'è la distribuzione (meglio contarla che dimenticarla)
    if (!electric && row.timing !== 'chain' && row.timing !== 'none' && every(y, p('timing_belt_every_years'))) {
      cost += p('timing_belt_job') * parts;
    }
    if (fuel === 'lpg' && y === p('lpg_tank_year')) {
      cost += p('lpg_tank_job');
    }
    if (fuel === 'cng') {
      cost += every(y, p('cng_tank_check_every_years')) ? p('cng_tank_check_price') : 0;
      cost += y === p('cng_tank_year') ? p('cng_tank_job') : 0;
    }
    if (every(y, p('battery_12v_every_years'))) {
      cost += p('battery_12v_price');
    }
    if (y === 1 && pluggable && ctx.inputs.wallbox) {
      cost += p('wallbox_price');
    }
    years.push(cost);
  }
  return { energyYear, years, guesses, per100: energy?.per100 ?? null, energyNote: energy?.note ?? null };
}

// ---- quanto costa questa auto rispetto a quella di riferimento ----

// l'auto di riferimento dei parametri: 1.350 kg, 90 kW (122 CV), gomme 205/55 R16
const REFERENCE_KG = 1350;
const REFERENCE_KW = 90;

/**
 * Freni, frizione, cinghia: un'auto più pesante e più potente ha dischi, frizione e kit più grandi (e cari).
 * Media fra peso e potenza rispetto all'auto di riferimento, fra 0,7 (citycar) e 3 (sportive).
 */
export function partsFactor(weightKg: number | null, kw: number): number {
  const power = kw / REFERENCE_KW;
  const factor = weightKg === null ? power : (weightKg / REFERENCE_KG + power) / 2;
  return Math.min(3, Math.max(0.7, factor));
}

// prezzo di una gomma rispetto a una da 16": cresce molto con il cerchio
const RIM_FACTORS: Record<number, number> = { 13: 0.6, 14: 0.7, 15: 0.8, 16: 1, 17: 1.25, 18: 1.55, 19: 1.9, 20: 2.3, 21: 2.8, 22: 3.3, 23: 3.8 };

/** Gomme: dalla misura (es. "225/45 R18"); se non la sappiamo, come gli altri ricambi (peso e potenza). */
export function tireFactor(tireSize: string | null, partsFallback: number): number {
  // "205/55 R16", "205/55R16 91V", "225/40 ZR18": se ce ne sono due (anteriori/posteriori) prendo la prima
  const match = /(\d{3})\s*\/\s*\d{2}\s*[A-Z]*?\s*R\s*(\d{2})/i.exec(tireSize ?? '');
  if (!match) {
    return partsFallback;
  }
  const width = Number(match[1]);
  const rim = Math.min(23, Math.max(13, Number(match[2])));
  return (RIM_FACTORS[rim] ?? 1) * (width / 205);
}

// RC per cilindrata (cc) e, per le elettriche o se la cilindrata manca, per potenza (kW): [fino a, fattore]
const INSURANCE_BY_CC: [number, number][] = [[1000, 0.85], [1400, 1], [1600, 1.1], [2000, 1.25], [2500, 1.45], [3000, 1.7], [Infinity, 2]];
const INSURANCE_BY_KW: [number, number][] = [[55, 0.85], [75, 1], [90, 1.1], [120, 1.25], [160, 1.45], [220, 1.7], [Infinity, 2]];

/** Assicurazione (solo RC): il parametro vale per un'auto media (1.201–1.400 cc), le più grandi pagano di più. */
export function insuranceFactor(row: Pick<CatalogRow, 'fuel' | 'displacementCc'>, kw: number): number {
  const byCc = row.fuel !== 'electric' && row.displacementCc !== null && row.displacementCc > 0;
  const bands = byCc ? INSURANCE_BY_CC : INSURANCE_BY_KW;
  const value = byCc ? row.displacementCc! : kw;
  return bands.find(([upTo]) => value <= upTo)![1];
}

// ---- dati mancanti ----

// kg di CO₂ per litro (kg per il metano) bruciato: il WLTP calcola la CO₂ proprio dal consumo, quindi si torna indietro esatti
const CO2_PER_UNIT: Record<'petrol' | 'diesel' | 'lpg' | 'cng', number> = { petrol: 2.31, diesel: 2.64, lpg: 1.66, cng: 2.72 };

/**
 * Completa i dati che servono al calcolo quando la scheda non li ha:
 * potenza dai CV (o quella dell'auto di riferimento); consumo dalla CO₂ WLTP, altrimenti da peso e potenza.
 */
export function fillGaps(original: CatalogRow): { row: CatalogRow; guesses: string[] } {
  const row = { ...original };
  const guesses: string[] = [];
  const kg = row.weightKg ?? REFERENCE_KG;

  if (row.powerKw === null) {
    if (row.powerCv !== null) {
      row.powerKw = row.powerCv * 0.7355;
    } else {
      row.powerKw = REFERENCE_KW;
      guesses.push('potenza sconosciuta: uso 122 CV');
    }
  }
  const kw = row.powerKw;
  const fromWeight = row.weightKg === null ? 'potenza' : 'peso e potenza';

  if (row.fuel === 'electric') {
    if ((row.consumptionUnit === 'kwh_100km' ? row.consumption : row.electricConsumption) === null) {
      row.consumption = estimatedKwh(kg);
      row.consumptionUnit = 'kwh_100km';
      guesses.push(row.weightKg === null ? 'consumo stimato da un peso medio' : 'consumo stimato dal peso');
    }
    return { row, guesses };
  }

  if (row.consumption === null || row.consumptionUnit === 'kwh_100km') {
    const kind = fuelKind(row);
    if (row.co2 !== null && row.co2 > 0) {
      row.consumption = row.co2 / 10 / CO2_PER_UNIT[kind];
      guesses.push('consumo ricavato dalla CO₂');
    } else {
      row.consumption = estimatedFuel(row.fuel, kind, kw, kg);
      guesses.push('consumo stimato da ' + fromWeight);
    }
    row.consumptionUnit = kind === 'cng' ? 'kg_100km' : 'l_100km';
  }
  if (row.fuel === 'plugin_hybrid' && (row.electricConsumption === null || row.electricConsumption < 10)) {
    row.electricConsumption = estimatedKwh(kg);
    guesses.push('consumo elettrico stimato dal peso');
  }
  return { row, guesses };
}

/** Elettriche: kWh/100km WLTP circa 9 + 6 ogni tonnellata (una 1.350 kg fa ~17). */
function estimatedKwh(kg: number): number {
  return 9 + 0.006 * kg;
}

/** Consumo WLTP tipico da potenza e peso (benzina: 1.350 kg e 90 kW fanno ~6,3 l/100km), corretto per alimentazione. */
function estimatedFuel(fuel: string | null, kind: keyof typeof CO2_PER_UNIT, kw: number, kg: number): number {
  const petrol = 2.5 + 0.015 * kw + 0.0018 * kg;
  const hybrid = fuel === 'full_hybrid' ? 0.75 : fuel === 'mild_hybrid' ? 0.93 : 1;
  const byFuel = { petrol: 1, diesel: 0.82, lpg: 1.25, cng: 0.65 }[kind];
  // plug-in: consumo a batteria scarica (resta sopra i 4 l/100km, quindi non viene "ripesato")
  return Math.max(fuel === 'plugin_hybrid' ? 4.5 : 0, petrol * hybrid * byFuel);
}

function fuelKind(row: CatalogRow): keyof typeof CO2_PER_UNIT {
  if (row.fuel === 'lpg' || row.fuel === 'cng') {
    return row.fuel;
  }
  return row.fuel === 'diesel' || DIESEL_NAME.test(row.powertrain ?? '') ? 'diesel' : 'petrol';
}

// ---- energia ----

export interface Energy {
  // euro all'anno
  cost: number;
  // il consumo usato, per 100 km: litri (kg il metano), kWh le elettriche; plug-in: litri su tutti i km
  per100: number;
  // da dove viene il consumo (WLTP + %, consumo reale UE...)
  note: string;
}

const pct = (factor: number) => `${factor >= 1 ? '+' : ''}${Math.round((factor - 1) * 100)}%`;
// 3313 -> "3.313" (senza Intl: nei test non ci sono i dati delle lingue)
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, '.');
const REAL_LEVELS ={ version: 'stessa versione', model: 'stesso modello', brand: 'stessa marca' } as const;

/** Il consumo reale UE di questa versione, a parole: "consumo reale UE: 1.234 auto, stessa versione". */
function realNote(row: CatalogRow): string {
  return `consumo reale UE: ${thousands(row.realVehicles ?? 0)} auto, ${REAL_LEVELS[row.realLevel!]}`;
}

/**
 * Carburante e/o corrente di un anno. Il consumo, nell'ordine:
 * 1. consumo REALE UE della stessa versione (contatori di bordo di migliaia di auto);
 * 2. WLTP × il rapporto reale/WLTP dello stesso modello o della stessa marca (sempre dati UE);
 * 3. WLTP × la percentuale scelta in alto (elettriche, GPL, metano, modelli senza dati UE).
 * null = consumo sconosciuto.
 */
export function yearlyEnergy(row: CatalogRow, ctx: CostContext): Energy | null {
  const { inputs } = ctx;
  const real = inputs.realPct / 100;
  const losses = 1 + (ctx.params.get('charging_losses_pct') ?? 0) / 100;
  const per100 = inputs.kmYear / 100;
  const pctNote = `consumo: WLTP ${pct(real)}`;

  if (row.fuel === 'electric') {
    const kwh = row.consumptionUnit === 'kwh_100km' ? row.consumption : row.electricConsumption;
    return kwh === null ? null : { cost: kwh * real * losses * per100 * inputs.electricity, per100: kwh * real, note: pctNote };
  }

  const fuel = fuelUse(row);
  if (fuel === null) {
    return null;
  }
  const kwhWltp = row.electricConsumption !== null && row.electricConsumption >= 10 ? row.electricConsumption : estimatedKwh(row.weightKg ?? REFERENCE_KG);

  if (row.fuel === 'plugin_hybrid' && row.realConsumption !== null && row.realLevel) {
    // plug-in con dati UE: litri su tutti i km e corrente presa dalla presa, come le usa davvero la gente
    const kwh = row.realKwh100km ?? (row.realEvShare !== null ? row.realEvShare * kwhWltp : 0);
    const share = row.realEvShare === null ? '' : `, ${Math.round(row.realEvShare * 100)}% dei km in elettrico`;
    return {
      cost: row.realConsumption * per100 * fuel.price(inputs) + kwh * losses * per100 * inputs.electricity,
      per100: row.realConsumption,
      note: realNote(row) + share,
    };
  }

  if (row.fuel !== 'plugin_hybrid') {
    const [amount, note] =
      row.realConsumption !== null && row.realLevel
        ? [row.realConsumption, realNote(row)]
        : row.realFactor !== null && row.realLevel
          ? [fuel.amount * row.realFactor, `${realNote(row)} (WLTP ${pct(row.realFactor)})`]
          : [fuel.amount * real, pctNote];
    return { cost: amount * per100 * fuel.price(inputs), per100: amount, note };
  }

  // plug-in senza dati UE: una parte dei km in elettrico (parametro), il resto con la batteria "scarica"
  const share = Math.min(100, Math.max(0, ctx.params.get('phev_electric_share_pct') ?? 50)) / 100;
  const electricPart = share * kwhWltp * real * losses * per100 * inputs.electricity;
  const litres = (1 - share) * chargeSustaining(fuel.amount, row.electricRangeKm) * real;
  return {
    cost: electricPart + litres * per100 * fuel.price(inputs),
    per100: litres,
    note: `${pctNote}, ${Math.round(share * 100)}% dei km in elettrico`,
  };
}

/** Quanto consuma (per 100 km) e a che prezzo, secondo l'unità del consumo e il tipo di carburante. */
function fuelUse(row: CatalogRow): { amount: number; price: (i: CostInputs) => number } | null {
  if (row.consumption === null || row.consumptionUnit === 'kwh_100km') {
    return null;
  }
  if (row.consumptionUnit === 'kg_100km') {
    return { amount: row.consumption, price: (i) => i.cng };
  }
  if (row.fuel === 'lpg') {
    return { amount: row.consumption, price: (i) => i.lpg };
  }
  // le ibride possono essere anche diesel: lo capisco dal nome del motore
  const diesel = row.fuel === 'diesel' || (row.fuel !== 'cng' && DIESEL_NAME.test(row.powertrain ?? ''));
  return { amount: row.consumption, price: (i) => (diesel ? i.diesel : i.petrol) };
}

const DIESEL_NAME = /diesel|\b(tdi|dci|cdi|crdi|hdi|bluehdi|multijet|ecoblue|jtd|jtdm|d-4d|skyactiv-d)\b/i;

/**
 * Il WLTP di una plug-in è un consumo "medio pesato" che conta anche i km in elettrico (es. 1 l/100km).
 * Per il consumo a batteria scarica divido per la quota di km a benzina della norma WLTP (utility factor UE).
 */
export function chargeSustaining(weighted: number, rangeKm: number | null): number {
  if (weighted >= 4) {
    return weighted; // sembra già il consumo a batteria scarica
  }
  const uf = utilityFactor(rangeKm ?? 50);
  return weighted / Math.max(0.05, 1 - uf);
}

const UF_COEFFICIENTS = [26.25, -38.94, -631.05, 5964.83, -25095, 60380.2, -87517, 75513.8, -35749, 7154.94];

/** Utility factor della norma WLTP (Reg. UE 2017/1151): la quota di km fatti in elettrico data l'autonomia. */
export function utilityFactor(rangeKm: number): number {
  const d = Math.min(rangeKm, 800) / 800;
  const sum = UF_COEFFICIENTS.reduce((acc, c, i) => acc + c * d ** (i + 1), 0);
  return 1 - Math.exp(-sum);
}

// ---- bollo ----

export function fuelGroup(fuel: string | null): FuelGroup {
  switch (fuel) {
    case 'lpg':
    case 'cng':
      return 'lpg_cng';
    case 'mild_hybrid':
    case 'full_hybrid':
      return 'hybrid';
    case 'plugin_hybrid':
      return 'plugin_hybrid';
    case 'electric':
      return 'electric';
    default:
      return 'thermal';
  }
}

function roadTaxRule(rules: RoadTaxRule[], fuel: string | null): RoadTaxRule | null {
  const group = fuelGroup(fuel);
  return rules.find((r) => r.fuelGroup === group) ?? rules.find((r) => r.fuelGroup === 'thermal') ?? null;
}

/** Bollo dell'anno y: €/kW fino a 100 kW + €/kW oltre, gratis negli anni di esenzione, poi la percentuale ridotta. */
export function yearlyRoadTax(kw: number, rule: RoadTaxRule, y: number): number {
  const full = Math.min(kw, 100) * (rule.rateUpTo100Kw ?? 0) + Math.max(0, kw - 100) * (rule.rateOver100Kw ?? rule.rateUpTo100Kw ?? 0);
  if (y <= rule.exemptYears) {
    return 0;
  }
  return rule.exemptYears > 0 ? (full * rule.afterExemptPct) / 100 : full;
}

/** Superbollo: €/kW oltre i 185 kW, ridotto al 60% dopo 5 anni, al 30% dopo 10, al 15% dopo 15. */
export function superbollo(kw: number, eurPerKw: number, y: number): number {
  if (kw <= 185) {
    return 0;
  }
  const pct = y > 15 ? 0.15 : y > 10 ? 0.3 : y > 5 ? 0.6 : 1;
  return (kw - 185) * eurPerKw * pct;
}
