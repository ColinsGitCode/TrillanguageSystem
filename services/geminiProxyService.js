async function runGeminiProxy(prompt, options = {}) {
  const {
    baseName = 'suggestion',
    model = options.model || '',
    url = process.env.GEMINI_PROXY_URL || 'http://host.docker.internal:3210/api/gemini'
  } = options;

  const payload = { prompt, baseName };
  if (String(model || '').trim()) {
    payload.model = String(model).trim();
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Gemini proxy error (${res.status})`);
  }

  return res.json();
}

module.exports = { runGeminiProxy };
