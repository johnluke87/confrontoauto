/**
 * Affidabilità di ogni dato:
 * official = 🟢 ufficiale (listino, configuratore, scheda della casa)
 * verified = 🟡 verificato da più fonti
 * estimate = 🟠 stima
 * missing  = 🔴 mancante (il valore è null: non si inventa)
 */
export type Confidence = 'official' | 'verified' | 'estimate' | 'missing';

export interface DataSource {
  id: number;
  title: string;
  url: string | null;
  type: string;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  officialUrl: string | null;
  // i marchi attivi sono quelli che il Research agent aggiorna ogni mese
  enabled: boolean;
  lastResearchedAt: string | null;
  models: number;
}

export type FuelGroup = 'thermal' | 'lpg_cng' | 'hybrid' | 'plugin_hybrid' | 'electric';

export interface RoadTaxRule {
  fuelGroup: FuelGroup;
  rateUpTo100Kw: number | null;
  rateOver100Kw: number | null;
  exemptYears: number;
  // dopo gli anni di esenzione si paga questa percentuale (es. 25 = un quarto)
  afterExemptPct: number;
  note: string | null;
  confidence: Confidence;
  source: DataSource | null;
  updatedAt: string;
}

export interface Region {
  code: string;
  name: string;
  roadTax: RoadTaxRule[];
}

export interface Parameter {
  code: string;
  label: string;
  value: number | null;
  unit: string;
  note: string | null;
  confidence: Confidence;
  source: DataSource | null;
  validFrom: string | null;
  updatedAt: string;
}

export interface UserSettings {
  regionCode: string;
}
