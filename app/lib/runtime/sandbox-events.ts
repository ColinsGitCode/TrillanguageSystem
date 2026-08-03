export const SANDBOX_LIMIT_EVENT = 'three-lans:sandbox-limit';

export type SandboxLimitDetail = {
  code: 'SANDBOX_QUOTA_EXCEEDED' | 'SANDBOX_STORAGE_LIMIT';
  category: 'generation' | 'ocr' | 'tts' | 'storage' | null;
  message: string;
};

export function publishSandboxLimit(detail: SandboxLimitDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SandboxLimitDetail>(SANDBOX_LIMIT_EVENT, { detail }));
}
