<?php
declare(strict_types=1);

// Lettura del catalogo: elenco dei modelli e scheda completa di un modello (con la provenienza di ogni dato).

/**
 * GET /models: TUTTI i modelli in archivio, ordinati per marchio, con numero di versioni e prezzo minimo.
 * GET /models?brandId=3: solo quelli di un marchio.
 */
function handle_list_models(): never
{
    require_user();
    $brandId = isset($_GET['brandId']) ? (int) $_GET['brandId'] : null;
    $stmt = db()->prepare(
        'SELECT m.id, m.name, m.slug, m.body_type, m.status, m.last_researched_at, m.research_priority,
                b.id AS brand_id, b.name AS brand,
                COUNT(CASE WHEN v.available = 1 THEN v.id END) AS variants,
                MIN(CASE WHEN v.available = 1 THEN COALESCE(v.list_price_cents, v.on_road_cents) END) AS min_price_cents
           FROM ca_models m
           JOIN ca_brands b ON b.id = m.brand_id
           LEFT JOIN ca_trims t ON t.model_id = m.id
           LEFT JOIN ca_variants v ON v.trim_id = t.id
          WHERE ? IS NULL OR m.brand_id = ?
          GROUP BY m.id
          ORDER BY b.name, m.status, m.name'
    );
    $stmt->execute([$brandId, $brandId]);
    json_response(array_map(fn (array $r) => [
        'id'               => (int) $r['id'],
        'brandId'          => (int) $r['brand_id'],
        'brand'            => $r['brand'],
        'name'             => $r['name'],
        'slug'             => $r['slug'],
        'bodyType'         => $r['body_type'],
        'status'           => $r['status'],
        'lastResearchedAt' => utc_to_iso($r['last_researched_at']),
        'variants'         => (int) $r['variants'],
        'queued'           => (bool) $r['research_priority'],
        'minPriceCents'    => $r['min_price_cents'] === null ? null : (int) $r['min_price_cents'],
    ], $stmt->fetchAll()));
}

/** "power_kw" -> "powerKw" */
function snake_to_camel(string $name): string
{
    return lcfirst(str_replace('_', '', ucwords($name, '_')));
}

