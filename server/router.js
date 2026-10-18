
import express from 'express';
import { FrontendRouter } from './frontendRouter.js';
import { McpRouter } from './mcpRouter.js';

/**
 * Main router class that aggregates all server routes.
 * Integrates frontend, webhook, search, and MCP routes.
 */
class Router {
    /**
     * @param {Config} config - Configuration object
     * @param {GiteaQdrantSync} sync - Sync service
     * @param {Search} search - Search service
     * @param {import('node:http').Server} httpServer - HTTP server instance
     * @param {McpService} mcpService - MCP service
     * @param {Logger} [logger] - Logger instance
     */
    constructor(config, sync, search, httpServer, mcpService, logger) {
        this.sync = sync;
        this.search = search;
        this.config = config;
        this.mcpService = mcpService;
        this.httpServer = httpServer;
        this.label = '[Router]';
        this.logger = logger || { log: () => {}, error: () => {} };

        this.router = express.Router();
        this.router.use(express.json());
    }

    /**
     * Defines all routes: frontend, health, webhook, search, and MCP.
     * @returns {Promise<void>}
     */
    async define() {

        //
        const frontendRouter = new FrontendRouter(this.config, this.sync, this.search, this.httpServer, this.logger);
        await frontendRouter.init();
        this.router.use('/', frontendRouter.router);

        //
        this.router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

        //
        this.router.post('/webhook', async (req, res) => {
            if (req.headers['x-gitea-event'] !== 'push') {
                return res.status(200).send('Ignored non-push event');
            }

            try {
                await this.sync.handlePushEvent(req.body);
                res.status(200).send('Sync completed successfully.');
            } catch (error) {
                this.logger.error(this.label, 'Error processing webhook:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        //
        this.router.post('/sync-all', async (req, res) => {
            try {
                const result = await this.sync.syncAllRepositories();
                res.status(202).json(result);
            } catch (error) {
                this.logger.error(this.label, 'Error triggering sync-all:', error);
                res.status(500).json({ error: 'Internal Server Error', message: error.message });
            }
        });

        //
        this.router.post('/search', async (req, res) => {
            const question = req.body.question;
            if (!question) {
                return res.status(400).json({ error: 'Missing "question" in request body' });
            }

            try {
                const answer = await this.search.searchAndAnswer(question);
                if (answer === undefined) {
                    return res.status(404).json({ error: 'No answer found' });
                }
                res.status(200).json({ answer });
            } catch (error) {
                this.logger.error(this.label, 'Error processing search:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        //
        this.router.post('/search/stream', async (req, res) => {
            const question = req.body.question;
            if (!question) {
                return res.status(400).json({ error: 'Missing "question" in request body' });
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            res.write('retry: 3000\n\n');

            const send = (event, data) => {
                if (res.writableEnded) return false;
                res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                return true;
            };

            const controller = new AbortController();
            res.on('close', () => controller.abort());

            const stream = this.search.streamAndAnswer(question, { signal: controller.signal });
            try {
                while (true) {
                    const { value, done } = await stream.next();
                    if (res.writableEnded) break;
                    if (done) break;

                    const ev = value;
                    let ok;
                    if (ev.type === 'status') ok = send('status', { phase: ev.phase, message: ev.message });
                    else if (ev.type === 'thinking') ok = send('thinking', ev.token);
                    else if (ev.type === 'answer') ok = send('answer', ev.token);
                    else if (ev.type === 'empty') ok = send('empty', {});
                    else if (ev.type === 'done') ok = send('done', {});
                    else ok = true;
                    if (ok === false) break;
                }
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                this.logger.error(this.label, '[Error] streaming search:', err);
                send('error', { message: err?.message || 'Streaming fehlgeschlagen' });
            } finally {
                if (!res.writableEnded) res.end();
            }
        });

        //
        const mcpRouter = new McpRouter(this.config, this.mcpService, this.logger);
        this.router.use('/', mcpRouter);

    }
}

export { Router };
