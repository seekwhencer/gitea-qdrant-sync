import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

class Config {
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
        giteaToken: ''
    };

    constructor(env = process.env) {
        this.env = env;
        this.configPath = this.resolvePath();
        this.defaults = this.loadOrGenerateDefaults();

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
    }

    resolvePath() {
        return this.env.CONFIG_PATH || join(__dirname, '..', 'config.json');
    }

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
            qdrantChunkMaxSize: parseInt(this.env.QDRANT_CHUNK_MAX_SIZE, 10) || Config.defaults.qdrantChunkMaxSize
        };
    }

    loadOrGenerateDefaults() {
        this.configPath = this.resolvePath();

        if (!existsSync(this.configPath)) {
            writeFileSync(this.configPath, JSON.stringify(this.buildDefaults(), null, 4), 'utf8');
            console.log(`[Config] No config.json found, created at ${this.configPath}`);
        }

        return JSON.parse(readFileSync(this.configPath, 'utf8'));
    }
}

export { Config };
