export function legacyWebPlatformRequested() {
  try { return sessionStorage.getItem('three-lans:web-platform') === 'legacy'; }
  catch { return false; }
}

export function supportsFieldSizing() {
  return !legacyWebPlatformRequested() && typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
}

export function supportsFocusGroup() {
  return !legacyWebPlatformRequested() && typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;
}

export function supportsHighlights() {
  return !legacyWebPlatformRequested() && typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

export function supportsAnchoredPopover() {
  return !legacyWebPlatformRequested() && typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype
    && typeof CSS !== 'undefined' && CSS.supports('anchor-name', '--anchor')
    && CSS.supports('position-area', 'bottom span-left') && CSS.supports('position-try-fallbacks', 'flip-block');
}

// Native modal migration remains opt-in until its complete browser contract passes.
export function nativeOverlaysEnabled() {
  try {
    return !legacyWebPlatformRequested() && sessionStorage.getItem('three-lans:native-overlays') === '1'
      && typeof HTMLDialogElement !== 'undefined' && 'showModal' in HTMLDialogElement.prototype;
  } catch { return false; }
}
