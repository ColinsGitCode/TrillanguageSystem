/**
 * Pure formatting / escaping helpers for the dashboard-family pages.
 *
 * Extracted verbatim from dashboard.js to trim the monolith. These are the
 * display-tuned variants used across Mission Control / Knowledge OPS /
 * Knowledge Hub (e.g. escapeHtml returns "-" for null so empty table cells read
 * as a dash) and are intentionally distinct from the generic helpers in
 * utils.js — keep them here rather than merging to avoid changing output.
 */

// HTML-escape a value for text content; null/undefined render as "-".
export function escapeHtml(value) {
    if (value === null || value === undefined) return '-';
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

// HTML-escape a value for use inside an attribute (no quote→entity for ').
export function escapeHtmlAttr(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Fixed-digit number formatting; non-numeric renders as "-".
export function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return '-';
    return num.toFixed(digits);
}

// Relative "x ago" from an epoch-ms timestamp.
export function formatQueueTime(value) {
    const ts = Number(value || 0);
    if (!Number.isFinite(ts) || ts <= 0) return '-';
    const delta = Date.now() - ts;
    if (delta < 1000) return 'just now';
    if (delta < 60000) return `${Math.floor(delta / 1000)}s ago`;
    if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
    if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
    return `${Math.floor(delta / 86400000)}d ago`;
}

// Compact elapsed duration between two ISO timestamps (end defaults to now).
export function formatDuration(startedAt, finishedAt) {
    if (!startedAt) return '-';
    const startTs = Date.parse(startedAt);
    if (Number.isNaN(startTs)) return '-';
    const endTs = finishedAt ? Date.parse(finishedAt) : Date.now();
    if (Number.isNaN(endTs) || endTs <= startTs) return '-';
    const delta = endTs - startTs;
    if (delta < 1000) return `${delta}ms`;
    if (delta < 60000) return `${Math.round(delta / 1000)}s`;
    if (delta < 3600000) return `${Math.round(delta / 60000)}m`;
    return `${Math.round(delta / 3600000)}h`;
}
