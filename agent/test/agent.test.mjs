import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJson } from '../src/llm.mjs';
import { isAllowed, parseRobots } from '../src/robots.mjs';
import { containsName, htmlLinks, htmlToText, quoteInText, registrableDomain, slugify } from '../src/text.mjs';
import { verifyEvidence } from '../src/verify.mjs';

test('citazioni: spazi, maiuscole e apostrofi non contano', () => {
  const page = 'Prezzo   di listino\n24.950 €  — l’offerta';
  assert.ok(quoteInText('prezzo di listino 24.950 €', page));
  assert.ok(quoteInText("l'offerta", page));
  assert.ok(!quoteInText('25.950 €', page));
});

test('slug e nomi come nel PHP', () => {
  assert.equal(slugify('Citroën C3 Aircross'), 'citroen-c3-aircross');
  assert.equal(slugify('Lynk & Co'), 'lynk-co');
  assert.ok(containsName('Nuova Fiat Panda Hybrid', 'Panda'));
  assert.ok(!containsName('Pandamonio', 'Panda'));
  assert.equal(registrableDomain('auto.suzuki.it'), 'suzuki.it');
  assert.equal(registrableDomain('www.bmw.co.uk'), 'bmw.co.uk');
});

test('HTML: testo e link assoluti', () => {
  const html = '<html><head><style>x{}</style></head><body><h1>Panda</h1><p>Da 15.950&nbsp;&euro;</p>'
    + '<a href="/modelli/panda#top">Scopri <b>Panda</b></a><a href="https://x.it/l.pdf" title="Listino"></a><script>var a=1</script></body></html>';
  assert.equal(htmlToText(html), 'Panda\nDa 15.950 €\nScopri Panda');
  assert.deepEqual(htmlLinks(html, 'https://www.fiat.it/'), [
    { text: 'Scopri Panda', href: 'https://www.fiat.it/modelli/panda' },
    { text: 'Listino', href: 'https://x.it/l.pdf' },
  ]);
});

test('robots.txt', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /privato/\nAllow: /privato/listini/\nDisallow: /*.json$\n');
  assert.ok(isAllowed(rules, '/modelli/panda'));
  assert.ok(!isAllowed(rules, '/privato/x'));
  assert.ok(isAllowed(rules, '/privato/listini/panda.pdf'));
  assert.ok(!isAllowed(rules, '/api/a.json'));
  assert.ok(isAllowed(parseRobots('User-agent: *\nDisallow:\n'), '/qualsiasi'));
});

test('verifica: i dati con citazione falsa spariscono', () => {
  const docs = [{ text: 'Pop 1.0 Hybrid 70 CV 15.950 € — Potenza 51 kW' }];
  const result = {
    powertrains: [{ name: '1.0 Hybrid', powerKw: { v: 51, q: 'Potenza 51 kW', s: 0 }, powerCv: { v: 71, q: 'Potenza 71 CV', s: 0 } }],
    variants: [{ trim: 'Pop', powertrain: '1.0 Hybrid', listPrice: { v: 15950, q: 'Pop 1.0 Hybrid 70 CV 15.950 €', s: 3 } }],
    features: [
      { trim: 'Pop', code: 'rear_camera', availability: 'standard', q: 'Retrocamera', s: 0 },
      { trim: 'Pop', code: 'cruise_control', availability: 'standard', q: 'Potenza', s: 0 },
    ],
  };
  const issues = verifyEvidence(result, docs);
  assert.equal(issues.length, 3);
  assert.ok(result.powertrains[0].powerKw);
  assert.equal(result.powertrains[0].powerCv, undefined);
  assert.equal(result.variants[0].listPrice, undefined);
  assert.deepEqual(result.features.map((f) => f.code), ['cruise_control']);
});

test('JSON anche dentro ```json', () => {
  assert.deepEqual(parseJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Ecco: {"a": 2} fine'), { a: 2 });
});
