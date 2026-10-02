<?php
declare(strict_types=1);

/*
 * Le rotte usate dal Research agent (il programma che gira su GitHub Actions, vedi la cartella agent/).
 * Non usa cookie né account: si presenta con l'header X-Agent-Token = 'agent_token' di config.php.
 *
 *   GET  /agent/work?limit=3     cosa ricercare adesso (e lo "prenota" per 30 minuti)
 *   GET  /agent/work?peek=1      solo quanti lavori sono in scadenza (per non avviare il browser se non c'è niente)
 *   POST /agent/results          il risultato di un lavoro: viene verificato e salvato, o messo da rivedere
 */

// un giro dura pochi minuti: se un lavoro prenotato non arriva entro mezz'ora, torna disponibile
const AGENT_CLAIM_MINUTES = 30;
const AGENT_MAX_BODY_BYTES = 2 * 1024 * 1024;
// dopo un errore (sito irraggiungibile, risposta non valida) si riprova tra una settimana, non tra mezz'ora
const AGENT_RETRY_DAYS = 7;

function require_agent(): void
{
    $token = (string) (config()['agent_token'] ?? '');
    $given = $_SERVER['HTTP_X_AGENT_TOKEN'] ?? '';
    if (strlen($token) < 32 || !is_string($given) || !hash_equals($token, $given)) {
        // conto solo i tentativi sbagliati: chi prova a indovinare il token si blocca presto
        enforce_rate_limit('agent_fail', 20, 3600);
        throw new HttpException(401, 'Token del Research agent non valido');
    }
}

function research_interval_days(): int
{
    return max(1, (int) (config()['research_interval_days'] ?? 30));
}

/** GET /agent/work */
function handle_agent_work(): never
{
    require_agent();
    $limit = max(1, min(20, (int) ($_GET['limit'] ?? 3)));
    $now = now_utc();
    $claimFreeBefore = gmdate('Y-m-d H:i:s', time() - AGENT_CLAIM_MINUTES * 60);

    // in scadenza = mai ricercato, oppure è arrivata la data della prossima ricerca
    $brandWhere = 'b.enabled = 1 AND b.official_url IS NOT NULL
                   AND (b.next_research_at IS NULL OR b.next_research_at <= ?)
                   AND (b.research_claimed_at IS NULL OR b.research_claimed_at < ?)';
    $modelWhere = "b.enabled = 1 AND m.status = 'active'
                   AND (m.next_research_at IS NULL OR m.next_research_at <= ?)
                   AND (m.research_claimed_at IS NULL OR m.research_claimed_at < ?)";
    $params = [$now, $claimFreeBefore];

    if (isset($_GET['peek'])) {
        $brands = db()->prepare("SELECT COUNT(*) FROM ca_brands b WHERE $brandWhere");
        $brands->execute($params);
        $models = db()->prepare("SELECT COUNT(*) FROM ca_models m JOIN ca_brands b ON b.id = m.brand_id WHERE $modelWhere");
        $models->execute($params);
        json_response(['due' => (int) $brands->fetchColumn() + (int) $models->fetchColumn()]);
    }

    // prima i marchi (da lì arrivano i modelli), poi i modelli; i mai ricercati per primi
    $stmt = db()->prepare(
        "SELECT b.id, b.name, b.official_url FROM ca_brands b WHERE $brandWhere
          ORDER BY b.next_research_at IS NOT NULL, b.next_research_at, b.name LIMIT $limit"
    );
    $stmt->execute($params);
    $brands = $stmt->fetchAll();

    $models = [];
    $left = $limit - count($brands);
    if ($left > 0) {
        $stmt = db()->prepare(
            "SELECT m.id, m.name, m.official_url, b.id AS brand_id, b.name AS brand, b.official_url AS brand_url
               FROM ca_models m JOIN ca_brands b ON b.id = m.brand_id
              WHERE $modelWhere
              ORDER BY m.research_priority DESC, m.next_research_at IS NOT NULL, m.next_research_at, m.id LIMIT $left"
        );
        $stmt->execute($params);
        $models = $stmt->fetchAll();
    }

    $tasks = [];
    $known = db()->prepare("SELECT name FROM ca_models WHERE brand_id = ? AND status = 'active' ORDER BY name");
    foreach ($brands as $b) {
        $known->execute([$b['id']]);
        $tasks[] = [
            'type'        => 'brand',
            'id'          => (int) $b['id'],
            'brand'       => $b['name'],
            'url'         => $b['official_url'],
            'knownModels' => $known->fetchAll(PDO::FETCH_COLUMN),
        ];
    }
    foreach ($models as $m) {
        $tasks[] = [
            'type'     => 'model',
            'id'       => (int) $m['id'],
            'brandId'  => (int) $m['brand_id'],
            'brand'    => $m['brand'],
            'model'    => $m['name'],
            'url'      => $m['official_url'],
            'brandUrl' => $m['brand_url'],
        ];
    }

    // prenoto: per 30 minuti nessun'altra esecuzione riceve gli stessi lavori
    $now = now_utc();
    foreach ([['ca_brands', array_column($brands, 'id')], ['ca_models', array_column($models, 'id')]] as [$table, $ids]) {
        if ($ids !== []) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            db()->prepare("UPDATE $table SET research_claimed_at = ? WHERE id IN ($in)")->execute([$now, ...$ids]);
        }
    }

    $features = db()->query('SELECT code, name, category FROM ca_features ORDER BY sort_order')->fetchAll();
    json_response(['tasks' => $tasks, 'features' => $features]);
}

