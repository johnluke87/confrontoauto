<?php
declare(strict_types=1);

// Piccole funzioni sui testi, usate dal catalogo e dalla verifica dei dati del Research agent.

/** "Citroën" -> "citroen", "Lynk & Co" -> "lynk-co", "Classe A" -> "classe-a" */
function slugify(string $text): string
{
    // tabella fissa invece di iconv: iconv //TRANSLIT dà risultati diversi a seconda del server
    $ascii = strtr(mb_strtolower($text), [
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a', 'å' => 'a',
        'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e',
        'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i',
        'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'õ' => 'o', 'ø' => 'o',
        'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u',
        'ç' => 'c', 'ñ' => 'n', 'ß' => 'ss', 'š' => 's', 'ž' => 'z', 'č' => 'c',
        '+' => ' plus ', '&' => ' ',
    ]);
    return trim((string) preg_replace('/[^a-z0-9]+/', '-', $ascii), '-');
}

/** "auto.suzuki.it" -> "suzuki.it", "www.bmw.co.uk" -> "bmw.co.uk", "127.0.0.1" -> "127.0.0.1" */
function registrable_domain(string $host): string
{
    $host = strtolower(trim($host, '.'));
    if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return $host;
    }
    $parts = explode('.', $host);
    $count = count($parts);
    if ($count <= 2) {
        return $host;
    }
    // secondi livelli "generici" (co.uk, com.au...): il dominio vero ha tre parti
    $keep = in_array($parts[$count - 2], ['co', 'com', 'net', 'org', 'gov', 'ac'], true) && strlen($parts[$count - 1]) === 2 ? 3 : 2;
    return implode('.', array_slice($parts, -$keep));
}

/** L'host dell'URL appartiene a uno dei domini (anche come sottodominio)? */
function host_matches_domains(string $url, array $domains): bool
{
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    foreach ($domains as $domain) {
        $domain = strtolower(trim($domain));
        if ($domain !== '' && ($host === $domain || str_ends_with($host, '.' . $domain))) {
            return true;
        }
    }
    return false;
}

/**
 * Tutti i numeri scritti in un testo, letti sia all'italiana sia all'inglese.
 * "24.950 €" -> [24950, 24.95]; "5,4 l/100 km" -> [5.4]; "1.2 TCe" -> [1.2]
 *
 * Le regole:
 * - "24.950" e "24 950" (gruppi da 3 cifre) valgono 24950; "24.950" potrebbe però anche essere 24,95 all'inglese
 * - "5,4" vale 5.4 (virgola = decimale, come in italiano)
 * - "1,234.5" (formato inglese) vale 1234.5
 *
 * @return float[]
 */
function numbers_in_text(string $text): array
{
    // spazi "strani" (spazio fisso, spazio stretto) diventano spazi normali
    $text = str_replace(["\u{00A0}", "\u{202F}", "\u{2009}"], ' ', $text);
    preg_match_all('/\d{1,3}(?:[. ]\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?/u', $text, $matches);

    $numbers = [];
    foreach ($matches[0] as $token) {
        $token = trim($token);
        if (preg_match('/^\d{1,3}(?:[. ]\d{3})+(?:,\d+)?$/', $token) === 1) {
            // italiano: punti o spazi = migliaia, virgola = decimali
            $numbers[] = (float) str_replace([' ', '.', ','], ['', '', '.'], $token);
            if (preg_match('/^\d{1,3}\.\d{3}$/', $token) === 1) {
                $numbers[] = (float) $token; // ...ma "1.200" potrebbe anche essere 1,2 scritto all'inglese
            }
        } elseif (preg_match('/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/', $token) === 1) {
            $numbers[] = (float) str_replace(',', '', $token); // inglese: 1,234.5
            if (preg_match('/^\d{1,3},\d{3}$/', $token) === 1) {
                $numbers[] = (float) str_replace(',', '.', $token); // oppure decimale italiano: 1,234
            }
        } else {
            $numbers[] = (float) str_replace(',', '.', $token);
        }
    }
    // anche i numeri "semplici", uno per uno: in "CO2 122 g/km" la prima regola legge "2 122" come duemila...
    preg_match_all('/\d+(?:[.,]\d+)?/', $text, $simple);
    foreach ($simple[0] as $token) {
        $numbers[] = (float) str_replace(',', '.', $token);
    }
    return array_values(array_unique($numbers, SORT_REGULAR));
}

/**
 * Il valore compare davvero nella citazione? Tolleranza minima per gli arrotondamenti (0,5%).
 * $scales: altre unità accettate, es. [1, 10, 1000] per i millimetri scritti in cm o in metri.
 */
function number_in_quote(float $value, string $quote, array $scales = [1]): bool
{
    foreach (numbers_in_text($quote) as $found) {
        foreach ($scales as $scale) {
            $candidate = $found * $scale;
            if (abs($candidate - $value) <= max(0.005 * abs($value), 0.0001)) {
                return true;
            }
        }
    }
    return false;
}
