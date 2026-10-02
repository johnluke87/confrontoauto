<?php
declare(strict_types=1);

/*
 * VERIFICA E SALVATAGGIO dei risultati del Research agent.
 *
 * Ogni dato arriva come {"v": valore, "q": "citazione esatta dalla pagina", "s": indice della fonte}.
 * L'agent ha già controllato (con codice, non con l'AI) che la citazione sia davvero nel testo della pagina.
 * Qui il server ricontrolla tutto il resto:
 *   - la fonte è sul sito ufficiale del marchio?           sì -> 🟢 official, no -> 🟠 estimate
 *   - il numero compare davvero nella citazione?           no -> il dato si scarta
 *   - il valore è plausibile (un'auto da 900 €? 12 metri?) no -> il dato si scarta
 *   - kW e CV sono coerenti tra loro?                      no -> si tengono solo i kW
 * E decide se salvare subito o mettere "da rivedere":
 *   - nessuna fonte ufficiale, troppi dati scartati, prezzi cambiati più del 15%, modelli spariti...
 *
 * Formato di un risultato "model":
 * {
 *   "task": {"type": "model", "id": 12}, "ok": true,
 *   "sources": [{"url": "https://www.fiat.it/...", "title": "Listino Fiat Panda", "kind": "official_pricelist"}],
 *   "model": {"bodyType": {"v": "city", "q": "...", "s": 0}, "generation": {...}, "url": "https://..."},
 *   "specs": {"lengthMm": {"v": 3705, "q": "Lunghezza 3.705 mm", "s": 1}, ...},     <- misure comuni a tutte le versioni
 *   "trims": ["Pop", "Icon"],
 *   "powertrains": [{"name": "1.0 Hybrid 70 CV", "fuel": {"v": "mild_hybrid", ...}, "powerKw": {...}, ...}],
 *   "variants": [{"trim": "Pop", "powertrain": "1.0 Hybrid 70 CV", "listPrice": {"v": 15950, ...}, ...}],
 *   "packages": [{"trim": "Pop", "name": "Pack Comfort", "price": {...}, "features": ["rear_parking_sensors"]}],
 *   "features": [{"trim": "Pop", "code": "rear_camera", "availability": "optional", "q": "...", "s": 0, "price": {...}}],
 *   "agentIssues": ["valore scartato: ..."]
 * }
 * Formato di un risultato "brand":
 *   { "task": {"type": "brand", "id": 3}, "ok": true, "sources": [...],
 *     "models": [{"name": "Panda", "url": "https://...", "q": "Nuova Panda", "s": 0, "bodyType": "city"}] }
 */

const PRICE_CHANGE_REVIEW_PCT = 15;
const DROPPED_REVIEW_PCT = 30;

const FUELS = ['petrol', 'diesel', 'lpg', 'cng', 'mild_hybrid', 'full_hybrid', 'plugin_hybrid', 'electric'];
const BODY_TYPES = ['city', 'hatchback', 'sedan', 'wagon', 'suv', 'crossover', 'mpv', 'coupe', 'convertible', 'pickup', 'van', 'other'];
const SOURCE_KINDS = ['official_pricelist', 'official_configurator', 'official_spec', 'official_site', 'press', 'aggregator', 'other'];

// misure: in mm, ma accetto anche citazioni in cm o metri ("4,05 m")
const MM = [1, 10, 1000];

/** [nome nel JSON => [colonna, tipo, min, max, scale accettate]] */
const POWERTRAIN_FIELDS = [
    'fuel'                    => ['fuel', 'enum', FUELS],
    'cylinders'               => ['cylinders', 'int', 1, 16],
    'displacementCc'          => ['displacement_cc', 'int', 500, 8500, [1, 1000]],
    'powerKw'                 => ['power_kw', 'int', 15, 1200],
    'powerCv'                 => ['power_cv', 'int', 20, 1700],
    'gearbox'                 => ['gearbox', 'enum', ['manual', 'automatic']],
    'gears'                   => ['gears', 'int', 1, 10],
    'drive'                   => ['drive', 'enum', ['fwd', 'rwd', 'awd']],
    'timing'                  => ['timing', 'enum', ['belt', 'chain', 'none']],
    'consumptionWltp'         => ['consumption_wltp', 'num', 0.3, 40],
    'consumptionUnit'         => ['consumption_unit', 'enum', ['l_100km', 'kg_100km', 'kwh_100km']],
    'electricConsumptionWltp' => ['electric_consumption_wltp', 'num', 8, 45],
    'batteryKwh'              => ['battery_kwh', 'num', 0.5, 250],
    'electricRangeKm'         => ['electric_range_km', 'int', 5, 1200],
    'co2GKm'                  => ['co2_g_km', 'int', 0, 700],
    'euroClass'               => ['euro_class', 'text', 20],
    'tankL'                   => ['tank_l', 'int', 10, 150],
    'lpgTankL'                => ['lpg_tank_l', 'int', 10, 150],
];

