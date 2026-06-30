# JobLens - Requisiti del prodotto

Versione documento: 1.0 draft
Data: 29 giugno 2026
Stato: specifica primaria di prodotto e architettura

## 1. Visione

JobLens e un'applicazione self-hosted per raccogliere, organizzare, filtrare e
valutare offerte di lavoro da piu provider. Il dominio deve restare generico
per aggiungere in futuro Indeed, Google Jobs o altri adapter senza riscrivere
UI, offerte, ricerche e AI.

Stato provider attuale:

- LinkedIn e l'unico provider operativo end-to-end.
- Indeed non e un provider operativo e oggi non e registrato nell'applicazione:
  prima di abilitarlo servono plugin API, seed DB, wizard ricerca, collector
  worker e normalizzazione offerte.

Stack target:

```text
React + TypeScript frontend
        |
Fastify + TypeScript API
        |
PostgreSQL
        |
Rust worker engine
        |
Provider jobs / endpoint AI esterni
```

Scelte principali:

- React gestisce UI, stato client, filtri, paginazione e aggiornamenti live.
- Fastify espone API JSON versionate, valida input/output e non esegue task
  lunghi nel processo request.
- PostgreSQL e archivio primario e coda persistente delle attivita.
- Rust esegue scheduler, raccolte, descrizioni, availability, review AI, retry
  e cancellazioni.
- Ollama o altri endpoint AI sono servizi esterni configurabili, non parte
  obbligatoria del core.

## 2. Principi Architetturali

### 2.1 DB Come Contratto

Il frontend parla solo con Fastify. Fastify non chiama Rust per task lunghi:
crea attivita persistenti nel database e restituisce subito un ID.

```text
React -> Fastify -> PostgreSQL <- Rust worker
```

Flusso standard:

1. React invia una richiesta, per esempio "valuta queste offerte".
2. Fastify valida e crea una o piu attivita `queued`.
3. Rust fa claim atomico, aggiorna stato/progresso/log e salva risultati.
4. Fastify legge il DB e notifica React via SSE, con polling come fallback.

### 2.2 Operazioni Lunghe

Devono sempre essere in background:

- raccolte provider;
- download descrizioni;
- availability check;
- review AI;
- installazioni modello;
- export grandi;
- benchmark.

Ogni operazione lunga deve avere stato persistito, log, progressi, retry
configurabili e cancellazione cooperativa.

### 2.3 Provider e AI Modulari

Il dominio principale non deve contenere concetti esclusivi di LinkedIn.
LinkedIn e l'unico provider operativo oggi, ma non deve diventare il dominio del
prodotto.

La valutazione AI deve separare:

- contratto JSON core fisso;
- campi evidenza configurabili;
- profilo candidato modificabile;
- regole di valutazione modificabili;
- lingua output configurabile;
- endpoint e modello selezionati.

Le regole su cosa inserire nei campi AI devono stare nelle **Regole di
valutazione** configurabili dalla UI, non in logica hardcoded.

### 2.4 Organizzazione Frontend

Il frontend deve seguire una struttura modulare simile a:

```text
src/
  API/          chiamate HTTP grezze
  services/     normalizzazione DTO e operazioni di dominio
  models/       tipi, enum, label e modelli frontend
  contexts/     stato globale e cache cross-page
  hooks/        caricamenti riutilizzabili e stato locale asincrono
  pages/        layout delle pagine
  components/   componenti per dominio
```

Regole:

- `API/` contiene solo `fetch`, costruzione URL, headers, `credentials`,
  parsing risposta ed errori HTTP. Non deve importare React o modelli UI.
- `services/` trasforma DTO backend in modelli frontend, normalizza opzionali,
  enum, numeri e stringhe, e applica validazioni leggere prima di consegnare i
  dati ai componenti.
- `models/` contiene tipi stabili, enum e funzioni/label di dominio riutilizzate
  dalla UI.
- `contexts/` gestisce stato condiviso, elemento selezionato, cache per ID,
  loading/error espliciti e funzioni `loadX(force)` usate da piu pagine.
