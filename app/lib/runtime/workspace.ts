import { requestJson } from '../api/client';

export type WorkspaceRuntime = {
  version: number;
  mode: 'owner' | 'sandbox';
  label: string;
  access: 'read-write' | 'read-only';
  exposure: 'local' | 'private' | 'public';
  protection: 'local-only' | 'external-gateway' | 'dedicated-process-storage';
  workspaceId: string | null;
  retentionHours: number | null;
  expiresAtUtc: string | null;
  resetSupported: boolean;
  capabilities: {
    read: boolean;
    write: boolean;
    highCostOperations: boolean;
    durableHistory: boolean;
    ownerData: boolean;
  };
};

export type SandboxQuotaValue = {
  used: number;
  limit: number;
  remaining: number;
};

export type SandboxRuntime = {
  expiresAtUtc: string | null;
  resetSupported: boolean;
  quota: {
    resetAtUtc: string | null;
    categories: {
      generation: SandboxQuotaValue;
      ocr: SandboxQuotaValue;
      tts: SandboxQuotaValue;
    };
    storage: {
      usedBytes: number;
      limitBytes: number;
      remainingBytes: number;
    };
  } | null;
};

export type RuntimeDescriptor = {
  success: true;
  workspace: WorkspaceRuntime;
  sandbox: SandboxRuntime | null;
  build: {
    version: string;
    commit: string | null;
    builtAtUtc: string | null;
  };
  support: {
    feedbackUrl: string | null;
  };
  observability?: {
    uiPerformance: {
      enabled: boolean;
      sampleRate: number;
    };
  };
  serverTimeUtc: string;
};

export const workspaceRuntimeApi = {
  get: () => requestJson<RuntimeDescriptor>('/api/runtime'),
  resetSandbox: () => requestJson<{ success: true; reset: boolean; reload: string }>(
    '/api/sandbox/reset',
    {
      method: 'POST',
      headers: { 'X-Sandbox-Action': 'reset' },
    }
  ),
};
