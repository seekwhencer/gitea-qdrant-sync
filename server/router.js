
import express from 'express';
import { FrontendRouter } from './frontendRouter.js';

class Router {
    constructor(config, sync, search, httpServer, mcpService) {
        this.sync = sync;
        this.search = search;
        this.config = config;
        this.mcpService = mcpService;
        this.httpServer = httpServer;

        this.router = express.Router();
        this.router.use(express.json());

        this.define();

        return this.router;
    }

    define() {

        //
        const frontendRouter = new FrontendRouter(this.config, this.sync, this.search, this.httpServer);
        this.router.use('/', frontendRouter);

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
                console.error('Error processing webhook:', error);
                res.status(500).send('Internal Server Error');
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
                console.error('Error processing search:', error);
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
                console.error('[Error] streaming search:', err);
                send('error', { message: err?.message || 'Streaming fehlgeschlagen' });
            } finally {
                if (!res.writableEnded) res.end();
            }
        });

        //
        // MCP SSE endpoints
        if (this.mcpService && this.config.mcpEnabled) {
            const mcpPath = this.config.mcpPath || '/mcp';
            const mcpMessagePath = mcpPath + '/message';

            // Host validation middleware for MCP routes
            const mcpMiddleware = [];
            if (this.config.mcpAllowedHosts) {
                const allowed = this.config.mcpAllowedHosts.split(',').map(h => h.trim());
                mcpMiddleware.push((req, res, next) => {
                    const host = req.get('Host') || '';
                    const hostname = host.replace(/:\d+$/, '');
                    if (!allowed.includes(hostname)) {
                        return res.status(403).json({ error: 'Forbidden: host not allowed' });
                    }
                    next();
                });
            }

            this.router.post(mcpPath, ...mcpMiddleware, async (req, res) => {
                try {
                    const baseUrl = `${req.protocol}://${req.get('host')}`;
                    const messageEndpoint = `${baseUrl}${mcpMessagePath}`;

                    const transport = await this.mcpService.createTransport(mcpMessagePath);

                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        'X-Accel-Buffering': 'no'
                    });

                    // Pipe the transport's response to the SSE stream
                    // The SSEServerTransport writes to res via its internal handle
                    // We need to pass res to the transport's response handling
                    transport.res = res;

                    // Send the endpoint URL as the first SSE event
                    res.write(`event: message\ndata: {"jsonrpc":"2.0","method":"serverInfo","params":{"endpoint":"${messageEndpoint}"}}\n\n`);

                } catch (error) {
                    console.error('[MCP] Error initializing SSE transport:', error);
                    res.status(500).json({ error: 'MCP initialization failed', message: error.message });
                }
            });

            this.router.post(mcpMessagePath, ...mcpMiddleware, async (req, res) => {
                try {
                    const transport = this.mcpService.getTransport();
                    if (!transport) {
                        return res.status(503).json({ error: 'No active MCP session. Call POST /mcp first.' });
                    }
                    await transport.handlePostMessage(req, res);
                } catch (error) {
                    console.error('[MCP] Error handling message:', error);
                    res.status(500).json({ error: 'MCP message handling failed', message: error.message });
                }
            });
        }

    }
}

export { Router };
