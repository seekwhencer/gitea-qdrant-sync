# gitea-qdrant-sync — MCP Fixes & Verbesserungsplan

## Ziel

Behebung aller kritischen Fehler, Sicherheitslücken und Performance-Probleme im Server. Jede Phase ist ein **kalt startbarer Sub-Agent**. Phasen bauen aufeinander auf.

---

## Phase 1 — Kritische Bugs (P1)

**Ziel:** Die drei schwerwiegendsten Laufzeitfehler beheben, bevor der Service produktiv eingesetzt wird.
**Abhängigkeiten:** Keine. Kann sofort starten.

### Task 1.1: handlePushEvent darf einen Fehler nicht weiterwerfen
`server/sync.js:57–71`

- **Problem:** Ein Fehler bei einer Datei wirft eine Exception (`throw error`) und bricht den Loop ab; restliche geänderte `.md`-Dateien werden nicht verarbeitet.
- **Fix:**
  - Entfernen Sie das `throw error` im Catch-Block des Loops in `handlePushEvent`.
  - Loggen Sie den Fehler pro Datei mit `console.error(...)` und fahren Sie mit der nächsten Datei fort (`continue`).
  - Werfen Sie nur dann einen Fehler, wenn *keine* Datei erfolgreich verarbeitet wurde (z.B. Tracken Sie eine Erfolgs-Zähler-Variable).

**Acceptance Criteria:**
- Bei einem Webhook-Push mit mehreren geänderten Files wird auch bei einem Fehler in einer Datei die restlichen weiterverarbeitet.
- Der HTTP Status des `/webhook`-Endpoints bleibt 200, solange mindestens eine Datei erfolgreich verarbeitet wurde.

### Task 1.2: Deterministische Punkt-ID in Qdrant-Upsert
`server/qdrant.js:46`

- **Problem:** `Date.now() + Math.floor(Math.random() * 1000)` kann bei schnellen Aufrufen kollidieren und ist nicht content-stabil.
- **Fix:**
  - Importieren Sie `crypto` aus `node:crypto`.
  - Erzeugen Sie eine stabile ID als SHA-256-Hash des Chunk-Inhalts (oder kombiniert mit source), z.B.:
    ```js
    const id = crypto.createHash('sha256').update(chunkText).digest('hex');
    ```
  - Alternativ: `crypto.randomUUID()`.
  - Stellen Sie sicher, dass die ID als String übergeben wird.

**Acceptance Criteria:**
- Gleiche Chunks erhalten bei wiederholten Upserts dieselbe Punkt-ID (idempotent).
- Keine Kollisionen bei schnellen aufeinanderfolgenden Aufrufen innerhalb desselben Millisekunden-Blocks.

### Task 1.3: Race Condition beim Collection-Create
`server/qdrant.js:120–131`

- **Problem:** `ensureCollection()` prüft Existenz (`collectionExists`) und erstellt dann – TOCTOU-Problem bei parallelen Upserts für dieselbe Sammlung.
- **Fix:**
  - Wrappen Sie den `createCollection`-Aufruf in einem Try/Catch.
  - Fangen Sie Fehler ab, die darauf hindeuten, dass die Collection bereits existiert (Status 409 oder Meldung "already exists" / "collection already exists").
  - Behandeln Sie diesen Fall als Erfolg und fahren Sie fort.

**Acceptance Criteria:**
- Mehrere gleichzeitige Upserts für dieselbe Sammlung schlagen nicht mit einem Fehler fehl.
- Die Collection wird nur einmal erstellt, auch bei parallelen Requests.

---

## Phase 2 — Metadaten & Datenkorrektheit

**Ziel:** Stellen Sie sicher, dass Suchergebnisse korrekte und konsistente Metadaten zurückgeben.
**Abhängigkeiten:** Phase 1 abgeschlossen (oder parallel möglich).

### Task 2.1: Qdrant-Payload erweitern
`server/qdrant.js:48–53`

- **Problem:** `upsert()` speichert nur `{ text, source, repository }`. Die Suche in `searchAndReturnChunks()` (`server/search.js:160`) erwartet aber auch `path`, `ref`, `commit`.
- **Fix:**
  - Erweitern Sie das Payload im Upsert um zusätzliche Felder:
    ```js
    payload: {
      text: chunkText,
      source: source,           // filePath
      repository: repository,
      path: source,             // alias für Kompatibilität mit searchAndReturnChunks
      ref: '',                  // leer oder aus dem Payload übernehmen (z.B. commit SHA)
      commit: ''                // leer oder aus dem Payload übernehmen
    }
    ```
  - Da `syncFile` in `server/sync.js:108–120` das Repository-Objekt (`payload.repository`) hat, können Sie dort auch den Commit-SHA (`payload.after`) durchreichen und im Qdrant-Payload speichern.

