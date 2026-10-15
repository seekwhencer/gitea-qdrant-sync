import axios from 'axios';

/**
 * Gitea API client for fetching files and listing repository contents.
 */
class Gitea {
    /**
     * @param {object} params - Configuration parameters
     * @param {string} [params.url=''] - Gitea API base URL
     * @param {string} [params.token=''] - Gitea API token
     */
    constructor({
        url = '',
        token = ''
    } = {}) {
        this.url = url;
        this.token = token;
    }

    /**
     * Fetches the raw content of a file from a Gitea repository.
     * @param {object} repository - Repository object with owner and name
     * @param {string} filePath - Path of the file to fetch
     * @param {string} ref - Git ref/branch/commit
     * @returns {Promise<string>} The file content as text
     */
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

    /**
     * Collects .md file paths from added and modified files in a list of commits.
     * @param {Array<object>} commits - Array of commit objects with added and modified arrays
     * @returns {Set<string>} Set of changed Markdown file paths
     */
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

    /**
     * Recursively lists all Markdown files in a repository tree.
     * @param {string} owner - Repository owner
     * @param {string} name - Repository name
     * @param {string} [ref='main'] - Git ref/branch/commit
     * @returns {Promise<string[]>} Array of Markdown file paths
     */
    async listFiles(owner, name, ref = 'main') {
        const markdownFiles = [];
        await this._walkTree(owner, name, '', ref, markdownFiles);
        return markdownFiles;
    }

    /**
     * Recursively walks the repository tree to collect Markdown file paths.
     * @param {string} owner - Repository owner
     * @param {string} name - Repository name
     * @param {string} path - Current directory path
     * @param {string} ref - Git ref/branch/commit
     * @param {string[]} results - Accumulator array for file paths
     * @returns {Promise<void>}
     */
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
