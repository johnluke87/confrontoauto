<?php
declare(strict_types=1);

/*
 * CONFRONTO AUTO — crea/aggiorna le tabelle e inserisce i dati di partenza.
 * Si può eseguire più volte: CREATE TABLE IF NOT EXISTS e INSERT IGNORE non toccano quello che c'è già.
 * Protetto da 'maintenance_key' (config.php): quando hai finito mettila vuota e lo script si disattiva.
 *
 * AFFIDABILITÀ di ogni dato (colonna "confidence"):
 *   official = 🟢 dato ufficiale (listino, configuratore, scheda tecnica della casa)
 *   verified = 🟡 verificato da più fonti
 *   estimate = 🟠 stima
 *   missing  = 🔴 dato mancante (il valore è NULL: non si inventa mai)
 */

require __DIR__ . '/private/bootstrap.php';

send_security_headers();
header('Referrer-Policy: same-origin'); // form: con no-referrer il browser manderebbe "Origin: null"
require_https();
require_allowed_origin();
header('Content-Type: text/html; charset=utf-8');

$O = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
$CONF = "ENUM('official','verified','estimate','missing') NOT NULL DEFAULT 'missing'";

$TABLES = [
    // ---------- Account (separati dalla dashboard) ----------
    'ca_users' => "CREATE TABLE IF NOT EXISTS ca_users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        is_admin TINYINT(1) NOT NULL DEFAULT 0,
        failed_logins TINYINT UNSIGNED NOT NULL DEFAULT 0,
        locked_until DATETIME NULL,
        created_at DATETIME NOT NULL
    ) $O",
    'ca_auth_tokens' => "CREATE TABLE IF NOT EXISTS ca_auth_tokens (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        created_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        last_used_at DATETIME NULL,
        user_agent VARCHAR(255) NULL,
        CONSTRAINT fk_ca_tokens_user FOREIGN KEY (user_id) REFERENCES ca_users(id) ON DELETE CASCADE
    ) $O",
    'ca_rate_limits' => "CREATE TABLE IF NOT EXISTS ca_rate_limits (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bucket VARCHAR(32) NOT NULL,
        ip_hash CHAR(64) NOT NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_ca_rate_limits_lookup (bucket, ip_hash, created_at)
    ) $O",

    // ---------- Fonti: da dove viene ogni dato ----------
    'ca_sources' => "CREATE TABLE IF NOT EXISTS ca_sources (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        url VARCHAR(1000) NULL,
        title VARCHAR(255) NOT NULL,
        source_type ENUM('official_pricelist','official_configurator','official_spec','official_site',
                         'government','press','aggregator','user_file','other') NOT NULL,
        fetched_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_ca_sources_url (url(191))
    ) $O",

    // ---------- Catalogo ----------
    'ca_brands' => "CREATE TABLE IF NOT EXISTS ca_brands (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        slug VARCHAR(80) NOT NULL UNIQUE,
        official_url VARCHAR(255) NULL,
        -- domini considerati \"ufficiali\" per le fonti, separati da virgola (es. fiat.it,fiat.com)
        official_domains VARCHAR(500) NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        last_researched_at DATETIME NULL,
        next_research_at DATETIME NULL,
        -- il Research agent \"prenota\" il lavoro: due esecuzioni non fanno la stessa cosa
        research_claimed_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    ) $O",
    'ca_models' => "CREATE TABLE IF NOT EXISTS ca_models (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        brand_id INT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        slug VARCHAR(120) NOT NULL,
        generation VARCHAR(60) NULL,
        body_type ENUM('city','hatchback','sedan','wagon','suv','crossover','mpv','coupe','convertible','pickup','van','other') NULL,
        segment VARCHAR(10) NULL,
        official_url VARCHAR(500) NULL,
        status ENUM('active','discontinued') NOT NULL DEFAULT 'active',
        last_researched_at DATETIME NULL,
        next_research_at DATETIME NULL,
        research_claimed_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_ca_models_brand_slug (brand_id, slug),
        INDEX idx_ca_models_research (status, next_research_at),
        CONSTRAINT fk_ca_models_brand FOREIGN KEY (brand_id) REFERENCES ca_brands(id) ON DELETE CASCADE
    ) $O",
    // allestimento: Essential, Expression, Extreme...
    'ca_trims' => "CREATE TABLE IF NOT EXISTS ca_trims (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        model_id INT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_ca_trims_model_name (model_id, name),
        CONSTRAINT fk_ca_trims_model FOREIGN KEY (model_id) REFERENCES ca_models(id) ON DELETE CASCADE
    ) $O",
    // motorizzazione: 1.2 TCe GPL 120 CV manuale 2WD...
    'ca_powertrains' => "CREATE TABLE IF NOT EXISTS ca_powertrains (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        model_id INT UNSIGNED NOT NULL,
        name VARCHAR(160) NOT NULL,
        fuel ENUM('petrol','diesel','lpg','cng','mild_hybrid','full_hybrid','plugin_hybrid','electric') NOT NULL,
        cylinders TINYINT UNSIGNED NULL,
        displacement_cc SMALLINT UNSIGNED NULL,
        power_kw SMALLINT UNSIGNED NULL,
        power_cv SMALLINT UNSIGNED NULL,
        gearbox ENUM('manual','automatic') NULL,
        gears TINYINT UNSIGNED NULL,
        drive ENUM('fwd','rwd','awd') NULL,
        timing ENUM('belt','chain','none') NULL,
        -- consumi WLTP combinati: l/100km (benzina, diesel, GPL), kg/100km (metano), kWh/100km (elettrico)
        consumption_wltp DECIMAL(5,2) NULL,
        consumption_unit ENUM('l_100km','kg_100km','kwh_100km') NULL,
        -- plug-in ed elettriche
        electric_consumption_wltp DECIMAL(5,2) NULL,
        battery_kwh DECIMAL(5,1) NULL,
        electric_range_km SMALLINT UNSIGNED NULL,
        co2_g_km SMALLINT UNSIGNED NULL,
        euro_class VARCHAR(20) NULL,
        tank_l SMALLINT UNSIGNED NULL,
        lpg_tank_l SMALLINT UNSIGNED NULL,
        -- per ogni campo qui sopra: {\"campo\": {\"s\": id_fonte, \"c\": affidabilità}}
        provenance TEXT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_ca_powertrains_model_name (model_id, name),
        CONSTRAINT fk_ca_powertrains_model FOREIGN KEY (model_id) REFERENCES ca_models(id) ON DELETE CASCADE
    ) $O",
    // la versione ACQUISTABILE: allestimento x motore, col suo prezzo e le sue misure
    'ca_variants' => "CREATE TABLE IF NOT EXISTS ca_variants (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        trim_id INT UNSIGNED NOT NULL,
        powertrain_id INT UNSIGNED NOT NULL,
        list_price_cents INT UNSIGNED NULL,
        price_valid_from DATE NULL,
        on_road_cents INT UNSIGNED NULL,
        length_mm SMALLINT UNSIGNED NULL,
        width_mm SMALLINT UNSIGNED NULL,
        height_mm SMALLINT UNSIGNED NULL,
        wheelbase_mm SMALLINT UNSIGNED NULL,
        trunk_l SMALLINT UNSIGNED NULL,
        trunk_max_l SMALLINT UNSIGNED NULL,
        seats TINYINT UNSIGNED NULL,
        doors TINYINT UNSIGNED NULL,
        weight_kg SMALLINT UNSIGNED NULL,
        tire_size VARCHAR(30) NULL,
        available TINYINT(1) NOT NULL DEFAULT 1,
        provenance TEXT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_ca_variants_trim_pt (trim_id, powertrain_id),
        CONSTRAINT fk_ca_variants_trim FOREIGN KEY (trim_id) REFERENCES ca_trims(id) ON DELETE CASCADE,
        CONSTRAINT fk_ca_variants_pt FOREIGN KEY (powertrain_id) REFERENCES ca_powertrains(id) ON DELETE CASCADE
    ) $O",

    // ---------- Dotazioni ----------
    // l'elenco delle dotazioni che l'utente può chiedere (sensori, retrocamera, CarPlay...)
    'ca_features' => "CREATE TABLE IF NOT EXISTS ca_features (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(60) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        category ENUM('sicurezza','assistenza','comfort','multimedia','esterni','interni','altro') NOT NULL,
        sort_order SMALLINT NOT NULL DEFAULT 0
    ) $O",
    // pacchetti di optional (es. 'Pack City' = sensori + retrocamera) per allestimento
    'ca_packages' => "CREATE TABLE IF NOT EXISTS ca_packages (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        trim_id INT UNSIGNED NOT NULL,
        name VARCHAR(160) NOT NULL,
        price_cents INT UNSIGNED NULL,
        source_id INT UNSIGNED NULL,
        confidence $CONF,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_ca_packages_trim_name (trim_id, name),
        CONSTRAINT fk_ca_packages_trim FOREIGN KEY (trim_id) REFERENCES ca_trims(id) ON DELETE CASCADE
    ) $O",
    'ca_package_features' => "CREATE TABLE IF NOT EXISTS ca_package_features (
        package_id INT UNSIGNED NOT NULL,
        feature_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (package_id, feature_id),
        CONSTRAINT fk_ca_pf_package FOREIGN KEY (package_id) REFERENCES ca_packages(id) ON DELETE CASCADE,
        CONSTRAINT fk_ca_pf_feature FOREIGN KEY (feature_id) REFERENCES ca_features(id) ON DELETE CASCADE
    ) $O",
    // per ogni allestimento: la dotazione è di serie, optional (con prezzo), in un pacchetto o non disponibile
    'ca_trim_features' => "CREATE TABLE IF NOT EXISTS ca_trim_features (
        trim_id INT UNSIGNED NOT NULL,
        feature_id INT UNSIGNED NOT NULL,
        availability ENUM('standard','optional','package','not_available') NOT NULL,
        price_cents INT UNSIGNED NULL,
        package_id INT UNSIGNED NULL,
        source_id INT UNSIGNED NULL,
        confidence $CONF,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (trim_id, feature_id),
        CONSTRAINT fk_ca_tf_trim FOREIGN KEY (trim_id) REFERENCES ca_trims(id) ON DELETE CASCADE,
        CONSTRAINT fk_ca_tf_feature FOREIGN KEY (feature_id) REFERENCES ca_features(id) ON DELETE CASCADE,
        CONSTRAINT fk_ca_tf_package FOREIGN KEY (package_id) REFERENCES ca_packages(id) ON DELETE SET NULL
    ) $O",

    // ---------- Parametri dei calcoli (carburanti, manutenzione...) e bollo ----------
    'ca_parameters' => "CREATE TABLE IF NOT EXISTS ca_parameters (
        code VARCHAR(64) NOT NULL PRIMARY KEY,
        sort_order SMALLINT NOT NULL DEFAULT 0,
        label VARCHAR(160) NOT NULL,
        value_num DECIMAL(12,4) NULL,
        unit VARCHAR(30) NOT NULL,
        note VARCHAR(500) NULL,
        source_id INT UNSIGNED NULL,
        confidence $CONF,
        valid_from DATE NULL,
        updated_at DATETIME NOT NULL
    ) $O",
    'ca_regions' => "CREATE TABLE IF NOT EXISTS ca_regions (
        code CHAR(3) NOT NULL PRIMARY KEY,
        name VARCHAR(60) NOT NULL
    ) $O",
    // bollo: €/kW fino a 100 kW e oltre, esenzioni (anni) e riduzione dopo l'esenzione, per regione e gruppo di alimentazione
    'ca_road_tax_rules' => "CREATE TABLE IF NOT EXISTS ca_road_tax_rules (
        region_code CHAR(3) NOT NULL,
        fuel_group ENUM('thermal','lpg_cng','hybrid','plugin_hybrid','electric') NOT NULL,
        rate_upto_100kw DECIMAL(6,2) NULL,
        rate_over_100kw DECIMAL(6,2) NULL,
        exempt_years TINYINT UNSIGNED NOT NULL DEFAULT 0,
        after_exempt_pct TINYINT UNSIGNED NOT NULL DEFAULT 100,
        note VARCHAR(500) NULL,
        source_id INT UNSIGNED NULL,
        confidence $CONF,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (region_code, fuel_group),
        CONSTRAINT fk_ca_tax_region FOREIGN KEY (region_code) REFERENCES ca_regions(code) ON DELETE CASCADE
    ) $O",

    // ---------- Dati dell'utente ----------
    'ca_user_settings' => "CREATE TABLE IF NOT EXISTS ca_user_settings (
        user_id INT UNSIGNED PRIMARY KEY,
        region_code CHAR(3) NOT NULL DEFAULT 'VEN',
        updated_at DATETIME NOT NULL,
        CONSTRAINT fk_ca_settings_user FOREIGN KEY (user_id) REFERENCES ca_users(id) ON DELETE CASCADE
    ) $O",
    // i profili di ricerca (km/anno, percorsi, budget, dotazioni obbligatorie...): JSON, come lo usa Angular
    'ca_profiles' => "CREATE TABLE IF NOT EXISTS ca_profiles (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        data TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_ca_profiles_user (user_id),
        CONSTRAINT fk_ca_profiles_user FOREIGN KEY (user_id) REFERENCES ca_users(id) ON DELETE CASCADE
    ) $O",
    // un commento per auto/configurazione, per utente
    'ca_comments' => "CREATE TABLE IF NOT EXISTS ca_comments (
        user_id INT UNSIGNED NOT NULL,
        variant_id INT UNSIGNED NOT NULL,
        body TEXT NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (user_id, variant_id),
        CONSTRAINT fk_ca_comments_user FOREIGN KEY (user_id) REFERENCES ca_users(id) ON DELETE CASCADE,
        CONSTRAINT fk_ca_comments_variant FOREIGN KEY (variant_id) REFERENCES ca_variants(id) ON DELETE CASCADE
    ) $O",

    // ---------- Aggiornamento automatico (tappa 2) ----------
    // ogni risultato del Research agent arriva qui; viene applicato o messo "da rivedere"
    'ca_imports' => "CREATE TABLE IF NOT EXISTS ca_imports (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        task_type ENUM('brand','model') NOT NULL,
        model_id INT UNSIGNED NULL,
        brand_id INT UNSIGNED NULL,
        payload MEDIUMTEXT NOT NULL,
        -- pending = appena arrivato; applied = salvato nel catalogo; review = da controllare a mano;
        -- rejected = scartato; failed = l'agent non ci è riuscito (sito irraggiungibile, risposta non valida...)
        status ENUM('pending','applied','review','rejected','failed') NOT NULL DEFAULT 'pending',
        -- JSON: [{\"level\": \"warning\" | \"error\", \"message\": \"...\"}]
        issues MEDIUMTEXT NULL,
        reviewed_by INT UNSIGNED NULL,
        received_at DATETIME NOT NULL,
        processed_at DATETIME NULL,
        INDEX idx_ca_imports_status (status, received_at)
    ) $O",
];

