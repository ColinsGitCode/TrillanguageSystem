import { useEffect, type RefObject } from 'react';
import { supportsFocusGroup } from '../../lib/platform/capabilities';
import { focusableElements } from '../../components/overlays/focus-management';

export function useToolbarNavigation(ref: RefObject<HTMLDivElement | null>, active: boolean, hasEmbeddedInputs = false) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    // Native focusgroup excludes select widgets. Mixed-input toolbars need
    // one coordinated tab stop, including controls that are loaded lazily.
    if (supportsFocusGroup() && !hasEmbeddedInputs) {
      root.setAttribute('focusgroup', 'toolbar wrap');
      return () => root.removeAttribute('focusgroup');
    }
    const original = new Map<HTMLElement, string | null>();
    let current: HTMLElement | null = null;
    const items = () => [...root.querySelectorAll<HTMLElement>('button, select')]
      .filter(el => !el.matches(':disabled') && el.getClientRects().length > 0
        && !el.closest('[role="menu"], .csa-tts-language, .csa-reading-details'));
    const update = () => {
      const controls = items();
      if (!current || !controls.includes(current)) current = controls[0] || null;
      for (const el of controls) {
        if (!original.has(el)) original.set(el, el.getAttribute('tabindex'));
        el.tabIndex = el === current ? 0 : -1;
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && items().includes(event.target)) {
        current = event.target; update();
      }
    };
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || !items().includes(document.activeElement as HTMLElement)) return;
      const owner = root.closest<HTMLElement>('dialog, [role="dialog"]');
      if (!owner) return;
      const controls = new Set(items());
      const stops = focusableElements(owner).filter(el => el.tabIndex >= 0 && !el.closest('[inert]'));
      const index = stops.indexOf(document.activeElement as HTMLElement);
      const direction = event.shiftKey ? -1 : 1;
      // Firefox may restart native-dialog Tab navigation at the retained text
      // selection. Exit this composite explicitly without clearing Selection.
      for (let step = 1; step <= stops.length; step++) {
        const next = stops[(index + direction * step + stops.length) % stops.length];
        if (controls.has(next)) continue;
        event.preventDefault();
        next.focus({ preventScroll: true });
        break;
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    root.addEventListener('focusin', onFocus);
    root.addEventListener('keydown', onTab);
    return () => {
      observer.disconnect(); root.removeEventListener('focusin', onFocus);
      root.removeEventListener('keydown', onTab);
      for (const [el, value] of original) {
        if (value === null) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', value);
      }
    };
  }, [active, hasEmbeddedInputs, ref]);
}
