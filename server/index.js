import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { Router } from './router.js';

export class Server {
    constructor(config, sync, search) {
        this.config = config;
        this.sync = sync;
        this.search = search;

        // create
        this.app = express();
        this.httpServer = createHttpServer(this.app);

        // append the routes
        this.router = new Router(this.config, this.sync, this.search, this.httpServer);
        this.app.use(this.router);

        // 404
        this.app.use((req, res) => {
            res.status(404).json({ error: 'Not found', code: 'not_found' });
        });

        // 500 
        this.app.use((error, req, res, next) => {
            console.error('Unhandled error', { error: error.message });
            res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
        });
    }

    start() {
        this.httpServer.listen(this.config.serverPort, () => {
            console.log(`Gitea-Qdrant-Sync running on port ${this.config.serverPort}`);
        });

        const shutdown = () => {
            console.log('Shutting down...');
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