// ---------- Dati di partenza ----------

// I marchi in vendita in Italia (attivabili/disattivabili dalla pagina di configurazione)
// Colonne arrivate dopo la prima versione: [tabella, colonna, definizione]. migrate.php le aggiunge se mancano.
$COLUMNS = [
    ['ca_brands', 'official_domains', 'VARCHAR(500) NULL AFTER official_url'],
    ['ca_brands', 'next_research_at', 'DATETIME NULL AFTER last_researched_at'],
    ['ca_brands', 'research_claimed_at', 'DATETIME NULL AFTER next_research_at'],
    ['ca_models', 'next_research_at', 'DATETIME NULL AFTER last_researched_at'],
    ['ca_models', 'research_claimed_at', 'DATETIME NULL AFTER next_research_at'],
    ['ca_parameters', 'sort_order', 'SMALLINT NOT NULL DEFAULT 0 AFTER code'],
    ['ca_imports', 'task_type', "ENUM('brand','model') NOT NULL DEFAULT 'model' AFTER id"],
    ['ca_imports', 'reviewed_by', 'INT UNSIGNED NULL AFTER issues'],
];

$BRANDS = [
    ['Abarth', 'https://www.abarth.it'], ['Alfa Romeo', 'https://www.alfaromeo.it'], ['Alpine', 'https://www.alpinecars.com/it/'],
    ['Aston Martin', 'https://www.astonmartin.com/it'], ['Audi', 'https://www.audi.it'], ['Bentley', 'https://www.bentleymotors.com'],
    ['BMW', 'https://www.bmw.it'], ['BYD', 'https://www.byd.com/it'], ['Citroën', 'https://www.citroen.it'],
    ['Cupra', 'https://www.cupraofficial.it'], ['Dacia', 'https://www.dacia.it'], ['DR', 'https://www.drautomobiles.com'],
    ['DS', 'https://www.dsautomobiles.it'], ['EVO', 'https://www.evo-cars.it'], ['Ferrari', 'https://www.ferrari.com/it-IT'],
    ['Fiat', 'https://www.fiat.it'], ['Ford', 'https://www.ford.it'], ['Honda', 'https://www.honda.it'],
    ['Hyundai', 'https://www.hyundai.com/it'], ['Jaecoo', 'https://www.jaecoo.it'], ['Jaguar', 'https://www.jaguar.it'],
    ['Jeep', 'https://www.jeep-official.it'], ['Kia', 'https://www.kia.com/it'], ['Lamborghini', 'https://www.lamborghini.com/it-en'],
    ['Lancia', 'https://www.lancia.it'], ['Land Rover', 'https://www.landrover.it'], ['Leapmotor', 'https://www.leapmotor.net/it'],
    ['Lexus', 'https://www.lexus.it'], ['Lynk & Co', 'https://www.lynkco.com/it-it'], ['Maserati', 'https://www.maserati.com/it/it'],
    ['Mazda', 'https://www.mazda.it'], ['Mercedes-Benz', 'https://www.mercedes-benz.it'], ['MG', 'https://www.mgmotor.it'],
    ['Mini', 'https://www.mini.it'], ['Mitsubishi', 'https://www.mitsubishi-auto.it'], ['Nissan', 'https://www.nissan.it'],
    ['Omoda', 'https://www.omoda.it'], ['Opel', 'https://www.opel.it'], ['Peugeot', 'https://www.peugeot.it'],
    ['Polestar', 'https://www.polestar.com/it'], ['Porsche', 'https://www.porsche.com/italy/'], ['Renault', 'https://www.renault.it'],
    ['Seat', 'https://www.seat.it'], ['Skoda', 'https://www.skoda-auto.it'], ['Smart', 'https://it.smart.com'],
    ['Subaru', 'https://www.subaru.it'], ['Suzuki', 'https://auto.suzuki.it'], ['Tesla', 'https://www.tesla.com/it_it'],
    ['Toyota', 'https://www.toyota.it'], ['Volkswagen', 'https://www.volkswagen.it'], ['Volvo', 'https://www.volvocars.com/it'],
    ['XPeng', 'https://www.xpeng.com/it'],
];

