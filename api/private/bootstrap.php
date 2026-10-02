<?php
declare(strict_types=1);

// Gli errori NON si mostrano mai al browser: vanno nel log, in una cartella protetta.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/logs/php-errors.log');
error_reporting(E_ALL);

date_default_timezone_set('UTC');

require __DIR__ . '/http.php';
require __DIR__ . '/db.php';
require __DIR__ . '/rate-limit.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/text.php';
require __DIR__ . '/catalog.php';
require __DIR__ . '/models.php';
require __DIR__ . '/settings.php';
require __DIR__ . '/agent.php';
require __DIR__ . '/imports.php';

function config(): array
{
    static $config = null;
    return $config ??= require __DIR__ . '/config.php';
}

// Warning e notice diventano eccezioni: meglio fermarsi che continuare con dati sbagliati.
// I "deprecated" invece finiscono solo nel log.
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if ($severity & (E_DEPRECATED | E_USER_DEPRECATED)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Ultima rete di sicurezza: qualsiasi eccezione non gestita arriva qui.
set_exception_handler(function (Throwable $e): void {
    if ($e instanceof HttpException) {
        json_error($e->getMessage(), $e->status);
    }
    // Dettagli (file, riga, messaggio SQL...) SOLO nel log; al browser un messaggio generico.
    error_log((string) $e);
    json_error('Errore interno del server', 500);
});

/** Blocca tutto se la connessione non è HTTPS. */
function require_https(): void
{
    if (($_SERVER['HTTPS'] ?? '') !== 'on') {
        throw new HttpException(403, 'È richiesto HTTPS');
    }
}

/**
 * Protezione CSRF: chi modifica dati deve arrivare da un sito ammesso.
 * Il browser mette sempre l'header Origin nelle richieste POST/PATCH/DELETE;
 * se manca (es. curl) non è un browser e quindi non ha i tuoi cookie.
 */
function require_allowed_origin(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        return;
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin !== null && !in_array($origin, config()['allowed_origins'], true)) {
        throw new HttpException(403, 'Origine non consentita');
    }
}
