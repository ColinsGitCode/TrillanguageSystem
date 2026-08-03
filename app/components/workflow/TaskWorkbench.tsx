import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { WorkflowTask, WorkflowTaskState } from './workflow-types';
import { ContextTools } from './ContextTools';
import { TaskRail, type TaskRailFilterOption } from './TaskRail';

const DEFAULT_LAYOUT = { rail: 230, tools: 270 };
const RAIL_MIN = 180;
const RAIL_MAX = 360;
const TOOLS_MIN = 220;
const TOOLS_MAX = 420;
const DETAIL_MIN = 500;
const SPLITTER_SPACE = 16;

type WorkbenchLayout = typeof DEFAULT_LAYOUT;
type ResizeTarget = keyof WorkbenchLayout;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function layoutLimits(containerWidth: number, layout: WorkbenchLayout) {
  const available = Math.max(containerWidth - SPLITTER_SPACE, RAIL_MIN + TOOLS_MIN + DETAIL_MIN);
  const railMax = Math.max(RAIL_MIN, Math.min(RAIL_MAX, available - TOOLS_MIN - DETAIL_MIN));
  const rail = clamp(layout.rail, RAIL_MIN, railMax);
  const toolsMax = Math.max(TOOLS_MIN, Math.min(TOOLS_MAX, available - rail - DETAIL_MIN));
  return { railMax, toolsMax };
}

function constrainLayout(layout: WorkbenchLayout, containerWidth: number) {
  const { railMax } = layoutLimits(containerWidth, layout);
  const rail = clamp(layout.rail, RAIL_MIN, railMax);
  const { toolsMax } = layoutLimits(containerWidth, { ...layout, rail });
  return {
    rail,
    tools: clamp(layout.tools, TOOLS_MIN, toolsMax),
  };
}

export function TaskWorkbench({
  tasks,
  activeId,
  filter,
  onFilter,
  onSelect,
  children,
  tools,
  query,
  onQuery,
  searchPlaceholder,
  selectedIds,
  onToggleSelection,
  isSelectable,
  railToolbar,
  storageKey,
  filterOptions,
  stateLabels,
}: {
  tasks: WorkflowTask[];
  activeId: string | null;
  filter: 'all' | WorkflowTaskState;
  onFilter: (filter: 'all' | WorkflowTaskState) => void;
  onSelect: (id: string) => void;
  children: React.ReactNode;
  tools?: React.ReactNode;
  query?: string;
  onQuery?: (query: string) => void;
  searchPlaceholder?: string;
  selectedIds?: ReadonlySet<string>;
  onToggleSelection?: (id: string) => void;
  isSelectable?: (task: WorkflowTask) => boolean;
  railToolbar?: React.ReactNode;
  storageKey?: string;
  filterOptions?: ReadonlyArray<TaskRailFilterOption>;
  stateLabels?: Partial<Record<WorkflowTaskState, string>>;
}) {
  const workbenchRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [containerWidth, setContainerWidth] = useState(1100);
  const [layout, setLayout] = useState<WorkbenchLayout>(DEFAULT_LAYOUT);
  const [storageLoaded, setStorageLoaded] = useState(!storageKey);

  useEffect(() => {
    if (!storageKey) {
      setStorageLoaded(true);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`three-lans:workflow-layout:${storageKey}`) || 'null');
      if (Number.isFinite(saved?.rail) && Number.isFinite(saved?.tools)) {
        const width = workbenchRef.current?.getBoundingClientRect().width || 1100;
        setLayout(constrainLayout({ rail: saved.rail, tools: saved.tools }, width));
      }
    } catch {
      // Invalid browser preferences fall back to the safe desktop defaults.
    } finally {
      setStorageLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !storageLoaded) return;
    localStorage.setItem(`three-lans:workflow-layout:${storageKey}`, JSON.stringify(layout));
  }, [layout, storageKey, storageLoaded]);

  useEffect(() => {
    const node = workbenchRef.current;
    if (!node) return undefined;
    const applyWidth = (width: number) => {
      setContainerWidth(width);
      setLayout((current) => constrainLayout(current, width));
    };
    applyWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => applyWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const resizeTo = (target: ResizeTarget, value: number) => {
    setLayout((current) => constrainLayout({ ...current, [target]: value }, containerWidth));
  };
  const beginResize = (target: ResizeTarget, event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = layout[target];
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      resizeTo(target, startWidth + (target === 'rail' ? delta : -delta));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      document.body.classList.remove('is-resizing-workflow');
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    document.body.classList.add('is-resizing-workflow');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup, { once: true });
  };
  const resizeWithKeyboard = (target: ResizeTarget, event: KeyboardEvent<HTMLDivElement>) => {
    const direction = target === 'rail' ? 1 : -1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = (event.key === 'ArrowRight' ? 12 : -12) * direction;
      resizeTo(target, layout[target] + delta);
    } else if (event.key === 'Home') {
      event.preventDefault();
      resizeTo(target, target === 'rail' ? RAIL_MIN : TOOLS_MIN);
    } else if (event.key === 'End') {
      event.preventDefault();
      const limits = layoutLimits(containerWidth, layout);
      resizeTo(target, target === 'rail' ? limits.railMax : limits.toolsMax);
    }
  };
  const limits = layoutLimits(containerWidth, layout);
  const layoutStyle = {
    '--workflow-rail-width': `${layout.rail}px`,
    '--workflow-tools-width': `${layout.tools}px`,
  } as CSSProperties;

  return (
    <div ref={workbenchRef} className="workflow-task-workbench" style={layoutStyle}>
      <TaskRail
        tasks={tasks}
        activeId={activeId}
        filter={filter}
        onFilter={onFilter}
        onSelect={onSelect}
        query={query}
        onQuery={onQuery}
        searchPlaceholder={searchPlaceholder}
        selectedIds={selectedIds}
        onToggleSelection={onToggleSelection}
        isSelectable={isSelectable}
        toolbar={railToolbar}
        filterOptions={filterOptions}
        stateLabels={stateLabels}
      />
      <div
        className="workflow-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label="调整任务列表宽度"
        aria-orientation="vertical"
        aria-valuemin={RAIL_MIN}
        aria-valuemax={limits.railMax}
        aria-valuenow={layout.rail}
        title="拖动或使用方向键调整任务列表宽度，双击恢复默认"
        onPointerDown={(event) => beginResize('rail', event)}
        onKeyDown={(event) => resizeWithKeyboard('rail', event)}
        onDoubleClick={() => resizeTo('rail', DEFAULT_LAYOUT.rail)}
      />
      <main className="workflow-task-detail">{children}</main>
      <div
        className="workflow-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label="调整上下文栏宽度"
        aria-orientation="vertical"
        aria-valuemin={TOOLS_MIN}
        aria-valuemax={limits.toolsMax}
        aria-valuenow={layout.tools}
        title="拖动或使用方向键调整上下文栏宽度，双击恢复默认"
        onPointerDown={(event) => beginResize('tools', event)}
        onKeyDown={(event) => resizeWithKeyboard('tools', event)}
        onDoubleClick={() => resizeTo('tools', DEFAULT_LAYOUT.tools)}
      />
      {tools || <ContextTools />}
    </div>
  );
}
