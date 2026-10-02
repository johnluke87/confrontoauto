/** A che punto è il Research agent (pagina Revisione). */
export interface ResearchStatus {
  brandsEnabled: number;
  brandsWithModels: number;
  models: number;
  modelsWithVariants: number;
  // lavori da fare adesso, prenotati da un'esecuzione, in attesa di un nuovo tentativo
  due: number;
  claimed: number;
  waitingRetry: number;
  lastResultAt: string | null;
}

export type ImportStatus = 'pending' | 'applied' | 'review' | 'rejected' | 'failed';

export interface ImportIssue {
  // warning = dato scartato o avviso; review = motivo per cui serve un controllo; error = import inutilizzabile
  level: 'warning' | 'review' | 'error';
  message: string;
  // per i dati scartati dal server: "variant:<allestimento>|<motore>:<campo>" o "powertrain:<motore>:<campo>" (minuscolo)
  key?: string;
}

export interface ImportSummary {
  id: number;
  taskType: 'brand' | 'model';
  status: ImportStatus;
  brand: string | null;
  model: string | null;
  warnings: number;
  reviews: number;
  errors: number;
  firstProblem: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface ImportList {
  counts: Partial<Record<ImportStatus, number>>;
  items: ImportSummary[];
}

/** Un dato con la sua prova, come lo manda il Research agent. */
export interface Evidence<T = unknown> {
  v: T;
  q: string;
  s: number;
}

export interface ImportSource {
  url: string;
  title: string;
  kind: string;
}

/** Il risultato grezzo dell'agent: lo mostro così com'è, i campi possono mancare. */
export interface ImportPayload {
  ok?: boolean;
  error?: string;
  sources?: ImportSource[];
  models?: { name: string; url: string | null; bodyType: string | null; q: string; s: number }[];
  trims?: (string | { name: string })[];
  powertrains?: ({ name: string } & Record<string, Evidence | string | undefined>)[];
  variants?: ({ trim: string; powertrain: string; listPrice?: Evidence<number>; onRoadPrice?: Evidence<number> } & Record<string, unknown>)[];
  features?: { trim: string; code: string; availability: string; q: string; s: number }[];
  packages?: { trim: string; name: string; price?: Evidence<number>; features?: string[] }[];
  agentIssues?: string[];
}

export interface ImportDetail extends ImportSummary {
  brandId: number;
  modelId: number | null;
  issues: ImportIssue[];
  payload: ImportPayload;
}
