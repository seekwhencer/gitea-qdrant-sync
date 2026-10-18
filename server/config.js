import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads and manages server configuration from environment variables and a config.json file.
 */
class Config {
    /** @type {Record<string, string | number>} */
    static defaults = {
        serverPort: 3000,
        qdrantUrl: '',
        qdrantPort: 80,
        qdrantCollection: 'research',
        qdrantChunkMaxSize: 768,
        embeddingsApi: '',
        embeddingsUrl: '',
        embeddingsModel: 'nomic-embed-text',
        chatApi: '',
        chatUrl: '',
        chatModel: '',
        giteaApiUrl: '',
        giteaToken: '',
        mcpEnabled: true,
        mcpPath: '/mcp',
        mcpAllowedHosts: '',
        llmSystemPrompt: 'You are a helpful research assistant. Answer in markdown format the user\'s question precisely and full, based solely on the following context:',
        verbose: false
    };

    constructor(env = process.env, logger) {
        this.env = env;
        this.configPath = this.resolvePath();
        this.label = '[Config]';
        this.logger = logger || { log: () => {}, error: () => {} };

        const loadedDefaults =
            existsSync(this.configPath)
                ? JSON.parse(readFileSync(this.configPath, 'utf8'))
                : null;

        this.defaults = loadedDefaults ?? this.buildDefaults();

        this.serverPort = parseInt(env.SERVER_PORT, 10) || this.defaults.serverPort;
        this.qdrantUrl = env.QDRANT_URL || this.defaults.qdrantUrl;
        this.qdrantPort = parseInt(env.QDRANT_PORT, 10) || this.defaults.qdrantPort;
        this.embeddingsApi = env.EMBEDDINGS_API || this.defaults.embeddingsApi || env.LLM_API;
        this.embeddingsUrl = env.EMBEDDINGS_URL || this.defaults.embeddingsUrl || env.LLM_URL;
        this.embeddingsModel = env.EMBEDDINGS_MODEL || this.defaults.embeddingsModel || env.MODEL_NAME;
        this.chatApi = env.CHAT_API || this.defaults.chatApi;
        this.chatUrl = env.CHAT_URL || this.defaults.chatUrl;
        this.chatModel = env.CHAT_MODEL || this.defaults.chatModel;
        this.giteaApiUrl = env.GITEA_API_URL || this.defaults.giteaApiUrl;
        this.giteaToken = env.GITEA_TOKEN || this.defaults.giteaToken;
        this.qdrantCollection = env.QDRANT_COLLECTION || this.defaults.qdrantCollection;
        this.qdrantChunkMaxSize = parseInt(env.QDRANT_CHUNK_MAX_SIZE, 10) || this.defaults.qdrantChunkMaxSize;
        this.mcpEnabled = env.MCP_ENABLED !== 'false' && this.defaults.mcpEnabled;
        this.mcpPath = env.MCP_PATH || this.defaults.mcpPath;
        this.mcpAllowedHosts = env.MCP_ALLOWED_HOSTS || this.defaults.mcpAllowedHosts;
        this.verbose = env.VERBOSE === 'true' || this.defaults.verbose;
    }

    /**
     * Resolves the path to the configuration file.
     * @returns {string}
     */
    resolvePath() {
        return this.env.CONFIG_PATH || join(__dirname, '..', 'config.json');
    }

    /**
     * Creates a defaults object from environment variables or static default values.
     * @returns {Record<string, string | number>}
     */
    buildDefaults() {
        return {
            serverPort: parseInt(this.env.SERVER_PORT, 10) || Config.defaults.serverPort,
            qdrantUrl: this.env.QDRANT_URL || Config.defaults.qdrantUrl,
            qdrantPort: parseInt(this.env.QDRANT_PORT, 10) || Config.defaults.qdrantPort,
            embeddingsApi: this.env.EMBEDDINGS_API || Config.defaults.embeddingsApi,
            embeddingsUrl: this.env.EMBEDDINGS_URL || Config.defaults.embeddingsUrl,
            embeddingsModel: this.env.EMBEDDINGS_MODEL || Config.defaults.embeddingsModel,
            chatApi: this.env.CHAT_API || Config.defaults.chatApi,
            chatUrl: this.env.CHAT_URL || Config.defaults.chatUrl,
            chatModel: this.env.CHAT_MODEL || Config.defaults.chatModel,
            giteaApiUrl: this.env.GITEA_API_URL || Config.defaults.giteaApiUrl,
            giteaToken: this.env.GITEA_TOKEN || Config.defaults.giteaToken,
            qdrantCollection: this.env.QDRANT_COLLECTION || Config.defaults.qdrantCollection,
            qdrantChunkMaxSize: parseInt(this.env.QDRANT_CHUNK_MAX_SIZE, 10) || Config.defaults.qdrantChunkMaxSize,
            mcpEnabled: this.env.MCP_ENABLED !== 'false' || Config.defaults.mcpEnabled,
            mcpPath: this.env.MCP_PATH || Config.defaults.mcpPath,
            mcpAllowedHosts: this.env.MCP_ALLOWED_HOSTS || Config.defaults.mcpAllowedHosts,
            llmSystemPrompt: this.env.LLM_SYSTEM_PROMPT || Config.defaults.llmSystemPrompt,
            verbose: this.env.VERBOSE === 'true' || Config.defaults.verbose
        };
    }

    /**
     * Writes the default configuration file explicitly.
     * Intended to be invoked by a separate setup step (e.g. CLI flag --init-config).
     */
    saveDefaults() {
        writeFileSync(
            this.configPath,
            JSON.stringify(this.buildDefaults(), null, 4),
            'utf8'
        );
    }
}

export { Config };