const VARIANT_FIELDS = [
    'listPrice'      => ['list_price_cents', 'money', 3000, 2000000],
    'onRoadPrice'    => ['on_road_cents', 'money', 3000, 2000000],
    'priceValidFrom' => ['price_valid_from', 'date'],
    'lengthMm'       => ['length_mm', 'int', 2000, 6500, MM],
    'widthMm'        => ['width_mm', 'int', 1300, 2600, MM],
    'heightMm'       => ['height_mm', 'int', 900, 2500, MM],
    'wheelbaseMm'    => ['wheelbase_mm', 'int', 1500, 4500, MM],
    'trunkL'         => ['trunk_l', 'int', 0, 3000],
    'trunkMaxL'      => ['trunk_max_l', 'int', 0, 6000],
    'seats'          => ['seats', 'int', 1, 9],
    'doors'          => ['doors', 'int', 2, 5],
    'weightKg'       => ['weight_kg', 'int', 400, 4500],
    'tireSize'       => ['tire_size', 'text', 30],
];

/** Raccoglie avvisi ed errori di un import. "suspicious" = da far controllare a una persona. */
final class ImportReport
{
    public array $issues = [];
    public bool $suspicious = false;
    public bool $fatal = false;
    public int $values = 0;
    public int $dropped = 0;

    public function warn(string $message): void
    {
        $this->issues[] = ['level' => 'warning', 'message' => $message];
    }

    public function drop(string $message): void
    {
        $this->dropValue(null, $message);
    }

    /** $key (es. "variant:top|1.5 hybrid:listPrice") serve alla pagina Revisione per barrare il dato scartato. */
    public function dropValue(?string $key, string $message): void
    {
        $this->dropped++;
        $this->issues[] = ['level' => 'warning', 'message' => "Scartato: $message"] + ($key !== null ? ['key' => $key] : []);
    }

    public function suspect(string $message): void
    {
        $this->suspicious = true;
        $this->issues[] = ['level' => 'review', 'message' => $message];
    }

    public function error(string $message): void
    {
        $this->fatal = true;
        $this->issues[] = ['level' => 'error', 'message' => $message];
    }
}

/**
 * Verifica un import e, se va bene (o se un amministratore l'ha approvato), lo salva nel catalogo.
 * @return array{status: string, issues: array}
 */
function process_import(int $importId, ?int $approvedBy = null): array
{
    $stmt = db()->prepare('SELECT * FROM ca_imports WHERE id = ?');
    $stmt->execute([$importId]);
    $import = $stmt->fetch();
    if ($import === false) {
        throw new HttpException(404, 'Import inesistente');
    }

    $payload = json_decode($import['payload'], true, 64, JSON_THROW_ON_ERROR);
    $report = new ImportReport();
    $brand = load_brand((int) $import['brand_id']);
    $sources = read_sources($payload['sources'] ?? null, $brand, $report);
    foreach (array_slice(is_array($payload['agentIssues'] ?? null) ? $payload['agentIssues'] : [], 0, 200) as $issue) {
        if (is_string($issue)) {
            $report->dropped++;
            $report->warn('Agent: ' . mb_substr($issue, 0, 300));
        }
    }

    $isBrand = $import['task_type'] === 'brand';
    $entityId = $isBrand ? (int) $import['brand_id'] : (int) $import['model_id'];
    $plan = $isBrand
        ? plan_brand_result($payload, $brand, $sources, $report)
        : plan_model_result($payload, (int) $import['model_id'], $sources, $report);

    // tanti dati scartati = la pagina era strana o l'AI ha "fantasticato": meglio guardare (con 1-2 scarti no)
    if ($report->dropped >= 3 && $report->dropped * 100 > DROPPED_REVIEW_PCT * ($report->values + $report->dropped)) {
        $report->suspect("Scartati {$report->dropped} dati su " . ($report->values + $report->dropped));
    }

    if ($report->fatal) {
        $status = 'rejected';
        schedule_research($import['task_type'], $entityId, AGENT_RETRY_DAYS);
    } elseif ($report->suspicious && $approvedBy === null) {
        $status = 'review';
        // i dati restano in attesa di revisione: niente nuova ricerca per un mese, ma l'archivio non cambia data
        schedule_research($import['task_type'], $entityId, research_interval_days());
    } else {
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $sourceIds = save_sources($sources);
            $isBrand ? apply_brand_plan($plan, $brand, $sourceIds) : apply_model_plan($plan, (int) $import['model_id'], $sourceIds);
            mark_researched($import['task_type'], $entityId);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        $status = 'applied';
    }

    finish_import($importId, $status, $report->issues, $approvedBy);
    return ['status' => $status, 'issues' => $report->issues];
}

function finish_import(int $importId, string $status, array $issues, ?int $reviewedBy = null): void
{
    db()->prepare('UPDATE ca_imports SET status = ?, issues = ?, processed_at = ?, reviewed_by = ? WHERE id = ?')
        ->execute([$status, json_encode($issues, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), now_utc(), $reviewedBy, $importId]);
}

