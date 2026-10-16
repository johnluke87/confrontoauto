<?php
declare(strict_types=1);

/*
 * Consumi REALI: li calcola l'agent (agent/src/real-consumption.mjs) dai dati ufficiali UE dei contatori di bordo
 * (EEA, "real-world CO2 emissions from cars and vans", milioni di auto) e qui li salva su ogni motore.
 *
 *   GET  /agent/powertrains        tutti i motori con quello che serve per riconoscerli nei dati UE
 *   POST /agent/real-consumption   i consumi reali trovati (a blocchi; i motori mandati senza dati vengono svuotati)
 */

/** GET /agent/powertrains */
function handle_agent_powertrains(): never
{
    require_agent();
    $rows = db()->query(
        'SELECT p.id, b.name AS brand, m.name AS model, p.name, p.fuel, p.power_kw, p.power_cv, p.displacement_cc,
                p.consumption_wltp, p.consumption_unit, p.co2_g_km
           FROM ca_powertrains p
           JOIN ca_models m ON m.id = p.model_id
           JOIN ca_brands b ON b.id = m.brand_id
          ORDER BY p.id'
    )->fetchAll();
    $int = fn ($v) => $v === null ? null : (int) $v;
    json_response(array_map(fn (array $r) => [
        'id'              => (int) $r['id'],
        'brand'           => $r['brand'],
        'model'           => $r['model'],
        'name'            => $r['name'],
        'fuel'            => $r['fuel'],
        'powerKw'         => $int($r['power_kw']),
        'powerCv'         => $int($r['power_cv']),
        'displacementCc'  => $int($r['displacement_cc']),
        'consumption'     => $r['consumption_wltp'] === null ? null : (float) $r['consumption_wltp'],
        'consumptionUnit' => $r['consumption_unit'],
        'co2'             => $int($r['co2_g_km']),
    ], $rows));
}

/**
 * POST /agent/real-consumption
 * { "source": {"title": "...", "url": "..."}, "items": [{ "powertrainId": 1, "level": "version", "vehicles": 1234,
 *   "realConsumption": 6.4, "realKwh100km": null, "realEvShare": null, "factor": 1.18 }, ...] }
 * level null = nessun dato: svuota.
 */
function handle_agent_real_consumption(): never
{
    require_agent();
    $body = read_json_body(AGENT_MAX_BODY_BYTES);
    $source = $body['source'] ?? null;
    $items = $body['items'] ?? null;
    if (!is_array($source) || !is_string($source['title'] ?? null) || !is_array($items) || !array_is_list($items) || count($items) > 5000) {
        throw new HttpException(400, 'Servono "source" {title, url} e "items" (al massimo 5000)');
    }

    $title = mb_substr(trim($source['title']), 0, 250);
    $url = is_string($source['url'] ?? null) && str_starts_with($source['url'], 'https://') ? mb_substr($source['url'], 0, 500) : null;
    $now = now_utc();
    $find = db()->prepare('SELECT id FROM ca_sources WHERE title = ?');
    $find->execute([$title]);
    $sourceId = $find->fetchColumn();
    if ($sourceId === false) {
        db()->prepare('INSERT INTO ca_sources (url, title, source_type, fetched_at, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$url, $title, 'government', $now, $now]);
        $sourceId = db()->lastInsertId();
    }

    // numero nell'intervallo giusto, altrimenti null
    $num = function ($value, float $min, float $max): ?float {
        return (is_int($value) || is_float($value)) && $value >= $min && $value <= $max ? (float) $value : null;
    };
    $update = db()->prepare(
        'UPDATE ca_powertrains SET real_consumption = ?, real_kwh_100km = ?, real_ev_share = ?, real_factor = ?,
                real_vehicles = ?, real_level = ?, real_source_id = ? WHERE id = ?'
    );
    $saved = 0;
    $cleared = 0;
    db()->beginTransaction();
    foreach ($items as $item) {
        $id = $item['powertrainId'] ?? null;
        if (!is_int($id) || $id < 1) {
            continue;
        }
        $level = in_array($item['level'] ?? null, ['version', 'model', 'brand'], true) ? $item['level'] : null;
        $vehicles = is_int($item['vehicles'] ?? null) && $item['vehicles'] > 0 ? $item['vehicles'] : null;
        if ($level === null || $vehicles === null) {
            $update->execute([null, null, null, null, null, null, null, $id]);
            $cleared++;
            continue;
        }
        $update->execute([
            $num($item['realConsumption'] ?? null, 0.3, 40),
            $num($item['realKwh100km'] ?? null, 0.1, 60),
            $num($item['realEvShare'] ?? null, 0, 1),
            $num($item['factor'] ?? null, 0.5, 3),
            $vehicles,
            $level,
            (int) $sourceId,
            $id,
        ]);
        $saved++;
    }
    db()->commit();
    json_response(['saved' => $saved, 'cleared' => $cleared]);
}
