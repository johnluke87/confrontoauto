// Colonne, filtri e ordinamento del listone dell'Archivio. Funzioni "pure": niente Angular, facili da provare.

import { BODY_TYPE_LABELS, FUEL_LABELS } from '../../models/car';
import { CatalogRow } from '../../models/catalog-row';

export type ColumnType = 'text' | 'enum' | 'number' | 'money';
export type ColumnKey = keyof CatalogRow;

export interface Column {
  key: ColumnKey;
  label: string;
  type: ColumnType;
  unit?: string;
  // per le colonne "enum": il nome da mostrare per ogni valore
  labels?: Record<string, string>;
  decimals?: number;
  // mostrata di default
  visible?: boolean;
}

const GEARBOX = { manual: 'Manuale', automatic: 'Automatico' };
const DRIVE = { fwd: 'Anteriore', rwd: 'Posteriore', awd: 'Integrale' };
const STATE = { listed: 'A listino', unlisted: 'Non più a listino', pending: 'Da ricercare', discontinued: 'Fuori produzione' };

export const COLUMNS: Column[] = [
  { key: 'brand', label: 'Marchio', type: 'enum', visible: true },
  { key: 'model', label: 'Modello', type: 'text', visible: true },
  { key: 'bodyType', label: 'Carrozzeria', type: 'enum', labels: BODY_TYPE_LABELS, visible: true },
  { key: 'trim', label: 'Allestimento', type: 'text', visible: true },
  { key: 'powertrain', label: 'Motore', type: 'text', visible: true },
  { key: 'fuel', label: 'Alimentazione', type: 'enum', labels: FUEL_LABELS, visible: true },
  { key: 'powerCv', label: 'CV', type: 'number', visible: true },
  { key: 'powerKw', label: 'kW', type: 'number' },
  { key: 'displacementCc', label: 'Cilindrata', type: 'number', unit: 'cm³' },
  { key: 'gearbox', label: 'Cambio', type: 'enum', labels: GEARBOX, visible: true },
  { key: 'gears', label: 'Marce', type: 'number' },
  { key: 'drive', label: 'Trazione', type: 'enum', labels: DRIVE },
  { key: 'consumption', label: 'Consumo WLTP', type: 'number', decimals: 1, visible: true },
  { key: 'electricRangeKm', label: 'Autonomia el.', type: 'number', unit: 'km' },
  { key: 'batteryKwh', label: 'Batteria', type: 'number', unit: 'kWh', decimals: 1 },
  { key: 'co2', label: 'CO₂', type: 'number', unit: 'g/km', visible: true },
  { key: 'listPrice', label: 'Listino', type: 'money', visible: true },
  { key: 'onRoadPrice', label: 'Chiavi in mano', type: 'money', visible: true },
  { key: 'lengthMm', label: 'Lunghezza', type: 'number', unit: 'mm', visible: true },
  { key: 'widthMm', label: 'Larghezza', type: 'number', unit: 'mm' },
  { key: 'heightMm', label: 'Altezza', type: 'number', unit: 'mm' },
  { key: 'wheelbaseMm', label: 'Passo', type: 'number', unit: 'mm' },
  { key: 'trunkL', label: 'Bagagliaio', type: 'number', unit: 'l', visible: true },
  { key: 'trunkMaxL', label: 'Bagagliaio max', type: 'number', unit: 'l' },
  { key: 'seats', label: 'Posti', type: 'number', visible: true },
  { key: 'doors', label: 'Porte', type: 'number' },
  { key: 'weightKg', label: 'Peso', type: 'number', unit: 'kg' },
  { key: 'state', label: 'Stato', type: 'enum', labels: STATE, visible: true },
];

export const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.visible).map((c) => c.key);

export interface Sort {
  key: ColumnKey;
  dir: 1 | -1;
}

export interface Range {
  min: number | null;
  max: number | null;
}

/** Tutti i filtri: testo nelle colonne di testo, valori scelti nelle "enum", minimo/massimo nei numeri. */
export interface Filters {
  search: string;
  text: Partial<Record<ColumnKey, string>>;
  enums: Partial<Record<ColumnKey, string[]>>;
  ranges: Partial<Record<ColumnKey, Range>>;
}

export const EMPTY_FILTERS: Filters = { search: '', text: {}, enums: {}, ranges: {} };

