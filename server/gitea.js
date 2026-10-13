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
}

export { Gitea };
