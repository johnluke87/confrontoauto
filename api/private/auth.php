<?php
declare(strict_types=1);

// Dopo 5 password sbagliate l'utente resta bloccato per 15 minuti.
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

/** Argon2id se il server lo supporta, altrimenti bcrypt. */
function password_algorithm(): string
{
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
}

// --- Handler delle rotte ---

/** POST /auth/login  { "username": "...", "password": "..." } */
function handle_login(): never
{
    $body = read_json_body();
    $username = is_string($body['username'] ?? null) ? trim($body['username']) : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';

    if ($username === '' || $password === '' || strlen($password) > 1024) {
        throw new HttpException(400, 'Inserisci utente e password');
    }

    // Oltre al blocco del singolo account (5 errori), un limite per IP: con la registrazione libera
    // qualcuno potrebbe provare una password comune su tanti utenti diversi.
    enforce_rate_limit('login', 30, 15 * 60);

    $stmt = db()->prepare(
        'SELECT id, username, password_hash, locked_until, is_admin FROM ca_users WHERE username = ?'
    );
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if ($user === false) {
        // Calcolo comunque un hash: così la risposta impiega lo stesso tempo
        // e dal cronometro non si capisce se l'utente esiste.
        password_verify($password, password_hash('dummy-password', PASSWORD_BCRYPT));
        throw new HttpException(401, 'Utente o password non validi');
    }

    // Le date sono stringhe 'Y-m-d H:i:s' in UTC: si confrontano anche come testo.
    if ($user['locked_until'] !== null && $user['locked_until'] > now_utc()) {
        throw new HttpException(429, 'Troppi tentativi falliti: riprova tra qualche minuto');
    }

    $userId = (int) $user['id'];

    if (!password_verify($password, $user['password_hash'])) {
        register_failed_login($userId);
        // Stesso messaggio di "utente inesistente": non diciamo quale dei due è sbagliato.
        throw new HttpException(401, 'Utente o password non validi');
    }

    // Password giusta: azzero i tentativi e, se l'algoritmo è cambiato, aggiorno l'hash.
    db()->prepare('UPDATE ca_users SET failed_logins = 0, locked_until = NULL WHERE id = ?')
        ->execute([$userId]);

    if (password_needs_rehash($user['password_hash'], password_algorithm())) {
        db()->prepare('UPDATE ca_users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, password_algorithm()), $userId]);
    }

    start_session($userId);
    json_response(['user' => user_to_json($user)]);
}

/** POST /auth/register  { "username": "...", "password": "..." }  -> crea l'account ed entra subito */
function handle_register(): never
{
    // interruttore in config.php: se un giorno vuoi chiudere le iscrizioni basta mettere false
    if (!(config()['registration_open'] ?? false)) {
        throw new HttpException(403, 'Le registrazioni sono chiuse');
    }
    // al massimo 5 nuovi account all'ora dalla stessa rete (contro i programmi che creano account a raffica)
    enforce_rate_limit('register', 5, 3600);

    $body = read_json_body();
    $username = is_string($body['username'] ?? null) ? trim($body['username']) : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    validate_new_credentials($username, $password);

    try {
        db()->prepare('INSERT INTO ca_users (username, password_hash, created_at) VALUES (?, ?, ?)')
            ->execute([$username, password_hash($password, password_algorithm()), now_utc()]);
    } catch (PDOException $e) {
        // 23000 = violato un vincolo UNIQUE: quel nome utente esiste già
        if ($e->getCode() === '23000') {
            throw new HttpException(409, 'Questo nome utente è già in uso');
        }
        throw $e;
    }

    $userId = (int) db()->lastInsertId();
    start_session($userId);
    json_response(['user' => ['username' => $username, 'isAdmin' => false]], 201);
}

/** Le stesse regole per chi si registra da solo e per setup.php. */
function validate_new_credentials(string $username, string $password): void
{
    if (preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username) !== 1) {
        throw new HttpException(400, 'Nome utente: da 3 a 50 caratteri tra lettere, numeri, punto, trattino e underscore');
    }
    if (mb_strlen($password) < 12) {
        throw new HttpException(400, 'La password deve avere almeno 12 caratteri');
    }
    if (strlen($password) > 1024) {
        throw new HttpException(400, 'Password troppo lunga');
    }
    if (strcasecmp($password, $username) === 0) {
        throw new HttpException(400, 'La password non può essere uguale al nome utente');
    }
}