- `hooks/` gestisce caricamenti locali riutilizzabili con `loading`, `error`,
  `force`, `silent`, cache temporale e protezione da richieste duplicate in
  flight.
- `pages/` deve restare sottile: compone layout e pannelli, ma non contiene
  chiamate API dirette ne normalizzazione DTO.
- `components/<dominio>/` contiene pannelli, liste, dettagli, editor e modali
  relativi a un dominio specifico.
- Componenti generici devono stare in `components/Utilities` o equivalente.

Convenzioni HTTP:

- `baseURL` deve derivare da env frontend, con default dev e produzione.
- Path parameter e query devono essere costruiti con `encodeURIComponent` e
  `URLSearchParams`.
- Errori API devono essere normalizzati in un helper unico che sappia leggere
  errori di validazione, `message`, `error` e fallback.
- Le funzioni API devono ritornare DTO/`unknown`; i componenti non devono
  consumare direttamente payload raw.

Convenzioni stato/cache:

- Usare `undefined` per "non caricato", `null` per "caricato ma assente" e array
  vuoto per "caricato senza risultati".
- Cache per entita collegate: `Record<id, value | null | undefined>`.
- Dopo una mutation, aggiornare localmente lo stato quando e sicuro; altrimenti
  ricaricare solo l'entita interessata, non tutta la pagina.
- Reset esplicito di cache e stato quando cambiano utente, provider/account o
  contesto principale.
- Dati derivati come elemento selezionato, permessi e contatori devono usare
  `useMemo`.
- Azioni passate a componenti figli devono usare `useCallback` quando vengono
  riusate o entrano in dipendenze di altri hook.

Convenzioni UI:

- Prediligere componenti React Bootstrap per layout, form, modali, card,
  bottoni, alert, badge, navbar e griglie.
- Usare CSS custom solo quando React Bootstrap e utility class non bastano,
  principalmente per shell dell'app, gestione overflow/scroll, stati selezionati
  e pochi token visuali globali.
- Prima di aggiungere una classe CSS custom, verificare se bastano props,
  utility class o composizione di componenti React Bootstrap.
- Preferire layout lista/dettaglio, pannelli e modali riutilizzabili.
- Mostrare loading, errore e stato vuoto vicino alla sezione interessata.
- I form devono normalizzare input con `trim`, validare prima della submit,
  disabilitare i controlli durante il salvataggio e mostrare errori inline.
- I modali/editor devono resettare stato ed errori quando vengono aperti.
- Le azioni compatte devono usare bottoni icona con `aria-label` e `title`.
- Pulsanti annidati dentro righe cliccabili devono fermare la propagazione.
- CSS globale deve usare variabili per colori, bordi, ombre e layout shell; lo
  scrolling va controllato con contenitori `min-height: 0` e overflow espliciti.

## 3. Concetti di Dominio

| Concetto | Significato |
| --- | --- |
| Provider | Adapter che sa cercare, importare e verificare offerte da una sorgente. |
| Provider account/session | Credenziali o sessione necessarie al provider. |
| Ricerca | Configurazione persistente per interrogare un provider. |
| Job | Offerta normalizzata nel dominio JobLens. |
| External job | Identificatore provider-specifico collegato a un job. |
| Descrizione | Testo/HTML dell'offerta, recuperato o deduplicato. |
| Review AI | Valutazione versionata di una offerta. |
| Modello prioritario | Modello usato per filtri, ranking e consiglio principale. |
| Attivita | Operazione persistente e osservabile: raccolta, review, export, ecc. |

Entita minime:

- `providers`
- `provider_sessions`
- `searches`
- `jobs`
- `external_jobs`
- `job_search_presence`
- `job_descriptions`
- `job_reviews`
- `activities`
- `activity_logs`
- `ai_endpoints`
- `ai_models`
- `raw_payloads`
- `settings`

## 4. Provider LinkedIn