function load_brand(int $brandId): array
{
    $stmt = db()->prepare('SELECT id, name, official_url, official_domains FROM ca_brands WHERE id = ?');
    $stmt->execute([$brandId]);
    $brand = $stmt->fetch();
    $domains = array_filter(array_map('trim', explode(',', (string) $brand['official_domains'])));
    if ($brand['official_url'] !== null) {
        $domains[] = registrable_domain((string) parse_url($brand['official_url'], PHP_URL_HOST));
    }
    $brand['domains'] = array_values(array_unique($domains));
    return $brand;
}

// ---------------------------------------------------------------- fonti e singoli valori

/** @return array<int, array{url: string, title: string, kind: string, official: bool}> */
function read_sources(mixed $raw, array $brand, ImportReport $report): array
{
    if (!is_array($raw) || !array_is_list($raw) || $raw === []) {
        $report->error('Nessuna fonte indicata');
        return [];
    }
    $sources = [];
    foreach (array_slice($raw, 0, 30) as $i => $s) {
        $url = is_array($s) && is_string($s['url'] ?? null) ? $s['url'] : '';
        if (!preg_match('#^https?://#i', $url) || strlen($url) > 1000) {
            $report->warn("Fonte $i senza un URL valido");
            $sources[$i] = null;
            continue;
        }
        $kind = in_array($s['kind'] ?? null, SOURCE_KINDS, true) ? $s['kind'] : 'other';
        $official = host_matches_domains($url, $brand['domains']);
        // un PDF linkato direttamente da una pagina ufficiale (es. listino Dacia su cdn.group.renault.com)
        // è pubblicato dalla casa anche se sta su un altro dominio
        $from = $s['linkedFrom'] ?? null;
        if (!$official && is_int($from) && $from < $i && ($sources[$from]['official'] ?? false)
            && preg_match('#\.pdf$#i', (string) parse_url($url, PHP_URL_PATH)) === 1) {
            $official = true;
        }
        if ($official && !str_starts_with($kind, 'official_')) {
            $kind = 'official_site';
        } elseif (!$official && str_starts_with($kind, 'official_')) {
            $kind = 'other'; // l'agent la diceva ufficiale, ma il dominio non è del marchio
        }
        $sources[$i] = [
            'url'      => $url,
            'title'    => mb_substr(is_string($s['title'] ?? null) && trim($s['title']) !== '' ? trim($s['title']) : $url, 0, 255),
            'kind'     => $kind,
            'official' => $official,
        ];
    }
    if (!in_array(true, array_column(array_filter($sources), 'official'), true)) {
        $report->suspect('Nessuna fonte è sul sito ufficiale del marchio (' . implode(', ', $brand['domains']) . ')');
    }
    return $sources;
}

/**
 * Un valore {"v", "q", "s"} verificato, oppure null (assente o scartato, con il motivo nel report).
 * @return array{v: mixed, q: string, s: int, c: string}|null
 */
function read_value(mixed $field, array $spec, array $sources, ImportReport $report, string $label, ?string $key = null): ?array
{
    if (!is_array($field) || !array_key_exists('v', $field) || $field['v'] === null || $field['v'] === '') {
        return null;
    }
    $type = $spec[1];
    $quote = is_string($field['q'] ?? null) ? trim($field['q']) : '';
    $s = $field['s'] ?? null;
    if (!is_int($s) || !isset($sources[$s])) {
        $report->dropValue($key, "$label: fonte mancante o non valida");
        return null;
    }
    // le date di listino possono arrivare senza citazione puntuale (es. "listino in vigore dal..."), il resto no
    if ($quote === '' && $type !== 'date') {
        $report->dropValue($key, "$label: manca la citazione dalla fonte");
        return null;
    }
    $quote = mb_substr($quote, 0, 400);
    $v = $field['v'];

    switch ($type) {
        case 'enum':
            if (!in_array($v, $spec[2], true)) {
                $report->dropValue($key, "$label: valore \"" . mb_substr((string) json_encode($v), 0, 40) . '" non previsto');
                return null;
            }
            break;
        case 'text':
            if (!is_string($v) || mb_strlen(trim($v)) > $spec[2]) {
                $report->dropValue($key, "$label: testo non valido");
                return null;
            }
            $v = trim($v);
            break;
        case 'date':
            if (!is_string($v) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) !== 1 || !checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4))) {
                $report->dropValue($key, "$label: data non valida");
                return null;
            }
            break;
        default: // int, num, money
            if (is_string($v) && is_numeric($v)) {
                $v = (float) $v;
            }
            if (!is_int($v) && !is_float($v)) {
                $report->dropValue($key, "$label: non è un numero");
                return null;
            }
            [$min, $max] = [$spec[2], $spec[3]];
            if ($v < $min || $v > $max) {
                $report->dropValue($key, "$label: $v fuori dall'intervallo plausibile ($min–$max)");
                return null;
            }
            if (!number_in_quote((float) $v, $quote, $spec[4] ?? [1])) {
                $report->dropValue($key, "$label: $v non compare nella citazione \"" . mb_substr($quote, 0, 80) . '"');
                return null;
            }
            $v = match ($type) {
                'int'   => (int) round($v),
                'money' => (int) round($v * 100), // in centesimi, come nel database
                default => (float) $v,
            };
    }

    $report->values++;
    return ['v' => $v, 'q' => $quote, 's' => $s, 'c' => $sources[$s]['official'] ? 'official' : 'estimate'];
}

