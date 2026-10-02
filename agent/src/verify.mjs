// Controllo delle citazioni: ogni dato {v, q, s} sopravvive solo se "q" è DAVVERO nel testo della fonte "s".
// È codice, non AI: se l'AI si inventa un valore, non riesce a inventarsi anche la frase nella pagina.

import { quoteInText } from './text.mjs';

const MAX_QUOTE = 400;

function isEvidence(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'q' in value && 's' in value;
}

function checkEvidence(evidence, docs) {
  const doc = Number.isInteger(evidence.s) ? docs[evidence.s] : undefined;
  if (!doc) {
    return 'fonte inesistente';
  }
  if (typeof evidence.q !== 'string' || evidence.q.trim() === '') {
    return 'citazione mancante';
  }
  if (evidence.q.length > MAX_QUOTE) {
    evidence.q = evidence.q.slice(0, MAX_QUOTE);
  }
  return quoteInText(evidence.q, doc.text) ? null : `citazione non trovata nella fonte ${evidence.s}: "${evidence.q.slice(0, 80)}"`;
}

/**
 * Toglie dal risultato tutti i dati con citazione falsa. Modifica l'oggetto e restituisce l'elenco dei problemi.
 * @param {object} result il JSON dell'AI
 * @param {{text: string}[]} docs i testi delle fonti, nello stesso ordine degli indici "s"
 */
export function verifyEvidence(result, docs) {
  const issues = [];

  const walk = (node, path) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (isEvidence(item)) {
          const problem = checkEvidence(item, docs);
          if (problem) {
            issues.push(`${path}[${i}] ${item.code ?? item.name ?? ''}: ${problem}`.replace(/\s+:/, ':'));
            node.splice(i, 1);
            continue;
          }
        }
        walk(item, `${path}[${i}]`);
      }
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (isEvidence(value)) {
        const problem = checkEvidence(value, docs);
        if (problem) {
          issues.push(`${path}.${key}: ${problem}`);
          delete node[key];
          continue;
        }
      }
      walk(value, `${path}.${key}`);
    }
  };

  walk(result, 'risultato');
  return issues;
}
