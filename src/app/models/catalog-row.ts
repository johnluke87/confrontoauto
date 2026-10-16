import { Confidence } from './catalog';

/** Una riga del listone dell'Archivio: una versione (allestimento + motore), oppure un modello ancora senza versioni. */
export interface CatalogRow {
  modelId: number;
  brandId: number;
  brand: string;
  model: string;
  bodyType: string | null;
  modelStatus: 'active' | 'discontinued';
  researchedAt: string | null;
  variantId: number | null;
  available: boolean | null;
  trim: string | null;
  powertrain: string | null;
  fuel: string | null;
  powerKw: number | null;
  powerCv: number | null;
  displacementCc: number | null;
  gearbox: string | null;
  gears: number | null;
  drive: string | null;
  consumption: number | null;
  consumptionUnit: string | null;
  electricRangeKm: number | null;
  batteryKwh: number | null;
  co2: number | null;
  timing: 'belt' | 'chain' | 'none' | null;
  // plug-in: consumo in elettrico (kWh/100km)
  electricConsumption: number | null;
  // consumi REALI dai contatori di bordo (dati UE): l/100km su tutti i km (plug-in: compresi quelli in elettrico),
  // kWh/100km presi dalla presa (plug-in), quota di km in elettrico, reale/WLTP, quante auto, a che livello
  realConsumption: number | null;
  realKwh100km: number | null;
  realEvShare: number | null;
  realFactor: number | null;
  realVehicles: number | null;
  realLevel: 'version' | 'model' | 'brand' | null;
  listPrice: number | null;
  onRoadPrice: number | null;
  priceConfidence: Confidence | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  wheelbaseMm: number | null;
  trunkL: number | null;
  trunkMaxL: number | null;
  seats: number | null;
  doors: number | null;
  weightKg: number | null;
  // es. "205/55 R16"
  tireSize: string | null;
  // pagina del modello sul sito ufficiale (o del marchio)
  modelUrl: string | null;
  // stima dei costi (calcolata nel browser con i prezzi scelti in alto nell'Archivio): null = dati insufficienti
  energyYear: number | null;
  runningYear: number | null;
  running10: number | null;
  running15: number | null;
  total10: number | null;
  total15: number | null;
  // cosa ho dovuto stimare (consumo dalla CO₂...) o perché manca qualcosa
  costNote: string | null;
  // true = qualche dato (consumo, potenza) l'ho dovuto stimare
  costGuessed: boolean;
  // il consumo usato per i costi, per 100 km (unità come consumptionUnit; plug-in: litri su tutti i km)
  usedConsumption: number | null;
  // calcolato: a listino / non più a listino / da ricercare / fuori produzione
  state: 'listed' | 'unlisted' | 'pending' | 'discontinued';
}

/** Il server manda righe compatte (liste di valori) + l'elenco dei nomi delle colonne. */
export interface CatalogRowsResponse {
  columns: string[];
  rows: unknown[][];
}

export function toCatalogRows(response: CatalogRowsResponse): CatalogRow[] {
  return response.rows.map((values) => {
    const row = Object.fromEntries(response.columns.map((name, i) => [name, values[i]])) as unknown as CatalogRow;
    // colonne aggiunte dopo: un server non ancora aggiornato non le manda
    row.timing ??= null;
    row.electricConsumption ??= null;
    row.tireSize ??= null;
    row.modelUrl ??= null;
    for (const key of ['realConsumption', 'realKwh100km', 'realEvShare', 'realFactor', 'realVehicles', 'realLevel'] as const) {
      row[key] ??= null;
    }
    row.state =
      row.modelStatus === 'discontinued' ? 'discontinued' : row.variantId === null ? 'pending' : row.available ? 'listed' : 'unlisted';
    return row;
  });
}
