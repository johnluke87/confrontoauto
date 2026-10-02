<?php
declare(strict_types=1);

/*
 * CONFRONTO AUTO — crea il PRIMO amministratore (o rende amministratore un utente che esiste già).
 * Protetto da 'setup_key' (config.php): quando hai finito mettila vuota e lo script si disattiva.
 */

require __DIR__ . '/private/bootstrap.php';

send_security_headers();
header('Referrer-Policy: same-origin'); // form: con no-referrer il browser manderebbe "Origin: null"
header("Content-Security-Policy: default-src 'none'; form-action 'self'; frame-ancestors 'none'");
require_https();
require_allowed_origin();
header('Content-Type: text/html; charset=utf-8');

$key = (string) (config()['setup_key'] ?? '');
$message = null;

if (strlen($key) < 20) {
    $message = "Script disattivato: in config.php non c'è una setup_key (almeno 20 caratteri).";
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    enforce_rate_limit('setup', 10, 3600);
    $username = trim((string) ($_POST['username'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    if (!hash_equals($key, (string) ($_POST['setup_key'] ?? ''))) {
        $message = 'Chiave errata.';
    } else {
        $stmt = db()->prepare('SELECT id, password_hash FROM ca_users WHERE username = ?');
        $stmt->execute([$username]);
        $existing = $stmt->fetch();

        if ($existing !== false) {
            // utente già registrato: lo promuovo solo se la password è la sua
            if (password_verify($password, $existing['password_hash'])) {
                db()->prepare('UPDATE ca_users SET is_admin = 1 WHERE id = ?')->execute([$existing['id']]);
                $message = "Fatto: \"$username\" ora è amministratore. Metti 'setup_key' => '' in config.php.";
            } else {
                $message = 'Utente già esistente e password non corretta.';
            }
        } else {
            try {
                validate_new_credentials($username, $password);
                db()->prepare('INSERT INTO ca_users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)')
                    ->execute([$username, password_hash($password, password_algorithm()), now_utc()]);
                $message = "Fatto: creato l'amministratore \"$username\". Metti 'setup_key' => '' in config.php.";
            } catch (HttpException $e) {
                $message = $e->getMessage();
            }
        }
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
  <title>Confronto auto · primo amministratore</title>
</head>
<body>
  <h1>Confronto auto · primo amministratore</h1>
  <?php if ($message !== null): ?><p><strong><?= $escape($message) ?></strong></p><?php endif; ?>
  <?php if (strlen($key) >= 20): ?>
    <form method="post" autocomplete="off">
      <p><label>Setup key<br><input name="setup_key" type="password" required></label></p>
      <p><label>Nome utente<br><input name="username" required minlength="3" maxlength="50"></label></p>
      <p><label>Password (almeno 12 caratteri)<br><input name="password" type="password" required minlength="12"></label></p>
      <p><button type="submit">Crea / promuovi amministratore</button></p>
    </form>
  <?php endif; ?>
</body>
</html>
