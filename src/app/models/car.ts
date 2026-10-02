import { Confidence } from './catalog';

export type Fuel = 'petrol' | 'diesel' | 'lpg' | 'cng' | 'mild_hybrid' | 'full_hybrid' | 'plugin_hybrid' | 'electric';

/** Da dove viene un singolo dato: fonte, affidabilità e la frase esatta della fonte. */
export interface FieldProvenance {
  sourceId: number | null;
  confidence: Confidence;
  quote: string | null;
  checkedAt: string | null;
}

export type Provenance = Partial<Record<string, FieldProvenance>>;

export interface ModelSummary {
  id: number;
  name: string;
  slug: string;
  bodyType: string | null;
  status: 'active' | 'discontinued';
  lastResearchedAt: string | null;
  variants: number;
  // true = "cerca subito": il Research agent lo fa prima degli altri
  queued: boolean;
  minPriceCents: number | null;
}

export interface Powertrain {
  id: number;
  name: string;
  fuel: Fuel;
  cylinders: number | null;
  displacementCc: number | null;
  powerKw: number | null;
  powerCv: number | null;
  gearbox: 'manual' | 'automatic' | null;
  gears: number | null;
  drive: 'fwd' | 'rwd' | 'awd' | null;
  timing: 'belt' | 'chain' | 'none' | null;
  consumptionWltp: number | null;
  consumptionUnit: 'l_100km' | 'kg_100km' | 'kwh_100km' | null;
  electricConsumptionWltp: number | null;
  batteryKwh: number | null;
  electricRangeKm: number | null;
  co2GKm: number | null;
  euroClass: string | null;
  tankL: number | null;
  lpgTankL: number | null;
  provenance: Provenance;
}

export interface Variant {
  id: number;
  trimId: number;
  powertrainId: number;
  listPriceCents: number | null;
  onRoadCents: number | null;
  priceValidFrom: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  wheelbaseMm: number | null;
  trunkL: number | null;
  trunkMaxL: number | null;
  seats: number | null;
  doors: number | null;
  weightKg: number | null;
  tireSize: string | null;
  available: boolean;
  provenance: Provenance;
}

export interface CarPackage {
  id: number;
  trimId: number;
  name: string;
  priceCents: number | null;
  features: string[];
  sourceId: number | null;
  confidence: Confidence;
}

export interface TrimFeature {
  trimId: number;
  code: string;
  availability: 'standard' | 'optional' | 'package' | 'not_available';
  priceCents: number | null;
  packageId: number | null;
  sourceId: number | null;
  confidence: Confidence;
}

export interface CarSource {
  id: number;
  url: string | null;
  title: string;
  type: string;
  fetchedAt: string | null;
}

export interface ModelDetail {
  id: number;
  brandId: number;
  brand: string;
  name: string;
  bodyType: string | null;
  generation: string | null;
  officialUrl: string | null;
  status: 'active' | 'discontinued';
  lastResearchedAt: string | null;
  trims: { id: number; name: string }[];
  powertrains: Powertrain[];
  variants: Variant[];
  packages: CarPackage[];
  trimFeatures: TrimFeature[];
  features: { code: string; name: string; category: string }[];
  sources: CarSource[];
}

export const FUEL_LABELS: Record<Fuel, string> = {
  petrol: 'Benzina',
  diesel: 'Diesel',
  lpg: 'GPL',
  cng: 'Metano',
  mild_hybrid: 'Mild hybrid',
  full_hybrid: 'Full hybrid',
  plugin_hybrid: 'Ibrida plug-in',
  electric: 'Elettrica',
};

export const BODY_TYPE_LABELS: Record<string, string> = {
  city: 'City car',
  hatchback: 'Berlina 2 volumi',
  sedan: 'Berlina 3 volumi',
  wagon: 'Station wagon',
  suv: 'SUV',
  crossover: 'Crossover',
  mpv: 'Monovolume',
  coupe: 'Coupé',
  convertible: 'Cabrio',
  pickup: 'Pick-up',
  van: 'Van',
  other: 'Altro',
};
