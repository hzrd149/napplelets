export function isNapDomainPresent(domain: string): boolean {
  const napplet = (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
  return Boolean(napplet?.[domain]);
}
