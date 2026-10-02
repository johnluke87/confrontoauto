// Le chiamate all'API di Confronto auto (sul server Aruba).

export class Api {
  constructor({ apiUrl, agentToken, userAgent }) {
    this.base = apiUrl;
    this.headers = { 'X-Agent-Token': agentToken, 'User-Agent': userAgent, Accept: 'application/json' };
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.base}${path}`, {
      ...options,
      headers: { ...this.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`API ${path}: risposta non JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      throw new Error(`API ${path}: HTTP ${response.status} ${data.error ?? ''}`);
    }
    return data;
  }

  /** Quanti lavori sono in scadenza (non prenota niente). */
  async due() {
    return (await this.request('/agent/work?peek=1')).due;
  }

  /** @returns {Promise<{tasks: object[], features: {code: string, name: string, category: string}[]}>} */
  work(limit) {
    return this.request(`/agent/work?limit=${limit}`);
  }

  /** Lavori prenotati ma non fatti (quota AI finita, tempo scaduto): tornano subito disponibili. */
  release(tasks) {
    return this.request('/agent/release', { method: 'POST', body: JSON.stringify({ tasks: tasks.map((t) => ({ type: t.type, id: t.id })) }) });
  }

  submit(result) {
    return this.request('/agent/results', { method: 'POST', body: JSON.stringify(result) });
  }
}
