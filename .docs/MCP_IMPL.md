# gitea-qdrant-sync — MCP Feature Konzept

## Ziel

Dem bestehenden Express-Service ein **MCP-Tool-Endpoint** hinzufügen, über den ein LLM-Client (Claude Code, Cursor, etc.) zwei Tools aufrufen kann:

1. **`search`** — RAG-Frage beantworten (SSE-Streaming)
2. **`sync`** — manuellen Sync für ein Repo triggern

Transport: **SSE** (Server-Sent Events) über einen einzigen `/mcp` Endpoint. Kein stdio, kein separater Prozess.

---

## Architektur-Entscheidungen

### Warum SSE statt Streamable HTTP?

- Der bestehende Server ist bereits ein langlebiger Express-Prozess.
- SSE ist einfacher zu integrieren: ein POST zum Initialisieren, dann ein SSE-Stream für die Antwort.
- Keine Session-ID-Verwaltung nötig — jeder MCP-Aufruf ist stateless (wie der bestehende `/search` vs `/search/stream`).
- Der bestehende `Search.streamAndAnswer()` Generator passt direkt in einen SSE-Stream.

### Wo läuft die Logik?

Die MCP-Tools sind **dünne Wrapper** um die bestehenden Klassen `Search` und `GiteaQdrantSync`. Keine Duplizierung.

Die MCP-spezifische Logik (Tool-Registrierung, Transport-Handling) kommt in eine neue Klasse `McpService` in `server/mcp.js`.

### Abhängigkeiten

```json
{
  "@modelcontextprotocol/sdk": "^1.12.1"
}
```

Das `@modelcontextprotocol/sdk` Paket enthält `McpServer`, `Tool`, `SSEServerTransport` und alle JSON-RPC-Primitive.

---

## SSE-Protokoll-Flow

```
Client                          Server
  |                                 |
  |  POST /mcp                      |
  |  {"jsonrpc":"2.0","id":1,       |
  |   "method":"initialize",        |
  |   "params":{"protocolVersion":..}}|
  |                                 |
  |  ← 200 OK                       |
  |  Content-Type: text/event-stream|
  |                                 |
  |  ← event: message               |
  |     data: {"jsonrpc":"2.0",     |
  |       "result":{"protocolVersion":..}}
  |                                 |
  |  ← event: message               |
  |     data: {"jsonrpc":"2.0",     |
  |       "method":"tools/list",     |
  |       "params":{...}}           |
  |                                 |
  |  ← event: message               |
  |     data: {"jsonrpc":"2.0",     |
  |       "result":{"tools":[...]}} |
  |                                 |
  |  POST /mcp                      |
  |  {"jsonrpc":"2.0","id":2,       |
  |   "method":"tools/call",        |
  |   "params":{"name":"search",    |
  |     "arguments":{"question":".."}}}|
  |                                 |
  |  ← event: message               |
  |     data: {"jsonrpc":"2.0",     |
  |       "result":{                |
  |         "content":[             |
  |           {"type":"text",       |
  |            "text":"..."}]}}     |
  |                                 |
```

Für **streaming** (search tool):

```
  |  POST /mcp (tools/call: search) |
  |                                 |
  |  ← event: message               |
  |     data: {"jsonrpc":"2.0",     |
  |       "result":{                |
  |         "content":[             |
  |           {"type":"text",       |
  |            "text":"partial..."}]}}
  |                                 |
  |  ← event: message (weitere)     |
  |     data: {"jsonrpc":"2.0",     |
  |       "result":{...}}           |
  |                                 |
```

---

## Dateistruktur

```
server/
├── mcp.js          ← Neue Datei: McpService Klasse
├── router.js       ← Erweiterung: /mcp Route
├── index.js        ← Erweiterung: McpService instanziieren
└── ...
```

---

## `server/mcp.js` — McpService Klasse

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

