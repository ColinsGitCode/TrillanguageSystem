/**
 * API 请求模块
 */
import { withNoCache } from './utils.js';

class ApiService {
    async fetchJson(url, options = {}) {
        try {
            const res = await fetch(url, options);
            const data = await res.json();
            
            if (!res.ok) {
                const detail = data.details && Array.isArray(data.details) ? data.details.join('；') : '';
                throw new Error(data.error + (detail ? ` (${detail})` : ''));
            }
            return data;
        } catch (error) {
            console.error(`[API] ${url} failed:`, error);
            throw error;
        }
    }

    async getFolders(noCache = false) {
        return this.fetchJson(withNoCache('/api/folders', noCache), {
            cache: noCache ? 'no-store' : 'default'
        });
    }

    async getFiles(folder, noCache = false) {
        const url = `/api/folders/${encodeURIComponent(folder)}/files`;
        return this.fetchJson(withNoCache(url, noCache), {
            cache: noCache ? 'no-store' : 'default'
        });
    }

    async getFileContent(folder, filename) {
        const url = `/api/folders/${encodeURIComponent(folder)}/files/${encodeURIComponent(filename)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('File not found');
        return res.text(); // Return text (Markdown/HTML)
    }

    async generate(phrase, provider, enableCompare = false) {
        return this.fetchJson('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phrase,
                llm_provider: provider,
                enable_compare: enableCompare
            })
        });
    }

    async ocr(image) {
        // 支持 Base64 上传（保持兼容性）
        return this.fetchJson('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image })
        });
    }

    async getHistory(params = {}, noCache = false) {
        const query = new URLSearchParams(params).toString();
        const url = withNoCache(`/api/history?${query}`, noCache);
        return this.fetchJson(url, { cache: noCache ? 'no-store' : 'default' });
    }

    async getHistoryDetail(id) {
        return this.fetchJson(`/api/history/${id}`);
    }
    
    async deleteRecord(id) {
        return this.fetchJson(`/api/records/${id}`, { method: 'DELETE' });
    }

    async getRecordByFile(folder, base) {
        const url = `/api/records/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(base)}`;
        return this.fetchJson(url);
    }

    async deleteRecordByFile(folder, base) {
        const url = `/api/records/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(base)}`;
        return this.fetchJson(url, { method: 'DELETE' });
    }

    async checkHealth() {
        return this.fetchJson('/api/health');
    }
}

export const api = new ApiService();
