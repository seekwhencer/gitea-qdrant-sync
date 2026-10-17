# gitea-qdrant-sync — MCP Feature Konzept

## Ziel

Dem bestehenden Express-Service ein **MCP-Tool-Endpoint** hinzufügen, über den ein LLM-Client (Claude Code, Cursor, etc.) drei Tools aufrufen kann:

1. **`ask`** — RAG-Frage beantworten (Vektorsuche in Qdrant + LLM-Antwort)
2. **`search`** — rohe Vektor-Treffer ohne LLM zurückgeben
3. **`sync`** — manuellen Sync für ein Repo triggern

Transport: **Streamable HTTP** über einen einzigen `/mcp` Endpoint. Kein stdio, kein separater Prozess, kein SSE-Handshake mit zwei Endpoints.

---

## Architektur-Entscheidungen

### Warum Streamable HTTP statt SSE?

- Der bestehende Server ist bereits ein langlebiger Express-Prozess.
- Das MCP v2 SDK (`@modelcontextprotocol/server@^2`) bietet den **Streamable HTTP**-Transport als offiziellen Standard an.
- **Ein einziger Endpoint** `/mcp` statt zweier SSE-Endpoints (`/mcp` + `/mcp/message`) — kein zustandsbehafteter Transport, der zwischen zwei Requests persistiert werden muss.
- Streaming-Antworten werden über `Connection: upgrade` + `text/event-stream` ausgeliefert; nicht-streaming Antworten als normales JSON-RPC-Response.
- Die JSON-RPC-Nachrichtenverwaltung (Session-ID, Pipelining, Cancel, Disconnect) übernimmt das SDK (`createMcpHandler`) — keine manuelle Implementierung.

### Wo läuft die Logik?

Die MCP-Tools sind **dünne Wrapper** um die bestehenden Klassen `Search` und `GiteaQdrantSync`. Keine Duplizierung.

Drei Komponenten:

- `server/mcp.js` — `McpService`: hält die Abhängigkeiten und erstellt mit `createServer()` ein konfiguriertes `McpServer`-Exemplar (Tools registrieren).
- `server/mcpRouter.js` — `McpRouter`: serviert die MCP-Routen über `createMcpHandler` + `toNodeHandler` und führt die Host-Validierung (`MCP_ALLOWED_HOSTS`) durch.
- `server/router.js` / `server/index.js` — integrieren beide und initialisieren/beenden den Service.

### Abhängigkeiten

```json
{
  "@modelcontextprotocol/server": "^2.3.1",
  "@modelcontextprotocol/node": "^2.1.1",
  "@modelcontextprotocol/express": "^2.0.2",
  "zod": "^4.6.7"
}
```

- `@modelcontextprotocol/server` — `McpServer` (v2 class pattern) und `createMcpHandler` (Streamable HTTP Handler).
- `@modelcontextprotocol/node` — `toNodeHandler` (Adapter von der SDK-Handler-Signatur auf `(req, res, body)`).
- `zod` — Schemata für Tool-Input-Schemas (`zod/v4`).

---

## Streamable HTTP-Protokoll-Flow

```
Client                          Server
  |                                 |
  |  POST /mcp                      |
  |  Content-Type: application/json |
  |  {"jsonrpc":"2.0","id":1,       |
  |   "method":"initialize",        |
  |   "params":{...}}               |
  |                                 |
  |  ← 202 Accepted                 |
  |  Connection: upgrade            |
  |  Content-Type: text/event-stream|
  |                                 |
  |  ← event: message               |
  |     data: {"jsonrpc":"2.0",     |
  |       "result":{...}}           |
  |                                 |
  |  POST /mcp                      |
  |  Accept: application/json,      |
  |        text/event-stream        |
  |  {"jsonrpc":"2.0",              |
  |   "method":"notifications/initialized"}|
  |                                 |
  |  ← 202 Accepted                 |
  |                                 |
  |  POST /mcp                      |
  |  {"jsonrpc":"2.0","id":2,       |
  |   "method":"tools/list"}        |
  |                                 |
  |  ← 200 OK / 202 Accepted        |
  |  (JSON-Response oder SSE-Stream)|
  |  data: {"result":{"tools":[...]}}|
  |                                 |
  |  POST /mcp                      |
  |  {"jsonrpc":"2.0","id":3,       |
  |   "method":"tools/call",        |
  |   "params":{"name":"ask",       |
  |     "arguments":{"question":".."}}}|
  |                                 |
  |  ← 202 Accepted (Streaming)     |
  |  ← event: message               |
  |     data: {"result":{           |
  |       "content":[{"type":"text", |
  |        "text":"..."}]}}         |
  |                                 |
  |  POST /mcp                      |
  |  {"jsonrpc":"2.0","id":4,       |
  |   "method":"notifications/cancel"}|
  |                                 |
  |  ← 202 Accepted                 |
  |                                 |
  |  DELETE /mcp                    |
  |  {"jsonrpc":"2.0","id":null,    |
  |   "method":"$disconnect"}       |
  |                                 |
  |  ← 202 Accepted                 |
  |  (Stream wird geschlossen)      |
```