class McpService {
    constructor({ search, sync }) {
        this.search = search;
        this.sync = sync;
        this.mcpServer = null;
        this.sseTransport = null;
        this.sseEndpoint = null; // gespeichert für den SSE-Stream
    }

    async init() {
        this.mcpServer = new McpServer({
            name: 'gitea-qdrant-sync',
            version: '1.0.0'
        });

        // Tool: search
        this.mcpServer.registerTool(
            'search',
            {
                description: 'Beantwortet eine Frage auf Basis der synchronisierten Gitea-Dokumentation (RAG). Nutzt Vektorsuche in Qdrant + LLM-Antwort mit Streaming.',
                inputSchema: {
                    question: { type: 'string', description: 'Die Frage, die beantwortet werden soll' }
                }
            },
            async ({ question }) => {
                const answer = await this.search.searchAndAnswer(question);
                if (answer === undefined) {
                    return {
                        content: [{ type: 'text', text: 'Keine Antwort gefunden. Vielleicht ist das Thema noch nicht synchronisiert.' }],
                        isError: false
                    };
                }
                return { content: [{ type: 'text', text: answer }] };
            }
        );

        // Tool: sync
        this.mcpServer.registerTool(
            'sync',
            {
                description: 'Triggert einen manuellen Sync der Markdown-Dateien eines Gitea-Repositories nach Qdrant.',
                inputSchema: {
                    repository: { type: 'string', description: 'Repo-Pfad in Gitea, z.B. "owner/repo"' },
                    ref: { type: 'string', optional: true, description: 'Git-Ref/Branch/Commit, default: main/master' }
                }
            },
            async ({ repository, ref }) => {
                // Parse repository string to extract owner and name
                const [owner, name] = repository.split('/');
                if (!owner || !name) {
                    return {
                        content: [{ type: 'text', text: 'Ungültiges Repository-Format. Erwartet: owner/repo' }],
                        isError: true
                    };
                }

                try {
                    await this.sync.syncRepository(owner, name, ref);
                    return { content: [{ type: 'text', text: `Sync für ${repository} abgeschlossen.` }] };
                } catch (error) {
                    return {
                        content: [{ type: 'text', text: `Sync fehlgeschlagen: ${error.message}` }],
                        isError: true
                    };
                }
            }
        );

        await this.mcpServer.start();
    }

    /**
     * Handler für den initialen POST /mcp (Protocol-Initialisierung).
     * Gibt die SSE-URL zurück und speichert den Transport.
     */
    async handleSsePost() {
        this.sseTransport = new SSEServerTransport('/mcp/message', {
            reqHeaders: { 'Content-Type': 'application/json' }
        });

        const url = this.sseEndpoint; // wird von der Route gesetzt

        await this.mcpServer.connect(this.sseTransport);

        return this.sseTransport;
    }

    /**
     * Gibt den aktuellen Transport zurück (für den SSE-Stream).
     */
    getTransport() {
        return this.sseTransport;
    }

    /**
     * Setzt die SSE-Endpoint-URL (wird von der Route aufgerufen).
     */
    setSseEndpoint(url) {
        this.sseEndpoint = url;
    }

    /**
     * Cleanup beim Shutdown.
     */
    async shutdown() {
        if (this.sseTransport) {
            await this.sseTransport.close();
        }
        if (this.mcpServer) {
            // McpServer hat keine explizite close-Methode in v1,
            // aber der Transport wird geschlossen.
        }
    }
}