/** Legge i campi previsti da $specs; @return array<string, array> [colonna => valore verificato] */
function read_fields(array $data, array $specs, array $sources, ImportReport $report, string $label, ?string $keyPrefix = null): array
{
    $values = [];
    foreach ($specs as $key => $spec) {
        $value = read_value($data[$key] ?? null, $spec, $sources, $report, "$label · $key", $keyPrefix === null ? null : "$keyPrefix:$key");
        if ($value !== null) {
            $values[$spec[0]] = $value;
        }
    }
    return $values;
}

function clean_name(mixed $name, int $max): ?string
{
    if (!is_string($name)) {
        return null;
    }
    $name = trim((string) preg_replace('/\s+/u', ' ', $name));
    return $name === '' || mb_strlen($name) > $max ? null : $name;
}

/** "Nuova Fiat Panda" contiene "Panda"? (senza maiuscole, accenti e punteggiatura) */
function text_contains_name(string $text, string $name): bool
{
    $slug = slugify($name);
    return $slug !== '' && str_contains('-' . slugify($text) . '-', '-' . $slug . '-');
}

// ---------------------------------------------------------------- risultato "brand": l'elenco dei modelli

function plan_brand_result(array $payload, array $brand, array $sources, ImportReport $report): array
{
    $models = [];
    $raw = is_array($payload['models'] ?? null) ? array_slice($payload['models'], 0, 300) : [];
    foreach ($raw as $i => $m) {
        $name = clean_name(is_array($m) ? ($m['name'] ?? null) : null, 120);
        if ($name === null) {
            $report->drop("modello $i: nome non valido");
            continue;
        }
        // "Fiat Panda" -> "Panda": il marchio è già nel marchio
        if (text_contains_name($name, $brand['name']) && slugify($name) !== slugify($brand['name'])) {
            $name = trim((string) preg_replace('/^' . preg_quote($brand['name'], '/') . '\s+/iu', '', $name));
        }
        $s = $m['s'] ?? null;
        $quote = is_string($m['q'] ?? null) ? $m['q'] : '';
        if (!is_int($s) || !isset($sources[$s]) || !text_contains_name($quote, $name)) {
            $report->drop("modello \"$name\": il nome non compare nella citazione");
            continue;
        }
        $url = is_string($m['url'] ?? null) && preg_match('#^https?://#i', $m['url']) ? $m['url'] : null;
        if ($url !== null && !host_matches_domains($url, $brand['domains'])) {
            $report->warn("modello \"$name\": link fuori dal sito ufficiale, ignorato");
            $url = null;
        }
        $slug = slugify($name);
        $report->values++;
        $models[$slug] = [
            'name'     => $name,
            'slug'     => $slug,
            'url'      => $url !== null ? mb_substr($url, 0, 500) : null,
            'bodyType' => in_array($m['bodyType'] ?? null, BODY_TYPES, true) ? $m['bodyType'] : null,
        ];
    }

    if ($models === []) {
        $report->error('Nessun modello valido trovato');
        return ['models' => [], 'missing' => []];
    }

    $stmt = db()->prepare("SELECT id, name, slug FROM ca_models WHERE brand_id = ? AND status = 'active'");
    $stmt->execute([$brand['id']]);
    $existing = $stmt->fetchAll();
    $missing = array_values(array_filter($existing, fn (array $row) => !isset($models[$row['slug']])));
    $known = count($existing);
    if ($missing !== []) {
        $names = implode(', ', array_column($missing, 'name'));
        if ($known >= 4 && count($missing) * 2 > $known) {
            $report->suspect("Non trovati " . count($missing) . " modelli su $known già in archivio: $names");
        } else {
            $report->warn("Modelli non più in elenco (diventano \"fuori produzione\"): $names");
        }
    }
    return ['models' => array_values($models), 'missing' => $missing];
}

function apply_brand_plan(array $plan, array $brand, array $sourceIds): void
{
    $now = now_utc();
    $upsert = db()->prepare(
        "INSERT INTO ca_models (brand_id, name, slug, body_type, official_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'active',
             body_type = COALESCE(VALUES(body_type), body_type),
             official_url = COALESCE(VALUES(official_url), official_url),
             updated_at = VALUES(updated_at)"
    );
    foreach ($plan['models'] as $m) {
        $upsert->execute([$brand['id'], $m['name'], $m['slug'], $m['bodyType'], $m['url'], $now, $now]);
    }
    $discontinue = db()->prepare("UPDATE ca_models SET status = 'discontinued', updated_at = ? WHERE id = ?");
    foreach ($plan['missing'] as $m) {
        $discontinue->execute([$now, $m['id']]);
    }
}

