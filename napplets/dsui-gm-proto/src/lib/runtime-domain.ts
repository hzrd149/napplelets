/** True when the runtime injected the named NAP domain. */
export function isNapDomainPresent(domain: string): boolean {
  const napplet = (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
  return napplet != null && napplet[domain] != null;
}
