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

        const mcpFactory = () => this.mcpService.createServer();
        const handler = createMcpHandler(mcpFactory);
        const nodeHandler = toNodeHandler(handler);

        this.router.all(mcpPath, (req, res) => {
            void nodeHandler(req, res, req.body);
        });
    }
}

export { McpRouter };
