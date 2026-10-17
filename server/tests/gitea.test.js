import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { Gitea } from '../gitea.js';

vi.mock('axios', () => ({
    __esModule: true,
    default: { get: vi.fn(), post: vi.fn() }
}));

describe('Gitea.collectMarkdownFiles', () => {
    const gitea = new Gitea({ url: 'http://gitea.test', token: 't' });

    it('collects and dedupes .md files from added and modified commits', () => {
        const commits = [
            { added: ['a.md', 'b.txt'], modified: ['a.md', 'c.md'] },
            { added: ['dir/d.md'] }
        ];
        const result = gitea.collectMarkdownFiles(commits);
        expect([...result].sort()).toEqual(['a.md', 'b.txt', 'c.md', 'dir/d.md']);
    });

    it('ignores non-markdown files and handles empty commits', () => {
        expect(gitea.collectMarkdownFiles([]).size).toBe(0);
        const result = gitea.collectMarkdownFiles([{ added: ['x.txt'], modified: ['y.pdf'] }]);
        expect(result.size).toBe(0);
    });
});

describe('Gitea._walkTree / listFiles', () => {
    beforeEach(() => {
        axios.get.mockReset();
    });

    it('recursively follows tree entries and collects .md files', async () => {
        axios.get.mockImplementation(async (url) => {
            if (url.includes('/contents/sub')) {
                return { data: [{ name: 'deep.md', type: 'file' }] };
            }
            return { data: [
                { name: 'sub', type: 'tree' },
                { name: 'readme.md', type: 'file' },
                { name: 'notes.txt', type: 'file' }
            ] };
        });

        const gitea = new Gitea({ url: 'http://gitea.test', token: 't' });
        const files = await gitea.listFiles('owner', 'repo', 'main');
        expect(files.sort()).toEqual(['readme.md', 'sub/deep.md']);
    });

    it('returns an empty list when the root tree is missing (404)', async () => {
        axios.get.mockImplementation(async () => {
            const error = new Error('Not Found');
            error.response = { status: 404 };
            throw error;
        });

        const gitea = new Gitea({ url: 'http://gitea.test', token: 't' });
        const files = await gitea.listFiles('owner', 'missing');
        expect(files).toEqual([]);
    });

    it('re-throws non-404 listing errors', async () => {
        axios.get.mockImplementation(async () => {
            const error = new Error('Server Error');
            error.response = { status: 500 };
            throw error;
        });

        const gitea = new Gitea({ url: 'http://gitea.test', token: 't' });
        await expect(gitea.listFiles('owner', 'repo')).rejects.toThrow('Server Error');
    });
});