Questa sezione descrive il comportamento LinkedIn osservato che l'implementazione
deve supportare. LinkedIn non garantisce stabilita di endpoint, headers,
decoration id o payload: tutto deve essere verificabile tramite HAR fornito
dall'utente e fixture di test.

### 4.1 URL Pubblico di Ricerca

Forma base:

```text
https://www.linkedin.com/jobs/search/?keywords=<keywords>&location=<location>&geoId=<geoId>&distance=<distance>&f_E=<levels>&position=1&pageNum=0
```

Parametri principali:

| Parametro | Uso |
| --- | --- |
| `keywords` | Testo ricerca. Per frase esatta usare virgolette URL encoded. |
| `location` | Nome leggibile della localita. |
| `geoId` | ID geografico LinkedIn da usare nella query API. |
| `distance` | `0`, `5`, `10`, `25`, `50`. |
| `f_E` | Livelli esperienza separati da virgola. |
| `position` | Contesto UI, default `1`. |
| `pageNum` | Contesto UI, default `0`. |
| `currentJobId` | Opzionale; preservabile ma non necessario. |

Livelli esperienza:

| `f_E` | Significato |
| --- | --- |
| `1` | Stage / Internship |
| `2` | Entry level / Esperienza minima |
| `3` | Associate |
| `4` | Mid-Senior |
| `5` | Director |
| `6` | Executive |

Distanze:

| `distance` | Etichetta UI |
| --- | --- |
| `0` | Localita esatta |
| `5` | circa 8 km |
| `10` | circa 16 km |
| `25` | circa 40 km |
| `50` | circa 80 km |

Il wizard deve esporre almeno Stage/Internship, Entry level e Associate.

### 4.2 Typeahead Geografico

Endpoint:

```text
https://www.linkedin.com/jobs-guest/api/typeaheadHits
```

Parametri:

| Parametro | Valore |
| --- | --- |
| `origin` | `jserp` |
| `typeaheadType` | `GEO` |
| `geoTypes` | `POPULATED_PLACE,ADMIN_DIVISION_1,COUNTRY_REGION` |
| `query` | Testo digitato dall'utente |

I risultati devono essere normalizzati in `geo_id`, `display_name`, `type` e
deduplicati per `geo_id`. Una ricerca guidata deve salvare un `geoId` valido. Se
un URL incollato non contiene `geoId`, il sistema deve tentare di ricavarlo dalla
location o chiedere all'utente di selezionarla.

### 4.3 API Job Cards

Endpoint autenticato:

```text
https://www.linkedin.com/voyager/api/voyagerJobsDashJobCards
```

Parametri:

| Parametro | Uso |
| --- | --- |
| `decorationId` | Da HAR o default configurato. |
| `count` | Numero risultati per pagina. |
| `start` | Offset pagina, incrementato di `count`. |
| `q` | `jobSearch`. |
| `query` | Query Rest.li con keyword, geoId, filtri e spell correction. |

Query minima:

```text
(
  origin:JOB_SEARCH_PAGE_JOB_FILTER,
  keywords:<keywords>,
  locationUnion:(geoId:<geoId>),
  selectedFilters:(...),
  spellCorrectionEnabled:true
)
```

Se `currentJobId` e presente puo essere incluso come `currentJobId:<id>`, ma non
deve essere richiesto.

Mappa filtri iniziale:

| URL pubblico | Query Voyager |
| --- | --- |
| `distance` | `distance:List(...)` |
| `f_E` | `experience:List(...)` |
| `f_TPR` | `timePostedRange:List(...)` |
| `f_WT` | `workplaceType:List(...)` |
| `f_JT` | `jobType:List(...)` |

Filtri riconosciuti ma non esposti nel wizard devono essere preservati. Filtri
sconosciuti devono restare nel dato raw o essere segnalati come non supportati.

La paginazione usa `start` e `count`. Il worker continua finche raggiunge
`data.paging.total`, incontra una pagina terminale documentata o riceve un errore
che rende la raccolta non affidabile.

