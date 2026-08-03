import { useCallback, useEffect } from 'react';
import { useBlocker } from 'react-router';

export function useLeaveGuard(active: boolean, message = '有未保存修改，确定离开吗？') {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    active
    && `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`
      !== `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`
  ));

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active, message]);

  const stay = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);
  const leave = useCallback(() => {
    if (blocker.state === 'blocked') blocker.proceed();
  }, [blocker]);

  return {
    blocked: blocker.state === 'blocked',
    destination: blocker.state === 'blocked'
      ? `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`
      : null,
    message,
    stay,
    leave,
  };
}
