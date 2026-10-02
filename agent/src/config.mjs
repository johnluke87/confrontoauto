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

const provider = env('LLM_PROVIDER', 'gemini');

export function loadConfig() {
  return {
    // es. https://www.gianlucadario.com/extra/confronto-auto/api
    apiUrl: required('CA_API_URL').replace(/\/+$/, ''),
    agentToken: cleanSecret(required('CA_AGENT_TOKEN')),

    llm: {
      // 'gemini' (Google AI Studio, piano gratuito) oppure 'openai' = qualsiasi API compatibile (Groq, OpenRouter, Ollama...)
      provider,
      model: env('LLM_MODEL', provider === 'gemini' ? 'gemini-3.8-flash' : undefined),
      apiKey: cleanSecret(env('LLM_API_KEY', env('GEMINI_API_KEY'))),
      baseUrl: env('LLM_BASE_URL', provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : undefined),
      // il piano gratuito di Gemini ha un limite di richieste al minuto: meglio non correre
      minIntervalMs: int('LLM_MIN_INTERVAL_MS', provider === 'gemini' ? 7000 : 0),
    },

    // quante chiamate all'AI al massimo per esecuzione (48 esecuzioni al giorno x 5 = 240, sotto il limite gratuito)
    maxLlmCalls: int('MAX_LLM_CALLS', 5),
    maxTasks: int('MAX_TASKS', 4),
    maxRunMinutes: int('MAX_RUN_MINUTES', 20),

    // 'playwright' = browser vero (siti fatti in JavaScript), 'fetch' = solo HTML, 'auto' = playwright se installato
    browser: env('BROWSER', 'auto'),
    userAgent: env(
      'AGENT_USER_AGENT',
      'Mozilla/5.0 (compatible; ConfrontoAutoBot/1.0; +https://www.gianlucadario.com/extra/confronto-auto/)',
    ),

    // DRY_RUN=1: stampa i risultati invece di mandarli all'API
    dryRun: env('DRY_RUN') === '1',
  };
}