Ogni risposta deve salvare almeno URL finale, parametri normalizzati, status
code, content type, elapsed time, payload raw, numero elementi e
`data.paging.total` quando presente.

### 4.4 HAR e Sessione

La sessione LinkedIn deve essere estratta da un HAR contenente almeno una
richiesta a `voyagerJobsDashJobCards` oppure inserita manualmente tramite i
segreti minimi.

Persistire solo:

- `li_at`;
- `JSESSIONID`, normalizzato senza virgolette;
- metadata non segreti utili a replicare o diagnosticare la richiesta, per
  esempio user agent, accept language, `x-li-lang`, `x-li-track` e
  `decorationId`.

Non persistere il cookie header completo, il file HAR completo o header browser
non necessari. La sessione salvata in `provider_sessions.session_data` deve
usare un envelope provider-agnostic con `providerKey`, `version`, `source`,
`importedAt`, `secrets`, `fingerprint` e, quando utile, `debug` senza segreti.
Il formato legacy con cookie completo puo restare leggibile in fallback, ma non
deve essere il formato prodotto dalle nuove importazioni.

Il worker ricostruisce a runtime:

```text
cookie: li_at=<li_at>; JSESSIONID="<jsessionid>"
csrf-token: <jsessionid>
accept: application/vnd.linkedin.normalized+json+2.1
x-restli-protocol-version: 2.0.0
```

Headers runtime minimi:

| Header | Nota |
| --- | --- |
| `accept` | `application/vnd.linkedin.normalized+json+2.1`. |
| `csrf-token` | Valore `JSESSIONID` senza virgolette. |
| `cookie` | Ricostruito solo da `li_at` e `JSESSIONID`. |
| `user-agent` | Da fingerprint o default browser-like. |
| `accept-language` | Da fingerprint o default. |
| `x-li-lang` | Da fingerprint o default. |
| `x-restli-protocol-version` | `2.0.0`. |
| `x-li-track` | Da fingerprint se presente. |

Headers extra vanno usati solo se dimostrati necessari da fixture/HAR reali e
non devono introdurre nuovi segreti persistiti.

Il file HAR completo non deve essere conservato dopo l'importazione. Log, debug
ed export devono oscurare cookie, CSRF token e altri segreti.

Il debug HAR deve mostrare senza segreti: numero richieste job card trovate,
host, path, presenza cookie/CSRF, parametri query, decoration id, count/start e
filtri riconosciuti.

Una raccolta parziale, un rate limit, una sessione scaduta o un payload non
interpretabile non devono aggiornare in modo distruttivo la disponibilita delle
offerte.

## 5. Funzionalita Prodotto

### 5.1 Navigazione e Dashboard

- Pagine principali: Dashboard, Offerte, Ricerche, Attivita, Impostazioni.
- La dashboard mostra solo riepiloghi: offerte attive, candidate consigliate,
  attivita in corso, errori recenti, stato provider/AI.
- La navbar mostra al massimo tre attivita e un indicatore aggregato per le
  altre.

### 5.2 Ricerche

- Creazione guidata da keyword, frase esatta, localita, distanza e livelli
  esperienza, con filtro modalita lavoro LinkedIn quando disponibile.
- Import e modifica di URL esistenti; se interpretabili, riaperti nel wizard
  precompilato.
- URL completo sempre visibile.
- Eliminare una ricerca non elimina offerte, descrizioni o review.
- Esecuzione manuale di una, piu o tutte le ricerche.
- Pianificazione con intervallo, ritardo extra, giorni attivi e una fascia
  inattiva per giorno, anche a cavallo della mezzanotte.

### 5.3 Raccolta, Descrizioni e Disponibilita

