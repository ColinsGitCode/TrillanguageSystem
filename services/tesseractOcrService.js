require('dotenv').config();

const OCR_TESSERACT_ENDPOINT = process.env.OCR_TESSERACT_ENDPOINT || 'http://ocr:8080/ocr';
const OCR_LANGS = process.env.OCR_LANGS || 'eng+jpn+chi_sim';
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 20000);

async function recognizeImage(image, options = {}) {
  if (!image) throw new Error('No image provided');

  const langs = options.langs || OCR_LANGS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    const response = await fetch(OCR_TESSERACT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, langs }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.detail || payload?.error || `status ${response.status}`;
      throw new Error(`Tesseract OCR Error (${response.status}): ${detail}`);
    }

    return String(payload?.text || '').trim();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Tesseract OCR timeout after ${OCR_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { recognizeImage };
