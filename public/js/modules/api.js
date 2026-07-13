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
                const err = new Error(data.error + (detail ? ` (${detail})` : ''));
                err.status = res.status;
                err.payload = data;
                if (typeof data.retry_after_ms === 'number') {
                    err.retryAfterMs = data.retry_after_ms;
                }
                throw err;
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

    async generate(phrase, options = {}) {
        const payload = { phrase };

        if (options.targetFolder) payload.target_folder = options.targetFolder;
        if (options.cardType) payload.card_type = options.cardType;
        if (options.sourceMode) payload.source_mode = options.sourceMode;

        return this.fetchJson('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async createGenerationJob(payload = {}) {
        return this.fetchJson('/api/generation-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async listGenerationJobs(limit = 30) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/generation-jobs?${params.toString()}`);
    }

    async getGenerationJob(id, options = {}) {
        const params = new URLSearchParams();
        if (options.includeEvents !== undefined) {
            params.set('includeEvents', options.includeEvents ? '1' : '0');
        }
        if (options.eventLimit !== undefined) {
            params.set('eventLimit', String(options.eventLimit));
        }
        const query = params.toString();
        return this.fetchJson(`/api/generation-jobs/${encodeURIComponent(id)}${query ? `?${query}` : ''}`);
    }

    async getGenerationJobSummary() {
        return this.fetchJson('/api/generation-jobs/summary');
    }

    async getGenerationJobEvents(jobId, limit = 20) {
        const params = new URLSearchParams();
        if (jobId) params.set('jobId', String(jobId));
        params.set('limit', String(limit));
        return this.fetchJson(`/api/generation-jobs/events?${params.toString()}`);
    }

    async retryGenerationJob(id) {
        return this.fetchJson(`/api/generation-jobs/${encodeURIComponent(id)}/retry`, {
            method: 'POST'
        });
    }

    async clearCompletedGenerationJobs() {
        return this.fetchJson('/api/generation-jobs/clear-done', {
            method: 'POST'
        });
    }

    async cancelGenerationJob(id) {
        return this.fetchJson(`/api/generation-jobs/${encodeURIComponent(id)}/cancel`, {
            method: 'POST'
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

    async getCardHighlight(folder, base, sourceHash) {
        const url = `/api/highlights/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(base)}&sourceHash=${encodeURIComponent(sourceHash)}`;
        return this.fetchJson(url);
    }

    async saveCardHighlight(payload = {}) {
        return this.fetchJson('/api/highlights/by-file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async deleteCardHighlight(folder, base, sourceHash = '') {
        const params = new URLSearchParams({
            folder: String(folder || ''),
            base: String(base || '')
        });
        if (sourceHash) params.set('sourceHash', sourceHash);
        return this.fetchJson(`/api/highlights/by-file?${params.toString()}`, { method: 'DELETE' });
    }

    async checkHealth() {
        return this.fetchJson('/api/health');
    }
}

export const api = new ApiService();
