<?php
declare(strict_types=1);

/**
 * Errore "previsto" da restituire al client con un codice HTTP preciso
 * (400 dati non validi, 401 non autenticato, 404 non trovato...).
 * Il messaggio È visibile al browser: mai metterci dettagli interni.
 */
final class HttpException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');                                      // il browser non "indovina" il tipo
    header('Cache-Control: no-store');                                              // nessuna cache di dati personali
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'"); // l'API non è una pagina
}

function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}

function json_error(string $message, int $status): never
{
    json_response(['error' => $message], $status);
}

/** Risposta vuota "fatto" (es. dopo un DELETE). */
function no_content(): never
{
    http_response_code(204);
    exit;
}

/** Legge il corpo JSON della richiesta (per POST e PATCH). */
function read_json_body(int $maxBytes = 64 * 1024): array
{
    // Pretendere JSON è anche una difesa: un form HTML di un altro sito non può inviarlo.
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (!str_starts_with($type, 'application/json')) {
        throw new HttpException(415, 'Il corpo della richiesta deve essere JSON');
    }

    // Di solito bastano 64 KB; i risultati del Research agent chiedono di più (vedi agent.php).
    $raw = (string) file_get_contents('php://input', length: $maxBytes + 1);
    if (strlen($raw) > $maxBytes) {
        throw new HttpException(413, 'Richiesta troppo grande');
    }

    try {
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new HttpException(400, 'JSON non valido');
    }

    if (!is_array($data) || array_is_list($data) && $data !== []) {
        throw new HttpException(400, 'Il corpo deve essere un oggetto JSON');
    }
    return $data;
}
