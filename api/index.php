<?php
declare(strict_types=1);

// L'UNICO punto d'ingresso dell'API: ogni richiesta passa di qui (grazie al .htaccess).
require __DIR__ . '/private/bootstrap.php';

send_security_headers();
require_https();
require_allowed_origin();

// Il percorso dopo ".../api", es. "/brands"
$base = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$path = '/' . trim(substr($path, strlen($base)), '/');

// Le rotte: [metodo, espressione regolare del percorso, funzione da chiamare].
// I gruppi tra parentesi nella regex diventano parametri della funzione.
// Ogni handler (tranne health, login e register) chiama require_user() o require_admin().
$routes = [
    ['GET',    '#^/health$#',          'handle_health'],

    ['POST',   '#^/auth/login$#',      'handle_login'],
    ['POST',   '#^/auth/register$#',   'handle_register'],
    ['POST',   '#^/auth/logout$#',     'handle_logout'],
    ['GET',    '#^/auth/me$#',         'handle_me'],

    ['GET',    '#^/settings$#',        'handle_get_settings'],
    ['PATCH',  '#^/settings$#',        'handle_update_settings'],

    ['GET',    '#^/brands$#',          'handle_list_brands'],
    ['PATCH',  '#^/admin/brands$#',    'handle_update_brands'],
    ['GET',    '#^/regions$#',         'handle_list_regions'],
    ['GET',    '#^/parameters$#',      'handle_list_parameters'],
    ['PATCH',  '#^/admin/parameters/([a-z0-9_]{1,64})$#', 'handle_update_parameter'],
    ['GET',    '#^/models$#',          'handle_list_models'],
    ['GET',    '#^/models/(\d+)$#',    'handle_get_model'],

    // revisione dei dati arrivati dal Research agent (solo amministratori)
    ['GET',    '#^/admin/imports$#',                 'handle_list_imports'],
    ['GET',    '#^/admin/imports/(\d+)$#',           'handle_get_import'],
    ['POST',   '#^/admin/imports/(\d+)/approve$#',   'handle_approve_import'],
    ['POST',   '#^/admin/imports/(\d+)/reject$#',    'handle_reject_import'],
    ['POST',   '#^/admin/research-now$#',            'handle_research_now'],

    // Research agent (GitHub Actions): si autentica con l'header X-Agent-Token, non con il cookie
    ['GET',    '#^/agent/work$#',      'handle_agent_work'],
    ['POST',   '#^/agent/results$#',   'handle_agent_results'],
    ['POST',   '#^/agent/release$#',   'handle_agent_release'],
];

$method = $_SERVER['REQUEST_METHOD'];
$pathExists = false;

foreach ($routes as [$routeMethod, $pattern, $handler]) {
    if (preg_match($pattern, $path, $matches) !== 1) {
        continue;
    }
    $pathExists = true;
    if ($routeMethod === $method) {
        $handler(...array_slice($matches, 1));
        exit;
    }
}

throw $pathExists
    ? new HttpException(405, 'Metodo non consentito')
    : new HttpException(404, 'Risorsa non trovata');

// --- Handler ---

/** Pubblico: dice solo se PHP e database rispondono. */
function handle_health(): never
{
    $dbTime = db()->query('SELECT NOW()')->fetchColumn();
    json_response(['status' => 'ok', 'dbTimeUtc' => $dbTime]);
}
