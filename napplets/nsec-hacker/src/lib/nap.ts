/**
 * Runtime capability detection.
 *
 * The manifest `requires` list is what current hosts use to decide which
 * domains to inject, but it is a request, not a guarantee: a host may inject
 * less, and the conformance reference shell injects a hollow `{}` for declared
 * domains. So every optional surface is probed before use and every call is
 * still allowed to fail -- `docs/design-patterns.md`: "support checks are
 * advisory".
 */

type ShellNamespace = Record<string, unknown> | undefined;

function shell(): ShellNamespace {
  return (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
}

/** True when the runtime injected a usable object for the named NAP domain. */
export function hasDomain(name: string): boolean {
  const domain = shell()?.[name];
  return typeof domain === 'object' && domain !== null;
}

/** True when the domain exists and exposes the named method. */
export function hasMethod(name: string, method: string): boolean {
  const domain = shell()?.[name] as Record<string, unknown> | undefined;
  return typeof domain?.[method] === 'function';
}

/** Run a shell call that may not exist; returns undefined instead of throwing. */
export function attempt<T>(call: () => T): T | undefined {
  try {
    return call();
  } catch {
    return undefined;
  }
}
