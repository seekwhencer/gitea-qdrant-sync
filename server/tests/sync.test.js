import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GiteaQdrantSync } from '../sync.js';

const qMock = {
    upsert: vi.fn(),
    deleteBySource: vi.fn(),
    isCollectionNotFoundError: vi.fn().mockReturnValue(false)
};
const lMock = {
    embed: vi.fn()
};
const gMock = {
    collectMarkdownFiles: vi.fn(),
    fetchFile: vi.fn(),
    listFiles: vi.fn()
};

let sync;

beforeEach(() => {
    qMock.upsert.mockReset().mockResolvedValue(undefined);
    qMock.deleteBySource.mockReset().mockResolvedValue(undefined);
    qMock.isCollectionNotFoundError.mockReset().mockReturnValue(false);
    lMock.embed.mockReset().mockResolvedValue([0.1, 0.2, 0.3]);
    gMock.collectMarkdownFiles.mockReset().mockReturnValue(new Set());
    gMock.fetchFile.mockReset().mockResolvedValue('# Title\n\nbody text');
    gMock.listFiles.mockReset().mockResolvedValue([]);

    sync = new GiteaQdrantSync({ qdrantChunkMaxSize: 100, qdrant: qMock, llm: lMock });
    sync.gitea = gMock;
});

describe('GiteaQdrantSync.recursiveMarkdownSplitter', () => {
    it('returns short text as a single chunk', () => {
        expect(sync.recursiveMarkdownSplitter('hello world', 100)).toEqual(['hello world']);
    });

    it('hard-cuts text into fixed-size chunks when no separators are given', () => {
        expect(sync.recursiveMarkdownSplitter('abcdefghij', 4, [])).toEqual(['abcd', 'efgh', 'ij']);
    });

    it('splits on newlines and preserves them', () => {
        const text = 'line1\nline2\nline3';
        const chunks = sync.recursiveMarkdownSplitter(text, 8);
        expect(chunks).toEqual(['line1', 'line2', 'line3']);
        expect(chunks.join('\n')).toBe(text);
    });

    it('splits long text into multiple non-empty chunks that cover the content', () => {
        const text = '# Heading One\nsome content here\n## Heading Two\nmore content';
        const chunks = sync.recursiveMarkdownSplitter(text, 12);
        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach(chunk => expect(chunk.length).toBeGreaterThan(0));
        const joined = chunks.join('');
        expect(joined).toContain('Heading One');
        expect(joined).toContain('Heading Two');
    });
});

describe('GiteaQdrantSync.chunkContent', () => {
    it('splits content using the configured max size', () => {
        expect(sync.chunkContent('alpha beta gamma delta')).toEqual(['alpha beta gamma', 'delta']);
    });
});

describe('GiteaQdrantSync.isRateLimitError', () => {
    it('detects HTTP 429 and rate-limit messages', () => {
        expect(sync.isRateLimitError({ status: 429 })).toBe(true);
        expect(sync.isRateLimitError({ message: 'Rate limited, slow down' })).toBe(true);
        expect(sync.isRateLimitError({ message: 'Too Many Requests' })).toBe(true);
        expect(sync.isRateLimitError({ status: 500 })).toBe(false);
    });
});

describe('GiteaQdrantSync.handlePushEvent', () => {
    it('continues processing when individual files fail and succeeds overall', async () => {
        gMock.collectMarkdownFiles.mockReturnValue(new Set(['a.md', 'b.md']));
        qMock.upsert.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));

        await expect(sync.handlePushEvent({
            repository: { html_url: 'http://x/a' },
            commits: [{ added: ['a.md', 'b.md'] }]
        })).resolves.toBeUndefined();

        expect(qMock.upsert).toHaveBeenCalledTimes(2);
    });

    it('throws only when no file could be synchronized', async () => {
        gMock.collectMarkdownFiles.mockReturnValue(new Set(['a.md']));
        qMock.upsert.mockRejectedValue(new Error('boom'));

        await expect(sync.handlePushEvent({
            repository: { html_url: 'http://x/a' },
            commits: [{ added: ['a.md'] }]
        })).rejects.toThrow('No files could be synchronized successfully.');
    });

    it('returns early when no markdown files changed', async () => {
        gMock.collectMarkdownFiles.mockReturnValue(new Set());

        await sync.handlePushEvent({
            repository: { html_url: 'http://x/a' },
            commits: [{ added: ['notes.txt'] }]
        });

        expect(gMock.fetchFile).not.toHaveBeenCalled();
        expect(qMock.upsert).not.toHaveBeenCalled();
    });
});

describe('GiteaQdrantSync.limiter (ConcurrencyLimiter)', () => {
    it('serializes tasks when the concurrency limit is 1', async () => {
        const prev = process.env.QDRANT_MAX_CONCURRENCY;
        process.env.QDRANT_MAX_CONCURRENCY = '1';
        const serial = new GiteaQdrantSync({ qdrantChunkMaxSize: 100, qdrant: qMock, llm: lMock });
        if (prev === undefined) {
            delete process.env.QDRANT_MAX_CONCURRENCY;
        } else {
            process.env.QDRANT_MAX_CONCURRENCY = prev;
        }

        let active = 0;
        let maxActive = 0;
        await Promise.all([1, 2, 3].map(() => serial.limiter.run(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
        })));

        expect(maxActive).toBe(1);
    });
});
