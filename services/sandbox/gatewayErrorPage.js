'use strict';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeSupportUrl(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    return ['https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function gatewayErrorDescriptor(error) {
  const status = Number(error?.status) || 502;
  const capacity = status === 503 || error?.code === 'SANDBOX_CAPACITY_FULL';
  return {
    status: capacity ? 503 : 502,
    code: capacity ? 'SANDBOX_CAPACITY_FULL' : String(error?.code || 'SANDBOX_START_FAILED'),
    eyebrow: capacity ? '公开体验 · 当前繁忙' : '公开体验 · 启动失败',
    title: capacity ? '体验空间暂时已满' : '暂时无法准备体验空间',
    description: capacity
      ? '当前可用的独立沙箱都在使用中。个人工作区没有被连接或共享，请稍后再试。'
      : '系统没有完成独立沙箱的准备，因此停止了本次访问。个人数据不会作为降级方案暴露。',
    recovery: capacity
      ? '通常等待几分钟后即可重新进入。'
      : '请重新尝试；如果问题持续出现，可以提交错误编号。',
    retryAfterSeconds: capacity ? 30 : 10,
  };
}

function renderGatewayErrorPage(error, options = {}) {
  const descriptor = gatewayErrorDescriptor(error);
  const feedbackUrl = safeSupportUrl(options.feedbackUrl);
  const support = feedbackUrl
    ? `<a class="secondary" href="${escapeHtml(feedbackUrl)}">提交问题</a>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(descriptor.title)} · Three LANS</title>
<style>
:root{font-family:Inter,"Noto Sans SC","PingFang SC",system-ui,sans-serif;color-scheme:light;--canvas:#f7f8fa;--surface:#fff;--text:#172033;--muted:#566074;--border:#dde2e9;--primary:#2563eb;--subtle:#eaf1ff;--danger:#c43b4d;--danger-subtle:#fff0f2}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px;background:var(--canvas);color:var(--text)}
.shell{width:min(680px,100%);display:grid;grid-template-columns:48px minmax(0,1fr);gap:18px;padding:32px;border:1px solid var(--border);border-radius:8px;background:var(--surface);box-shadow:0 14px 36px rgb(23 32 51 / .10)}
.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:8px;background:var(--danger-subtle);color:var(--danger);font-size:24px;font-weight:800}
.eyebrow{margin:0;color:var(--danger);font:700 12px/1.4 ui-monospace,SFMono-Regular,monospace;text-transform:uppercase}
h1{margin:6px 0 0;font-size:26px;line-height:1.25;letter-spacing:0}p{margin:10px 0 0;color:var(--muted);font-size:14px;line-height:1.65}
.actions{grid-column:2;display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}.actions a{min-height:40px;display:inline-flex;align-items:center;justify-content:center;padding:0 15px;border:1px solid var(--border);border-radius:6px;color:var(--text);background:var(--surface);font-weight:750;text-decoration:none}.actions .primary{border-color:var(--primary);color:#fff;background:var(--primary)}
.code{grid-column:2;margin:2px 0 0;color:var(--muted);font:500 12px/1.4 ui-monospace,SFMono-Regular,monospace}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--canvas:#15181d;--surface:#1d2128;--text:#f2f4f7;--muted:#c1c8d2;--border:#343b46;--primary:#78a8ff;--subtle:#23334f;--danger:#ff8794;--danger-subtle:#48242b}.actions .primary{color:#14171c}}
@media(prefers-reduced-motion:no-preference){.shell{animation:arrive .18s ease-out}@keyframes arrive{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}
</style>
</head>
<body>
<main class="shell" role="alert">
  <div class="mark" aria-hidden="true">!</div>
  <div>
    <p class="eyebrow">${escapeHtml(descriptor.eyebrow)}</p>
    <h1>${escapeHtml(descriptor.title)}</h1>
    <p>${escapeHtml(descriptor.description)}</p>
    <p>${escapeHtml(descriptor.recovery)}</p>
  </div>
  <div class="actions"><a class="primary" href="/">重新尝试</a>${support}</div>
  <p class="code">错误编号：${escapeHtml(descriptor.code)}</p>
</main>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  gatewayErrorDescriptor,
  renderGatewayErrorPage,
  safeSupportUrl,
};
