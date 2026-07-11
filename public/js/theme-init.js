(() => {
    const key = 'three-lans-theme-v1';
    const valid = new Set(['system', 'light', 'dark']);
    let preference = 'system';
    try { preference = localStorage.getItem(key) || 'system'; } catch (error) {}
    if (!valid.has(preference)) preference = 'system';
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
})();
