import axios from 'axios';

class Gitea {
    constructor({
        url = '',
        token = ''
    } = {}) {
        this.url = url;
        this.token = token;
    }

    async fetchFile(repository, filePath, ref) {
        const url = `${this.url}/api/v1/repos/${repository.owner.username}/${repository.name}/raw/${ref}/${filePath}`;
        try {
            const fileRes = await axios.get(url, {
                headers: { Authorization: `token ${this.token}` },
                responseType: 'text'
            });
            return fileRes.data;
        } catch (error) {
            const status = error.response?.status;
            const message = error.response?.data?.message || error.message;
            console.error(`[Gitea] Failed to fetch ${filePath} (ref ${ref}) from ${repository.owner.username}/${repository.name}: HTTP ${status} - ${message}`);
            throw new Error(`Failed to fetch file ${filePath}: HTTP ${status} - ${message}`);
        }
    }

    collectMarkdownFiles(commits) {
        const changedFiles = new Set();
        commits.forEach(commit => {
            [...(commit.added || []), ...(commit.modified || [])].forEach(file => {
                if (file.endsWith('.md')) {
                    changedFiles.add(file);
                }
            });
        });
        return changedFiles;
    }

    async listFiles(owner, name, ref = 'main') {
        const markdownFiles = [];
        await this._walkTree(owner, name, '', ref, markdownFiles);
        return markdownFiles;
    }

    async _walkTree(owner, name, path, ref, results) {
        const encodedPath = encodeURIComponent(path);
        const url = `${this.url}/api/v1/repos/${owner}/${name}/contents${encodedPath ? `/${encodedPath}` : ''}?ref=${encodeURIComponent(ref)}`;
        try {
            const res = await axios.get(url, {
                headers: { Authorization: `token ${this.token}` }
            });
            const items = Array.isArray(res.data) ? res.data : [];
            for (const item of items) {
                if (item.type === 'tree') {
                    await this._walkTree(owner, name, `${path}${item.name}/`, ref, results);
                } else if (item.type === 'file' && /\.md$/i.test(item.name)) {
                    results.push(`${path}${item.name}`);
                }
            }
        } catch (error) {
            const status = error.response?.status;
            if (status === 404) return;
            console.error(`[Gitea] Failed to list tree ${path} in ${owner}/${name}: HTTP ${status}`);
            throw error;
        }
    }
}

export { Gitea };