/** GET /models/{id} */
function handle_get_model(string $id): never
{
    require_user();
    $stmt = db()->prepare('SELECT m.*, b.name AS brand FROM ca_models m JOIN ca_brands b ON b.id = m.brand_id WHERE m.id = ?');
    $stmt->execute([(int) $id]);
    $model = $stmt->fetch();
    if ($model === false) {
        throw new HttpException(404, 'Modello inesistente');
    }
    $modelId = (int) $model['id'];
    $usedSources = [];

    // provenance nel database: {"power_kw": {"s": id fonte, "c": affidabilità, "q": citazione, "at": data}}
    $provenance = function (?string $json) use (&$usedSources): array {
        $out = [];
        foreach (json_decode((string) $json, true) ?: [] as $column => $p) {
            if (isset($p['s'])) {
                $usedSources[(int) $p['s']] = true;
            }
            $out[snake_to_camel($column)] = [
                'sourceId'   => isset($p['s']) ? (int) $p['s'] : null,
                'confidence' => $p['c'] ?? 'missing',
                'quote'      => $p['q'] ?? null,
                'checkedAt'  => $p['at'] ?? null,
            ];
        }
        return $out;
    };

    /** Una riga del database -> oggetto JSON: colonne in camelCase, numeri come numeri. */
    $row = function (array $r, array $ints, array $floats, array $skip = []) use ($provenance): array {
        $out = [];
        foreach ($r as $column => $value) {
            if (in_array($column, $skip, true)) {
                continue;
            }
            if ($column === 'provenance') {
                $out['provenance'] = $provenance($value);
                continue;
            }
            $out[snake_to_camel($column)] = match (true) {
                $value === null              => null,
                in_array($column, $ints, true)   => (int) $value,
                in_array($column, $floats, true) => (float) $value,
                default                      => $value,
            };
        }
        return $out;
    };

    $stmt = db()->prepare('SELECT id, name FROM ca_trims WHERE model_id = ? ORDER BY sort_order, name');
    $stmt->execute([$modelId]);
    $trims = array_map(fn (array $r) => ['id' => (int) $r['id'], 'name' => $r['name']], $stmt->fetchAll());

    $stmt = db()->prepare('SELECT * FROM ca_powertrains WHERE model_id = ? ORDER BY fuel, power_kw, name');
    $stmt->execute([$modelId]);
    $powertrains = array_map(fn (array $r) => $row(
        $r,
        ['id', 'cylinders', 'displacement_cc', 'power_kw', 'power_cv', 'gears', 'electric_range_km', 'co2_g_km', 'tank_l', 'lpg_tank_l'],
        ['consumption_wltp', 'electric_consumption_wltp', 'battery_kwh'],
        ['model_id', 'created_at', 'updated_at'],
    ), $stmt->fetchAll());

    $stmt = db()->prepare(
        'SELECT v.* FROM ca_variants v JOIN ca_trims t ON t.id = v.trim_id
          WHERE t.model_id = ? ORDER BY v.available DESC, v.list_price_cents IS NULL, v.list_price_cents'
    );
    $stmt->execute([$modelId]);
    $variants = array_map(function (array $r) use ($row) {
        $v = $row(
            $r,
            ['id', 'trim_id', 'powertrain_id', 'list_price_cents', 'on_road_cents', 'length_mm', 'width_mm', 'height_mm',
             'wheelbase_mm', 'trunk_l', 'trunk_max_l', 'seats', 'doors', 'weight_kg'],
            [],
            ['created_at', 'updated_at'],
        );
        $v['available'] = (bool) $r['available'];
        return $v;
    }, $stmt->fetchAll());

    $stmt = db()->prepare(
        'SELECT p.id, p.trim_id, p.name, p.price_cents, p.source_id, p.confidence,
                GROUP_CONCAT(f.code ORDER BY f.sort_order) AS features
           FROM ca_packages p JOIN ca_trims t ON t.id = p.trim_id
           LEFT JOIN ca_package_features pf ON pf.package_id = p.id
           LEFT JOIN ca_features f ON f.id = pf.feature_id
          WHERE t.model_id = ?
          GROUP BY p.id ORDER BY p.name'
    );
    $stmt->execute([$modelId]);
    $packages = [];
    foreach ($stmt->fetchAll() as $r) {
        if ($r['source_id'] !== null) {
            $usedSources[(int) $r['source_id']] = true;
        }
        $p = $row($r, ['id', 'trim_id', 'price_cents', 'source_id'], [], ['features']);
        $p['features'] = $r['features'] === null ? [] : explode(',', $r['features']);
        $packages[] = $p;
    }

    $stmt = db()->prepare(
        'SELECT tf.trim_id, f.code, tf.availability, tf.price_cents, tf.package_id, tf.source_id, tf.confidence
           FROM ca_trim_features tf JOIN ca_trims t ON t.id = tf.trim_id JOIN ca_features f ON f.id = tf.feature_id
          WHERE t.model_id = ?'
    );
    $stmt->execute([$modelId]);
    $trimFeatures = [];
    foreach ($stmt->fetchAll() as $r) {
        if ($r['source_id'] !== null) {
            $usedSources[(int) $r['source_id']] = true;
        }
        $trimFeatures[] = $row($r, ['trim_id', 'price_cents', 'package_id', 'source_id'], []);
    }

    $sources = [];
    if ($usedSources !== []) {
        $ids = array_keys($usedSources);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $stmt = db()->prepare("SELECT id, url, title, source_type, fetched_at FROM ca_sources WHERE id IN ($in)");
        $stmt->execute($ids);
        foreach ($stmt->fetchAll() as $r) {
            $sources[] = [
                'id'        => (int) $r['id'],
                'url'       => $r['url'],
                'title'     => $r['title'],
                'type'      => $r['source_type'],
                'fetchedAt' => utc_to_iso($r['fetched_at']),
            ];
        }
    }

    json_response([
        'id'               => $modelId,
        'brandId'          => (int) $model['brand_id'],
        'brand'            => $model['brand'],
        'name'             => $model['name'],
        'bodyType'         => $model['body_type'],
        'generation'       => $model['generation'],
        'officialUrl'      => $model['official_url'],
        'status'           => $model['status'],
        'lastResearchedAt' => utc_to_iso($model['last_researched_at']),
        'trims'            => $trims,
        'powertrains'      => $powertrains,
        'variants'         => $variants,
        'packages'         => $packages,
        'trimFeatures'     => $trimFeatures,
        'features'         => db()->query('SELECT code, name, category FROM ca_features ORDER BY sort_order')->fetchAll(),
        'sources'          => $sources,
    ]);
}

/**
 * GET /catalog/rows: il "listone" dell'Archivio. Una riga per ogni versione (allestimento + motore) di ogni modello;
 * i modelli senza versioni (non ancora ricercati) sono una riga sola con i campi della versione vuoti.
 * Array compatti (una riga = una lista di valori, nell'ordine di "columns") per non mandare migliaia di nomi di campo.
 */
