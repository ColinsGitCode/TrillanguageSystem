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
    (document.querySelector('[data-shell-actions]') || document.body).appendChild(host);

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

window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) applyTheme(VALID_THEMES.has(event.newValue) ? event.newValue : 'system', false);
});

applyTheme(preference, false);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountThemeControl, { once: true });
else mountThemeControl();

export { applyTheme, resolveTheme };