- Ogni raccolta e una attivita persistente.
- La raccolta deve salvare pagine raw e dati normalizzati.
- Le offerte sono identificate da provider + external ID.
- Le descrizioni mancanti vengono recuperate automaticamente o manualmente.
- HTML e testo normalizzato della descrizione sono conservati separatamente.
- Se un job appare in almeno una ricerca completa resta attivo.
- Se non appare piu in nessuna ricerca completa diventa fuori dalle ricerche.
- Solo i job fuori dalle ricerche vengono verificati direttamente.
- La chiusura richiede conferme configurabili o segnale definitivo del provider.
- Se lo stesso external ID riappare, il job viene riattivato mantenendo storico.

### 5.4 Offerte

- Lista paginata lato server.
- Filtri multipli per provider, ricerca, localita, stato locale, disponibilita,
  decisione AI, modello prioritario e testo.
- Filtri testuali con debounce.
- Ordinamento per pubblicazione o ripubblicazione recente.
- Riga compatta con titolo, azienda, localita, data, decisione AI principale e
  indicatori essenziali.
- Scheda offerta con riepilogo, descrizione, stati locali, link provider,
  disponibilita, review AI ed export JSON.
- Stati locali: vista/non vista, salvata, candidata.
- Tornando dalla scheda alla lista devono restare filtri, pagina e scroll.

### 5.5 AI

- L'app funziona anche senza endpoint AI disponibile.
- L'utente puo configurare piu endpoint AI e selezionare quello attivo.
- La selezione dell'endpoint attivo si applica alle nuove attivita.
- L'app elenca modelli installati e puo installare un modello se l'endpoint lo
  supporta.
- Impostazioni configurabili: modello valutazioni, modello prioritario,
  timeout, `num_ctx`, `num_predict`, `temperature`, `think`, `keep_alive`, retry
  e ritardo retry.
- Profilo candidato, lingua output review, campi evidenza e Regole di
  valutazione sono modificabili dalla UI.
- Le Regole di valutazione definiscono come interpretare decisione, score, fit,
  blocker, match, preferenziali espliciti, gap obbligatori, note e motivazione.
- Le Regole di valutazione devono avere editor dedicato, salvataggio esplicito,
  ripristino template default e indicazione ultima modifica.
- Le pause AI devono essere configurabili per giorno e orario.

### 5.6 Review AI

- Ogni esecuzione crea una nuova review append-only.
- Una review manuale puo essere ripetuta anche se stesso modello e offerta sono
  gia stati valutati.
- L'automazione salta review gia completate con il modello automatico.
- La review salva modello, endpoint, hash/versione profilo, hash/versione regole,
  timestamp, decisione, score, campi JSON, raw output, errore e metriche.
- Metriche minime quando disponibili: durata, token prompt, token generati,
  token/s, parametri runtime e motivo di stop.
- La review del modello prioritario viene mostrata per prima e alimenta filtri,
  ranking e dashboard. In assenza usa la review riuscita piu recente.
- La UI deve mostrare la history append-only delle review di una offerta, con
  motivo della review principale, risultato normalizzato, raw output, errori,
  metriche, hash profilo e hash regole.
- Se la descrizione manca, la review tenta prima il recupero descrizione.

### 5.7 Attivita e Debug

- Stati minimi attivita: `queued`, `running`, `success`, `failed`,
  `cancelled`, `interrupted`.
- Ogni attivita salva tipo, stato, oggetto collegato, progresso, fase,
  messaggio, errore, timestamps, source e log.
- L'utente puo filtrare attivita, annullarne una, annullare la coda e ritentare
  quelle fallite quando supportato dal tipo di attivita.
- La cancellazione coda deve poter essere ristretta almeno per tipo e origine.
- La pagina Attivita si aggiorna live via SSE.
- Export completi e bundle debug sono attivita in background.
- Il bundle debug include configurazione non segreta, versioni servizi, stato
  code, attivita recenti, errori, conteggi e parametri AI.
- Debug puo cancellare review AI per modello o tutte le review, senza eliminare
  attivita e log.

## 6. Contratto JSON Review AI

La struttura core della risposta e fissa; i campi evidenza sono configurabili.
Il significato pratico di cosa inserire nei campi deriva dalle Regole di
valutazione attive e dalla descrizione dei campi evidenza configurati.