// Le dotazioni che si possono chiedere come "obbligatorie" [codice, nome, categoria]
$FEATURES = [
    ['rear_parking_sensors', 'Sensori di parcheggio posteriori', 'assistenza'],
    ['front_parking_sensors', 'Sensori di parcheggio anteriori', 'assistenza'],
    ['rear_camera', 'Retrocamera', 'assistenza'],
    ['camera_360', 'Telecamere a 360°', 'assistenza'],
    ['park_assist', 'Parcheggio automatico', 'assistenza'],
    ['cruise_control', 'Cruise control', 'assistenza'],
    ['adaptive_cruise', 'Cruise control adattivo', 'assistenza'],
    ['lane_assist', 'Mantenimento della corsia', 'sicurezza'],
    ['blind_spot', 'Monitoraggio angolo cieco', 'sicurezza'],
    ['auto_emergency_brake', 'Frenata automatica di emergenza', 'sicurezza'],
    ['auto_high_beam', 'Abbaglianti automatici', 'sicurezza'],
    ['rain_sensor', 'Sensore pioggia', 'comfort'],
    ['light_sensor', 'Sensore luci', 'comfort'],
    ['climate_manual', 'Climatizzatore manuale', 'comfort'],
    ['climate_auto', 'Climatizzatore automatico', 'comfort'],
    ['climate_dual_zone', 'Climatizzatore bizona', 'comfort'],
    ['keyless', 'Accesso e avviamento senza chiave', 'comfort'],
    ['heated_seats', 'Sedili anteriori riscaldati', 'comfort'],
    ['heated_steering_wheel', 'Volante riscaldato', 'comfort'],
    ['electric_folding_mirrors', 'Specchietti ripiegabili elettricamente', 'comfort'],
    ['rear_electric_windows', 'Alzacristalli posteriori elettrici', 'comfort'],
    ['electric_tailgate', 'Portellone elettrico', 'comfort'],
    ['heat_pump', 'Pompa di calore (elettriche)', 'comfort'],
    ['carplay_android_auto', 'Apple CarPlay / Android Auto', 'multimedia'],
    ['wireless_carplay_android_auto', 'CarPlay / Android Auto wireless', 'multimedia'],
    ['navigation', 'Navigatore integrato', 'multimedia'],
    ['wireless_charger', 'Ricarica smartphone wireless', 'multimedia'],
    ['digital_cluster', 'Quadro strumenti digitale', 'multimedia'],
    ['led_headlights', 'Fari anteriori a LED', 'esterni'],
    ['alloy_wheels', 'Cerchi in lega', 'esterni'],
    ['tinted_rear_windows', 'Vetri posteriori oscurati', 'esterni'],
    ['roof_rails', 'Barre / mancorrenti sul tetto', 'esterni'],
    ['metallic_paint', 'Vernice metallizzata', 'esterni'],
    ['panoramic_roof', 'Tetto panoramico / apribile', 'esterni'],
    ['tow_hook', 'Gancio traino', 'esterni'],
    ['spare_wheel', 'Ruotino di scorta', 'altro'],
    ['height_adjustable_driver_seat', 'Sedile guida regolabile in altezza', 'interni'],
    ['split_rear_seat', 'Sedile posteriore frazionato', 'interni'],
];