export { McpService };
```

---

## Erweiterung `server/router.js`

Neue Route im Router:

```js
// MCP SSE endpoint
this.router.post('/mcp', async (req, res) => {
    if (!this.mcpService) {
        return res.status(503).json({ error: 'MCP not initialized' });
    }

    // Ersten POST (initialize) erkennen: body enthält "method":"initialize"
    const isInitialize = req.body?.method === 'initialize';

    if (isInitialize) {
        // SSE-Transport erstellen
        const transport = await this.mcpService.handleSsePost();

        // SSE-Header setzen
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Transport-URL speichern
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        this.mcpService.setSseEndpoint(`${baseUrl}/mcp/message`);

        // SSE-Stream vom Transport starten
        transport.handlePostMessage = async (req, res) => {
            // Wird für /mcp/message verwendet
        };

        // Den SSE-Stream vom Transport an res.pipe übergeben
        // Der SSEServerTransport sendet messages über res.write()
        // Wir müssen den internen Response-Stream des Transports nutzen
    } else {
        // Zweiter POST: /mcp/message — forward zum Transport
        // ...
    }
});
```

**Korrektur:** Der `SSEServerTransport` aus dem MCP SDK erwartet zwei Endpoints:
1. `POST /mcp` — initialisiert den Transport, gibt SSE-URL zurück
2. `POST /mcp/message` — empfängt JSON-RPC-Nachrichten, leitet sie an den Transport weiter

Die Implementierung muss beide Pfade unterscheiden.

---

## Erweiterung `server/index.js`

```js
import { McpService } from './mcp.js';

// Im Server-Constructor:
this.mcpService = new McpService({ search: this.search, sync: this.sync });
await this.mcpService.init();

// Im Router-Konstruktor:
this.router = new Router(this.config, this.sync, this.search, this.httpServer, this.mcpService);

// Im Router.define():
// MCP routes hinzufügen (siehe oben)

// Im Shutdown:
await this.mcpService.shutdown();
```

---

## Erweiterung `server/sync.js` — `syncRepository()` Methode

Die neue Methode `syncRepository(owner, name, ref)` im `GiteaQdrantSync`-Klasse:

```js
async syncRepository(owner, name, ref = 'main') {
    // 1. Alle Markdown-Dateien des Repos auflisten
    const markdownFiles = await this.gitea.listFiles(owner, name, ref);

    // 2. Jede Datei sync'en
    for (const filePath of markdownFiles) {
        await this.syncFile({ repository: { html_url: `https://gitea.example.com/${owner}/${name}` }, after: ref }, filePath);
    }

    console.log(`[Sync] Repository ${owner}/${name} mit ${markdownFiles.length} Dateien synchronisiert.`);
}
```

Ergänzend in `server/gitea.js`:

```js
async listFiles(owner, name, ref = 'main') {
    // Recursiv alle Markdown-Dateien im Repo auflisten
    // Nutzt Gitea API: GET /repos/{owner}/{name}/contents/{path}
    const markdownFiles = [];
    await this._walkTree(owner, name, '', ref, markdownFiles);
    return markdownFiles;
}