// ---------------------------------------------------------------- risultato "model": versioni, prezzi, dotazioni

function plan_model_result(array $payload, int $modelId, array $sources, ImportReport $report): array
{
    $plan = ['model' => [], 'specs' => [], 'trims' => [], 'powertrains' => [], 'variants' => [], 'packages' => [], 'features' => []];

    $model = is_array($payload['model'] ?? null) ? $payload['model'] : [];
    $plan['model'] = read_fields($model, [
        'bodyType'   => ['body_type', 'enum', BODY_TYPES],
        'generation' => ['generation', 'text', 60],
    ], $sources, $report, 'modello');
    $plan['specs'] = read_fields(is_array($payload['specs'] ?? null) ? $payload['specs'] : [], VARIANT_FIELDS, $sources, $report, 'misure');
    unset($plan['specs']['list_price_cents'], $plan['specs']['on_road_cents'], $plan['specs']['price_valid_from']);

    // allestimenti
    foreach (array_slice(is_array($payload['trims'] ?? null) ? $payload['trims'] : [], 0, 50) as $trim) {
        $name = clean_name(is_array($trim) ? ($trim['name'] ?? null) : $trim, 120);
        if ($name !== null) {
            $plan['trims'][mb_strtolower($name)] = $name;
        }
    }

    // motorizzazioni
    foreach (array_slice(is_array($payload['powertrains'] ?? null) ? $payload['powertrains'] : [], 0, 80) as $i => $pt) {
        $name = clean_name(is_array($pt) ? ($pt['name'] ?? null) : null, 160);
        if ($name === null) {
            $report->drop("motore $i: nome non valido");
            continue;
        }
        $fields = read_fields($pt, POWERTRAIN_FIELDS, $sources, $report, $name, 'powertrain:' . mb_strtolower($name));
        if (isset($fields['power_kw'], $fields['power_cv'])) {
            $expected = $fields['power_kw']['v'] * 1.35962;
            if (abs($fields['power_cv']['v'] - $expected) > 0.03 * $expected) {
                $report->dropValue('powertrain:' . mb_strtolower($name) . ':powerCv', "$name: {$fields['power_cv']['v']} CV non tornano con {$fields['power_kw']['v']} kW, tengo i kW");
                unset($fields['power_cv']);
            }
        }
        $plan['powertrains'][mb_strtolower($name)] = ['name' => $name, 'fields' => $fields];
    }

    // versioni = allestimento x motore
    foreach (array_slice(is_array($payload['variants'] ?? null) ? $payload['variants'] : [], 0, 400) as $i => $v) {
        $trim = clean_name(is_array($v) ? ($v['trim'] ?? null) : null, 120);
        $pt = clean_name(is_array($v) ? ($v['powertrain'] ?? null) : null, 160);
        if ($trim === null || $pt === null || !isset($plan['powertrains'][mb_strtolower($pt)])) {
            $report->drop("versione $i: allestimento o motore non riconosciuti");
            continue;
        }
        $plan['trims'][mb_strtolower($trim)] ??= $trim;
        $key = mb_strtolower($trim) . '|' . mb_strtolower($pt);
        $plan['variants'][$key] = ['trim' => $trim, 'powertrain' => $pt, 'fields' => read_fields($v, VARIANT_FIELDS, $sources, $report, "$trim $pt", "variant:$key")];
    }

    // pacchetti di optional
    $featureIds = db()->query('SELECT code, id FROM ca_features')->fetchAll(PDO::FETCH_KEY_PAIR);
    foreach (array_slice(is_array($payload['packages'] ?? null) ? $payload['packages'] : [], 0, 200) as $i => $p) {
        $trim = clean_name(is_array($p) ? ($p['trim'] ?? null) : null, 120);
        $name = clean_name(is_array($p) ? ($p['name'] ?? null) : null, 160);
        if ($trim === null || $name === null || !isset($plan['trims'][mb_strtolower($trim)])) {
            $report->drop("pacchetto $i: nome o allestimento non validi");
            continue;
        }
        $codes = array_values(array_filter(is_array($p['features'] ?? null) ? $p['features'] : [], fn ($c) => is_string($c) && isset($featureIds[$c])));
        $plan['packages'][mb_strtolower("$trim|$name")] = [
            'trim'     => $trim,
            'name'     => $name,
            'price'    => read_value($p['price'] ?? null, ['price_cents', 'money', 0, 100000], $sources, $report, "pacchetto $name"),
            'features' => $codes,
        ];
    }

    // dotazioni per allestimento
    foreach (array_slice(is_array($payload['features'] ?? null) ? $payload['features'] : [], 0, 3000) as $i => $f) {
        $trim = clean_name(is_array($f) ? ($f['trim'] ?? null) : null, 120);
        $code = is_array($f) ? ($f['code'] ?? null) : null;
        $availability = is_array($f) ? ($f['availability'] ?? null) : null;
        if ($trim === null || !isset($plan['trims'][mb_strtolower($trim)]) || !is_string($code) || !isset($featureIds[$code])
            || !in_array($availability, ['standard', 'optional', 'package', 'not_available'], true)) {
            $report->drop("dotazione $i: allestimento, codice o disponibilità non validi");
            continue;
        }
        // la dotazione stessa è un "valore" testuale: serve citazione e fonte
        $evidence = read_value(['v' => $availability, 'q' => $f['q'] ?? '', 's' => $f['s'] ?? null], ['availability', 'enum', ['standard', 'optional', 'package', 'not_available']], $sources, $report, "$trim · $code");
        if ($evidence === null) {
            continue;
        }
        $package = clean_name($f['package'] ?? null, 160);
        $plan['features'][mb_strtolower($trim) . "|$code"] = [
            'trim'     => $trim,
            'featureId' => (int) $featureIds[$code],
            'availability' => $availability,
            'price'    => $availability === 'optional' ? read_value($f['price'] ?? null, ['price_cents', 'money', 0, 50000], $sources, $report, "$trim · $code · prezzo") : null,
            'package'  => $availability === 'package' && $package !== null && isset($plan['packages'][mb_strtolower("$trim|$package")]) ? $package : null,
            'evidence' => $evidence,
        ];
    }

    if ($plan['powertrains'] === [] && $plan['variants'] === []) {
        $report->error('Nessun motore e nessuna versione validi');
        return $plan;
    }

    check_price_changes($plan, $modelId, $report);
    return $plan;
}