/**
 * POST /agent/results
 *   { "task": {"type": "model", "id": 12}, "ok": true, "sources": [...], ... }   vedi imports.php per il formato
 *   { "task": {"type": "brand", "id": 3}, "ok": false, "error": "HTTP 403 dal sito" }
 */
function handle_agent_results(): never
{
    require_agent();
    $body = read_json_body(AGENT_MAX_BODY_BYTES);

    $task = $body['task'] ?? null;
    $type = is_array($task) ? ($task['type'] ?? null) : null;
    $id = is_array($task) ? ($task['id'] ?? null) : null;
    if (!in_array($type, ['brand', 'model'], true) || !is_int($id)) {
        throw new HttpException(400, 'Serve "task": {"type": "brand" | "model", "id": numero}');
    }

    if ($type === 'brand') {
        $stmt = db()->prepare('SELECT id FROM ca_brands WHERE id = ?');
        $stmt->execute([$id]);
        $brandId = $stmt->fetchColumn();
        $modelId = null;
    } else {
        $stmt = db()->prepare('SELECT brand_id FROM ca_models WHERE id = ?');
        $stmt->execute([$id]);
        $brandId = $stmt->fetchColumn();
        $modelId = $id;
    }
    if ($brandId === false) {
        throw new HttpException(404, 'Marchio o modello inesistente');
    }

    db()->prepare(
        'INSERT INTO ca_imports (task_type, brand_id, model_id, payload, status, received_at) VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([
        $type,
        (int) $brandId,
        $modelId,
        json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        'pending',
        now_utc(),
    ]);
    $importId = (int) db()->lastInsertId();

    if (($body['ok'] ?? true) === false) {
        $error = is_string($body['error'] ?? null) ? mb_substr($body['error'], 0, 500) : 'errore non specificato';
        finish_import($importId, 'failed', [['level' => 'error', 'message' => "L'agent non ci è riuscito: $error"]]);
        schedule_research($type, $id, AGENT_RETRY_DAYS);
        json_response(['importId' => $importId, 'status' => 'failed']);
    }

    $result = process_import($importId);
    json_response(['importId' => $importId, 'status' => $result['status'], 'issues' => $result['issues']]);
}

/** Dati nuovi salvati in archivio: "aggiornato adesso", la prossima ricerca tra un mese. */
function mark_researched(string $type, int $id): void
{
    $table = $type === 'brand' ? 'ca_brands' : 'ca_models';
    $priority = $type === 'model' ? ', research_priority = 0' : '';
    db()->prepare("UPDATE $table SET last_researched_at = ?, next_research_at = ?, research_claimed_at = NULL$priority WHERE id = ?")
        ->execute([now_utc(), gmdate('Y-m-d H:i:s', time() + research_interval_days() * 86400), $id]);
}

/** Nessun dato nuovo in archivio (errore, scartato, in revisione): si riprova tra $days giorni. */
function schedule_research(string $type, int $id, int $days): void
{
    $table = $type === 'brand' ? 'ca_brands' : 'ca_models';
    $priority = $type === 'model' ? ', research_priority = 0' : '';
    db()->prepare("UPDATE $table SET next_research_at = ?, research_claimed_at = NULL$priority WHERE id = ?")
        ->execute([gmdate('Y-m-d H:i:s', time() + $days * 86400), $id]);
}

/**
 * POST /admin/research-now  { "modelId": 12 }  oppure  { "brandId": 3 }
 * Solo amministratori: "cerca subito". Il modello (o tutti i modelli del marchio) passa davanti agli altri
 * alla prossima esecuzione del Research agent. Se il marchio non ha ancora modelli, si ricerca il marchio.
 */
