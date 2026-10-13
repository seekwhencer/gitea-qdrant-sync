import express from 'express';
import { GiteaQdrantSync } from './server/sync.js';
import { Search } from './server/search.js';
import { Qdrant } from './server/qdrant.js';
import { Llm } from './server/llm.js';
import { Config } from './server/config.js';
import { Router } from './server/routes.js';

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

        // create
        this.app = express();

        // append the routes
        this.router = new Router(this.sync, this.search, express);
        this.app.use(this.router);
    }

    listen() {
        return this.app.listen(this.config.serverPort, () => {
            console.log(`Gitea-Qdrant-Sync running on port ${this.config.serverPort}`);
        });
    }
}

new App().listen();

export { App };
