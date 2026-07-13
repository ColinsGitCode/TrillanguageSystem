const NOISE_LINE = /^[\s|¦•◆◇■□●○★☆※_=~\-—–·・]+$/u;

export function normalizeOcrText(text: string) {
  const raw = String(text || '').normalize('NFKC').replace(/\r\n?/g, '\n');
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/^[\s|¦•◆◇■□●○★☆※_=~]+|[\s|¦•◆◇■□●○★☆※_=~]+$/gu, '').trim())
    .filter((line) => line && !NOISE_LINE.test(line));
  const clean = lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/([\u3040-\u30ff\u3400-\u9fff々])\s+(?=[\u3040-\u30ff\u3400-\u9fff々])/gu, '$1')
    .trim();
  return {
    raw,
    clean,
    changed: clean !== raw.trim(),
  };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Image read failed'));
    reader.readAsDataURL(file);
  });
}