/** Prezzi di listino cambiati più del 15% rispetto all'archivio: meglio guardarli. */
function check_price_changes(array $plan, int $modelId, ImportReport $report): void
{
    $stmt = db()->prepare(
        'SELECT t.name AS trim, p.name AS pt, v.list_price_cents
           FROM ca_variants v JOIN ca_trims t ON t.id = v.trim_id JOIN ca_powertrains p ON p.id = v.powertrain_id
          WHERE t.model_id = ? AND v.list_price_cents IS NOT NULL'
    );
    $stmt->execute([$modelId]);
    foreach ($stmt->fetchAll() as $row) {
        $new = $plan['variants'][mb_strtolower($row['trim']) . '|' . mb_strtolower($row['pt'])]['fields']['list_price_cents']['v'] ?? null;
        $old = (int) $row['list_price_cents'];
        if ($new !== null && $old > 0 && abs($new - $old) * 100 > PRICE_CHANGE_REVIEW_PCT * $old) {
            $report->suspect(sprintf('Prezzo di %s %s: da %s € a %s €', $row['trim'], $row['pt'], number_format($old / 100, 0, ',', '.'), number_format($new / 100, 0, ',', '.')));
        }
    }
}

/** Salva le fonti (riusa quelle con lo stesso URL). @return array<int, int> indice della fonte => id nel database */
function save_sources(array $sources): array
{
    $ids = [];
    $find = db()->prepare('SELECT id FROM ca_sources WHERE url = ? LIMIT 1');
    $update = db()->prepare('UPDATE ca_sources SET title = ?, source_type = ?, fetched_at = ? WHERE id = ?');
    $insert = db()->prepare('INSERT INTO ca_sources (url, title, source_type, fetched_at, created_at) VALUES (?, ?, ?, ?, ?)');
    $now = now_utc();
    foreach ($sources as $i => $s) {
        if ($s === null) {
            continue;
        }
        $find->execute([$s['url']]);
        $id = $find->fetchColumn();
        if ($id !== false) {
            $update->execute([$s['title'], $s['kind'], $now, $id]);
            $ids[$i] = (int) $id;
        } else {
            $insert->execute([$s['url'], $s['title'], $s['kind'], $now, $now]);
            $ids[$i] = (int) db()->lastInsertId();
        }
    }
    return $ids;
}

/**
 * Scrive i campi verificati in una riga e aggiorna il suo JSON "provenance":
 * {"power_kw": {"s": 12, "c": "official", "q": "Potenza 51 kW", "at": "2026-10-02"}, ...}
 * I campi non presenti nel risultato restano com'erano (non trovarli una volta non vuol dire che non esistono).
 */
