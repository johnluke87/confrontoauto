<?php
declare(strict_types=1);

/**
 * Limite di richieste per indirizzo IP: al massimo $max azioni del tipo $bucket in $windowSeconds secondi.
 * Serve soprattutto con la registrazione libera: senza, un programma potrebbe creare migliaia di account
 * o provare migliaia di password su utenti diversi.
 *
 * L'IP NON viene salvato in chiaro: salviamo un HMAC (un "hash con chiave segreta", app_secret in config.php).
 * Così riconosciamo lo stesso IP senza conservare dati personali leggibili.
 */
function enforce_rate_limit(string $bucket, int $max, int $windowSeconds): void
{
    $ipHash = hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown', config()['app_secret']);

    // pulizia: le righe più vecchie di un giorno non servono a nessun limite
    db()->prepare('DELETE FROM ca_rate_limits WHERE created_at < ?')
        ->execute([gmdate('Y-m-d H:i:s', time() - 86400)]);

    $stmt = db()->prepare(
        'SELECT COUNT(*) FROM ca_rate_limits WHERE bucket = ? AND ip_hash = ? AND created_at >= ?'
    );
    $stmt->execute([$bucket, $ipHash, gmdate('Y-m-d H:i:s', time() - $windowSeconds)]);

    if ((int) $stmt->fetchColumn() >= $max) {
        throw new HttpException(429, 'Troppi tentativi da questa rete: riprova più tardi');
    }

    db()->prepare('INSERT INTO ca_rate_limits (bucket, ip_hash, created_at) VALUES (?, ?, ?)')
        ->execute([$bucket, $ipHash, now_utc()]);
}
