<?php
declare(strict_types=1);

// Dati "di riferimento": marchi, regioni con le regole del bollo, parametri dei calcoli.

/** La fonte di un dato come la vede Angular (null se il dato non ha fonte). */
function source_to_json(array $row): ?array
{
    if ($row['source_id'] === null) {
        return null;
    }
    return [
        'id'    => (int) $row['source_id'],
        'title' => $row['source_title'],
        'url'   => $row['source_url'],
        'type'  => $row['source_type'],
    ];
}

/** GET /brands: tutti i marchi, con il numero di modelli in archivio. */
function handle_list_brands(): never
{
    require_user();
    $rows = db()->query(
        'SELECT b.id, b.name, b.slug, b.official_url, b.enabled, b.last_researched_at,
                (SELECT COUNT(*) FROM ca_models m WHERE m.brand_id = b.id) AS models
           FROM ca_brands b
          ORDER BY b.name'
    )->fetchAll();

    json_response(array_map(fn (array $r) => [
        'id'               => (int) $r['id'],
        'name'             => $r['name'],
        'slug'             => $r['slug'],
        'officialUrl'      => $r['official_url'],
        'enabled'          => (bool) $r['enabled'],
        'lastResearchedAt' => utc_to_iso($r['last_researched_at']),
        'models'           => (int) $r['models'],
    ], $rows));
}

/**
 * PATCH /admin/brands  { "ids": [1, 4, 7], "enabled": true }
 * Solo amministratori: i marchi attivi sono quelli che il Research agent aggiorna ogni mese.
 */
function handle_update_brands(): never
{
    require_admin();
    $body = read_json_body();

    $ids = $body['ids'] ?? null;
    $enabled = $body['enabled'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > 500 || !is_bool($enabled)) {
        throw new HttpException(400, 'Servono "ids" (lista di id) ed "enabled" (true/false)');
    }
    foreach ($ids as $id) {
        if (!is_int($id) || $id < 1) {
            throw new HttpException(400, 'Id marchio non valido');
        }
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    db()->prepare("UPDATE ca_brands SET enabled = ?, updated_at = ? WHERE id IN ($placeholders)")
        ->execute([$enabled ? 1 : 0, now_utc(), ...$ids]);

    handle_list_brands();
}

/** GET /regions: le regioni con le regole del bollo per alimentazione. */
function handle_list_regions(): never
{
    require_user();
    $regions = db()->query('SELECT code, name FROM ca_regions ORDER BY name')->fetchAll();
    $rules = db()->query(
        'SELECT r.*, s.title AS source_title, s.url AS source_url, s.source_type
           FROM ca_road_tax_rules r
           LEFT JOIN ca_sources s ON s.id = r.source_id
          ORDER BY r.fuel_group'
    )->fetchAll();

    $byRegion = [];
    foreach ($rules as $r) {
        $byRegion[$r['region_code']][] = [
            'fuelGroup'      => $r['fuel_group'],
            'rateUpTo100Kw'  => $r['rate_upto_100kw'] === null ? null : (float) $r['rate_upto_100kw'],
            'rateOver100Kw'  => $r['rate_over_100kw'] === null ? null : (float) $r['rate_over_100kw'],
            'exemptYears'    => (int) $r['exempt_years'],
            'afterExemptPct' => (int) $r['after_exempt_pct'],
            'note'           => $r['note'],
            'confidence'     => $r['confidence'],
            'source'         => source_to_json($r),
            'updatedAt'      => utc_to_iso($r['updated_at']),
        ];
    }

    json_response(array_map(fn (array $r) => [
        'code'    => $r['code'],
        'name'    => $r['name'],
        'roadTax' => $byRegion[$r['code']] ?? [],
    ], $regions));
}

/** GET /parameters: prezzi dei carburanti, costi di manutenzione ecc., ognuno con fonte e affidabilità. */
function handle_list_parameters(): never
{
    require_user();
    json_response(parameters_json());
}

/**
 * PATCH /admin/parameters/{code}  { "value": 1.99, "confidence": "verified", "note": "..." }
 * Solo amministratori: aggiorna un parametro (es. il prezzo della benzina). La fonte diventa
 * "inserito a mano da <utente>" con la data di oggi: si vede sempre chi l'ha messo e quando.
 */
function handle_update_parameter(string $code): never
{
    $user = require_admin();
    $body = read_json_body();

    $stmt = db()->prepare('SELECT code FROM ca_parameters WHERE code = ?');
    $stmt->execute([$code]);
    if ($stmt->fetchColumn() === false) {
        throw new HttpException(404, 'Parametro inesistente');
    }

    $value = $body['value'] ?? null;
    if ($value !== null && (!is_int($value) && !is_float($value) || $value < 0 || $value > 1000000)) {
        throw new HttpException(400, 'Il valore deve essere un numero positivo (oppure null = mancante)');
    }
    $confidence = $value === null ? 'missing' : ($body['confidence'] ?? 'verified');
    if (!in_array($confidence, ['official', 'verified', 'estimate', 'missing'], true)) {
        throw new HttpException(400, 'Affidabilità non valida');
    }
    $note = $body['note'] ?? null;
    if ($note !== null && (!is_string($note) || mb_strlen($note) > 500)) {
        throw new HttpException(400, 'Nota non valida (massimo 500 caratteri)');
    }

    $now = now_utc();
    $sourceId = null;
    if ($value !== null) {
        db()->prepare('INSERT INTO ca_sources (url, title, source_type, fetched_at, created_at) VALUES (NULL, ?, ?, ?, ?)')
            ->execute(['Inserito a mano da ' . $user['username'] . ' il ' . gmdate('d/m/Y'), 'other', $now, $now]);
        $sourceId = (int) db()->lastInsertId();
    }

    // la nota vecchia ("scenario del tuo Excel"...) non vale più per un valore nuovo: resta solo quella passata
    $note = $note === null || trim($note) === '' ? null : trim($note);
    db()->prepare(
        'UPDATE ca_parameters SET value_num = ?, confidence = ?, source_id = ?, valid_from = ?, note = ?, updated_at = ? WHERE code = ?'
    )->execute([$value, $confidence, $sourceId, $value === null ? null : gmdate('Y-m-d'), $note, $now, $code]);

    json_response(parameters_json());
}

function parameters_json(): array
{
    $rows = db()->query(
        'SELECT p.*, s.title AS source_title, s.url AS source_url, s.source_type
           FROM ca_parameters p
           LEFT JOIN ca_sources s ON s.id = p.source_id
          ORDER BY p.sort_order, p.code'
    )->fetchAll();

    return array_map(fn (array $r) => [
        'code'       => $r['code'],
        'label'      => $r['label'],
        'value'      => $r['value_num'] === null ? null : (float) $r['value_num'],
        'unit'       => $r['unit'],
        'note'       => $r['note'],
        'confidence' => $r['confidence'],
        'source'     => source_to_json($r),
        'validFrom'  => $r['valid_from'],
        'updatedAt'  => utc_to_iso($r['updated_at']),
    ], $rows);
}
