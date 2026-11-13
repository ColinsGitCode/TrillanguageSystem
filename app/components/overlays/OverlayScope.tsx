import { createContext, useContext } from 'react';

export const OverlayScope = createContext<{ native: boolean; container: HTMLElement | undefined; closeGuard?: { current: (() => void) | null } }>({ native: false, container: undefined });
export const useOverlayScope = () => useContext(OverlayScope);
