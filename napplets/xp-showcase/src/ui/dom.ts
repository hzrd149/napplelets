/** The three DOM helpers this napplet needs, so nothing else has to cast. */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  // textContent, never innerHTML: theme titles, font names and resource error
  // details are shell-supplied strings, and this napplet is not the place to
  // find out whether the shell sanitises them.
  if (text !== undefined) node.textContent = text;
  return node;
}

export function replaceChildren(parent: Element, children: readonly Node[]): void {
  parent.replaceChildren(...children);
}
