

import { Config } from './server/config.js';
import { GiteaQdrantSync } from './server/sync.js';
import { Search } from './server/search.js';
import { Qdrant } from './server/qdrant.js';
import { Llm } from './server/llm.js';
import { Server } from './server/index.js';

class App {
    constructor(config = new Config()) {
        this.config = config;

        this.qdrant = new Qdrant({
            url: config.qdrantUrl,
            port: config.qdrantPort,
            collection: config.qdrantCollection
        });

        this.llm = new Llm({
            embeddingsApi: config.embeddingsApi,
            embeddingsUrl: config.embeddingsUrl,
            embeddingsModel: config.embeddingsModel,
            chatApi: config.chatApi,
            chatUrl: config.chatUrl,
            chatModel: config.chatModel
        });

        this.sync = new GiteaQdrantSync({
            qdrant: this.qdrant,
            llm: this.llm,
            giteaApiUrl: config.giteaApiUrl,
            giteaToken: config.giteaToken,
            qdrantChunkMaxSize: config.qdrantChunkMaxSize
        });

        this.search = new Search({
            qdrant: this.qdrant,
            llm: this.llm
        });

        this.server = new Server(this.config, this.sync, this.search);
    }

    async run() {
        return this.server.start();
    }

}


if (process.argv.includes('--init-config')) {
    new Config().saveDefaults();
    console.log('[Config] Defaults written to config.json.');
    process.exit(0);
}

new App().run();

export { App };