function handle_catalog_rows(): never
{
    require_user();
    $rows = db()->query(
        "SELECT m.id AS model_id, b.id AS brand_id, b.name AS brand, m.name AS model, m.body_type, m.status, m.last_researched_at,
                t.name AS trim_name, v.id AS variant_id, v.available, v.list_price_cents, v.on_road_cents, v.provenance AS variant_provenance,
                v.length_mm, v.width_mm, v.height_mm, v.wheelbase_mm, v.trunk_l, v.trunk_max_l, v.seats, v.doors, v.weight_kg, v.tire_size,
                p.name AS powertrain, p.fuel, p.power_kw, p.power_cv, p.displacement_cc, p.gearbox, p.gears, p.drive,
                p.consumption_wltp, p.consumption_unit, p.electric_range_km, p.battery_kwh, p.co2_g_km, p.timing, p.electric_consumption_wltp,
                p.real_consumption, p.real_kwh_100km, p.real_ev_share, p.real_factor, p.real_vehicles, p.real_level,
                COALESCE(m.official_url, b.official_url) AS model_url
           FROM ca_models m
           JOIN ca_brands b ON b.id = m.brand_id
           LEFT JOIN (ca_trims t JOIN ca_variants v ON v.trim_id = t.id) ON t.model_id = m.id
           LEFT JOIN ca_powertrains p ON p.id = v.powertrain_id
          ORDER BY b.name, m.name, t.sort_order, v.list_price_cents"
    )->fetchAll();

    $columns = [
        'modelId', 'brandId', 'brand', 'model', 'bodyType', 'modelStatus', 'researchedAt',
        'variantId', 'available', 'trim', 'powertrain', 'fuel', 'powerKw', 'powerCv', 'displacementCc', 'gearbox', 'gears', 'drive',
        'consumption', 'consumptionUnit', 'electricRangeKm', 'batteryKwh', 'co2', 'timing', 'electricConsumption',
        'realConsumption', 'realKwh100km', 'realEvShare', 'realFactor', 'realVehicles', 'realLevel',
        'listPrice', 'onRoadPrice', 'priceConfidence',
        'lengthMm', 'widthMm', 'heightMm', 'wheelbaseMm', 'trunkL', 'trunkMaxL', 'seats', 'doors', 'weightKg', 'tireSize',
        // pagina del modello sul sito ufficiale (o del marchio, se il modello non ce l'ha)
        'modelUrl',
    ];
    $int = fn ($v) => $v === null ? null : (int) $v;
    $float = fn ($v) => $v === null ? null : (float) $v;

    $out = [];
    foreach ($rows as $r) {
        // affidabilità del prezzo: quella del listino, altrimenti del chiavi in mano
        $prov = json_decode((string) $r['variant_provenance'], true) ?: [];
        $priceConfidence = $prov['list_price_cents']['c'] ?? $prov['on_road_cents']['c'] ?? null;
        $out[] = [
            (int) $r['model_id'], (int) $r['brand_id'], $r['brand'], $r['model'], $r['body_type'], $r['status'], utc_to_iso($r['last_researched_at']),
            $int($r['variant_id']), $r['variant_id'] === null ? null : (bool) $r['available'], $r['trim_name'], $r['powertrain'], $r['fuel'],
            $int($r['power_kw']), $int($r['power_cv']), $int($r['displacement_cc']), $r['gearbox'], $int($r['gears']), $r['drive'],
            $float($r['consumption_wltp']), $r['consumption_unit'], $int($r['electric_range_km']), $float($r['battery_kwh']), $int($r['co2_g_km']),
            $r['timing'], $float($r['electric_consumption_wltp']),
            $float($r['real_consumption']), $float($r['real_kwh_100km']), $float($r['real_ev_share']), $float($r['real_factor']),
            $int($r['real_vehicles']), $r['real_level'],
            $r['list_price_cents'] === null ? null : (int) $r['list_price_cents'] / 100,
            $r['on_road_cents'] === null ? null : (int) $r['on_road_cents'] / 100,
            $priceConfidence,
            $int($r['length_mm']), $int($r['width_mm']), $int($r['height_mm']), $int($r['wheelbase_mm']),
            $int($r['trunk_l']), $int($r['trunk_max_l']), $int($r['seats']), $int($r['doors']), $int($r['weight_kg']), $r['tire_size'],
            $r['model_url'],
        ];
    }
    json_response(['columns' => $columns, 'rows' => $out]);
}
