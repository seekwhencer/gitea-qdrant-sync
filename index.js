

import { Config } from './server/config.js';
import { GiteaQdrantSync } from './server/sync.js';
import { Search } from './server/search.js';
import { Qdrant } from './server/qdrant.js';
import { Llm } from './server/llm.js';
import { Server } from './server/index.js';
import { Logger } from './server/logger.js';

class App {
    constructor(config = new Config()) {
        this.config = config;
        this.label = '[App]';
        this.logger = new Logger({ verbose: config.verbose });

        this.qdrant = new Qdrant({
            url: config.qdrantUrl,
            port: config.qdrantPort,
            collection: config.qdrantCollection,
            logger: this.logger
        });

        this.llm = new Llm({
            embeddingsApi: config.embeddingsApi,
            embeddingsUrl: config.embeddingsUrl,
            embeddingsModel: config.embeddingsModel,
            chatApi: config.chatApi,
            chatUrl: config.chatUrl,
            chatModel: config.chatModel,
            logger: this.logger
        });

        this.sync = new GiteaQdrantSync({
            qdrant: this.qdrant,
            llm: this.llm,
            giteaApiUrl: config.giteaApiUrl,
            giteaToken: config.giteaToken,
            qdrantChunkMaxSize: config.qdrantChunkMaxSize,
            logger: this.logger
        });

        this.search = new Search({
            qdrant: this.qdrant,
            llm: this.llm,
            systemPrompt: config.llmSystemPrompt,
            logger: this.logger
        });

        this.server = new Server(this.config, this.sync, this.search, this.logger);
    }

    async run() {
        return this.server.start();
    }
}

if (process.argv.includes('--init-config')) {
    new Config().saveDefaults();
    const logger = new Logger({ verbose: process.env.VERBOSE === 'true' });
    logger.log('[App]', 'Defaults written to config.json.');
    process.exit(0);
}

new App().run();

export { App };
