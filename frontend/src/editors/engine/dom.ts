/**
 * True when a keyboard event originates from a text-entry context, so global
 * canvas shortcuts (space-to-pan, Delete/Backspace, v/h, …) must ignore it.
 *
 * Why not just check `e.target`? The embedded DioscHub chat kit (`<diosc-chat>`)
 * is a shadow-DOM web component. A keystroke typed in its inner contenteditable
 * is RETARGETED to the host element by the time it bubbles to a `window`
 * listener, so `e.target.tagName` reads `DIOSC-CHAT` and `e.target.isContentEditable`
 * reads `false`. A plain target check therefore lets the keystroke through — which
 * is how a space typed in the chat got eaten by the pan shortcut once a diagram
 * editor was open. `composedPath()` preserves the real inner target across shadow
 * roots, so we can detect the contenteditable (and treat anything inside the kit
 * as off-limits, since the kit owns its own keyboard handling).
 */
export function isTypingTarget(e: Event): boolean {
  for (const node of e.composedPath()) {
    const el = node as HTMLElement;
    if (!el || el.nodeType !== 1) continue;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    if (tag === 'DIOSC-CHAT') return true; // kit owns its own keyboard handling
  }
  return false;
}
