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
}

export const api = new ApiService();
