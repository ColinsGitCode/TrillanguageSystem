/**
 * 通用工具函数模块
 */

// HTML 转义
export function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// HTML 净化与安全处理
export function sanitizeHtml(html) {
    if (window.DOMPurify) {
        return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            ADD_TAGS: ['audio', 'source', 'ruby', 'rt', 'rp'],
            ADD_ATTR: ['class', 'src', 'data-audio-src', 'preload', 'controls', 'href', 'title', 'alt', 'aria-label'],
        });
    }
    return html;
}

// URL 缓存清除
export function withNoCache(url, noCache) {
    if (!noCache) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_ts=${Date.now()}`;
}

// 时间格式化 (ms -> mm:ss)
export function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// 防抖函数
export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 格式化日期时间
export function formatDate(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
