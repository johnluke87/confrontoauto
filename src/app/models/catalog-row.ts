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
    row.state =
      row.modelStatus === 'discontinued' ? 'discontinued' : row.variantId === null ? 'pending' : row.available ? 'listed' : 'unlisted';
    return row;
  });
}