/** POST /auth/logout: cancella la sessione dal database e il cookie dal browser. */
function handle_logout(): never
{
    $token = read_session_cookie();
    if ($token !== null) {
        db()->prepare('DELETE FROM ca_auth_tokens WHERE token_hash = ?')
            ->execute([hash('sha256', $token)]);
    }
    set_session_cookie('', 1); // scadenza nel passato = il browser lo elimina
    json_response(['ok' => true]);
}

/** GET /auth/me: chi sono? (Angular lo usa per sapere se sei già loggato.) */
function handle_me(): never
{
    $user = require_user();
    json_response(['user' => user_to_json($user)]);
}

/** Cosa sa Angular dell'utente collegato (niente id interni, niente hash). */
function user_to_json(array $user): array
{
    return ['username' => $user['username'], 'isAdmin' => (bool) ($user['is_admin'] ?? false)];
}

// --- Da usare in ogni rotta protetta ---

/** L'utente collegato, oppure errore 401. */
function require_user(): array
{
    return current_user() ?? throw new HttpException(401, 'Accesso richiesto');
}

/** Solo per gli amministratori (configurazione dei marchi, revisione dei dati importati): altrimenti 403. */
function require_admin(): array
{
    $user = require_user();
    if (!$user['is_admin']) {
        throw new HttpException(403, 'Serve un account amministratore');
    }
    return $user;
}

/** L'utente collegato secondo il cookie di sessione, oppure null. */
function current_user(): ?array
{
    $token = read_session_cookie();
    if ($token === null) {
        return null;
    }

    $stmt = db()->prepare(
        'SELECT t.id AS token_id, u.id, u.username, u.is_admin
           FROM ca_auth_tokens t
           JOIN ca_users u ON u.id = t.user_id
          WHERE t.token_hash = ? AND t.expires_at > ?'
    );
    $stmt->execute([hash('sha256', $token), now_utc()]);
    $row = $stmt->fetch();

    if ($row === false) {
        return null;
    }

    db()->prepare('UPDATE ca_auth_tokens SET last_used_at = ? WHERE id = ?')
        ->execute([now_utc(), $row['token_id']]);

    return ['id' => (int) $row['id'], 'username' => $row['username'], 'is_admin' => (int) $row['is_admin']];
}

// --- Dettagli interni ---

function register_failed_login(int $userId): void
{
    db()->prepare('UPDATE ca_users SET failed_logins = failed_logins + 1 WHERE id = ?')
        ->execute([$userId]);

    // Al quinto errore: blocco e ricomincio a contare.
    db()->prepare(
        'UPDATE ca_users SET locked_until = ?, failed_logins = 0 WHERE id = ? AND failed_logins >= ?'
    )->execute([gmdate('Y-m-d H:i:s', time() + LOCK_MINUTES * 60), $userId, MAX_FAILED_LOGINS]);
}

/**
 * Crea un token casuale: il token vero va SOLO nel cookie,
 * nel database salviamo il suo hash (se rubassero il database, i token non servirebbero a niente).
 */
function start_session(int $userId): void
{
    $token = bin2hex(random_bytes(32)); // 64 caratteri esadecimali, 256 bit casuali
    $expiresAt = time() + config()['session']['lifetime_days'] * 86400;

    // Pulizia: le sessioni scadute di questo utente non servono più.
    db()->prepare('DELETE FROM ca_auth_tokens WHERE user_id = ? AND expires_at <= ?')
        ->execute([$userId, now_utc()]);

    db()->prepare(
        'INSERT INTO ca_auth_tokens (user_id, token_hash, created_at, expires_at, user_agent)
         VALUES (?, ?, ?, ?, ?)'
    )->execute([
        $userId,
        hash('sha256', $token),
        now_utc(),
        gmdate('Y-m-d H:i:s', $expiresAt),
        mb_strcut($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
    ]);

    set_session_cookie($token, $expiresAt);
}

function read_session_cookie(): ?string
{
    $token = $_COOKIE[config()['session']['cookie_name']] ?? null;
    // Accetto solo il formato che genero io: niente stringhe strane verso il database.
    return is_string($token) && preg_match('/^[0-9a-f]{64}$/', $token) === 1 ? $token : null;
}

function set_session_cookie(string $value, int $expiresAt): void
{
    $s = config()['session'];
    setcookie($s['cookie_name'], $value, [
        'expires'  => $expiresAt,
        'path'     => $s['cookie_path'], // il browser lo manda solo alle chiamate dell'API
        'secure'   => true,              // solo su HTTPS
        'httponly' => true,              // JavaScript non può leggerlo: un eventuale script malevolo non lo ruba
        'samesite' => 'Strict',          // mai inviato se la richiesta parte da un altro sito
    ]);
}
