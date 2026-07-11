import { startHealthMonitor, subscribeHealth } from './shell-health.js';

const THEME_KEY = 'three-lans-theme-v1';
const VALID_THEMES = new Set(['system', 'light', 'dark']);
const media = window.matchMedia('(prefers-color-scheme: dark)');
let preference = readPreference();
let mediaListening = false;

function readPreference() {
    const value = document.documentElement.dataset.themePreference || localStorage.getItem(THEME_KEY) || 'system';
    return VALID_THEMES.has(value) ? value : 'system';
}

function resolveTheme(value) {
    return value === 'system' ? (media.matches ? 'dark' : 'light') : value;
}

function handleSystemThemeChange() {
    if (preference === 'system') applyTheme('system', false);
}

function syncMediaListener() {
    if (preference === 'system' && !mediaListening) {
        media.addEventListener('change', handleSystemThemeChange);
        mediaListening = true;
    } else if (preference !== 'system' && mediaListening) {
        media.removeEventListener('change', handleSystemThemeChange);
        mediaListening = false;
    }
}

function applyTheme(nextPreference, persist = true) {
    preference = VALID_THEMES.has(nextPreference) ? nextPreference : 'system';
    const root = document.documentElement;
    root.dataset.themePreference = preference;
    root.dataset.theme = resolveTheme(preference);
    if (persist) localStorage.setItem(THEME_KEY, preference);
    syncMediaListener();
    document.querySelectorAll('[data-theme-option]').forEach((option) => {
        option.setAttribute('aria-checked', option.dataset.themeOption === preference ? 'true' : 'false');
    });
    window.dispatchEvent(new CustomEvent('three-lans:theme-change', {
        detail: { preference, theme: root.dataset.theme }
    }));
}

function closeThemeMenu(button, menu, restoreFocus = false) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
}

function mountThemeControl() {
    if (document.documentElement.classList.contains('kh-embed') || document.querySelector('[data-theme-control]')) return;
    const host = document.createElement('div');
    host.className = 'theme-control-host';
    host.dataset.themeControl = '';
    host.innerHTML = `
        <button class="ui-icon-button" type="button" aria-label="主题" aria-haspopup="menu" aria-expanded="false" data-tooltip="主题">
            <i data-lucide="sun-moon" aria-hidden="true"></i>
        </button>
        <div class="ui-menu theme-menu" role="menu" aria-label="主题选择" hidden>
            <button class="ui-menu-item" type="button" role="menuitemradio" data-theme-option="system"><i data-lucide="monitor" aria-hidden="true"></i>跟随系统</button>
            <button class="ui-menu-item" type="button" role="menuitemradio" data-theme-option="light"><i data-lucide="sun" aria-hidden="true"></i>浅色</button>
            <button class="ui-menu-item" type="button" role="menuitemradio" data-theme-option="dark"><i data-lucide="moon" aria-hidden="true"></i>深色</button>
        </div>`;
    (document.querySelector('.app-sidebar-footer') || document.querySelector('[data-shell-actions]') || document.body).appendChild(host);

    const button = host.querySelector('[aria-haspopup="menu"]');
    const menu = host.querySelector('[role="menu"]');
    const options = [...host.querySelectorAll('[data-theme-option]')];
    button.addEventListener('click', () => {
        const opening = menu.hidden;
        menu.hidden = !opening;
        button.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) options.find((item) => item.dataset.themeOption === preference)?.focus();
    });
    options.forEach((option) => option.addEventListener('click', () => {
        applyTheme(option.dataset.themeOption);
        closeThemeMenu(button, menu, true);
    }));
    menu.addEventListener('keydown', (event) => {
        const index = options.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            closeThemeMenu(button, menu, true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            options[(index + delta + options.length) % options.length].focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            options[event.key === 'Home' ? 0 : options.length - 1].focus();
        }
    });
    document.addEventListener('pointerdown', (event) => {
        if (!host.contains(event.target)) closeThemeMenu(button, menu);
    });
    applyTheme(preference, false);
    window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function getActiveNavKey() {
    const url = new URL(window.location.href);
    if (url.pathname === '/' || url.pathname.endsWith('/index.html')) {
        return url.searchParams.get('view') === 'library' ? 'library' : 'workspace';
    }
    if (url.pathname.endsWith('/knowledge-hub.html')) {
        return url.searchParams.get('mode') === 'review' ? 'review' : 'knowledge-hub';
    }
    if (url.pathname.endsWith('/dashboard.html')) return 'mission-control';
    if (url.pathname.endsWith('/knowledge-ops.html')) return 'knowledge-ops';
    return '';
}

function navLink({ key, href, icon, label }, activeKey) {
    const current = key === activeKey ? ' aria-current="page"' : '';
    return `<a class="app-nav-link" href="${href}" data-nav-key="${key}" data-tooltip="${label}"${current}><i data-lucide="${icon}" aria-hidden="true"></i><span class="app-nav-label">${label}</span></a>`;
}