Input minimo al modello:

- profilo candidato;
- regole di valutazione attive;
- lingua output configurata;
- campi evidenza configurati;
- titolo, azienda, luogo, modalita di lavoro;
- provider ed external ID;
- descrizione testuale dell'offerta.

Ogni review deve salvare hash o versione di profilo, regole, lingua output e
campi evidenza usati.

La risposta deve essere un singolo oggetto JSON valido, senza markdown o testo
extra. Quando supportato, la richiesta deve usare schema JSON strutturato.

Formato canonico default:

```json
{
  "decision": "apply",
  "score": 75,
  "seniority_fit": "good",
  "skill_fit": "partial",
  "location_fit": "good",
  "blockers": [],
  "matching_points": [
    "Esempio di corrispondenza positiva secondo le regole attive"
  ],
  "explicit_optional_matches": [
    "Esempio di preferenziale esplicito secondo le regole attive"
  ],
  "mandatory_gaps": [
    "Esempio di gap obbligatorio secondo le regole attive"
  ],
  "caution_notes": [
    "Esempio di cautela non bloccante secondo le regole attive"
  ],
  "reason": "Verdetto sintetico coerente con le regole attive."
}
```

Campi:

| Campo | Vincolo |
| --- | --- |
| `decision` | `apply`, `maybe`, `reject`; valori sconosciuti diventano `maybe`. |
| `score` | Intero 0-100; 0 solo per offerte chiaramente incompatibili. |
| `seniority_fit` | `good`, `borderline`, `bad`. |
| `skill_fit` | `good`, `partial`, `bad`. |
| `location_fit` | `good`, `partial`, `bad`, `unknown`. |
| campi evidenza | Array configurabili di stringhe brevi; default: `blockers`, `matching_points`, `explicit_optional_matches`, `mandatory_gaps`, `caution_notes`. |
| `reason` | Una frase concreta, max 500 caratteri. |

Le stringhe nelle liste evidenza devono restare brevi, idealmente sotto 220
caratteri. La lingua dei campi testuali e configurabile; gli enum restano le
keyword inglesi del contratto.

Il prompt deve separare chiaramente contratto JSON, profilo e regole. I campi
`missing_skills`, `optional_strengths` e alias simili non fanno parte del
contratto canonico e non devono essere prodotti.

Il sistema salva raw output e output normalizzato. Risposte vuote, troncate, non
JSON o non conformi producono una review di errore con raw output, parametri
runtime e metriche disponibili.

## 7. API Minime

Questa sezione descrive il contratto API operativo attuale esposto
dall'applicazione.

### 7.1 Sistema e impostazioni base

- `GET /health`
- `GET /api/v1/health`
- `GET /api/v1/schema`
- `GET /api/v1/settings/base`
- `GET /api/v1/settings`
- `GET /api/v1/settings/:key`

### 7.2 Offerte

- `GET /api/v1/jobs`
- `GET /api/v1/jobs/insights`
- `GET /api/v1/jobs/:id`
- `GET /api/v1/jobs/:id/reviews`
- `PATCH /api/v1/jobs/:id/state`
- `POST /api/v1/jobs/:id/reviews`
- `POST /api/v1/jobs/batch-reviews`
- `GET /api/v1/jobs/:id/export` include metadati offerta/provider/ricerche,
  descrizione piu recente, riepilogo review piu rilevante e storico review AI
  completo con `result`, `metrics` e `rawOutput`.

### 7.3 Provider e sessioni

- `GET /api/v1/providers`
- `GET /api/v1/providers/:providerKey/sessions`
- `POST /api/v1/providers/:providerKey/credentials`
- `POST /api/v1/providers/:providerKey/har-debug`
- `POST /api/v1/providers/:providerKey/sessions/har`
- `POST /api/v1/providers/:providerKey/sessions/:sessionId/verify`
- `GET /api/v1/providers/:providerKey/geo-typeahead`

Note:

