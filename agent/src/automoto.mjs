// Listino di riserva: Automoto.it pubblica in HTML semplice la gamma di ogni marchio e, per ogni modello,
// tutte le versioni con prezzo, CV/kW e CO2 (robots.txt lo permette). Si usa quando il sito ufficiale
// non si apre o non mostra il listino (sta dietro un modulo, un configuratore, un PDF da richiedere...).
// Il server tratta i dati che arrivano da qui come "stima" (fonte non ufficiale).

import { containsName, slugify } from './text.mjs';

const INDEX_URL = 'https://www.automoto.it/listino';

function path(href) {
  try {
    return new URL(href).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** La pagina della gamma del marchio su Automoto, o null se il marchio non c'è. */
export async function automotoBrandPage(pages, brand) {
  const index = await pages.get(INDEX_URL, { plain: true });
  const link = index.links.find((l) => /^\/listino\/[^/]+$/.test(path(l.href)) && slugify(l.text) === slugify(brand));
  return link ? pages.get(link.href, { plain: true }) : null;
}

/** I link ai modelli nella pagina del marchio, con il nome senza il marchio davanti ("Mercedes-Benz GLC" -> "GLC"). */
export function automotoModelLinks(brandPage, brand) {
  const prefix = path(brandPage.url);
  const brandSlug = slugify(brand);
  const brandWords = brand.trim().split(/\s+/).length;
  return brandPage.links
    .filter((l) => path(l.href).startsWith(`${prefix}/`) && /^\/listino\/[^/]+\/[^/]+$/.test(path(l.href)))
    .map((l) => {
      const words = l.text.trim().split(/\s+/);
      // "Citroen C3" con marchio "Citroën": confronto gli slug, non le lettere
      const name = slugify(l.text).startsWith(`${brandSlug}-`) ? words.slice(brandWords).join(' ') : l.text.trim();
      return { ...l, name };
    })
    .filter((l) => l.name !== '');
}

/**
 * Il link del modello: stesso nome; altrimenti il nome Automoto più lungo contenuto nel nostro
 * ("Classe C Berlina" -> "Classe C"); altrimenti il più corto che contiene il nostro ("GLA" -> "GLA SUV").
 */
export function matchModelLink(links, model) {
  const slug = slugify(model);
  const exact = links.find((l) => slugify(l.name) === slug);
  if (exact) {
    return exact;
  }
  const inOurs = links.filter((l) => containsName(model, l.name)).sort((a, b) => b.name.length - a.name.length);
  if (inOurs.length > 0) {
    return inOurs[0];
  }
  const containsOurs = links.filter((l) => containsName(l.name, model)).sort((a, b) => a.name.length - b.name.length);
  return containsOurs[0] ?? null;
}

/** La pagina del listino del modello su Automoto, o null se non la trovo. */
export async function automotoModelPage(pages, brand, model) {
  const brandPage = await automotoBrandPage(pages, brand);
  if (!brandPage) {
    return null;
  }
  const link = matchModelLink(automotoModelLinks(brandPage, brand), model);
  return link ? pages.get(link.href, { plain: true }) : null;
}