function closeNavigation(sidebar, toggle, backdrop, restoreFocus = false) {
    document.body.classList.remove('shell-nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
    sidebar.setAttribute('aria-hidden', window.matchMedia('(max-width: 768px)').matches ? 'true' : 'false');
    sidebar.inert = window.matchMedia('(max-width: 768px)').matches;
    if (restoreFocus) toggle.focus();
}

function mountShellNavigation() {
    if (document.documentElement.classList.contains('kh-embed')) return;
    const sidebar = document.getElementById('appSidebarMount');
    if (!sidebar || sidebar.dataset.mounted === 'true') return;
    sidebar.dataset.mounted = 'true';
    const activeKey = getActiveNavKey();
    const learning = [
        { key: 'workspace', href: '/', icon: 'layout-dashboard', label: '学习工作台' },
        { key: 'library', href: '/?view=library', icon: 'library', label: '卡片库' },
        { key: 'review', href: '/knowledge-hub.html?mode=review', icon: 'calendar-check', label: '今日复习' },
        { key: 'knowledge-hub', href: '/knowledge-hub.html', icon: 'network', label: '知识空间' }
    ];
    const system = [
        { key: 'mission-control', href: '/dashboard.html', icon: 'gauge', label: 'Mission Control' },
        { key: 'knowledge-ops', href: '/knowledge-ops.html', icon: 'workflow', label: 'Knowledge OPS' }
    ];
    sidebar.innerHTML = `
        <div class="app-sidebar-inner">
            <a class="app-brand" href="/" aria-label="Three LANS 学习工作台">
                <span class="lans-rail" aria-hidden="true"><span></span><span></span><span></span></span>
                <span class="app-brand-copy"><span class="app-brand-name">Three LANS</span><span class="app-brand-subtitle">安静学习工作台</span></span>
            </a>
            <nav class="app-nav" aria-label="应用导航">
                <section class="app-nav-group"><h2 class="app-nav-heading">学习</h2>${learning.map((item) => navLink(item, activeKey)).join('')}</section>
                <section class="app-nav-group"><h2 class="app-nav-heading">系统</h2>${system.map((item) => navLink(item, activeKey)).join('')}</section>
            </nav>
            <div class="app-sidebar-footer">
                <div class="app-health-summary" data-shell-health><span class="ui-status-dot" data-state="loading"></span><span class="app-health-label">正在检查服务</span></div>
            </div>
        </div>`;

    const toggle = document.createElement('button');
    toggle.className = 'ui-icon-button app-nav-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', '打开主导航');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<i data-lucide="menu" aria-hidden="true"></i>';
    const backdrop = document.createElement('div');
    backdrop.className = 'app-nav-backdrop';
    backdrop.hidden = true;
    document.body.append(toggle, backdrop);

    const openNavigation = () => {
        document.body.classList.add('shell-nav-open');
        toggle.setAttribute('aria-expanded', 'true');
        backdrop.hidden = false;
        sidebar.setAttribute('aria-hidden', 'false');
        sidebar.inert = false;
        sidebar.querySelector('[aria-current="page"], a, button')?.focus();
    };
    toggle.addEventListener('click', () => {
        if (document.body.classList.contains('shell-nav-open')) closeNavigation(sidebar, toggle, backdrop, true);
        else openNavigation();
    });
    backdrop.addEventListener('click', () => closeNavigation(sidebar, toggle, backdrop, true));
    document.addEventListener('keydown', (event) => {
        if (!document.body.classList.contains('shell-nav-open')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeNavigation(sidebar, toggle, backdrop, true);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
    const syncViewport = () => {
        if (!window.matchMedia('(max-width: 768px)').matches) closeNavigation(sidebar, toggle, backdrop);
        else if (!document.body.classList.contains('shell-nav-open')) {
            sidebar.setAttribute('aria-hidden', 'true');
            sidebar.inert = true;
        }
    };
    window.addEventListener('resize', syncViewport, { passive: true });
    syncViewport();
    window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function mountAppShell() {
    mountShellNavigation();
    mountThemeControl();
    if (!document.documentElement.classList.contains('kh-embed')) {
        subscribeHealth((health) => {
            const summary = document.querySelector('[data-shell-health]');
            if (!summary) return;
            const dot = summary.querySelector('.ui-status-dot');
            const label = summary.querySelector('.app-health-label');
            if (dot) dot.dataset.state = health.state;
            if (label) label.textContent = health.label;
        });
        startHealthMonitor();
    }
}

window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) applyTheme(VALID_THEMES.has(event.newValue) ? event.newValue : 'system', false);
});

applyTheme(preference, false);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAppShell, { once: true });
else mountAppShell();

export { applyTheme, resolveTheme };
