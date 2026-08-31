type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Minimal element helper. The whole UI is a few panels; a framework would be more
 * code than the panels. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function clear(el: HTMLElement): HTMLElement {
  el.replaceChildren();
  return el;
}

/** Replace an element's children, skipping the falsy ones so `cond && h(...)` works. */
export function fill(el: HTMLElement, ...children: Child[]): HTMLElement {
  el.replaceChildren(
    ...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false),
  );
  return el;
}

export function mustFind<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

/** "3 days ago", roughly. Exact timestamps are in the title attribute. */
export function relativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2629800, 'month'],
    [31557600, 'year'],
  ];
  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0];
  for (const unit of units) if (seconds >= unit[0]) chosen = unit;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return formatter.format(-Math.round(seconds / chosen[0]), chosen[1]);
}

/** Stars for a rating, and a clear "not rated" for a note that carries none — an
 * unrated note is a note, not a zero-star review. */
export function ratingLabel(rating: number | undefined): string {
  if (rating === undefined) return '';
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}