function handle_research_now(): never
{
    require_admin();
    $body = read_json_body();
    $modelId = $body['modelId'] ?? null;
    $brandId = $body['brandId'] ?? null;

    if (is_int($modelId)) {
        $stmt = db()->prepare("UPDATE ca_models SET research_priority = 1, next_research_at = NULL, research_claimed_at = NULL WHERE id = ? AND status = 'active'");
        $stmt->execute([$modelId]);
        json_response(['queued' => $stmt->rowCount()]);
    }
    if (!is_int($brandId)) {
        throw new HttpException(400, 'Serve "modelId" oppure "brandId"');
    }
    $stmt = db()->prepare("UPDATE ca_models SET research_priority = 1, next_research_at = NULL, research_claimed_at = NULL WHERE brand_id = ? AND status = 'active'");
    $stmt->execute([$brandId]);
    $queued = $stmt->rowCount();
    if ($queued === 0) {
        // nessun modello (o già tutti in coda): rifaccio la ricerca della gamma del marchio
        db()->prepare('UPDATE ca_brands SET next_research_at = NULL, research_claimed_at = NULL WHERE id = ?')->execute([$brandId]);
    }
    json_response(['queued' => $queued]);
}

/** POST /agent/release  { "tasks": [{"type": "model", "id": 12}, ...] }: libera lavori prenotati e non fatti. */
function handle_agent_release(): never
{
    require_agent();
    $body = read_json_body();
    $released = 0;
    foreach (array_slice(is_array($body['tasks'] ?? null) ? $body['tasks'] : [], 0, 50) as $task) {
        $type = is_array($task) ? ($task['type'] ?? null) : null;
        $id = is_array($task) ? ($task['id'] ?? null) : null;
        if (in_array($type, ['brand', 'model'], true) && is_int($id)) {
            $table = $type === 'brand' ? 'ca_brands' : 'ca_models';
            $stmt = db()->prepare("UPDATE $table SET research_claimed_at = NULL WHERE id = ?");
            $stmt->execute([$id]);
            $released += $stmt->rowCount();
        }
    }
    json_response(['released' => $released]);
}

/** GET /admin/research-status: a che punto è il Research agent (per la pagina Revisione). */
function handle_research_status(): never
{
    require_admin();
    json_response(research_status());
}

/** POST /admin/research-unlock: libera TUTTI i lavori prenotati (es. dopo un'esecuzione interrotta). */
function handle_research_unlock(): never
{
    require_admin();
    $models = db()->exec('UPDATE ca_models SET research_claimed_at = NULL WHERE research_claimed_at IS NOT NULL');
    $brands = db()->exec('UPDATE ca_brands SET research_claimed_at = NULL WHERE research_claimed_at IS NOT NULL');
    json_response(['released' => (int) $models + (int) $brands] + research_status());
}

function research_status(): array
{
    $now = now_utc();
    $claimFree = gmdate('Y-m-d H:i:s', time() - AGENT_CLAIM_MINUTES * 60);
    $count = function (string $sql, array $params = []): int {
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    };
    $activeModels = "FROM ca_models m JOIN ca_brands b ON b.id = m.brand_id WHERE b.enabled = 1 AND m.status = 'active'";
    return [
        'brandsEnabled'       => $count('SELECT COUNT(*) FROM ca_brands WHERE enabled = 1'),
        'brandsWithModels'    => $count("SELECT COUNT(DISTINCT m.brand_id) $activeModels"),
        'models'              => $count("SELECT COUNT(*) $activeModels"),
        'modelsWithVariants'  => $count("SELECT COUNT(DISTINCT m.id) $activeModels AND EXISTS (SELECT 1 FROM ca_trims t JOIN ca_variants v ON v.trim_id = t.id WHERE t.model_id = m.id)"),
        // da fare adesso (non prenotati)
        'due'                 => $count("SELECT COUNT(*) $activeModels AND (m.next_research_at IS NULL OR m.next_research_at <= ?) AND (m.research_claimed_at IS NULL OR m.research_claimed_at < ?)", [$now, $claimFree])
                               + $count('SELECT COUNT(*) FROM ca_brands b WHERE b.enabled = 1 AND b.official_url IS NOT NULL AND (b.next_research_at IS NULL OR b.next_research_at <= ?) AND (b.research_claimed_at IS NULL OR b.research_claimed_at < ?)', [$now, $claimFree]),
        // prenotati da un'esecuzione in corso (o interrotta)
        'claimed'             => $count("SELECT COUNT(*) $activeModels AND m.research_claimed_at >= ?", [$claimFree])
                               + $count('SELECT COUNT(*) FROM ca_brands WHERE research_claimed_at >= ?', [$claimFree]),
        // in attesa di un nuovo tentativo (sito che blocca, errore...)
        'waitingRetry'        => $count("SELECT COUNT(*) $activeModels AND m.next_research_at > ? AND m.last_researched_at IS NULL", [$now]),
        'lastResultAt'        => utc_to_iso(db()->query('SELECT MAX(received_at) FROM ca_imports')->fetchColumn() ?: null),
    ];
}
