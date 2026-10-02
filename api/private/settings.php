<?php
declare(strict_types=1);

// Impostazioni personali di ogni utente (una riga per utente, creata alla prima modifica).

/** GET /settings */
function handle_get_settings(): never
{
    $user = require_user();
    json_response(read_settings($user['id']));
}

/** PATCH /settings  { "regionCode": "VEN" } */
function handle_update_settings(): never
{
    $user = require_user();
    $body = read_json_body();

    $unknown = array_diff(array_keys($body), ['regionCode']);
    if ($unknown !== []) {
        throw new HttpException(400, 'Campo non previsto: ' . implode(', ', $unknown));
    }

    if (array_key_exists('regionCode', $body)) {
        $code = is_string($body['regionCode']) ? $body['regionCode'] : '';
        $stmt = db()->prepare('SELECT 1 FROM ca_regions WHERE code = ?');
        $stmt->execute([$code]);
        if ($stmt->fetchColumn() === false) {
            throw new HttpException(400, 'Regione non valida');
        }
        // INSERT ... ON DUPLICATE KEY UPDATE = "crea la riga se non c'è, altrimenti aggiornala"
        db()->prepare(
            'INSERT INTO ca_user_settings (user_id, region_code, updated_at) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE region_code = VALUES(region_code), updated_at = VALUES(updated_at)'
        )->execute([$user['id'], $code, now_utc()]);
    }

    json_response(read_settings($user['id']));
}

function read_settings(int $userId): array
{
    $stmt = db()->prepare('SELECT region_code FROM ca_user_settings WHERE user_id = ?');
    $stmt->execute([$userId]);
    $region = $stmt->fetchColumn();
    return ['regionCode' => $region === false ? 'VEN' : $region]; // default: Veneto
}
