import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { Router } from './router.js';
import { McpService } from './mcp.js';

/**
 * Main server class for the Gitea-Qdrant-Sync service.
 * Starts the HTTP server, initializes MCP, and sets up error handlers.
 */
export class Server {
    /**
     * @param {object} config - Configuration object
     * @param {GiteaQdrantSync} sync - Sync service
     * @param {Search} search - Search service
     */
    constructor(config, sync, search) {
        this.config = config;
        this.sync = sync;
        this.search = search;

        // create
        this.app = express();
        this.httpServer = createHttpServer(this.app);

        // security headers on every response (covers all routes, 404 and 500 handlers)
        this.app.use((req, res, next) => {
            res.setHeader('X-Frame-Options', 'DENY');

            if (process.env.NODE_ENV === 'production') {
                res.setHeader("Content-Security-Policy", "default-src 'self'");
            }
            res.setHeader('X-Content-Type-Options', 'nosniff');
            next();
        });

        // MCP service
        this.mcpService = new McpService({ search: this.search, sync: this.sync });
    }

    /**
     * Starts the HTTP server and initializes the MCP service.
     * Registers signal handlers for clean shutdown.
     * @returns {Promise<void>}
     */
    async start() {
        try {
            await this.mcpService.init();
            console.log('[MCP] Server initialized');
        } catch (error) {
            console.error('[MCP] Initialization failed, continuing without MCP:', error.message);
        }

        // append the routes
        this.router = new Router(this.config, this.sync, this.search, this.httpServer, this.mcpService);
        await this.router.define();
        this.app.use(this.router.router);

        // 404
        this.app.use((req, res) => {
            res.status(404).json({ error: 'Not found', code: 'not_found' });
        });

        // 500 
        this.app.use((error, req, res, next) => {
            console.error('Unhandled error', { error: error.message });
            res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
        });

        this.httpServer.listen(this.config.serverPort, () => {
            console.log(`Gitea-Qdrant-Sync running on port ${this.config.serverPort}`);
        });

        const shutdown = async () => {
            console.log('Shutting down...');
            try {
                await this.mcpService.shutdown();
            } catch (e) {
                console.error('[MCP] Shutdown error:', e.message);
            }
            this.httpServer.close(() => process.exit(0));
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

        // something goes wrong ;)
        process.on('unhandledRejection', (reason) => {
            console.error('Unhandled Rejection', { reason: reason?.message, ...reason });
        });
    }

}
