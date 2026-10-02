// Scarica una pagina (HTML con o senza browser, oppure PDF) e restituisce testo e link.

import { isAllowed, parseRobots } from './robots.mjs';
import { htmlLinks, htmlToText } from './text.mjs';

const MAX_TEXT_CHARS = 80_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const SAME_HOST_DELAY_MS = 1500;

export class PageError extends Error {}

export class PageFetcher {
  constructor({ browser, userAgent, log }) {
    this.mode = browser;
    this.userAgent = userAgent;
    this.log = log;
    this.robots = new Map(); // origin -> regole
    this.lastHit = new Map(); // host -> timestamp: un po' di pausa tra due richieste allo stesso sito
    this.browser = null;
  }

  async init() {
    if (this.mode === 'fetch') {
      return;
    }
    try {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({ userAgent: this.userAgent, locale: 'it-IT', viewport: { width: 1366, height: 900 } });
      this.log('Browser avviato (Playwright)');
    } catch (error) {
      if (this.mode === 'playwright') {
        throw error;
      }
      this.log(`Playwright non disponibile, uso solo fetch (${error.message.split('\n')[0]})`);
    }
  }

  async close() {
    await this.browser?.close();
  }

  /** @returns {Promise<{url: string, title: string, text: string, links: {text: string, href: string}[], kind: 'html'|'pdf'}>} */
  async get(url) {
    const parsed = new URL(url);
    if (!(await this.allowedByRobots(parsed))) {
      throw new PageError(`robots.txt non permette di leggere ${url}`);
    }
    await this.politeDelay(parsed.host);

    if (/\.pdf($|\?)/i.test(parsed.pathname + parsed.search)) {
      return this.getPdf(url);
    }
    return this.browser ? this.getWithBrowser(url) : this.getWithFetch(url);
  }

  async allowedByRobots(url) {
    if (!this.robots.has(url.origin)) {
      let rules = [];
      try {
        const response = await fetch(`${url.origin}/robots.txt`, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(10_000) });
        if (response.ok) {
          rules = parseRobots(await response.text());
        }
      } catch {
        // robots.txt irraggiungibile: nessuna regola
      }
      this.robots.set(url.origin, rules);
    }
    return isAllowed(this.robots.get(url.origin), url.pathname + url.search);
  }

  async politeDelay(host) {
    const wait = (this.lastHit.get(host) ?? 0) + SAME_HOST_DELAY_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastHit.set(host, Date.now());
  }

  async getWithFetch(url) {
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'it-IT,it;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new PageError(`HTTP ${response.status} da ${url}`);
    }
    if ((response.headers.get('content-type') ?? '').includes('pdf')) {
      return this.pdfFromResponse(url, response);
    }
    const html = await response.text();
    return {
      url: response.url || url,
      title: htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 200),
      text: htmlToText(html).slice(0, MAX_TEXT_CHARS),
      links: htmlLinks(html, response.url || url),
      kind: 'html',
    };
  }

  async getWithBrowser(url) {
    const page = await this.context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (!response) {
        throw new PageError(`Nessuna risposta da ${url}`);
      }
      if ((response.headers()['content-type'] ?? '').includes('pdf')) {
        return this.getPdf(url);
      }
      if (response.status() >= 400) {
        throw new PageError(`HTTP ${response.status()} da ${url}`);
      }
      // i siti delle case caricano listini e tabelle dopo: aspetto che la rete si calmi (al massimo 10 secondi)
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await rejectCookies(page);
      const data = await page.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText ?? '',
        links: [...document.querySelectorAll('a[href]')].map((a) => ({
          text: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          href: a.href.split('#')[0],
        })),
      }));
      const links = new Map();
      for (const link of data.links) {
        if (/^https?:/.test(link.href) && (!links.has(link.href) || !links.get(link.href).text)) {
          links.set(link.href, link);
        }
      }
      return { url: page.url(), title: data.title.slice(0, 200), text: data.text.slice(0, MAX_TEXT_CHARS), links: [...links.values()], kind: 'html' };
    } finally {
      await page.close();
    }
  }

  async getPdf(url) {
    const response = await fetch(url, { headers: { 'User-Agent': this.userAgent }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new PageError(`HTTP ${response.status} da ${url}`);
    }
    return this.pdfFromResponse(url, response);
  }

  async pdfFromResponse(url, response) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new PageError(`PDF troppo grande (${Math.round(bytes.byteLength / 1e6)} MB): ${url}`);
    }
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const text = await pdfTextByRows(pdf);
    return { url, title: decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'documento.pdf'), text: text.slice(0, MAX_TEXT_CHARS), links: [], kind: 'pdf' };
  }
}

/**
 * Testo del PDF riga per riga, come lo vede una persona: i pezzi di testo con la stessa altezza nella pagina
 * diventano una riga, da sinistra a destra. Così una riga di listino ("Journey TCe 100 ... 15.800,00")
 * resta unita, e la citazione "versione + prezzo" si può verificare.
 */
export async function pdfTextByRows(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const rows = [];
    for (const item of content.items) {
      const value = item.str?.trim();
      if (!value) {
        continue;
      }
      const [x, y] = [item.transform[4], item.transform[5]];
      const height = Math.abs(item.transform[3]) || 8;
      // stessa riga se l'altezza differisce meno di metà carattere
      let row = rows.find((r) => Math.abs(r.y - y) < height / 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, value });
    }
    rows.sort((a, b) => b.y - a.y); // nel PDF la y cresce verso l'alto
    pages.push(rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.value).join(' ')).join('\n'));
  }
  return pages.join('\n\n');
}

/** Banner dei cookie: scelgo sempre "rifiuta" / "solo necessari", mai "accetta tutto". */
async function rejectCookies(page) {
  const labels = [/rifiuta/i, /solo (i )?(cookie )?necessari/i, /continua senza accettare/i, /reject all/i, /necessary only/i];
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}
