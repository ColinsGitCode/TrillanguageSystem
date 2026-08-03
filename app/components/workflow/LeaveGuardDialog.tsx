import { ConfirmDialog } from '../overlays';

export type LeaveGuardController = {
  blocked: boolean;
  destination: string | null;
  message: string;
  stay: () => void;
  leave: () => void;
};

export function LeaveGuardDialog({
  guard,
  title = '放弃未保存修改？',
  description,
}: {
  guard: LeaveGuardController;
  title?: string;
  description?: string;
}) {
  if (!guard.blocked) return null;
  return (
    <ConfirmDialog
      ariaLabel="放弃未保存修改"
      title={title}
      description={description || `${guard.message} 已保存的内容不会受影响。`}
      cancelLabel="继续编辑"
      confirmLabel="放弃修改并离开"
      tone="warning"
      onCancel={guard.stay}
      onConfirm={guard.leave}
    />
  );
}
