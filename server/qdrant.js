import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Qdrant client wrapper for upserting vectors, searching, and managing collections.
 */
class Qdrant {
    /**
     * @param {object} params - Configuration parameters
     * @param {string} params.url - Qdrant server URL
     * @param {number} [params.port=80] - Qdrant port
     * @param {string} [params.collection='research'] - Collection name
     */
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
        };
        this.client = new QdrantClient(this.params);

        this.client.versionInfo().then(data => console.log('[Qdrant] Version:', data.version));

    }

    /**
     * Upserts a single vector point with text payload into the collection.
     * Auto-creates the collection if it does not exist.
     * @param {number[]} vector - The embedding vector
     * @param {{text: string, source?: string, repository?: string}} meta - Point metadata (path alias = source)
     * @returns {Promise<void>}
     */
    async upsert(vector, {
        text: chunkText = '',
        path,
        source = '',
        repository = '',
        ref = ''
    } = {}) {
        const hex = createHash('sha256').update(`${chunkText}\0${repository}`).digest('hex');
        // Qdrant requires point IDs to be unsigned integers or UUIDs; a raw hex hash is neither.
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

        // path ist Alias für source (Kompatibilität mit searchAndReturnChunks)
        const payloadPath = (path ?? source) || '';

        const payload = {
            points: [
                {
                    id,
                    vector: vector,
                    payload: {
                        text: chunkText,
                        path: payloadPath,
                        source: String(source) || '',
                        repository: String(repository),
                        ref: String(ref)
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

    /**
     * Searches for the most similar vectors to the query vector.
     * @param {number[]} vector - The query embedding vector
     * @param {number} [limit=3] - Maximum number of results
     * @returns {Promise<Array<object>>} Array of matching points with payloads
     */
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

    /**
     * Deletes all points in the collection that match the given source path.
     * @param {string} source - Source file path to match
     * @returns {Promise<void>}
     */
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

    /**
     * Checks whether an error indicates a missing collection.
     * @param {object} err - The error object
     * @returns {boolean}
     */
    isCollectionNotFoundError(err) {
        return err?.status === 404 || String(err?.message ?? '').toLowerCase().includes('not found');
    }

    /**
     * Creates the collection if it does not already exist.
     * @param {number[]} vector - Embedding vector (used to determine vector size)
     * @returns {Promise<void>}
     */
    async ensureCollection(vector) {
        const { result } = await this.client.collectionExists(this.collection);
        if (result) return;

        let created = false;
        try {
            await this.client.createCollection(this.collection, {
                vectors: { size: vector.length, distance: 'Cosine' }
            });
            created = true;
        } catch (err) {
            const alreadyExists =
                err?.status === 409 ||
                String(err?.message ?? '').toLowerCase().includes('already exists');
            if (!alreadyExists) throw err;
        }

        if (created) {
            console.log(`[Qdrant] Collection '${this.collection}' created (size=${vector.length}, distance=Cosine)`);
        }
    }
}

export { Qdrant };