Wichtig:

- **Ein Endpoint** `/mcp` für alle Methoden (POST = Nachrichten, GET = SSE-Stream fortsetzen, DELETE = Disconnect).
- Nach `initialize` sendet der Client `notifications/initialized` (kein `id`, keine Antwort erwartet).
- Der Client kann mehrere Requests pipelinen, ohne auf vorherige Responses zu warten.
- Streaming-Antworten (`tools/call` mit langer Antwort) kommen über `Connection: upgrade` + SSE; kurze Antworten als JSON.

---

## Dateistruktur

```
server/
├── mcp.js          ← McpService Klasse (createServer: Tools registrieren)
├── mcpRouter.js    ← McpRouter Klasse (Streamable HTTP + Host-Validierung)
├── router.js       ← Erweiterung: McpRouter integrieren
├── index.js        ← Erweiterung: McpService instanziieren/initialisieren
└── ...
```

---

## `server/mcp.js` — McpService Klasse

```js
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

class McpService {
    constructor({ search, sync }) {
        this.search = search;
        this.sync = sync;
        this.mcpServer = null;
    }

    init() {
        console.log('[MCP] Service initialized (v2 class pattern)');
        return Promise.resolve();
    }

    shutdown() {
        this.mcpServer = null;
        return Promise.resolve();
    }

    /**
     * Erstellt und konfiguriert ein McpServer-Exemplar mit den Tools
     * `ask`, `search` und `sync`. Wird pro Session lazily vom Router aufgerufen.
     */
    createServer() {
        this.mcpServer = new McpServer({
            name: 'gitea-qdrant-sync',
            version: '1.0.0'
        });

        this.mcpServer.registerTool(
            'ask',
            {
                description: 'Beantwortet eine Frage auf Basis der synchronisierten Gitea-Dokumentation (RAG). Nutzt Vektorsuche in Qdrant + LLM-Antwort.',
                inputSchema: z.object({
                    question: z.string().describe('Die Frage, die beantwortet werden soll')
                })
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

        this.mcpServer.registerTool(
            'search',
            {
                description: 'Durchsucht die synchronisierte Gitea-Dokumentation mit Vektorsuche in Qdrant. Gibt rohe Treffer ohne LLM zurück.',
                inputSchema: z.object({
                    question: z.string().describe('Die Suchanfrage')
                })
            },
            async ({ question }) => {
                const chunks = await this.search.searchAndReturnChunks(question);
                if (chunks.length === 0) {
                    return {
                        content: [{ type: 'text', text: 'Keine Ergebnisse gefunden. Vielleicht ist das Thema noch nicht synchronisiert.' }],
                        isError: false
                    };
                }
                return { content: [{ type: 'text', text: JSON.stringify(chunks, null, 2) }] };
            }
        );

        this.mcpServer.registerTool(
            'sync',
            {
                description: 'Triggert einen manuellen Sync aller Markdown-Dateien eines Gitea-Repositories.',
                inputSchema: z.object({
                    repository: z.string().describe('Repo-Pfad in Gitea, z.B. "owner/repo"'),
                    ref: z.string().optional().describe('Git-Ref/Branch/Commit, default: main')
                })
            },
            async ({ repository, ref }) => {
                const parts = repository.split('/');
                if (parts.length < 2) {
                    return {
                        content: [{ type: 'text', text: 'Ungültiges Repository-Format. Erwartet: owner/repo' }],
                        isError: true
                    };
                }
                const [owner, name] = parts;

                try {
                    await this.sync.syncRepository(owner, name, ref || 'main');
                    return { content: [{ type: 'text', text: `Sync für ${repository} abgeschlossen.` }] };
                } catch (error) {
                    return {
                        content: [{ type: 'text', text: `Sync fehlgeschlagen: ${error.message}` }],
                        isError: true
                    };
                }
            }
        );

        return this.mcpServer;
    }
}

export { McpService };
```

