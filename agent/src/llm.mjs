// L'AI che legge le pagine. Intercambiabile: Gemini (gratuito) oppure qualsiasi API "compatibile OpenAI".

export class BudgetExhausted extends Error {}
export class RateLimited extends Error {}
// chiave sbagliata, modello inesistente...: non è colpa del sito, inutile segnare il lavoro come fallito
export class LlmUnavailable extends Error {}

export class Llm {
  constructor(config, maxCalls, log) {
    if (!config.apiKey && config.provider === 'gemini') {
      throw new Error('Manca GEMINI_API_KEY (o LLM_API_KEY)');
    }
    if (!config.model) {
      throw new Error('Manca LLM_MODEL');
    }
    this.config = config;
    this.maxCalls = maxCalls;
    this.calls = 0;
    this.lastCallAt = 0;
    this.log = log;
  }

  get remaining() {
    return this.maxCalls - this.calls;
  }

  /** Manda il prompt e restituisce il JSON della risposta. */
  async json(prompt) {
    if (this.calls >= this.maxCalls) {
      throw new BudgetExhausted('Chiamate all\'AI finite per questa esecuzione');
    }
    this.calls++;

    for (let attempt = 1; ; attempt++) {
      const wait = this.lastCallAt + this.config.minIntervalMs - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      this.lastCallAt = Date.now();

      const response = await (this.config.provider === 'gemini' ? this.callGemini(prompt) : this.callOpenAi(prompt));
      if (response.ok) {
        const text = await this.extractText(await response.json());
        return parseJson(text);
      }
      const body = (await response.text()).slice(0, 500);
      // 429 = troppe richieste; 5xx = servizio in difficoltà: riprovo un paio di volte con pause crescenti
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 20_000 * attempt;
        this.log(`AI: HTTP ${response.status}, riprovo tra ${Math.round(delay / 1000)} s`);
        await sleep(delay);
        continue;
      }
      if (response.status === 429) {
        throw new RateLimited(`Limite dell'AI raggiunto: ${body}`);
      }
      // modello ritirato (Google li cambia spesso): cerco il "flash" più recente e riprovo una volta
      if (response.status === 404 && this.config.provider === 'gemini' && !this.switchedModel) {
        this.switchedModel = true;
        const newer = await this.latestGeminiFlash();
        if (newer && newer !== this.config.model) {
          this.log(`AI: il modello ${this.config.model} non è disponibile, uso ${newer}`);
          this.config.model = newer;
          continue;
        }
      }
      if (response.status >= 400 && response.status < 500) {
        throw new LlmUnavailable(`AI: HTTP ${response.status} ${body.replace(/\s+/g, ' ')}`);
      }
      throw new Error(`AI: HTTP ${response.status} ${body.replace(/\s+/g, ' ')}`);
    }
  }

  /** Il modello Gemini "flash" con il numero di versione più alto tra quelli disponibili per questa chiave. */
  async latestGeminiFlash() {
    const response = await fetch(`${this.config.baseUrl}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': this.config.apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return null;
    }
    const { models = [] } = await response.json();
    const candidates = models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), version: /^gemini-(\d+(?:\.\d+)?)-flash$/.exec(m.name.replace(/^models\//, ''))?.[1] }))
      .filter((m) => m.version)
      .sort((a, b) => Number(b.version) - Number(a.version));
    return candidates[0]?.id ?? null;
  }

  callGemini(prompt) {
    return fetch(`${this.config.baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 60_000 },
      }),
      signal: AbortSignal.timeout(240_000),
    });
  }

  callOpenAi(prompt) {
    return fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(240_000),
    });
  }

  async extractText(data) {
    if (this.config.provider === 'gemini') {
      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error(`AI: nessuna risposta (${data.promptFeedback?.blockReason ?? 'motivo sconosciuto'})`);
      }
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error('AI: risposta troncata (troppo lunga)');
      }
      return (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    }
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/** JSON dalla risposta, anche se l'AI l'ha messo dentro ```json ... ``` */
export function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('AI: la risposta non è JSON valido');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
