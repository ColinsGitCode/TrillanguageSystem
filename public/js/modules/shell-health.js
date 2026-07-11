const HEALTH_INTERVAL_MS = 30_000;
const listeners = new Set();
let timerId = null;
let started = false;
let requestPromise = null;
let snapshot = Object.freeze({
    state: 'loading',
    label: '正在检查服务',
    services: [],
    updatedAt: null
});

function publish(next) {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => {
        try { listener(snapshot); } catch (error) { console.error('[ShellHealth] subscriber failed:', error); }
    });
}

function normalizeHealth(payload) {
    const services = Array.isArray(payload?.services) ? payload.services : [];
    const overall = String(payload?.system?.overallStatus || '').toLowerCase();
    const hasOffline = services.some((service) => String(service.status || '').toLowerCase() === 'offline');
    const hasDegraded = services.some((service) => String(service.status || '').toLowerCase() === 'degraded');
    const state = overall === 'online' && !hasOffline && !hasDegraded
        ? 'online'
        : (hasOffline || overall === 'offline' ? 'offline' : 'degraded');
    return {
        state,
        label: state === 'online' ? '服务正常' : state === 'degraded' ? '部分服务降级' : '服务异常',
        services,
        updatedAt: new Date().toISOString()
    };
}

async function refreshHealth() {
    if (requestPromise) return requestPromise;
    requestPromise = fetch('/api/health', { headers: { Accept: 'application/json' } })
        .then(async (response) => {
            if (!response.ok) throw new Error(`Health check failed (${response.status})`);
            const payload = await response.json();
            const next = normalizeHealth(payload);
            publish(next);
            return next;
        })
        .catch((error) => {
            const next = {
                state: 'offline',
                label: '无法获取服务状态',
                services: [],
                updatedAt: new Date().toISOString()
            };
            publish(next);
            console.warn('[ShellHealth] refresh failed:', error.message);
            return next;
        })
        .finally(() => { requestPromise = null; });
    return requestPromise;
}

function startHealthMonitor() {
    if (started) return refreshHealth();
    started = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshHealth();
    });
    timerId = window.setInterval(() => {
        if (!document.hidden) refreshHealth();
    }, HEALTH_INTERVAL_MS);
    return refreshHealth();
}

function getHealthSnapshot() {
    return snapshot;
}

function subscribeHealth(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot);
    return () => listeners.delete(listener);
}

export { getHealthSnapshot, refreshHealth, startHealthMonitor, subscribeHealth };
