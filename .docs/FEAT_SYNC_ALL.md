# gitea-qdrant-sync — Feature: Gitea Re-Sync (Alle Repos)

## Ziel

Ein Frontend-Button **"Gitea Re-Sync"** liest alle Markdown-Dateien aller
konfigurierten Gitea-Repositories noch einmal ein und synchronisiert sie in
Qdrant. Der Re-Sync läuft im Hintergrund; der Server erlaubt ein erneutes
Anstoßen erst, wenn der aktuelle Re-Sync beendet ist.

## Architektur

```
Frontend (Button) ──▶ POST /sync-all ──▶ GiteaQdrantSync.syncAllRepositories()
                                              │
                                              ▼
                                      Hintergrund-Verarbeitung (lock-guarded)
                                              │
                                              ▼
                                      Für jedes Repo: syncRepository(owner, name, ref)
                                              │
                                              ▼
                                      Für jede Datei: syncFile() → Qdrant upsert
```

## Komponenten

### 1. Backend: `server/sync.js`

**Neue Methode:** `syncAllRepositories()` — synchronisiert alle Repos.

**Lock-Mechanismus:** Eine Promise-basierte Sperre verhindert parallele Re-Syncs.
Ein neuer Request wartet auf `this._syncLock`, bis der laufende Re-Sync fertig ist,
dann übernimmt er die Sperre und startet den nächsten Re-Sync.

**Ablauf:**
1. `await this._syncLock` — wartet auf laufenden Re-Sync (falls vorhanden).
2. Sperre erwerben: `this._syncLock` wird durch ein neues `Promise` ersetzt, das erst
   am Ende des Hintergrund-Prozesses aufgelöst wird.
3. Re-Sync wird als `void (async () => {...})()` gestartet (fire-and-forget).
4. Sofortige Rückgabe: `{ status: 'started' }`.
5. Im `finally`-Block: Sperre freigeben (`resolve()`), `_syncInProgress = false`.

**Interne Methode:** `_performSyncAll()` — listet alle Repos via `this.gitea.listRepos()`
und ruft für jedes Repo `this.syncRepository(owner, name, 'main')` auf.

### 2. Backend: `server/gitea.js`

**Neue Methode:** `listRepos()` — ruft `GET /api/v1/user/repos` auf und gibt
`[{ owner, name }]` zurück.

### 3. Backend: `server/router.js`

**Neuer Endpoint:** `POST /sync-all`

- Ruft `this.sync.syncAllRepositories()` auf.
- Gibt sofort `202 Accepted` mit `{ status: 'started', message: 'Re-Sync läuft im Hintergrund.' }` zurück.
- Der eigentliche Sync läuft im Hintergrund; der HTTP-Response blockiert nicht.

### 4. Backend: `server/mcp.js`

**Neues Tool:** `sync-all`

- Beschreibung: "Synchronisiert alle Markdown-Dateien aller Gitea-Repositories in Qdrant."
- Keine Eingabeparameter.
- Ruft `this.sync.syncAllRepositories()` auf.
- Gibt Status zurück (gestartet / bereits läuft / Fehler).

### 5. Frontend

**Neue API-Funktion:** `syncAll()` in `frontend/src/api/client.js` — `POST /sync-all`.

**Neue Komponente:** `ReSyncButton.jsx` in `frontend/src/components/`

- Button "Gitea Re-Sync"
- Ladezustand: Button deaktiviert + Text "Re-Sync läuft…"
- Erfolg: Toast/Nachricht "Re-Sync abgeschlossen."
- Fehler: Fehlernachricht anzeigen.

**Integration:** Button wird in `App.jsx` neben der SearchBar platziert.

## Phasen-Plan

### Phase 1 — Backend: Lock + syncAllRepositories

**Ziel:** `GiteaQdrantSync` bekommt eine Re-Sync-Sperre und eine `syncAllRepositories()`-Methode.

**Dateien:**
- `server/sync.js` — Lock-Eigenschaften + `syncAllRepositories()` + `_performSyncAll()`

**Definition von Done:** `npm test` läuft grün; Logik ist syntaktisch korrekt.

### Phase 2 — Backend: Gitea.listRepos

**Ziel:** `Gitea` bekommt eine `listRepos()`-Methode.

**Dateien:**
- `server/gitea.js` — `listRepos()` Methode

**Definition von Done:** `npm test` läuft grün.

### Phase 3 — Backend: API-Endpunkt /sync-all

**Ziel:** Express-Endpunkt `POST /sync-all` triggert Hintergrund-Re-Sync und gibt sofort 202 zurück.

**Dateien:**
- `server/router.js` — `POST /sync-all` Route

**Definition von Done:** Endpunkt ist registriert und antwortet.

### Phase 4 — Backend: MCP Tool sync-all

**Ziel:** MCP-Tool `sync-all` triggert Re-Sync aller Repos.

**Dateien:**
- `server/mcp.js` — `sync-all` Tool registrieren

**Definition von Done:** MCP-Tool ist registriert.

### Phase 5 — Frontend: API + Button

**Ziel:** Frontend bekommt `syncAll()` API-Funktion und `ReSyncButton` Komponente.

**Dateien:**
- `frontend/src/api/client.js` — `syncAll()` Export
- `frontend/src/components/ReSyncButton.jsx` — Neue Komponente
- `frontend/src/App.jsx` — Button integrieren

**Definition von Done:** `npm run build` im Frontend erfolgreich.

### Phase 6 — Test & Validierung

**Ziel:** End-to-End Test über MCP und Frontend.

**Schritte:**
1. Server starten (`npm run dev`).
2. MCP-Client (z.B. Claude Code / Inspector) verbindet sich auf `http://sync.gitea.home/mcp`.
3. Tool `sync-all` aufrufen → Re-Sync startet im Hintergrund.
4. Zweiter `sync-all` Aufruf während laufendem Re-Sync → wartet bis erster fertig ist.
5. Frontend-Button "Gitea Re-Sync" klicken → Re-Sync startet, Button deaktiviert, nach Abschluss wieder aktiv.
6. Datei auf Server ändern → Server startet automatisch neu (via `--watch`).

## Risiken & Hinweise

- **Lange Laufzeit:** Bei vielen Repos/Dateien kann der Re-Sync Minuten dauern. Der Lock verhindert versehentliche Doppel-Läufe.
- **Fehler pro Repo:** Ein Fehler bei einem Repo bricht den gesamten Re-Sync nicht ab; der nächste Repo wird weiterhin verarbeitet (ähnlich wie `handlePushEvent`).
- **Kein Feedback im Frontend:** Der Frontend-Button kennt den Abschluss des Hintergrund-Re-Syncs nicht (fire-and-forget). Der Button wird nach dem Klick kurz deaktiviert und wieder aktiviert (optimistisches UI). Eine echte Status-Abfrage wäre ein zukünftiger Verbesserungspunkt (z.B. `GET /sync-status`).
- **Gitea-Token:** `listRepos()` benötigt ein gültiges `GITEA_TOKEN`.