---

## `server/mcpRouter.js` — McpRouter Klasse

Der Router adaptiert den Streamable-HTTP-Handler des SDK auf Node.js und schützt die MCP-Routen mit einer Host-Whitelist (`MCP_ALLOWED_HOSTS`, DNS-Rebinding-Schutz).

```js
import express from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

class McpRouter {
    constructor(config, mcpService) {
        this.config = config;
        this.mcpService = mcpService;
        this.router = express.Router();
        this.define();
        return this.router;
    }

    define() {
        if (!this.mcpService || !this.config.mcpEnabled) return;

        const mcpPath = this.config.mcpPath || '/mcp';

        // MCP_ALLOWED_HOSTS Host-Validierung. Bei leerer/konfigurativer Konfiguration komplett überspringen.
        let allowedHosts;
        try {
            const raw =
                typeof this.config.mcpAllowedHosts === 'string'
                    ? this.config.mcpAllowedHosts
                    : '';
            const parsed =
                [...new Set(raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))];
            if (parsed.length > 0) allowedHosts = new Set(parsed);
        } catch {
            // malformed config → skip validation
        }

        const stripPort = (host) => {
            const bracketed =
                /^\[([^\]]*)\](?::(\d+))?$/.exec(host.toLowerCase());
            if (bracketed) return `[${bracketed[1]}]`;
            const idx = host.lastIndexOf(':');
            return idx >= 0 ? host.slice(0, idx).toLowerCase() : host.toLowerCase();
        };

        // Host-Validierung für alle nodeHandler-bedienten MCP-Routen (/mcp und /mcp/message).
        if (allowedHosts && allowedHosts.size > 0) {
            this.router.use((req, res, next) => {
                const rawHost = req.headers['host'] || '';
                let ok;
                for (const a of allowedHosts) {
                    if (
                        stripPort(rawHost).toLowerCase() === a ||
                        rawHost.toLowerCase() === a
                    ) { ok = true; break; }
                }

                if (!ok) {
                    return res.status(403).json({
                        error: 'Host not allowed',
                        message:
                            `Host ${rawHost} is not in the MCP_ALLOWED_HOSTS whitelist.`,
                    });
                }

                next();
            });
        }

        const mcpFactory = () => this.mcpService.createServer();
        const handler = createMcpHandler(mcpFactory);
        const nodeHandler = toNodeHandler(handler);

        // Middleware oben läuft vor der Route, also jede von nodeHandler bediente
        // Request (z.B. /mcp und /mcp/message) durchläuft die Host-Validierung.
        this.router.all(mcpPath, (req, res) => {
            void nodeHandler(req, res, req.body);
        });
    }
}

export { McpRouter };
```

---

## Erweiterung `server/router.js`

Der `McpRouter` wird am Ende der Routen integriert:

```js
import { McpRouter } from './mcpRouter.js';

// Im Router-Konstruktor:
this.mcpService = mcpService; // wird von index.js übergeben

// Im Router.define():
const mcpRouter = new McpRouter(this.config, this.mcpService);
this.router.use('/', mcpRouter);
```

---

## Erweiterung `server/index.js`

```js
import { McpService } from './mcp.js';

// Im Server-Constructor:
this.mcpService = new McpService({ search: this.search, sync: this.sync });
this.router = new Router(this.config, this.sync, this.search, this.httpServer, this.mcpService);

// Im start():
try {
    await this.mcpService.init();
    console.log('[MCP] Server initialized');
} catch (error) {
    console.error('[MCP] Initialization failed, continuing without MCP:', error.message);
}

// Im Shutdown:
await this.mcpService.shutdown();
```

