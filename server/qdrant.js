import { QdrantClient } from '@qdrant/js-client-rest';

class Qdrant {
    constructor({
        url,
        port = 80,
        collection = 'research'
    } = {}) {
        this.url = url;
        this.port = port;
        this.collection = collection;

        this.params = {
            url: url,
            port: port,
            checkCompatibility: false
        }
        this.client = new QdrantClient(this.params);

        this.client.versionInfo().then(data => console.log('[Qdrant] Version:', data));

    }

    async upsert(vector, chunkText, source, repository) {
        const payload = {
            points: [
                {
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    vector: vector,
                    payload: {
                        text: chunkText,
                        source: source,
                        repository: repository
                    }
                }
            ]
        };

        try {
            await this.client.upsert(this.collection, payload);
        } catch (err) {
            if (this.isCollectionNotFoundError(err)) {
                await this.ensureCollection(vector);
                await this.client.upsert(this.collection, payload);
                return;
            }
            throw err;
        }
    }

    async search(vector, limit = 3) {
        try {
            const results = await this.client.query(this.collection, {
                query: vector,
                limit: limit,
                with_payload: true
            });
            return results?.points || [];
        } catch (err) {
            if (this.isCollectionNotFoundError(err)) return [];
            throw err;
        }
    }

    async deleteBySource(source) {
        try {
            await this.client.delete(this.collection, {
                filter: {
                    must: [{ key: 'source', match: { value: source } }]
                }
            });
        } catch (err) {
            if (!this.isCollectionNotFoundError(err)) throw err;
        }
    }

    isCollectionNotFoundError(err) {
        return err?.status === 404 || String(err?.message ?? '').toLowerCase().includes('not found');
    }

    async ensureCollection(vector) {
        const { result } = await this.client.collectionExists(this.collection);
        if (result) return;

        await this.client.createCollection(this.collection, {
            vectors: {
                size: vector.length,
                distance: 'Cosine'
            }
        });
        console.log(`[Qdrant] Collection '${this.collection}' created (size=${vector.length}, distance=Cosine)`);
    }
}

export { Qdrant };