function write_fields(string $table, int $id, array $fields, array $sourceIds, array $extra = []): void
{
    if ($fields === [] && $extra === []) {
        return;
    }
    $stmt = db()->prepare("SELECT provenance FROM $table WHERE id = ?");
    $stmt->execute([$id]);
    $provenance = json_decode((string) $stmt->fetchColumn(), true) ?: [];

    $set = [];
    $params = [];
    foreach ($fields as $column => $value) {
        $set[] = "$column = ?";
        $params[] = $value['v'];
        $provenance[$column] = ['s' => $sourceIds[$value['s']] ?? null, 'c' => $value['c'], 'q' => $value['q'], 'at' => gmdate('Y-m-d')];
    }
    foreach ($extra as $column => $value) {
        $set[] = "$column = ?";
        $params[] = $value;
    }
    $set[] = 'provenance = ?';
    $params[] = json_encode($provenance, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $set[] = 'updated_at = ?';
    $params[] = now_utc();
    $params[] = $id;
    db()->prepare("UPDATE $table SET " . implode(', ', $set) . ' WHERE id = ?')->execute($params);
}

function apply_model_plan(array $plan, int $modelId, array $sourceIds): void
{
    $pdo = db();
    $now = now_utc();

    // modello: tipo di carrozzeria e generazione (senza provenance: sono dati "di catalogo")
    foreach ($plan['model'] as $column => $value) {
        $pdo->prepare("UPDATE ca_models SET $column = ?, updated_at = ? WHERE id = ?")->execute([$value['v'], $now, $modelId]);
    }

    // allestimenti
    $trimIds = [];
    $upsertTrim = $pdo->prepare(
        'INSERT INTO ca_trims (model_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)'
    );
    $findTrim = $pdo->prepare('SELECT id FROM ca_trims WHERE model_id = ? AND name = ?');
    $order = 0;
    foreach ($plan['trims'] as $key => $name) {
        $upsertTrim->execute([$modelId, $name, $order++, $now, $now]);
        $findTrim->execute([$modelId, $name]);
        $trimIds[$key] = (int) $findTrim->fetchColumn();
    }

    // motorizzazioni: una nuova serve almeno l'alimentazione (colonna obbligatoria)
    $ptIds = [];
    $findPt = $pdo->prepare('SELECT id FROM ca_powertrains WHERE model_id = ? AND name = ?');
    $insertPt = $pdo->prepare('INSERT INTO ca_powertrains (model_id, name, fuel, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    foreach ($plan['powertrains'] as $key => $pt) {
        $findPt->execute([$modelId, $pt['name']]);
        $id = $findPt->fetchColumn();
        if ($id === false) {
            if (!isset($pt['fields']['fuel'])) {
                continue; // senza alimentazione non so nemmeno come calcolare i consumi
            }
            $insertPt->execute([$modelId, $pt['name'], $pt['fields']['fuel']['v'], $now, $now]);
            $id = $pdo->lastInsertId();
        }
        $ptIds[$key] = (int) $id;
        write_fields('ca_powertrains', (int) $id, $pt['fields'], $sourceIds);
    }

    // versioni: le misure comuni del modello valgono dove la versione non ne ha di sue
    $seen = [];
    $findVariant = $pdo->prepare('SELECT id FROM ca_variants WHERE trim_id = ? AND powertrain_id = ?');
    $insertVariant = $pdo->prepare('INSERT INTO ca_variants (trim_id, powertrain_id, available, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    foreach ($plan['variants'] as $v) {
        $trimId = $trimIds[mb_strtolower($v['trim'])] ?? null;
        $ptId = $ptIds[mb_strtolower($v['powertrain'])] ?? null;
        if ($trimId === null || $ptId === null) {
            continue;
        }
        $findVariant->execute([$trimId, $ptId]);
        $id = $findVariant->fetchColumn();
        if ($id === false) {
            $insertVariant->execute([$trimId, $ptId, $now, $now]);
            $id = $pdo->lastInsertId();
        }
        $seen[] = (int) $id;
        write_fields('ca_variants', (int) $id, $v['fields'] + $plan['specs'], $sourceIds, ['available' => 1]);
    }

    // le versioni che il listino non riporta più: non più ordinabili (restano in archivio)
    if ($seen !== []) {
        $in = implode(',', array_fill(0, count($seen), '?'));
        $pdo->prepare(
            "UPDATE ca_variants v JOIN ca_trims t ON t.id = v.trim_id SET v.available = 0, v.updated_at = ?
              WHERE t.model_id = ? AND v.id NOT IN ($in)"
        )->execute([$now, $modelId, ...$seen]);
    }

    // pacchetti
    $packageIds = [];
    $upsertPackage = $pdo->prepare(
        'INSERT INTO ca_packages (trim_id, name, price_cents, source_id, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE price_cents = VALUES(price_cents), source_id = VALUES(source_id),
             confidence = VALUES(confidence), updated_at = VALUES(updated_at)'
    );
    $findPackage = $pdo->prepare('SELECT id FROM ca_packages WHERE trim_id = ? AND name = ?');
    $featureIds = db()->query('SELECT code, id FROM ca_features')->fetchAll(PDO::FETCH_KEY_PAIR);
    foreach ($plan['packages'] as $key => $p) {
        $trimId = $trimIds[mb_strtolower($p['trim'])];
        $price = $p['price'];
        $upsertPackage->execute([
            $trimId, $p['name'], $price['v'] ?? null,
            $price !== null ? ($sourceIds[$price['s']] ?? null) : null,
            $price['c'] ?? 'missing', $now, $now,
        ]);
        $findPackage->execute([$trimId, $p['name']]);
        $packageId = (int) $findPackage->fetchColumn();
        $packageIds[$key] = $packageId;
        $pdo->prepare('DELETE FROM ca_package_features WHERE package_id = ?')->execute([$packageId]);
        $insertPf = $pdo->prepare('INSERT IGNORE INTO ca_package_features (package_id, feature_id) VALUES (?, ?)');
        foreach ($p['features'] as $code) {
            $insertPf->execute([$packageId, $featureIds[$code]]);
        }
    }

    // dotazioni
    $upsertFeature = $pdo->prepare(
        'INSERT INTO ca_trim_features (trim_id, feature_id, availability, price_cents, package_id, source_id, confidence, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE availability = VALUES(availability), price_cents = VALUES(price_cents),
             package_id = VALUES(package_id), source_id = VALUES(source_id), confidence = VALUES(confidence),
             updated_at = VALUES(updated_at)'
    );
    foreach ($plan['features'] as $f) {
        $trimKey = mb_strtolower($f['trim']);
        $upsertFeature->execute([
            $trimIds[$trimKey],
            $f['featureId'],
            $f['availability'],
            $f['price']['v'] ?? null,
            $f['package'] !== null ? ($packageIds[$trimKey . '|' . mb_strtolower($f['package'])] ?? null) : null,
            $sourceIds[$f['evidence']['s']] ?? null,
            $f['evidence']['c'],
            $now,
        ]);
    }
}

// ---------------------------------------------------------------- revisione da parte degli amministratori

/** GET /admin/imports?status=review */
function handle_list_imports(): never
{
    require_admin();
    $status = $_GET['status'] ?? 'review';
    if (!in_array($status, ['pending', 'applied', 'review', 'rejected', 'failed'], true)) {
        throw new HttpException(400, 'Stato non valido');
    }
    $counts = db()->query('SELECT status, COUNT(*) FROM ca_imports GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);

    $stmt = db()->prepare(
        'SELECT i.id, i.task_type, i.status, i.issues, i.received_at, i.processed_at, b.name AS brand, m.name AS model
           FROM ca_imports i
           LEFT JOIN ca_brands b ON b.id = i.brand_id
           LEFT JOIN ca_models m ON m.id = i.model_id
          WHERE i.status = ?
          ORDER BY i.id DESC LIMIT 100'
    );
    $stmt->execute([$status]);

    json_response([
        'counts' => array_map('intval', $counts),
        'items'  => array_map(fn (array $r) => import_summary($r), $stmt->fetchAll()),
    ]);
}

/** GET /admin/imports/{id} */
function handle_get_import(string $id): never
{
    require_admin();
    json_response(import_detail((int) $id));
}

/** POST /admin/imports/{id}/approve: salva nel catalogo un import "da rivedere" (i dati scartati restano scartati). */
function handle_approve_import(string $id): never
{
    $user = require_admin();
    $import = import_detail((int) $id);
    if ($import['status'] !== 'review') {
        throw new HttpException(409, 'Si possono approvare solo gli import da rivedere');
    }
    process_import((int) $id, $user['id']);
    json_response(import_detail((int) $id));
}

/** POST /admin/imports/{id}/reject */
function handle_reject_import(string $id): never
{
    $user = require_admin();
    $import = import_detail((int) $id);
    if (!in_array($import['status'], ['review', 'pending'], true)) {
        throw new HttpException(409, 'Questo import è già stato chiuso');
    }
    db()->prepare("UPDATE ca_imports SET status = 'rejected', reviewed_by = ?, processed_at = ? WHERE id = ?")
        ->execute([$user['id'], now_utc(), (int) $id]);
    // si riprova tra una settimana: magari il sito era in aggiornamento
    $entityId = $import['taskType'] === 'brand' ? $import['brandId'] : $import['modelId'];
    schedule_research($import['taskType'], $entityId, AGENT_RETRY_DAYS);
    json_response(import_detail((int) $id));
}

function import_summary(array $r): array
{
    $issues = json_decode((string) $r['issues'], true) ?: [];
    $count = fn (string $level) => count(array_filter($issues, fn ($i) => ($i['level'] ?? '') === $level));
    return [
        'id'          => (int) $r['id'],
        'taskType'    => $r['task_type'],
        'status'      => $r['status'],
        'brand'       => $r['brand'],
        'model'       => $r['model'],
        'warnings'    => $count('warning'),
        'reviews'     => $count('review'),
        'errors'      => $count('error'),
        'receivedAt'  => utc_to_iso($r['received_at']),
        'processedAt' => utc_to_iso($r['processed_at']),
    ];
}

function import_detail(int $id): array
{
    $stmt = db()->prepare(
        'SELECT i.*, b.name AS brand, m.name AS model
           FROM ca_imports i
           LEFT JOIN ca_brands b ON b.id = i.brand_id
           LEFT JOIN ca_models m ON m.id = i.model_id
          WHERE i.id = ?'
    );
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if ($row === false) {
        throw new HttpException(404, 'Import inesistente');
    }
    return import_summary($row) + [
        'brandId' => (int) $row['brand_id'],
        'modelId' => $row['model_id'] === null ? null : (int) $row['model_id'],
        'issues'  => json_decode((string) $row['issues'], true) ?: [],
        'payload' => json_decode($row['payload'], true),
    ];
}
