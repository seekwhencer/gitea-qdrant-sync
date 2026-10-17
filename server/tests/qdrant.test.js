import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

const clientMock = vi.hoisted(() => ({
    versionInfo: vi.fn(),
    upsert: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
    collectionExists: vi.fn(),
    createCollection: vi.fn()
}));

vi.mock('@qdrant/js-client-rest', () => ({
    QdrantClient: vi.fn().mockImplementation(() => clientMock)
}));

import { Qdrant } from '../qdrant.js';

describe('Qdrant', () => {
    beforeEach(() => {
        clientMock.versionInfo.mockReset().mockResolvedValue({ version: '1.12.0' });
        clientMock.upsert.mockReset().mockResolvedValue(undefined);
        clientMock.query.mockReset().mockResolvedValue({ points: [] });
        clientMock.delete.mockReset().mockResolvedValue(undefined);
        clientMock.collectionExists.mockReset().mockResolvedValue({ result: true });
        clientMock.createCollection.mockReset().mockResolvedValue(undefined);
    });

    it('upsert sends a deterministic id and a full payload', async () => {
        const q = new Qdrant({ url: 'http://q', port: 80, collection: 'research' });
        await q.upsert([0.1, 0.2], { text: 'hello', path: 'a.md', source: 'a.md', repository: 'repo', ref: 'main', commit: 'abc' });

        expect(clientMock.upsert).toHaveBeenCalledTimes(1);
        const [collection, payload] = clientMock.upsert.mock.calls[0];
        expect(collection).toBe('research');

        const point = payload.points[0];
        const expectedId = createHash('sha256').update('hello\0repo').digest('hex');
        expect(point.id).toBe(expectedId);
        expect(point.vector).toEqual([0.1, 0.2]);
        expect(point.payload).toEqual({
            text: 'hello',
            path: 'a.md',
            source: 'a.md',
            repository: 'repo',
            ref: 'main',
            commit: 'abc'
        });
    });

    it('upsert auto-creates the collection on a not-found error, then upserts', async () => {
        clientMock.upsert
            .mockRejectedValueOnce({ status: 404, message: 'Collection not found' })
            .mockResolvedValueOnce(undefined);
        clientMock.collectionExists.mockResolvedValue({ result: false });

        const q = new Qdrant({ url: 'http://q', collection: 'research' });
        await q.upsert([0.1], { text: 'x', source: 'x.md', repository: 'r' });

        expect(clientMock.collectionExists).toHaveBeenCalledTimes(1);
        expect(clientMock.createCollection).toHaveBeenCalledWith('research', {
            vectors: { size: 1, distance: 'Cosine' }
        });
        expect(clientMock.upsert).toHaveBeenCalledTimes(2);
    });

    it('search returns the matching points', async () => {
        clientMock.query.mockResolvedValue({ points: [{ payload: { text: 'a' } }] });
        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        const results = await q.search([0.1], 5);
        expect(results).toHaveLength(1);
    });

    it('search returns an empty array when the collection is missing', async () => {
        clientMock.query.mockRejectedValue({ status: 404 });
        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        expect(await q.search([0.1])).toEqual([]);
    });

    it('deleteBySource deletes points filtered by source', async () => {
        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        await q.deleteBySource('a.md');
        expect(clientMock.delete).toHaveBeenCalledWith('c', {
            filter: { must: [{ key: 'source', match: { value: 'a.md' } }] }
        });
    });

    it('deleteBySource ignores a missing collection', async () => {
        clientMock.delete.mockRejectedValue({ status: 404 });
        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        await expect(q.deleteBySource('a.md')).resolves.toBeUndefined();
    });

    it('isCollectionNotFoundError detects 404 and not-found messages', () => {
        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        expect(q.isCollectionNotFoundError({ status: 404 })).toBe(true);
        expect(q.isCollectionNotFoundError({ message: 'Collection not found' })).toBe(true);
        expect(q.isCollectionNotFoundError({ status: 500 })).toBe(false);
    });

    it('ensureCollection skips creation when the collection already exists', async () => {
        clientMock.collectionExists.mockResolvedValue({ result: true });
        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        await q.ensureCollection([0.1, 0.2]);
        expect(clientMock.createCollection).not.toHaveBeenCalled();
    });

    it('ensureCollection treats a 409 as an already-existing collection', async () => {
        clientMock.collectionExists.mockResolvedValue({ result: false });
        clientMock.createCollection.mockRejectedValueOnce({ status: 409, message: 'collection already exists' });

        const q = new Qdrant({ url: 'http://q', collection: 'c' });
        await expect(q.ensureCollection([0.1])).resolves.toBeUndefined();
        expect(clientMock.createCollection).toHaveBeenCalledTimes(1);
    });
});
