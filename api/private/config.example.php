<?php
// Modello della configurazione. Copialo in config.php e metti i valori veri.
// config.php NON va su git: contiene la password del database.
return [
    'db' => [
        'host'     => 'INDIRIZZO_DB_DAL_PANNELLO_ARUBA',
        'name'     => 'NOME_DATABASE',
        'user'     => 'UTENTE_DATABASE',
        'password' => 'PASSWORD_DATABASE',
    ],

    // Gli unici siti da cui accettiamo richieste che modificano dati.
    'allowed_origins' => ['https://www.gianlucadario.com'],

    'session' => [
        'cookie_name'   => 'ca_session',
        'cookie_path'   => '/extra/confronto-auto/api',
        'lifetime_days' => 30,
    ],

    // Serve solo a setup.php per creare il primo amministratore. Dopo, lasciala vuota.
    'setup_key' => '',

    // Chiunque può creare un account da /register. Metti false per chiudere le iscrizioni.
    'registration_open' => true,

    // Segreto dell'app (almeno 32 caratteri casuali): serve a "cifrare" gli IP nei limiti di tentativi.
    // Non cambiarlo dopo averlo messo.
    'app_secret' => 'METTI_QUI_UNA_STRINGA_CASUALE_LUNGA',

    // Abilita migrate.php (crea le tabelle). Dopo averlo eseguito, lasciala vuota.
    'maintenance_key' => '',

    // Research agent (GitHub Actions): lo stesso valore va nel secret CA_AGENT_TOKEN del repository.
    // Almeno 32 caratteri casuali. Vuoto = agent disattivato.
    'agent_token' => '',

    // Ogni quanti giorni il Research agent ricontrolla marchi e modelli.
    'research_interval_days' => 30,
];
