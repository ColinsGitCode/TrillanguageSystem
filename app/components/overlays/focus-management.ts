export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && element.getClientRects().length > 0
    ));
}

// Isolate ancestors' siblings, not body portals used by menus inside the modal.
export function isolateDialogBackground(surface: HTMLElement) {
  const snapshots: Array<{ element: HTMLElement; inert: string | null; hidden: string | null }> = [];
  let branch: HTMLElement = surface;
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.matches('script, style, link')) continue;
      snapshots.push({ element: sibling, inert: sibling.getAttribute('inert'), hidden: sibling.getAttribute('aria-hidden') });
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    if (branch.parentElement === document.body) break;
    branch = branch.parentElement;
  }
  return () => {
    for (const { element, inert, hidden } of snapshots) {
      if (inert === null) element.removeAttribute('inert');
      else element.setAttribute('inert', inert);
      if (hidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', hidden);
    }
  };
}
