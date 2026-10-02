<?php
declare(strict_types=1);

/** Connessione unica al database, creata alla prima chiamata. */
function db(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $c = config()['db'];
        $pdo = new PDO(
            "mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4",
            $c['user'],
            $c['password'],
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION, // ogni errore SQL diventa un'eccezione
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,       // righe come array ['title' => ...]
                PDO::ATTR_EMULATE_PREPARES   => false,                  // query preparate VERE, fatte da MySQL
            ],
        );
        // Tutte le date in UTC, come abbiamo deciso per il database.
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

/** Data e ora attuali in UTC, nel formato DATETIME di MySQL. */
function now_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

/** '2026-10-01 08:30:00' (UTC dal database) -> '2026-10-01T08:30:00Z' (ISO, che Angular capisce). */
function utc_to_iso(?string $datetime): ?string
{
    return $datetime === null ? null : str_replace(' ', 'T', $datetime) . 'Z';
}
