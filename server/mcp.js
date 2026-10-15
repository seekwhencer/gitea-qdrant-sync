import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

class McpService {
    constructor({ search, sync }) {
        this.search = search;
        this.sync = sync;
        this.mcpServer = null;
        this.sseTransport = null;
        this.sseEndpoint = null;
    }

    async init() {
        this.mcpServer = new McpServer({
            name: 'gitea-qdrant-sync',
            version: '1.0.0'
        });

        // Tool: search — RAG question answering
        this.mcpServer.registerTool(
            'search',
            {
                description: 'Beantwortet eine Frage auf Basis der synchronisierten Gitea-Dokumentation (RAG). Nutzt Vektorsuche in Qdrant + LLM-Antwort.',
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

        // Tool: sync — manual repository sync
        this.mcpServer.registerTool(
            'sync',
            {
                description: 'Triggert einen manuellen Sync aller Markdown-Dateien eines Gitea-Repositories nach Qdrant.',
                inputSchema: {
                    repository: { type: 'string', description: 'Repo-Pfad in Gitea, z.B. "owner/repo"' },
                    ref: { type: 'string', optional: true, description: 'Git-Ref/Branch/Commit, default: main' }
                }
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

        await this.mcpServer.start();
    }

    /**
     * Initialisiert den SSE-Transport für einen neuen Client.
     * Muss vor dem ersten Aufruf von connect() aufgerufen werden.
     */
    async createTransport(messageEndpoint) {
        this.sseTransport = new SSEServerTransport(messageEndpoint, {
            reqHeaders: { 'Content-Type': 'application/json' }
        });
        await this.mcpServer.connect(this.sseTransport);
        return this.sseTransport;
    }

    getTransport() {
        return this.sseTransport;
    }

    setSseEndpoint(url) {
        this.sseEndpoint = url;
    }

    get mcpServerInstance() {
        return this.mcpServer;
    }

    async shutdown() {
        if (this.sseTransport) {
            try {
                await this.sseTransport.close();
            } catch (e) {
                console.error('[MCP] Error closing transport:', e.message);
            }
        }
    }
}

export { McpService };
