import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../config.js';

const missingPath = () => join(tmpdir(), `cfg-missing-${Math.random()}.json`);

function withTempConfig(write) {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const cfgPath = join(dir, 'config.json');
    if (write) writeFileSync(cfgPath, JSON.stringify(write), 'utf8');
    return { dir, cfgPath };
}

describe('Config', () => {
    it('uses static defaults when no config.json and no env overrides are present', () => {
        const config = new Config({ CONFIG_PATH: missingPath() });
        expect(config.serverPort).toBe(3000);
        expect(config.qdrantCollection).toBe('research');
        expect(config.qdrantChunkMaxSize).toBe(768);
        expect(config.embeddingsModel).toBe('nomic-embed-text');
        expect(config.mcpEnabled).toBe(true);
        expect(config.mcpPath).toBe('/mcp');
    });

    it('reads values from a config.json file referenced by CONFIG_PATH', () => {
        const { dir, cfgPath } = withTempConfig({ serverPort: 4000, qdrantCollection: 'mycol' });
        try {
            const config = new Config({ CONFIG_PATH: cfgPath });
            expect(config.serverPort).toBe(4000);
            expect(config.qdrantCollection).toBe('mycol');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('lets env vars override values from config.json', () => {
        const { dir, cfgPath } = withTempConfig({ serverPort: 4000, qdrantCollection: 'mycol' });
        try {
            const config = new Config({ CONFIG_PATH: cfgPath, SERVER_PORT: '5000', QDRANT_COLLECTION: 'envcol' });
            expect(config.serverPort).toBe(5000);
            expect(config.qdrantCollection).toBe('envcol');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('parses integer-valued fields', () => {
        const config = new Config({ CONFIG_PATH: missingPath(), QDRANT_PORT: '6333', QDRANT_CHUNK_MAX_SIZE: '512' });
        expect(config.qdrantPort).toBe(6333);
        expect(config.qdrantChunkMaxSize).toBe(512);
    });

    it('falls back to LLM_* env vars for embeddings when EMBEDDINGS_* are unset', () => {
        const config = new Config({ CONFIG_PATH: missingPath(), LLM_API: 'openapi', LLM_URL: 'http://llm' });
        expect(config.embeddingsApi).toBe('openapi');
        expect(config.embeddingsUrl).toBe('http://llm');
    });

    it('prefers EMBEDDINGS_* over LLM_* when both are set', () => {
        const config = new Config({
            CONFIG_PATH: missingPath(),
            LLM_API: 'openapi', LLM_URL: 'http://llm',
            EMBEDDINGS_API: 'ollama', EMBEDDINGS_URL: 'http://embed'
        });
        expect(config.embeddingsApi).toBe('ollama');
        expect(config.embeddingsUrl).toBe('http://embed');
    });

    it('can disable MCP via MCP_ENABLED=false', () => {
        const config = new Config({ CONFIG_PATH: missingPath(), MCP_ENABLED: 'false' });
        expect(config.mcpEnabled).toBe(false);
    });

    it('prefers CONFIG_PATH in resolvePath and falls back to the project config.json', () => {
        const custom = '/tmp/custom.json';
        expect(new Config({ CONFIG_PATH: custom }).resolvePath()).toBe(custom);
        const fallback = missingPath();
        expect(new Config({ CONFIG_PATH: fallback }).resolvePath()).toBe(fallback);
        expect(new Config({}).resolvePath()).toContain('config.json');
    });

    it('buildDefaults derives values from the environment', () => {
        const config = new Config({ CONFIG_PATH: missingPath(), SERVER_PORT: '7000', MCP_PATH: '/custom' });
        const defaults = config.buildDefaults();
        expect(defaults.serverPort).toBe(7000);
        expect(defaults.mcpPath).toBe('/custom');
    });

    it('saveDefaults explicitly writes the config file', () => {
        const { dir, cfgPath } = withTempConfig();
        try {
            const config = new Config({ CONFIG_PATH: cfgPath, SERVER_PORT: '8000' });
            config.saveDefaults();
            expect(existsSync(cfgPath)).toBe(true);
            const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
            expect(written.serverPort).toBe(8000);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not create a config.json during construction when none exists', () => {
        const { dir, cfgPath } = withTempConfig();
        try {
            new Config({ CONFIG_PATH: cfgPath });
            expect(existsSync(cfgPath)).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
