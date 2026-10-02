// Tutta la configurazione arriva da variabili d'ambiente (su GitHub: secrets e variables del repository).

function env(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function required(name) {
  const value = env(name);
  if (value === undefined) {
    throw new Error(`Manca la variabile d'ambiente ${name}`);
  }
  return value;
}

/** Per i secret incollati a mano: via spazi, a capo e apici intorno ('abc' -> abc). */
function cleanSecret(value) {
  return value === undefined ? undefined : value.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

function int(name, fallback) {
  const value = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * I servizi AI gratuiti, nell'ordine in cui si usano: quando uno finisce la quota del giorno lavora il successivo.
 * Basta mettere la chiave (secret su GitHub) per attivarne uno; il modello si può cambiare con <NOME>_MODEL.
 * Tutti tranne Gemini parlano il formato "compatibile OpenAI".
 */
const PROVIDERS = [
  { name: 'gemini', kind: 'gemini', key: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', minIntervalMs: 7000 },
  { name: 'mistral', kind: 'openai', key: 'MISTRAL_API_KEY', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-medium-latest', minIntervalMs: 1500 },
  { name: 'cerebras', kind: 'openai', key: 'CEREBRAS_API_KEY', baseUrl: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', minIntervalMs: 2000 },
  { name: 'groq', kind: 'openai', key: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', minIntervalMs: 3000 },
  { name: 'openrouter', kind: 'openai', key: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', minIntervalMs: 4000 },
];

function llmProviders() {
  const providers = PROVIDERS.filter((p) => env(p.key)).map((p) => ({
    name: p.name,
    kind: p.kind,
    apiKey: cleanSecret(env(p.key)),
    baseUrl: env(`${p.name.toUpperCase()}_BASE_URL`, p.baseUrl),
    model: env(`${p.name.toUpperCase()}_MODEL`, p.name === 'gemini' ? env('LLM_MODEL', p.model) : p.model),
    minIntervalMs: p.minIntervalMs,
  }));
  // un servizio qualsiasi "compatibile OpenAI" (anche Ollama in locale): LLM_BASE_URL + LLM_MODEL (+ LLM_API_KEY)
  if (env('LLM_BASE_URL') && env('LLM_MODEL')) {
    providers.push({ name: 'custom', kind: 'openai', apiKey: cleanSecret(env('LLM_API_KEY')), baseUrl: env('LLM_BASE_URL'), model: env('LLM_MODEL'), minIntervalMs: int('LLM_MIN_INTERVAL_MS', 0) });
  }
  // LLM_ORDER=mistral,gemini per cambiare l'ordine
  const order = (env('LLM_ORDER') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return order.length ? providers.sort((a, b) => rank(order, a.name) - rank(order, b.name)) : providers;
}

function rank(order, name) {
  const i = order.indexOf(name);
  return i < 0 ? order.length : i;
}

export function loadConfig() {
  return {
    // es. https://www.gianlucadario.com/extra/confronto-auto/api
    apiUrl: required('CA_API_URL').replace(/\/+$/, ''),
    agentToken: cleanSecret(required('CA_AGENT_TOKEN')),

    llmProviders: llmProviders(),

    // quante chiamate all'AI al massimo per esecuzione
    maxLlmCalls: int('MAX_LLM_CALLS', 5),
    maxTasks: int('MAX_TASKS', 4),
    maxRunMinutes: int('MAX_RUN_MINUTES', 20),

    // 'playwright' = browser vero (siti fatti in JavaScript), 'fetch' = solo HTML, 'auto' = playwright se installato
    browser: env('BROWSER', 'auto'),
    // user agent da browser: diversi siti (es. Audi) rifiutano le richieste che si dichiarano bot
    userAgent: env(
      'AGENT_USER_AGENT',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ),

    // DRY_RUN=1: stampa i risultati invece di mandarli all'API
    dryRun: env('DRY_RUN') === '1',
  };
}