Fehlerbehandlung: Wenn die MCP-Initialisierung fehlschlägt, fährt der Server trotzdem fort (graceful degradation).

---

## Erweiterung `server/sync.js` — `syncRepository()` Methode

Die Methode `syncRepository(owner, name, ref)` in der `GiteaQdrantSync`-Klasse:

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

**Aufgabe:** v2-SDK-Pakete installieren, Config-Erweiterung prüfen.

**Schritte:**
1. `npm install @modelcontextprotocol/server @modelcontextprotocol/node @modelcontextprotocol/express zod`
2. Prüfen, ob `config.json`/Config-Klasse neue MCP-Optionen braucht (`mcpEnabled`, `mcpPath`, `mcpAllowedHosts`) — wahrscheinlich nicht — MCP nutzt dieselben Search/Sync-Instanzen
3. `package.json` Typ `module` ist bereits gesetzt ✓

**Output:** `package.json` mit neuen Dependencies, `package-lock.json` aktualisiert.

---

### Phase 2 — `server/mcp.js` (McpService Klasse)

**Aufgabe:** Die `McpService` Klasse implementieren.

**Schritte:**
1. Neue Datei `server/mcp.js` erstellen
2. `McpService` Klasse mit `constructor({ search, sync })`
3. `createServer()` Methode: `McpServer` instanziieren, Tools (`ask`, `search`, `sync`) registrieren
4. Tool `ask`: wrapper um `search.searchAndAnswer(question)`
5. Tool `search`: wrapper um `search.searchAndReturnChunks(question)`
6. Tool `sync`: wrapper um `sync.syncRepository(owner, name, ref)`
7. `init()` / `shutdown()` Helper
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

### Phase 5 — `server/mcpRouter.js` (McpRouter Klasse)

**Aufgabe:** Streamable-HTTP-Endpoints in den Router integrieren.

**Schritte:**
1. `McpService` als optionalen Parameter im `McpRouter`-Konstruktor aufnehmen
2. `createMcpHandler(() => mcpService.createServer())` + `toNodeHandler` adaptieren
3. Route `router.all(mcpPath)` für alle HTTP-Methoden des Streamable-HTTP-Transports
4. Host-Validierung für MCP-Routes (`MCP_ALLOWED_HOSTS`, DNS-Rebinding-Schutz)

**Abhängigkeiten:** Phase 2

**Output:** MCP-Endpoints in `server/mcpRouter.js` funktionsfähig.

---

### Phase 6 — `server/router.js` & `server/index.js` Integration & Shutdown

**Aufgabe:** McpService im Server instanziieren, initialisieren, beim Shutdown beenden.

**Schritte:**
1. `McpService` importieren und im `Server`-Constructor instanziieren
2. `McpService`-Instance an `Router` weitergeben (`new Router(config, sync, search, httpServer, mcpService)`)
3. `McpRouter` im `Router.define()` integrieren
4. `await this.mcpService.init()` in `start()`
5. Shutdown-Handler erweitern: `await this.mcpService.shutdown()`
6. Fehlerbehandlung: Wenn MCP-Init fehlschlägt, Server trotzdem starten (graceful degradation)

**Abhängigkeiten:** Phase 5

**Output:** Vollintegrierter MCP-Service im laufenden Server.

---

### Phase 7 — Tests & Validierung

**Aufgabe:** MCP-Endpoints manuell/testen.

**Schritte:**
1. Server starten
2. `curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}'`
3. Response prüfen (`202 Accepted`, `Connection: upgrade`, SSE-Stream)
4. `tools/list` Methode prüfen
5. `tools/call` mit `ask`/`search` Tool testen
6. `tools/call` mit `sync` Tool testen
7. Error-Fälle testen (ungültige Inputs, nicht synchronisierte Repos)
8. Host-Validierung testen (`MCP_ALLOWED_HOSTS`)

**Abhängigkeiten:** Phase 6

**Output:** Verifizierte MCP-Integration.
