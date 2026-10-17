import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

/**
 * MCP service that registers tools for asking questions, searching, and syncing.
 */
class McpService {
    /**
     * @param {object} params - Service dependencies
     * @param {Search} params.search - Search service
     * @param {GiteaQdrantSync} params.sync - Sync service
     */
    constructor({ search, sync }) {
        this.search = search;
        this.sync = sync;
        this.mcpServer = null;
    }

    /**
     * Initializes the MCP service.
     * @returns {Promise<void>}
     */
    init() {
        console.log('[MCP] Service initialized (v2 class pattern)');
        return Promise.resolve();
    }

    /**
     * Shuts down the MCP service.
     * @returns {Promise<void>}
     */
    shutdown() {
        this.mcpServer = null;
        return Promise.resolve();
    }

    /**
     * Creates and configures an MCP server with the ask, search, and sync tools.
     * @returns {McpServer}
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

        this.mcpServer.registerTool(
            'sync-all',
            {
                description: 'Synchronisiert alle Markdown-Dateien aller Gitea-Repositories in Qdrant. Läuft im Hintergrund.',
                inputSchema: z.object({})
            },
            async () => {
                if (this.sync._syncInProgress) {
                    return {
                        content: [{ type: 'text', text: 'Re-Sync läuft bereits. Bitte warten bis er abgeschlossen ist.' }],
                        isError: false
                    };
                }
                const result = await this.sync.syncAllRepositories();
                return { content: [{ type: 'text', text: result.message }] };
            }
        );

        return this.mcpServer;
    }
}

export { McpService };