// '' = valore mancante (es. carrozzeria non ancora nota)
export function enumValue(row: CatalogRow, key: ColumnKey): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value);
}

/** Il testo mostrato in una cella. */
export function cellText(row: CatalogRow, column: Column): string {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') {
    return '';
  }
  switch (column.type) {
    case 'enum':
      return column.labels?.[String(value)] ?? String(value);
    case 'money':
      return EURO.format(value as number);
    case 'number': {
      const n = formatNumber(value as number, column.decimals ?? 0);
      if (column.key === 'consumption') {
        return `${n} ${{ l_100km: 'l/100km', kg_100km: 'kg/100km', kwh_100km: 'kWh/100km' }[row.consumptionUnit ?? 'l_100km'] ?? ''}`;
      }
      return column.unit ? `${n} ${column.unit}` : n;
    }
    default:
      return String(value);
  }
}

const EURO = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const NUMBERS = new Map<number, Intl.NumberFormat>();
function formatNumber(value: number, decimals: number): string {
  if (!NUMBERS.has(decimals)) {
    NUMBERS.set(decimals, new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }));
  }
  return NUMBERS.get(decimals)!.format(value);
}

/** Le righe che passano TUTTI i filtri. */
export function applyFilters(rows: CatalogRow[], filters: Filters): CatalogRow[] {
  const search = filters.search.trim().toLowerCase();
  const texts = Object.entries(filters.text).filter(([, v]) => v && v.trim() !== '') as [ColumnKey, string][];
  const enums = Object.entries(filters.enums).filter(([, v]) => v && v.length > 0) as [ColumnKey, string[]][];
  const ranges = Object.entries(filters.ranges).filter(([, r]) => r && (r.min !== null || r.max !== null)) as [ColumnKey, Range][];
  const enumSets = enums.map(([key, values]) => [key, new Set(values)] as const);

  return rows.filter((row) => {
    if (search && !`${row.brand} ${row.model} ${row.trim ?? ''} ${row.powertrain ?? ''}`.toLowerCase().includes(search)) {
      return false;
    }
    for (const [key, text] of texts) {
      if (!String(row[key] ?? '').toLowerCase().includes(text.trim().toLowerCase())) {
        return false;
      }
    }
    for (const [key, set] of enumSets) {
      if (!set.has(enumValue(row, key))) {
        return false;
      }
    }
    for (const [key, range] of ranges) {
      const value = row[key] as number | null;
      // chi filtra per numero vuole righe CON quel numero: le vuote spariscono
      if (value === null || (range.min !== null && value < range.min) || (range.max !== null && value > range.max)) {
        return false;
      }
    }
    return true;
  });
}

/** Ordinamento su più colonne: prima per la prima, a parità per la seconda, ecc. Le celle vuote vanno sempre in fondo. */
export function applySorts(rows: CatalogRow[], sorts: Sort[]): CatalogRow[] {
  if (sorts.length === 0) {
    return rows;
  }
  const columns = sorts.map((s) => ({ ...s, column: COLUMNS.find((c) => c.key === s.key)! })).filter((s) => s.column);
  const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    for (const { column, dir } of columns) {
      const va = sortValue(a, column);
      const vb = sortValue(b, column);
      if (va === null && vb === null) {
        continue;
      }
      if (va === null) {
        return 1;
      }
      if (vb === null) {
        return -1;
      }
      const diff = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
      if (diff !== 0) {
        return diff * dir;
      }
    }
    return 0;
  });
}

function sortValue(row: CatalogRow, column: Column): string | number | null {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (column.type === 'enum') {
    return column.labels?.[String(value)] ?? String(value);
  }
  return value as string | number;
}

/** CSV per Excel italiano: separatore ";" e virgola decimale. */
export function toCsv(rows: CatalogRow[], columns: Column[]): string {
  const escape = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const value = (row: CatalogRow, c: Column) => {
    const v = row[c.key];
    if (v === null || v === undefined) {
      return '';
    }
    if (c.type === 'number' || c.type === 'money') {
      return String(v).replace('.', ',');
    }
    return c.type === 'enum' ? (c.labels?.[String(v)] ?? String(v)) : String(v);
  };
  const header = columns.map((c) => escape(c.unit ? `${c.label} (${c.unit})` : c.label)).join(';');
  return [header, ...rows.map((r) => columns.map((c) => escape(value(r, c))).join(';'))].join('\r\n');
}
