// L'AI che legge le pagine. Una CATENA di servizi gratuiti: quando uno finisce la quota del giorno si passa al
// successivo (Gemini con tutti i suoi modelli "flash", poi Mistral, Cerebras, Groq, OpenRouter... se configurati).

export class BudgetExhausted extends Error {}
// quota finita su TUTTI i servizi configurati: si riprende domani
export class RateLimited extends Error {}
// nessun servizio utilizzabile (chiavi sbagliate, modelli inesistenti...): non è colpa del sito
export class LlmUnavailable extends Error {}

// un 429 con un'attesa più lunga di così è una quota giornaliera finita, non un "rallenta un attimo"
const LONG_WAIT_MS = 2 * 60_000;

export class Llm {
  /**
   * @param providers [{name, kind: 'gemini'|'openai', baseUrl, apiKey, model, minIntervalMs}] in ordine di preferenza
   */
  constructor(providers, maxCalls, log) {
    if (providers.length === 0) {
      throw new LlmUnavailable('Nessun servizio AI configurato (GEMINI_API_KEY, MISTRAL_API_KEY, ...)');
    }
    this.providers = providers.map((p) => ({ ...p, exhausted: false, triedModels: new Set([p.model]), jsonMode: true }));
    this.maxCalls = maxCalls;
    this.calls = 0;
    this.log = log;
  }

  get remaining() {
    return this.maxCalls - this.calls;
  }

  /** Il servizio (e modello) che sta lavorando adesso, per il riepilogo. */
  get current() {
    const p = this.providers.find((x) => !x.exhausted);
    return p ? `${p.name} ${p.model}` : 'nessuno';
  }

  /** Manda il prompt e restituisce il JSON della risposta. */
  async json(prompt) {
    if (this.calls >= this.maxCalls) {
      throw new BudgetExhausted("Chiamate all'AI finite per questa esecuzione");
    }
    this.calls++;

    const errors = [];
    for (const provider of this.providers) {
      if (provider.exhausted) {
        continue;
      }
      try {
        return await this.callWithRetry(provider, prompt);
      } catch (error) {
        if (error instanceof QuotaExhausted) {
          provider.exhausted = true;
          this.log(`AI: ${provider.name} ha finito la quota (${error.message}), passo al servizio successivo`);
          continue;
        }
        if (error instanceof ProviderError) {
          // chiave sbagliata, testo troppo lungo per questo modello...: provo il prossimo servizio, solo per questa richiesta
          errors.push(`${provider.name}: ${error.message}`);
          this.log(`AI: ${provider.name} non va (${error.message.slice(0, 160)}), provo il successivo`);
          continue;
        }
        throw error; // risposta non JSON e simili: problema di questo lavoro
      }
    }
    if (this.providers.every((p) => p.exhausted)) {
      throw new RateLimited("Quota gratuita finita su tutti i servizi AI configurati: si riprende quando si azzera");
    }
    throw new LlmUnavailable(`Nessun servizio AI ha risposto: ${errors.join(' | ').slice(0, 600)}`);
  }

  async callWithRetry(provider, prompt) {
    for (let attempt = 1; ; attempt++) {
      const wait = (provider.lastCallAt ?? 0) + provider.minIntervalMs - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      provider.lastCallAt = Date.now();

      const response = await (provider.kind === 'gemini' ? callGemini(provider, prompt) : callOpenAi(provider, prompt));
      if (response.ok) {
        return parseJson(extractText(provider, await response.json()));
      }
      const body = (await response.text()).slice(0, 800);
      const flat = body.replace(/\s+/g, ' ');

      if (response.status === 429) {
        const waitMs = retryDelayMs(response, body);
        if (waitMs > LONG_WAIT_MS || /per ?day|daily|PerDay|quota/i.test(body) && waitMs > 30_000) {
          // quota del giorno finita: per Gemini provo un altro modello (ognuno ha la sua quota)
          if (provider.kind === 'gemini' && (await this.switchGeminiModel(provider))) {
            continue;
          }
          throw new QuotaExhausted(`riprova tra ${Math.round(waitMs / 60_000)} min`);
        }
        if (attempt < 3) {
          const delay = Math.max(waitMs, 20_000 * attempt);
          this.log(`AI: ${provider.name} HTTP 429, riprovo tra ${Math.round(delay / 1000)} s`);
          await sleep(delay);
          continue;
        }
        throw new QuotaExhausted('troppe richieste');
      }
      if (response.status >= 500 && attempt < 3) {
        this.log(`AI: ${provider.name} HTTP ${response.status}, riprovo tra ${20 * attempt} s`);
        await sleep(20_000 * attempt);
        continue;
      }
      // sovraccarico che non passa ("high demand"): per Gemini provo un altro modello
      if (response.status >= 500 && provider.kind === 'gemini' && (await this.switchGeminiModel(provider))) {
        attempt = 0;
        continue;
      }
      // modello ritirato: Gemini cerca il "flash" più recente
      if (response.status === 404 && provider.kind === 'gemini' && (await this.switchGeminiModel(provider))) {
        continue;
      }
      // alcuni servizi non conoscono la "modalità JSON": riprovo senza
      if (response.status === 400 && provider.jsonMode && /response_format|json/i.test(body)) {
        provider.jsonMode = false;
        continue;
      }
      throw new ProviderError(`HTTP ${response.status} ${flat}`);
    }
  }

  /** Passa a un altro modello Gemini non ancora provato: prima i "flash" più recenti, poi i "flash-lite". */
  async switchGeminiModel(provider) {
    provider.candidates ??= await geminiFlashModels(provider);
    const next = provider.candidates.find((m) => !provider.triedModels.has(m));
    if (!next) {
      return false;
    }
    this.log(`AI: ${provider.model} esaurito o non disponibile, passo a ${next}`);
    provider.triedModels.add(next);
    provider.model = next;
    return true;
  }
}

class QuotaExhausted extends Error {}
class ProviderError extends Error {}

/** I modelli Gemini "flash" e "flash-lite" disponibili per questa chiave, dal più recente. */
export async function geminiFlashModels(provider) {
  const response = await fetch(`${provider.baseUrl}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': provider.apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    return [];
  }
  const { models = [] } = await response.json();
  return models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .map((id) => ({ id, match: /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(id) }))
    .filter((m) => m.match)
    .sort((a, b) => Number(Boolean(a.match[2])) - Number(Boolean(b.match[2])) || Number(b.match[1]) - Number(a.match[1]))
    .map((m) => m.id);
}

/** Quanto aspettare secondo il servizio: header Retry-After oppure "retry in 11h20m13s" / "retryDelay": "39s" nel testo. */
function retryDelayMs(response, body) {
  const header = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  if (Number.isFinite(header)) {
    return header * 1000;
  }
  const human = /retry in ((\d+)h)?((\d+)m)?([\d.]+)s/i.exec(body);
  if (human) {
    return ((Number(human[2] ?? 0) * 60 + Number(human[4] ?? 0)) * 60 + Number(human[5])) * 1000;
  }
  const delay = /"retryDelay":\s*"(\d+)s"/.exec(body);
  return delay ? Number(delay[1]) * 1000 : 0;
}

function callGemini(provider, prompt) {
  return fetch(`${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 60_000 },
    }),
    signal: AbortSignal.timeout(240_000),
  });
}

function callOpenAi(provider, prompt) {
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.1,
      ...(provider.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(240_000),
  });
}

function extractText(provider, data) {
  if (provider.kind === 'gemini') {
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