**Acceptance Criteria:**
- Jeder upserted Punkt enthält die Felder `text`, `source`, `repository`, `path`, `ref`, `commit`.
- Die Suchergebnisse in `/search/stream` oder MCP Tool `search` liefern konsistente Metadaten statt undefined-Werte.

### Task 2.2: searchAndReturnChunks anpassen
`server/search.js:157–166`

- **Fix:** Greifen Sie nur auf tatsächlich gespeicherte Felder zu (`source`, `repository`). Setzen Sie fehlende Metadaten auf leere Strings statt undefined.
```js
const chunks = results.map(item => ({
    text: item.payload?.text || '',
    score: item.score || 0,
    metadata: {
        repository: item.payload?.repository || '',
        path: item.payload?.path || '',       // jetzt existiert durch Task 2.1
        ref: item.payload?.ref || '',         // jetzt existiert durch Task 2.1
        commit: item.payload?.commit || ''     // jetzt existiert durch Task 2.1
    }
}));
```

**Acceptance Criteria:**
- `searchAndReturnChunks` liefert Metadaten mit definierten String-Werten statt undefined.
- Die Frontend-Komponenten, die auf diese Felder zugreifen (`src/api/search.js`, `Conversation.jsx`), erhalten konsistente Daten.

---

## Phase 3 — Sicherheit & Konfiguration

**Ziel:** Implementieren Sie fehlende Sicherheitsmechanismen und entfernen Sie Side-Effekte aus der Config-Klasse.
**Abhängigkeiten:** Keine. Kann parallel zu Phase 2 laufen.

### Task 3.1: MCP_ALLOWED_HOSTS implementieren
`server/mcpRouter.js`, `server/router.js`

- **Problem:** Die Dokumentation erwähnt DNS-Rebinding-Schutz via `MCP_ALLOWED_HOSTS`, aber keine Host-Validierung existiert.
- **Fix:**
  - Erstellen Sie eine Middleware-Funktion, die den `Host`-Header der Request prüft.
  - Wenn `config.mcpAllowedHosts` gesetzt ist (komma-getrennte Liste), validieren Sie den Host gegen diese Whitelist.
  - Rejecten Sie nicht-listed Hosts mit HTTP-Status 403 und einer klaren Fehlermeldung.
  - Die Validierung sollte für alle MCP-Routen (`/mcp`, `/mcp/message`) aktiv sein.

**Acceptance Criteria:**
- Requests von erlaubten Hosts (z.B. `localhost,127.0.0.1,[::1]`) werden normal verarbeitet.
- Requests von nicht-listed Hosts erhalten HTTP 403.

### Task 3.2: Security Headers setzen
`server/index.js`

- **Problem:** Keine CSP / X-Frame-Options auf der Express App gesetzt.
- **Fix:**
  - Fügen Sie im `Server`-Constructor nach dem Erstellen des Express-Apps folgende Header hinzu:
    ```js
    this.app.use((req, res, next) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        next();
    });
    ```
  - Oder installieren Sie `helmet` als Dependency und nutzen Sie es.

**Acceptance Criteria:**
- Alle Antworten des Servers enthalten die Security Header.
- Clickjacking-Schutz ist aktiv (X-Frame-Options: DENY).

### Task 3.3: Config-Klasse Side-Effekt entfernen
`server/config.js`

- **Problem:** Der Constructor schreibt `config.json`, wenn er nicht existiert – impliziter Datei-Schreibzugriff bei Initialisierung.
- **Fix:**
  - Trennen Sie das Schreiben von der Initialisierung:
    - Laden Sie defaults aus env oder statischen Defaults ohne Datei zu schreiben.
    - Fügen Sie eine separate Methode `saveDefaults()` hinzu, die explizit aufgerufen werden kann (z.B. über einen CLI-Flag `--init-config`).
  - Der Constructor sollte nur lesen und parsen.

**Acceptance Criteria:**
- Beim Starten des Servers wird keine neue `config.json`-Datei erstellt, wenn sie fehlt.
- Eine separate Initialisierung/Setup-Schritt schreibt die Datei explizit.

