// Funzioni sui testi. La verifica delle citazioni è fatta QUI, con codice: l'AI propone, il codice controlla.

/** Testo "confrontabile": minuscolo, apostrofi/virgolette/trattini uniformi, spazi compattati. */
export function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[‘’‚′`´]/g, "'")
    .replace(/[“”„″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   \s]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** La citazione compare (a meno di spazi e maiuscole) nel testo della pagina? */
export function quoteInText(quote, text) {
  const q = normalize(quote);
  return q.length >= 3 && normalize(text).includes(q);
}

/** Come slugify() del PHP: "Citroën C3 Aircross" -> "citroen-c3-aircross" */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Nuova Fiat Panda Hybrid" contiene il nome "Panda"? */
export function containsName(text, name) {
  const slug = slugify(name);
  return slug !== '' && `-${slugify(text)}-`.includes(`-${slug}-`);
}

/** Un pezzo di testo (al massimo ~160 caratteri) intorno alla prima volta che compare il nome. */
export function snippetAround(text, name) {
  const lower = text.toLowerCase();
  const index = lower.indexOf(name.toLowerCase());
  if (index < 0) {
    return null;
  }
  const start = Math.max(0, index - 60);
  return text.slice(start, index + name.length + 80).replace(/\s+/g, ' ').trim();
}

/** "auto.suzuki.it" -> "suzuki.it" (come registrable_domain() del PHP) */
export function registrableDomain(host) {
  host = String(host).toLowerCase().replace(/^\.+|\.+$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') {
    return host;
  }
  const parts = host.split('.');
  if (parts.length <= 2) {
    return host;
  }
  const genericSecondLevel = ['co', 'com', 'net', 'org', 'gov', 'ac'].includes(parts.at(-2)) && parts.at(-1).length === 2;
  return parts.slice(genericSecondLevel ? -3 : -2).join('.');
}

export function sameSite(url, baseUrl) {
  try {
    return registrableDomain(new URL(url).hostname) === registrableDomain(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** HTML -> testo leggibile (quando non usiamo il browser): niente script/stili, un a capo per ogni blocco. */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table)\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' \t ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** I link di una pagina HTML: [{text, href}] con indirizzi assoluti, senza doppioni. */
export function htmlLinks(html, baseUrl) {
  const links = new Map();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]);
    const raw = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!raw) {
      continue;
    }
    let url;
    try {
      url = new URL(decodeEntities(raw), baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) {
      continue;
    }
    url.hash = '';
    const label = /(?:aria-label|title)\s*=\s*"([^"]*)"/i.exec(match[1])?.[1] ?? '';
    const text = (htmlToText(match[2]) || decodeEntities(label)).replace(/\s+/g, ' ').trim();
    const key = url.href;
    if (!links.has(key) || (links.get(key).text === '' && text !== '')) {
      links.set(key, { text: text.slice(0, 120), href: key });
    }
  }
  return [...links.values()];
}
