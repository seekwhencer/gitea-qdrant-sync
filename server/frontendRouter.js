import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FrontendRouter {
    constructor(config, sync, search, httpServer) {
        this.config = config;
        this.sync = sync;
        this.search = search;
        this.httpServer = httpServer;

        this.router = express.Router();
        this.router.use(express.json());

        this.uiDir = this.config?.uiDir || 'frontend';
        this.buildDir = this.config?.uiBuildDir || 'frontend/dist';
        this.viteServer = null;

        this.define();

        return this.router;
    }

    async define() {
        
        if (process.env.NODE_ENV === 'development') {
            this.viteServer = await this.getViteServer();
            if (this.viteServer) {
                this.router.use(this.viteServer.middlewares);
            }
        } else {
            this.router.use(express.static(this.buildDir));
            this.router.get('*', (req, res) => {
                res.sendFile(path.join(this.buildDir, 'index.html'));
            });
        }

        this.router.get('/', (req, res) => {
            const targetDir = process.env.NODE_ENV === 'development' ? this.uiDir : this.buildDir;
            const indexPath = path.resolve(__dirname, '..', targetDir, 'index.html');
            if (this.viteServer && this.viteServer.transformIndexHtml) {
                fs.promises.readFile(indexPath, 'utf-8')
                    .then((html) => this.viteServer.transformIndexHtml(req.url, html))
                    .then((transformed) => res.type('html').send(transformed))
                    .catch(() => res.sendFile(indexPath));
            } else {
                res.sendFile(indexPath);
            }
        });
        
    }

    async getViteServer() {
        try {
            const uiRoot = path.resolve(__dirname, '..', this.uiDir);
            const require = createRequire(path.join(uiRoot, 'package.json'));
            const vite = await import(require.resolve('vite'));
            return await vite.createServer({
                root: uiRoot,
                server: {
                    middlewareMode: true,
                    ws: this.httpServer ? { server: this.httpServer } : {}
                },
                appType: 'custom'
            });
        } catch (e) {
            return null;
        }
    }
}

export { FrontendRouter };