$REGIONS = [
    ['ABR', 'Abruzzo'], ['BAS', 'Basilicata'], ['CAL', 'Calabria'], ['CAM', 'Campania'], ['EMR', 'Emilia-Romagna'],
    ['FVG', 'Friuli-Venezia Giulia'], ['LAZ', 'Lazio'], ['LIG', 'Liguria'], ['LOM', 'Lombardia'], ['MAR', 'Marche'],
    ['MOL', 'Molise'], ['PIE', 'Piemonte'], ['PUG', 'Puglia'], ['SAR', 'Sardegna'], ['SIC', 'Sicilia'],
    ['TOS', 'Toscana'], ['TAA', 'Trentino-Alto Adige'], ['UMB', 'Umbria'], ['VDA', "Valle d'Aosta"], ['VEN', 'Veneto'],
];

$key = (string) (config()['maintenance_key'] ?? '');
$log = [];
$message = null;

if (strlen($key) < 20) {
    $message = "Script disattivato: in config.php non c'è una maintenance_key (almeno 20 caratteri).";
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($key, (string) ($_POST['maintenance_key'] ?? ''))) {
        $message = 'Chiave errata.';
    } else {
        $pdo = db();
        $now = now_utc();
        $existing = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        foreach ($TABLES as $name => $sql) {
            $pdo->exec($sql);
            $log[] = in_array($name, $existing, true) ? "$name: già presente" : "$name: CREATA";
        }

        // tabelle create da una versione precedente: aggiungo le colonne nuove (CREATE IF NOT EXISTS non lo fa)
        $hasColumn = function (string $table, string $column) use ($pdo): bool {
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
            $stmt->execute([$table, $column]);
            return (int) $stmt->fetchColumn() > 0;
        };
        foreach ($COLUMNS as [$table, $column, $definition]) {
            if (!$hasColumn($table, $column)) {
                $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition");
                $log[] = "$table.$column: AGGIUNTA";
            }
        }
        // stati e dimensioni nuove della coda del Research agent (MODIFY è innocuo se è già così)
        $pdo->exec("ALTER TABLE ca_imports MODIFY status ENUM('pending','applied','review','rejected','failed') NOT NULL DEFAULT 'pending', MODIFY issues MEDIUMTEXT NULL");
        // domini ufficiali dei marchi già presenti, presi dal loro sito
        $fill = $pdo->prepare('UPDATE ca_brands SET official_domains = ? WHERE id = ?');
        foreach ($pdo->query('SELECT id, official_url FROM ca_brands WHERE official_domains IS NULL AND official_url IS NOT NULL') as $b) {
            $fill->execute([registrable_domain((string) parse_url($b['official_url'], PHP_URL_HOST)), $b['id']]);
        }

        // fonti di partenza (una volta sola: le riconosco dal titolo)
        $sourceId = function (string $title, ?string $url, string $type) use ($pdo, $now): int {
            $stmt = $pdo->prepare('SELECT id FROM ca_sources WHERE title = ?');
            $stmt->execute([$title]);
            $id = $stmt->fetchColumn();
            if ($id !== false) {
                return (int) $id;
            }
            $pdo->prepare('INSERT INTO ca_sources (url, title, source_type, fetched_at, created_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([$url, $title, $type, $now, $now]);
            return (int) $pdo->lastInsertId();
        };
        $excel = $sourceId('Excel "confronto_auto_2026_15_anni_v3" (foglio ASSUNZIONI, 20/09/2026)', null, 'user_file');
        $venetoTax = $sourceId('Regione Veneto – tasse automobilistiche, riduzioni', 'https://www.regione.veneto.it/web/tributi-regionali/riduzioni', 'government');
        $venetoHybrid = $sourceId('Regione Veneto – esenzioni veicoli ibridi', 'https://elezioni2020.regione.veneto.it/web/tributi-regionali/esenzioni', 'government');
        $national = $sourceId('Tariffe nazionali bollo auto Euro 4/5/6 (2,58 €/kW fino a 100 kW, 3,87 €/kW oltre)', null, 'other');

        $added = 0;
        $ins = $pdo->prepare(
            'INSERT IGNORE INTO ca_brands (name, slug, official_url, official_domains, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)'
        );
        foreach ($BRANDS as [$name, $url]) {
            $ins->execute([$name, slugify($name), $url, registrable_domain((string) parse_url($url, PHP_URL_HOST)), $now, $now]);
            $added += $ins->rowCount();
        }
        $log[] = "marchi: $added nuovi (totale " . count($BRANDS) . ')';

        $added = 0;
        $ins = $pdo->prepare('INSERT IGNORE INTO ca_features (code, name, category, sort_order) VALUES (?, ?, ?, ?)');
        foreach ($FEATURES as $i => [$code, $name, $category]) {
            $ins->execute([$code, $name, $category, $i]);
            $added += $ins->rowCount();
        }
        $log[] = "dotazioni: $added nuove (totale " . count($FEATURES) . ')';

        $ins = $pdo->prepare('INSERT IGNORE INTO ca_regions (code, name) VALUES (?, ?)');
        foreach ($REGIONS as [$code, $name]) {
            $ins->execute([$code, $name]);
        }

        // BOLLO. Veneto: dal tuo Excel/Regione Veneto. Altre regioni: tariffa nazionale come STIMA (da verificare)
        $tax = $pdo->prepare(
            'INSERT IGNORE INTO ca_road_tax_rules
             (region_code, fuel_group, rate_upto_100kw, rate_over_100kw, exempt_years, after_exempt_pct, note, source_id, confidence, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($REGIONS as [$code]) {
            if ($code === 'VEN') {
                $tax->execute(['VEN', 'thermal', 2.84, 4.26, 0, 100, null, $venetoTax, 'verified', $now]);
                $tax->execute(['VEN', 'lpg_cng', 2.84, 4.26, 0, 100, 'bivalenti GPL/metano', $venetoTax, 'verified', $now]);
                $tax->execute(['VEN', 'hybrid', 2.84, 4.26, 3, 100, '3 annualità esenti', $venetoHybrid, 'verified', $now]);
                $tax->execute(['VEN', 'plugin_hybrid', 2.84, 4.26, 3, 100, 'trattate come ibride: da verificare', $venetoHybrid, 'estimate', $now]);
                $tax->execute(['VEN', 'electric', 2.84, 4.26, 5, 25, '5 anni esenti, poi riduzione 75%', $venetoTax, 'verified', $now]);
                continue;
            }
            $tax->execute([$code, 'thermal', 2.58, 3.87, 0, 100, 'tariffa nazionale: verificare la regione', $national, 'estimate', $now]);
            $tax->execute([$code, 'lpg_cng', 2.58, 3.87, 0, 100, 'tariffa nazionale: verificare riduzioni regionali', $national, 'estimate', $now]);
            $tax->execute([$code, 'hybrid', 2.58, 3.87, 0, 100, 'esenzioni ibride regionali: da verificare', $national, 'estimate', $now]);
            $tax->execute([$code, 'plugin_hybrid', 2.58, 3.87, 0, 100, 'esenzioni regionali: da verificare', $national, 'estimate', $now]);
            $tax->execute([$code, 'electric', 2.58, 3.87, 5, 25, '5 anni esenti poi 25%: da verificare', $national, 'estimate', $now]);
        }
        $log[] = 'bollo: regole per ' . count($REGIONS) . ' regioni (Veneto verificato, le altre stime da verificare)';

        // PARAMETRI dei calcoli. NULL + 'missing' = non lo sappiamo ancora (lo cercherà il Research agent): niente numeri inventati
        $P = [
            // [codice, etichetta, valore, unità, nota, fonte, affidabilità]
            ['fuel_price_petrol', 'Prezzo benzina', 2.135, '€/l', 'scenario del tuo Excel', $excel, 'estimate'],
            ['fuel_price_diesel', 'Prezzo gasolio', null, '€/l', 'da rilevare (media nazionale MIMIT)', null, 'missing'],
            ['fuel_price_lpg', 'Prezzo GPL', 0.742, '€/l', 'scenario del tuo Excel', $excel, 'estimate'],
            ['fuel_price_cng', 'Prezzo metano', null, '€/kg', 'da rilevare (media nazionale MIMIT)', null, 'missing'],
            ['electricity_price_home', 'Prezzo energia domestica', 0.3024, '€/kWh', 'scenario del tuo Excel', $excel, 'estimate'],
            ['electricity_price_public', 'Prezzo ricarica pubblica', null, '€/kWh', 'da rilevare', null, 'missing'],
            ['charging_losses_pct', 'Perdite di ricarica', 10, '%', 'come nel tuo Excel', $excel, 'estimate'],
            ['real_consumption_factor_pct', 'Consumo reale rispetto al WLTP', null, '%', 'da definire con fonte', null, 'missing'],
            ['insurance_year', 'Assicurazione RCA (media)', 750, '€/anno', 'Excel: 650–850 €/anno; dipende molto dal profilo', $excel, 'estimate'],
            ['tire_set_price', 'Treno di gomme (media)', 600, '€', 'Excel: 550–650 € a seconda del modello', $excel, 'estimate'],
            ['tire_set_every_km', 'Cambio gomme ogni', 52500, 'km', 'Excel: 5 treni in 262.500 km', $excel, 'estimate'],
            ['service_year', 'Tagliando (media annua)', 290, '€/anno', 'Excel: ~4.300 € in 15 anni', $excel, 'estimate'],
            ['brakes_job', 'Freni (dischi + pastiglie)', 700, '€', 'Excel: ~1.400 € in 15 anni', $excel, 'estimate'],
            ['brakes_every_km', 'Freni ogni', 130000, 'km', 'Excel: 2 interventi in 262.500 km', $excel, 'estimate'],
            ['clutch_job', 'Frizione (solo cambio manuale)', 1100, '€', 'Excel: 1 intervento in 15 anni', $excel, 'estimate'],
            ['clutch_every_km', 'Frizione ogni', 150000, 'km', 'stima del tuo Excel', $excel, 'estimate'],
            ['timing_belt_job', 'Cinghia di distribuzione', 1200, '€', 'solo motori a cinghia', $excel, 'estimate'],
            ['timing_belt_every_years', 'Cinghia ogni', 8, 'anni', 'verificare il motore', $excel, 'estimate'],
            ['lpg_tank_job', 'Serbatoio GPL (sostituzione/collaudo)', 700, '€', 'Excel: al 10° anno', $excel, 'estimate'],
            ['lpg_tank_year', 'Serbatoio GPL: sostituzione al', 10, '° anno','come nel tuo Excel', $excel, 'estimate'],
            ['battery_12v_ac_year', 'Batteria 12V / climatizzatore (fondo)', 67, '€/anno', 'Excel: ~1.000 € in 15 anni', $excel, 'estimate'],
            ['unexpected_year', 'Imprevisti / piccoli guasti (fondo)', 270, '€/anno', 'Excel: ~4.000 € in 15 anni', $excel, 'estimate'],
            ['revision_price', 'Revisione', 85, '€', 'prima al 4° anno, poi ogni 2', $excel, 'estimate'],
            ['wallbox_price', 'Wallbox installata', 1300, '€', 'solo elettriche/plug-in, se la vuoi', $excel, 'estimate'],
            ['superbollo_eur_kw', 'Superbollo (oltre 185 kW)', 20, '€/kW', 'tributo nazionale, ridotto dopo 5/10/15 anni', $national, 'estimate'],
        ];
        $ins = $pdo->prepare(
            'INSERT IGNORE INTO ca_parameters (code, label, value_num, unit, note, source_id, confidence, valid_from, sort_order, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $added = 0;
        foreach ($P as $i => [$code, $label, $value, $unit, $note, $source, $confidence]) {
            $ins->execute([$code, $label, $value, $unit, $note, $source, $confidence, $value === null ? null : '2026-09-20', $i, $now]);
            $added += $ins->rowCount();
        }
        $log[] = "parametri: $added nuovi (totale " . count($P) . ')';

        $message = "Fatto. Ora in config.php metti 'maintenance_key' => '' per disattivare lo script.";
    }
}

$escape = fn (string $text): string => htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Confronto auto · aggiornamento database</title>
</head>
<body>
  <h1>Confronto auto · aggiornamento database</h1>
  <?php if ($message !== null): ?><p><strong><?= $escape($message) ?></strong></p><?php endif; ?>
  <?php if ($log !== []): ?>
    <ul><?php foreach ($log as $line): ?><li><?= $escape($line) ?></li><?php endforeach; ?></ul>
  <?php elseif (strlen($key) >= 20): ?>
    <form method="post" autocomplete="off">
      <p><label>Maintenance key<br><input name="maintenance_key" type="password" required></label></p>
      <p><button type="submit">Crea / aggiorna le tabelle</button></p>
    </form>
  <?php endif; ?>
</body>
</html>
