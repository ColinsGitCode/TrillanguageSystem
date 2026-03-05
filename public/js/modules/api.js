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

    async generate(phrase, provider, enableCompare = false, options = {}) {
        let compareFlag = enableCompare;
        let extra = options || {};

        if (typeof enableCompare === 'object' && enableCompare !== null) {
            extra = enableCompare;
            compareFlag = Boolean(enableCompare.enableCompare);
        }

        const payload = {
            phrase,
            llm_provider: provider,
            enable_compare: Boolean(compareFlag)
        };

        if (extra.targetFolder) payload.target_folder = extra.targetFolder;
        if (extra.llmModel) payload.llm_model = extra.llmModel;
        if (extra.cardType) payload.card_type = extra.cardType;
        if (extra.sourceMode) payload.source_mode = extra.sourceMode;
        if (extra.experimentId) payload.experiment_id = extra.experimentId;
        if (extra.experimentRound !== undefined) payload.experiment_round = extra.experimentRound;
        if (extra.roundName) payload.round_name = extra.roundName;
        if (extra.variant) payload.variant = extra.variant;
        if (extra.isTeacherReference !== undefined) payload.is_teacher_reference = Boolean(extra.isTeacherReference);
        if (extra.fewshotOptions && typeof extra.fewshotOptions === 'object') {
            payload.fewshot_options = extra.fewshotOptions;
        }

        return this.fetchJson('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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

    async getActiveReviewCampaign() {
        return this.fetchJson('/api/review/campaigns/active');
    }

    async createReviewCampaign(payload = {}) {
        return this.fetchJson('/api/review/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async getReviewCampaignProgress(campaignId) {
        return this.fetchJson(`/api/review/campaigns/${encodeURIComponent(campaignId)}/progress`);
    }

    async finalizeReviewCampaign(campaignId, payload = {}) {
        return this.fetchJson(`/api/review/campaigns/${encodeURIComponent(campaignId)}/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async rollbackReviewCampaign(campaignId) {
        return this.fetchJson(`/api/review/campaigns/${encodeURIComponent(campaignId)}/rollback`, {
            method: 'POST'
        });
    }

    async getGenerationReviewExamples(generationId, params = {}) {
        const query = new URLSearchParams(params).toString();
        const suffix = query ? `?${query}` : '';
        return this.fetchJson(`/api/review/generations/${encodeURIComponent(generationId)}/examples${suffix}`);
    }

    async submitExampleReview(exampleId, payload = {}) {
        return this.fetchJson(`/api/review/examples/${encodeURIComponent(exampleId)}/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    async backfillReviewExamples(limit = 0) {
        return this.fetchJson('/api/review/backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit })
        });
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