async _walkTree(owner, name, path, ref, results) {
    const res = await this.api(`/repos/${owner}/${name}/contents/${path}?ref=${ref}`);
    for (const item of res) {
        if (item.type === 'tree') {
            await this._walkTree(owner, name, `${path}${item.name}/`, ref, results);
        } else if (item.type === 'file' && /\.md$/.test(item.name)) {
            results.push(`${path}${item.name}`);
        }
    }
}
```

---

## Phasen-Plan

Jede Phase ist ein **kalt startbarer Sub-Agent**. Keine Abhängigkeiten zwischen den Phasen ausser der sequenziellen Reihenfolge.

### Phase 1 — Abhängigkeiten & Konfiguration

**Aufgabe:** `@modelcontextprotocol/sdk` installieren, Config-Erweiterung prüfen.

**Schritte:**
1. `npm install @modelcontextprotocol/sdk zod`
2. Prüfen, ob `config.json`/Config-Klasse neue MCP-Optionen braucht (wahrscheinlich nicht — MCP nutzt dieselben Search/Sync-Instanzen)
3. `package.json` Typ `module` ist bereits gesetzt ✓

**Output:** `package.json` mit neuer Dependency, `package-lock.json` aktualisiert.

---

### Phase 2 — `server/mcp.js` (McpService Klasse)

**Aufgabe:** Die `McpService` Klasse implementieren.

**Schritte:**
1. Neue Datei `server/mcp.js` erstellen
2. `McpService` Klasse mit `constructor({ search, sync })`
3. `init()` Methode: `McpServer` instanziieren, Tools registrieren
4. Tool `search`: wrapper um `search.searchAndAnswer(question)`
5. Tool `sync`: wrapper um `sync.syncRepository(owner, name, ref)`
6. `handleSsePost()`: erstellt `SSEServerTransport`, verbindet mit McpServer
7. `getTransport()` / `setSseEndpoint()` / `shutdown()` Helper
8. Export der Klasse

**Abhängigkeiten:** Phase 1

**Output:** Funktionierende `server/mcp.js` mit allen MCP-Methoden.

---

### Phase 3 — `server/gitea.js` Erweiterung (`listFiles`)

**Aufgabe:** Methode zum rekursiven Auflisten aller Markdown-Dateien eines Repos.

**Schritte:**
1. In `server/gitea.js` Methode `listFiles(owner, name, ref)` hinzufügen
2. Hilfsmethode `_walkTree` für rekursives Durchlaufen der Verzeichnisstruktur
3. Nutzung der Gitea Contents API (`/repos/{owner}/{name}/contents/{path}`)
4. Filter auf `*.md` Dateien

**Abhängigkeiten:** keine (unabhängig von MCP)

**Output:** Neue Methoden in `server/gitea.js`.

---

### Phase 4 — `server/sync.js` Erweiterung (`syncRepository`)

**Aufgabe:** Methode zum Sync'en eines ganzen Repos.

**Schritte:**
1. In `server/sync.js` Methode `syncRepository(owner, name, ref)` hinzufügen
2. Ruft `this.gitea.listFiles(owner, name, ref)` auf
3. Iteriert über Dateien, ruft für jede `syncFile()` auf
4. Error-Handling pro Datei

**Abhängigkeiten:** Phase 3

**Output:** Neue Methode in `server/sync.js`.

---

### Phase 5 — `server/router.js` Erweiterung (MCP Routes)

**Aufgabe:** Zwei MCP-Endpoints in den Router integrieren.

**Schritte:**
1. `McpService` als optionalen Parameter im Router-Konstruktor aufnehmen
2. Route `POST /mcp` — Initialisierung: erkennt `initialize`-Payload, erstellt SSE-Transport, startet SSE-Stream
3. Route `POST /mcp/message` — empfängt JSON-RPC-Nachrichten, leitet an Transport weiter
4. Beide Routes teilen sich denselben `SSEServerTransport`-Instance
5. Host-Validierung für MCP-Routes (DNS-Rebinding-Schutz)

**Abhängigkeiten:** Phase 2

**Output:** MCP-Endpoints in `server/router.js` funktionsfähig.

---

### Phase 6 — `server/index.js` Integration & Shutdown

**Aufgabe:** McpService im Server instanziieren, initialisieren, beim Shutdown beenden.

**Schritte:**
1. `McpService` importieren und im `Server`-Constructor instanziieren
2. `await this.mcpService.init()` nach Router-Initialisierung
3. `McpService`-Instance an Router weitergeben
4. Shutdown-Handler erweitern: `await this.mcpService.shutdown()`
5. Fehlerbehandlung: Wenn MCP-Init fehlschlägt, Server trotzdem starten (graceful degradation)

**Abhängigkeiten:** Phase 5

**Output:** Vollintegrierter MCP-Service im laufenden Server.

---

### Phase 7 — Tests & Validierung

**Aufgabe:** MCP-Endpoints manuell/testen.

**Schritte:**
1. Server starten
2. `curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}'`
3. SSE-Stream prüfen (Content-Type: text/event-stream)
4. `tools/list` Methode prüfen
5. `tools/call` mit `search` Tool testen
6. `tools/call` mit `sync` Tool testen
7. Error-Fälle testen (ungültige Inputs, nicht synchronisierte Repos)

**Abhängigkeiten:** Phase 6

**Output:** Verifizierte MCP-Integration.
