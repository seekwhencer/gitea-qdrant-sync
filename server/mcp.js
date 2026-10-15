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

    createServer() {
        this.mcpServer = new McpServer({
            name: 'gitea-qdrant-sync',
            version: '1.0.0'
        });

        this.mcpServer.registerTool(
            'search',
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
