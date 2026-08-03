import { FileJson2, Search } from 'lucide-react';
import { useState } from 'react';

export function TextbookIntakeTools({
  search,
  results,
  onSearch,
  onSelectResult,
  onDryRun,
  onImport,
  busy,
  message,
}: {
  search: string;
  results: Array<{ id: number; track_id: number; official_en_text: string; official_ja_text: string }>;
  onSearch: (value: string) => void;
  onSelectResult: (trackId: number) => void;
  onDryRun: (payload: { manifestRelativePath: string; expectedManifestHash: string }) => void;
  onImport: (payload: { manifestRelativePath: string; expectedManifestHash: string }) => void;
  busy: boolean;
  message: string;
}) {
  const [manifestRelativePath, setManifestRelativePath] = useState('');
  const [expectedManifestHash, setExpectedManifestHash] = useState('');
  const valid = Boolean(manifestRelativePath.trim() && /^[a-f0-9]{64}$/u.test(expectedManifestHash));
  const payload = { manifestRelativePath: manifestRelativePath.trim(), expectedManifestHash };
  return (
    <section className="textbook-intake-tools">
      <label>
        <Search aria-hidden="true" />
        <span>搜索教材表达</span>
        <input value={search} placeholder="搜索英文、日文或中文提示" onChange={(event) => onSearch(event.target.value)} />
      </label>
      {search.trim().length >= 2 && (
        <div className="textbook-search-results">
          {results.slice(0, 5).map((result) => (
            <button key={result.id} type="button" onClick={() => onSelectResult(result.track_id)}>
              <strong>{result.official_en_text}</strong><span>{result.official_ja_text}</span>
            </button>
          ))}
          {!results.length && <span>没有匹配表达。</span>}
        </div>
      )}
      <details>
        <summary><FileJson2 aria-hidden="true" />高级导入工具</summary>
        <p>仅供受控恢复使用。正常流程由 Codex Skill 在用户批准 dry-run 后调用正式 import API。</p>
        <label>Manifest relative path<input value={manifestRelativePath} onChange={(event) => setManifestRelativePath(event.target.value)} /></label>
        <label>Expected SHA-256<input value={expectedManifestHash} onChange={(event) => setExpectedManifestHash(event.target.value.toLowerCase())} /></label>
        <div><button type="button" disabled={!valid || busy} onClick={() => onDryRun(payload)}>Dry-run</button><button className="primary" type="button" disabled={!valid || busy} onClick={() => onImport(payload)}>Import draft</button></div>
        {message && <small>{message}</small>}
      </details>
    </section>
  );
}