- `geo-typeahead` e operativo solo per LinkedIn.
- `credentials`, `har-debug`, `sessions/har` e `verify` sono generici per
  provider, ma dipendono dalle capability dichiarate dal plugin provider.

### 7.4 Ricerche

- `GET /api/v1/searches`
- `POST /api/v1/searches`
- `GET /api/v1/searches/:id`
- `PATCH /api/v1/searches/:id`
- `DELETE /api/v1/searches/:id`
- `POST /api/v1/searches/run`
- `POST /api/v1/searches/:id/run`
- `POST /api/v1/searches/preview-url`
- `POST /api/v1/searches/import-url`

### 7.5 Attivita

- `POST /api/v1/activities`
- `GET /api/v1/activities`
- `GET /api/v1/activities/summary`
- `POST /api/v1/activities/cancel`
- `GET /api/v1/activities/:id`
- `GET /api/v1/activities/:id/logs`
- `GET /api/v1/activities/:id/linkedin-debug`
- `POST /api/v1/activities/:id/cancel`
- `POST /api/v1/activities/:id/retry`

### 7.6 AI

- `GET /api/v1/ai/settings`
- `PATCH /api/v1/ai/settings`
- `POST /api/v1/ai/settings/rules/reset`
- `GET /api/v1/ai/endpoints`
- `POST /api/v1/ai/endpoints`
- `PATCH /api/v1/ai/endpoints/:id`
- `POST /api/v1/ai/endpoints/:id/activate`
- `GET /api/v1/ai/endpoints/:id/health`
- `POST /api/v1/ai/endpoints/probe`
- `DELETE /api/v1/ai/endpoints/:id`
- `GET /api/v1/ai/models`
- `GET /api/v1/ai/models/metrics`
- `POST /api/v1/ai/models/sync`
- `POST /api/v1/ai/models/install`
- `DELETE /api/v1/ai/models/:id`
- `POST /api/v1/ai/benchmark`
- `DELETE /api/v1/ai/reviews`

### 7.7 Export, debug e manutenzione

- `POST /api/v1/exports/jobs-reviews`
- `POST /api/v1/debug/bundle`

### 7.8 Eventi

- `GET /api/v1/events`

Endpoint SSE oggi operativo per snapshot attivita, con polling frontend come
fallback. Il target di prodotto resta estenderlo anche a offerte, review, errori
e stato servizi. Gli eventi live non sono fonte unica di verita: un reload deve
ricostruire lo stato dal DB.

## 8. Stati

Attivita:

```text
queued -> running -> success
queued -> running -> failed
queued -> cancelled
running -> cancelled
running -> interrupted
failed -> queued
interrupted -> queued
```

Disponibilita job:

```text
active
missing_from_searches
available_outside_searches
unavailable
reactivated -> active
```

Review AI:

```text
requested -> queued -> running -> completed
requested -> queued -> cancelled
running -> failed
failed -> queued
```

## 9. Requisiti Operativi

- Tutte le API mutative validano body, query e parametri.
- Le response principali hanno schema dichiarato.
- Le migrazioni DB sono versionate.
- Il claim delle attivita e atomico e concorrente-safe.
- Le attivita running hanno lease o heartbeat.
- Dopo restart, lease scaduti vengono recuperati o falliti secondo regole
  esplicite.
- Il worker espone solo endpoint interni `health`, `version`, `metrics`.
- Le classi di coda minime sono `collection`, `description`, `availability`,
  `ai_review`, `model_install`, `export`, `maintenance`.
- La concorrenza e configurabile per classe; la coda AI puo restare sequenziale.
- Nessuna pagina scarica dataset completi quando basta una pagina.
- Dashboard, Debug e Attivita usano query aggregate.
- Export grandi sono streammati o generati in background.
- Cookie, CSRF token e sessioni provider sono segreti.
- Export e debug non includono segreti.
- Pianificazione, pause e limiti servono a controllare carico e risorse, non ad
  aggirare policy dei provider.
- In assenza di login applicativo, il deploy va considerato privato e protetto
  da rete/VPN/reverse proxy.
