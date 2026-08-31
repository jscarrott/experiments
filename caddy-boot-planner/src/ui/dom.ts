/** Minimal DOM helpers. No framework — the UI is a handful of panels. */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function mm(value: number): string {
  return `${Math.round(value)} mm`;
}

export function kg(value: number): string {
  return `${value.toFixed(1)} kg`;
}

/**
 * Copying to the clipboard, with a fallback.
 *
 * The async Clipboard API needs a secure context and can be refused outright, so
 * the old execCommand path stays as a backstop. This is the primary export route —
 * a published artifact runs in a sandbox that blocks file downloads — so it needs
 * to work more than it needs to be tidy.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Brief status message in the corner, for save/copy confirmations. */
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const existing = document.querySelector('.toast');
  existing?.remove();

  const node = el('div', { class: `toast toast--${kind}`, text: message });
  document.body.appendChild(node);
  setTimeout(() => node.classList.add('toast--out'), 2200);
  setTimeout(() => node.remove(), 2600);
}
