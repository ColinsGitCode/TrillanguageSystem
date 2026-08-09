import {
  Bot,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  FileCheck2,
  HeartPulse,
  ShieldCheck,
  Volume2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { HealthResponse, HealthService } from '../../features/factory/types';
import type { RuntimeDescriptor } from '../../lib/runtime/workspace';
import type { ProductArea } from '../ProductShell';
import { useModalDrawer } from './useModalDrawer';

const PAGE_BOUNDARY: Record<ProductArea, string> = {
  factory: '生成任务离开页面后仍会继续，成功结果保留在卡片库和活动中心。',
  today: '只有成功提交的四档评分才进入今日学习统计。',
  plan: '调整范围不会删除历史评分；保存前会先显示真实影响。',
  history: '学习记录只统计已提交评分，不用卡片创建数量代替学习进度。',
  textbooks: '教材英日原文与官方音频来自用户提供；中文提示和单句语音属于派生内容。',
  knowledge: '待确认候选不会进入正式知识点或学习队列。',
  dictionary: '开放词典保持只读；人工词条以独立覆盖层保存，升级词典不会改写人工内容。',
};

function serviceList(health?: HealthResponse): HealthService[] {
  if (!health?.services) return [];
  return Array.isArray(health.services) ? health.services : Object.values(health.services);
}

function publicServiceName(name = '') {
  if (/deepseek/iu.test(name)) return 'AI 卡片生成';
  if (/storage/iu.test(name)) return '卡片与学习数据';
  if (/kokoro|english/iu.test(name)) return '英语朗读';
  if (/voicevox|japanese/iu.test(name)) return '日语朗读';
  if (/selection.*tts.*cache/iu.test(name)) return '选区朗读缓存';
  if (/ocr/iu.test(name)) return '图片识别';
  return name || '后台能力';
}

function statusLabel(status = '') {
  const normalized = status.toLowerCase();
  if (['online', 'healthy', 'ok'].includes(normalized)) return '正常';
  if (['degraded', 'warning', 'partial'].includes(normalized)) return '部分可用';
  if (['offline', 'error', 'unhealthy'].includes(normalized)) return '不可用';
  return '待确认';
}

function statusTone(status = '') {
  const normalized = status.toLowerCase();
  if (['online', 'healthy', 'ok'].includes(normalized)) return 'success';
  if (['offline', 'error', 'unhealthy'].includes(normalized)) return 'danger';
  return 'warning';
}

function formatBuildTime(value: string | null | undefined) {
  if (!value) return '未提供';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

export function WorkspaceInfoDrawer({
  open,
  onClose,
  triggerRef,
  active,
  pageTitle,
  path,
  runtime,
  health,
  healthError,
  healthRefreshing,
  onRetryHealth,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  active: ProductArea;
  pageTitle: string;
  path: string;
  runtime?: RuntimeDescriptor;
  health?: HealthResponse;
  healthError: boolean;
  healthRefreshing: boolean;
  onRetryHealth: () => void;
}) {
  const drawerRef = useModalDrawer({
    open,
    onClose,
    triggerRef,
    initialFocusSelector: '[data-info-initial-focus]',
  });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const services = useMemo(() => serviceList(health), [health]);
  const overallLabel = healthError
    ? '状态暂不可读'
    : services.some((service) => statusTone(service.status) === 'danger')
      ? '部分能力不可用'
      : services.some((service) => statusTone(service.status) === 'warning')
        ? '部分能力待确认'
        : '服务正常';

  if (!open) return null;

  const diagnostics = JSON.stringify({
    product: 'Three LANS',
    page: { title: pageTitle, path },
    workspace: runtime ? {
      mode: runtime.workspace.mode,
      access: runtime.workspace.access,
      exposure: runtime.workspace.exposure,
      protection: runtime.workspace.protection,
    } : null,
    build: runtime?.build || null,
    services: services.map((service) => ({
      name: publicServiceName(service.name),
      status: statusLabel(service.status),
    })),
    collectedAtUtc: new Date().toISOString(),
  }, null, 2);

  const copyDiagnostics = async () => {
    try {
      await copyText(diagnostics);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="shell-activity-backdrop" data-testid="workspace-info-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        ref={drawerRef}
        className="shell-activity-drawer shell-info-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shell-info-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">公开服务信息</p>
            <h2 id="shell-info-title">帮助与系统信息</h2>
            <small>{pageTitle}</small>
          </div>
          <button className="icon-button" type="button" aria-label="关闭帮助与系统信息" data-info-initial-focus onClick={onClose}><X aria-hidden="true" /></button>
        </header>

        <div className="shell-info-sections">
          <section>
            <h3><CircleHelp aria-hidden="true" /> 当前页面</h3>
            <strong>{pageTitle}</strong>
            <p>{PAGE_BOUNDARY[active]}</p>
          </section>

          <section>
            <div className="shell-info-section-heading">
              <h3><HeartPulse aria-hidden="true" /> 系统状态</h3>
              <button type="button" onClick={onRetryHealth} disabled={healthRefreshing}>
                {healthRefreshing ? '正在检查' : '重新检查'}
              </button>
            </div>
            <strong>{overallLabel}</strong>
            {services.length ? (
              <ul className="shell-info-services">
                {services.map((service, index) => (
                  <li key={`${service.name || 'service'}-${index}`}>
                    <span>{publicServiceName(service.name)}</span>
                    <small className={`is-${statusTone(service.status)}`}>{statusLabel(service.status)}</small>
                  </li>
                ))}
              </ul>
            ) : <p>现有学习内容仍可浏览；状态恢复后可重新检查生成和朗读能力。</p>}
          </section>

          <section>
            <h3><Bot aria-hidden="true" /> 内容与 AI 来源</h3>
            <dl className="shell-info-source-list">
              <div><dt>学习卡</dt><dd>DeepSeek 生成，属于 AI 内容，需要用户判断。</dd></div>
              <div><dt>教材课程</dt><dd>英日原文与整轨音频为用户提供；中文提示和单句语音为派生内容。</dd></div>
              <div><dt>知识点</dt><dd>确定性分析与人工确认是正式事实；待确认候选不会自动进入学习。</dd></div>
              <div><dt>朗读</dt><dd>英语使用 Kokoro，日语使用 VOICEVOX；教材官方音频单独标识。</dd></div>
            </dl>
          </section>

          <section>
            <h3><ShieldCheck aria-hidden="true" /> 工作区与版本</h3>
            <dl className="shell-info-runtime">
              <div><dt>工作区</dt><dd>{runtime?.workspace.label || '正在确认'}</dd></div>
              <div><dt>访问</dt><dd>{runtime?.workspace.access === 'read-only' ? '只读' : '可读写'}</dd></div>
              <div><dt>版本</dt><dd>{runtime?.build.version || '未提供'}</dd></div>
              <div><dt>Commit</dt><dd>{runtime?.build.commit?.slice(0, 12) || '未提供'}</dd></div>
              <div><dt>构建时间</dt><dd>{formatBuildTime(runtime?.build.builtAtUtc)}</dd></div>
            </dl>
          </section>

          <section>
            <h3><FileCheck2 aria-hidden="true" /> 问题反馈</h3>
            <p>诊断摘要只包含页面、工作区模式、公开服务状态和构建信息，不包含学习内容、服务器路径或密钥。</p>
            <div className="shell-info-actions">
              <button type="button" onClick={() => void copyDiagnostics()}>
                {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copyState === 'copied' ? '已复制诊断信息' : '复制诊断信息'}
              </button>
              {runtime?.support?.feedbackUrl && (
                <a href={runtime.support.feedbackUrl} target="_blank" rel="noreferrer">
                  提交问题 <ExternalLink aria-hidden="true" />
                </a>
              )}
            </div>
            {copyState === 'failed' && <small className="shell-info-copy-error" role="alert">复制失败，请允许浏览器访问剪贴板后重试。</small>}
          </section>
        </div>
      </aside>
    </div>
  );
}