---

## Phase 4 — Performance & Concurrency

**Ziel:** Beschleunigen Sie den Sync und reduzieren Sie redundante Embedding-Berechnungen.
**Abhängigkeiten:** Phasen 1–3 abgeschlossen (oder parallel möglich).

### Task 4.1: Parallele Datei-Verarbeitung
`server/sync.js:63–70`, `80–98`

- **Problem:** Files werden nacheinander mit `for...of + await` verarbeitet.
- **Fix:**
  - In `handlePushEvent`: Verarbeiten Sie die Chunks pro Datei parallel (z.B. `Promise.all` über die Chunk-Liste einer Datei).
  - Beachten Sie Qdrant-Rate-Limits: Begrenzen Sie die Concurrency mit einem Semaphore oder verarbeiten Sie maximal N Dateien gleichzeitig.
  - In `syncRepository`: Gleiches Vorgehen für das Full-Sync.

**Acceptance Criteria:**
- Bei großen Repositories verkürzt sich die Gesamtzeit des Syncs durch parallele Verarbeitung.
- Qdrant-Rate-Limits werden nicht überschritten (Fehler bei Rate-Limit werden gecatcht und mit Backoff wiederholt).

### Task 4.2: Embedding-Caching (optional)
**Aufgabe:** Cachen Sie Embeddings für identische Text-Chunks, um redundante LLM-Aufrufe zu vermeiden.

- **Fix:**
  - Implementieren Sie einen einfachen Map-Cache im `Llm`-Layer oder als Wrapper in `GiteaQdrantSync`.
  - Key: SHA-256-Hash des Chunk-Inhalts.
  - Value: Das Embedding-Vector.
  - Bei erneutem Sync derselben Datei können bereits gecachte Embeddings wiederverwendet werden.

**Acceptance Criteria:**
- Identische Text-Chunks erhalten bei wiederholtem Sync dieselben Embeddings ohne erneuten LLM-Aufruf.
- Der Cache wird pro Prozess/Sitzung beibehalten (optional: persistent auf Disk).

---

## Phase 5 — Dokumentation & Tests

**Ziel:** Bringen Sie die Dokumentation auf den Stand der tatsächlichen Implementation und fügen Sie Tests hinzu.
**Abhängigkeiten:** Phasen 1–4 abgeschlossen.

### Task 5.1: MCP-Dokumentation aktualisieren
`.docs/MCP_IMPL.md`

- **Problem:** Die Doku beschreibt SSE-Transport mit v1 SDK (`SSEServerTransport`), implementiert ist aber Streamable HTTP via `@modelcontextprotocol/server@^2`.
- **Fix:**
  - Passen Sie die Architektur-Beschreibung an die tatsächliche Implementation (Streamable HTTP, `createMcpHandler`, `toNodeHandler`).
  - Aktualisieren Sie das SSE-Protokoll-Flow-Diagramm auf Streamable HTTP.
  - Korrigieren Sie die Abhängigkeiten (`@modelcontextprotocol/sdk@v2` statt v1).

**Acceptance Criteria:**
- Die Dokumentation beschreibt korrekt, wie der MCP-Server tatsächlich funktioniert (Streamable HTTP über `/mcp`).

### Task 5.2: Tests hinzufügen
**Aufgabe:** Erstellen Sie einen minimalen Test-Suite.

- **Fix:**
  - Nur Server
  - Installieren Sie ein Testing-Framework (z.B. `vitest` oder `jest`) als Dev-Dependency.
  - Unit tests für:
    - Config-Loading (`server/config.js`)
    - Gitea file collection (`server/gitea.js`: `collectMarkdownFiles`, `_walkTree`)
    - Qdrant upsert/search/delete (`server/qdrant.js`)
    - Recursive Markdown Splitter (`server/sync.js`)

**Acceptance Criteria:**
- Alle Unit Tests laufen grün.
- Mindestens 80% Code-Coverage für die kritischen Logik-Pfade.

---

## Ausführungsreihenfolge

```
Phase 1 (Bugs) → Phase 2 (Metadaten)
                ↓
        Phase 3 (Sicherheit) ← parallel zu Phase 4 möglich
               ↓
        Phase 4 (Performance)
               ↓
        Phase 5 (Doku & Tests)

Jede Phase kann einem separaten Subagenten zugewiesen werden, solange die vorherige Phase abgeschlossen ist.
```
