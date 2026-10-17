import express from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';

/**
 * MCP router that exposes Model Context Protocol endpoints.
 */
class McpRouter {
    /**
     * @param {Config} config - Configuration object
     * @param {McpService} mcpService - MCP service
     */
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

        // MCP_ALLOWED_HOSTS host validation. Skip entirely when not configured or empty.
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

        // Host validation middleware covering all nodeHandler-served MCP routes.
        if (allowedHosts && allowedHosts.size > 0) {
            this.router.use((req, res, next) => {
                const rawHost = req.headers['host'] || '';
                let ok;
                for (const a of allowedHosts) {
                    // full host-with-port match OR hostname without port
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

        // Middleware registered above runs before the route below, so every
        // request served by nodeHandler (e.g. /mcp and /mcp/message) passes host validation.
        this.router.all(mcpPath, (req, res) => {
            void nodeHandler(req, res, req.body);
        });
    }
}

export { McpRouter };
