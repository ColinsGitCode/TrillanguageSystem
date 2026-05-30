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

    async getGeminiAuthStatus() {
        return this.fetchJson('/api/gemini/auth/status');
    }

    async startGeminiAuth() {
        return this.fetchJson('/api/gemini/auth/start', { method: 'POST' });
    }

    async submitGeminiAuth(code) {
        return this.fetchJson('/api/gemini/auth/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
    }

    async cancelGeminiAuth() {
        return this.fetchJson('/api/gemini/auth/cancel', { method: 'POST' });
    }

    async startKnowledgeJob(payload = {}) {
        return this.fetchJson('/api/knowledge/jobs/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async getKnowledgeJobs(limit = 20) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/jobs?${params.toString()}`);
    }

    async getKnowledgeJob(id) {
        return this.fetchJson(`/api/knowledge/jobs/${encodeURIComponent(id)}`);
    }

    async cancelKnowledgeJob(id) {
        return this.fetchJson(`/api/knowledge/jobs/${encodeURIComponent(id)}/cancel`, {
            method: 'POST'
        });
    }

    async getKnowledgeSummaryLatest() {
        return this.fetchJson('/api/knowledge/summary/latest');
    }

    async getKnowledgeOverview(limit = 8) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/overview?${params.toString()}`);
    }

    async getKnowledgeIndex(params = {}) {
        const query = new URLSearchParams();
        if (params.query) query.set('query', String(params.query));
        if (params.limit) query.set('limit', String(params.limit));
        const suffix = query.toString();
        return this.fetchJson(`/api/knowledge/index${suffix ? `?${suffix}` : ''}`);
    }

    async getKnowledgeBaseOverview(topTagLimit = 20) {
        const params = new URLSearchParams();
        params.set('topTagLimit', String(topTagLimit));
        return this.fetchJson(`/api/knowledge/base/overview?${params.toString()}`);
    }

    async listKnowledgeBaseTerms(params = {}) {
        const query = new URLSearchParams();
        if (params.query) query.set('query', String(params.query));
        if (params.langProfile && params.langProfile !== 'all') query.set('langProfile', String(params.langProfile));
        if (params.cardType && params.cardType !== 'all') query.set('cardType', String(params.cardType));
        if (params.tag) query.set('tag', String(params.tag));
        if (params.uncategorized) query.set('uncategorized', '1');
        else if (params.category && params.category !== 'all') query.set('category', String(params.category));
        if (params.sort) query.set('sort', String(params.sort));
        query.set('page', String(params.page || 1));
        query.set('pageSize', String(params.pageSize || 20));
        return this.fetchJson(`/api/knowledge/base/terms?${query.toString()}`);
    }

    async getKnowledgeBaseCategories(taxonomy = 'all') {
        const query = new URLSearchParams();
        query.set('taxonomy', String(taxonomy || 'all'));
        return this.fetchJson(`/api/knowledge/base/categories?${query.toString()}`);
    }

    async getSrsQueue(params = {}) {
        const query = new URLSearchParams();
        query.set('limit', String(params.limit || 20));
        if (params.cardType && params.cardType !== 'all') query.set('cardType', String(params.cardType));
        return this.fetchJson(`/api/srs/queue?${query.toString()}`);
    }

    async getSrsStats() {
        return this.fetchJson('/api/srs/stats');
    }

    async reviewSrs(generationId, grade) {
        return this.fetchJson('/api/srs/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ generationId: Number(generationId), grade: String(grade) })
        });
    }

    async getKnowledgeSynonyms(phrase, limit = 20) {
        const query = new URLSearchParams();
        query.set('phrase', String(phrase || ''));
        query.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/synonyms?${query.toString()}`);
    }

    async listKnowledgeSynonymBoundaries(params = {}) {
        const query = new URLSearchParams();
        if (params.page) query.set('page', String(params.page));
        if (params.pageSize) query.set('pageSize', String(params.pageSize));
        if (params.jobId) query.set('jobId', String(params.jobId));
        if (params.riskLevel) query.set('riskLevel', String(params.riskLevel));
        if (params.query) query.set('query', String(params.query));
        return this.fetchJson(`/api/knowledge/synonyms/list?${query.toString()}`);
    }

    async getKnowledgeSynonymBoundaryDetail(pairKey, params = {}) {
        const query = new URLSearchParams();
        if (params.jobId) query.set('jobId', String(params.jobId));
        const suffix = query.toString();
        return this.fetchJson(`/api/knowledge/synonyms/${encodeURIComponent(pairKey)}${suffix ? `?${suffix}` : ''}`);
    }

    async getKnowledgeGrammar(params = {}) {
        const query = new URLSearchParams();
        if (params.pattern) query.set('pattern', String(params.pattern));
        if (params.limit) query.set('limit', String(params.limit));
        const suffix = query.toString();
        return this.fetchJson(`/api/knowledge/grammar${suffix ? `?${suffix}` : ''}`);
    }

    async getKnowledgeClusters(limit = 20) {
        const query = new URLSearchParams();
        query.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/clusters?${query.toString()}`);
    }

    async getKnowledgeIssues(params = {}) {
        const query = new URLSearchParams();
        if (params.issueType) query.set('issueType', String(params.issueType));
        if (params.severity) query.set('severity', String(params.severity));
        if (params.resolved !== undefined) query.set('resolved', params.resolved ? 'true' : 'false');
        if (params.limit) query.set('limit', String(params.limit));
        const suffix = query.toString();
        return this.fetchJson(`/api/knowledge/issues${suffix ? `?${suffix}` : ''}`);
    }

    async getKnowledgeCardRelations(generationId, limit = 12) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/cards/${encodeURIComponent(generationId)}/relations?${params.toString()}`);
    }

    async getKnowledgeTermRelations(term, limit = 20) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/terms/${encodeURIComponent(term)}/relations?${params.toString()}`);
    }

    async getKnowledgePatternRelations(pattern, limit = 20) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/patterns/${encodeURIComponent(pattern)}/relations?${params.toString()}`);
    }

    async getKnowledgeClusterRelations(clusterKey, limit = 20) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        return this.fetchJson(`/api/knowledge/clusters/${encodeURIComponent(clusterKey)}/relations?${params.toString()}`);
    }
}

export const api = new ApiService();