- Lo stack parte con Docker Compose con servizi minimi `frontend`, `api`,
  `worker`, `postgres`; Ollama e opzionale locale o remoto.
- Tutti i servizi applicativi usano `restart: unless-stopped`.
- Porte e volumi persistenti sono configurabili.

## 10. Test e Accettazione

Copertura automatica richiesta:

- API e worker testabili senza frontend.
- Provider LinkedIn testato con fixture HAR/raw versionate e con casi derivati
  da HAR reali, senza dipendere da chiamate live nelle suite automatiche.
- Handler worker testati per successo, errore, cancellazione e retry.
- Query principali testate per paginazione e filtri.
- UI end-to-end per creazione ricerca, filtro offerte, dettaglio offerta e
  modifica impostazioni.
- UI end-to-end per review AI con fixture, cancellazione attivita ed
  export/debug.
- UI end-to-end da aggiungere per raccolta LinkedIn completa con fixture.

Copertura oggi presente:

- Unit/API/DB per health, schema, provider LinkedIn, settings, ricerche,
  offerte, attivita, AI settings e manutenzione.
- Unit/worker per query LinkedIn, parsing payload, sessione, descrizioni,
  heartbeat e logica di base.
- Integrazione DB worker con fixture per raccolta LinkedIn, descrizioni,
  availability, install modello, review AI, export e debug.
- E2E Playwright attivi per navigazione principale, layout mobile, wizard
  ricerca LinkedIn, configurazione scheduler ricerca, filtri modalita lavoro e
  dettaglio offerte.
- E2E Playwright gia scritti ma marcati `fixme` per history review AI con
  fixture, cancellazione attivita, export/debug artifact, debug raw LinkedIn e
  impostazioni AI: richiedono harness isolato DB/AI prima di entrare nella suite
  standard.
- API/DB per attivita summary/cancel, run multiplo ricerche, history review e
  insight/ranking offerte.

Test ancora da aggiungere:

- E2E raccolta LinkedIn completa con fixture raw/HAR, senza chiamate live.
- Harness e2e isolato o mock Ollama per riabilitare i test `activities`,
  `ai-review` e `settings-ai` nella suite standard.
- E2E retry di attivita fallita per un tipo supportato.
- E2E mobile dei workflow desktop principali se il prodotto deve supportare
  operativita mobile completa.

JobLens e pronto quando:

1. Frontend, API, worker e PostgreSQL partono via Docker Compose.
2. React copre Dashboard, Offerte, Ricerche, Attivita e Impostazioni.
3. Fastify espone API versionate e validate.
4. Rust esegue task leggendo e aggiornando PostgreSQL.
5. Le attivita sopravvivono a restart di API e worker.
6. La UI mostra progresso live da stato persistente.
7. LinkedIn supporta sessione, ricerca, raccolta, dettaglio, descrizione e
   disponibilita secondo questa specifica.
8. Le liste principali sono paginabili lato server.
9. Le review AI sono versionate e confrontabili.
10. Il modello prioritario guida filtri, ranking e riepiloghi.
11. La coda AI rispetta pause e cancellazioni.
12. Gli export non espongono segreti.

## 11. Decisioni Esplicite

- Fastify e scelto al posto di Express per API ordinate, schema validation e
  buona base TypeScript senza la complessita di NestJS.
- Rust comunica con il backend principalmente tramite PostgreSQL, non tramite
  chiamate HTTP lunghe.
- PostgreSQL e archivio primario e coda persistente per lock, lease e query
  aggregate.
- Ollama non e parte obbligatoria del core: e un endpoint AI configurabile.
- LinkedIn e il primo provider operativo, non il dominio del prodotto.
- Le nuove sessioni LinkedIn persistono solo `li_at` e `JSESSIONID`; cookie
  completi e HAR completi non fanno parte dello stato persistito.
- Indeed resta non operativo finche non esistono plugin API, seed DB, collector
  worker, normalizzazione e UI di ricerca dedicata.
