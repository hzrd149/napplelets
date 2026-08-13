/**
 * Runtime capability detection.
 *
 * The manifest `requires` list is what current hosts use to decide which
 * domains to inject, but it is a request, not a guarantee: a host may inject
 * less, and the conformance reference shell injects a hollow `{}` for declared
 * domains. So every optional surface is probed before use and every call is
 * still allowed to fail — `docs/design-patterns.md`: "support checks are
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

export type CapabilitySeverity = 'essential' | 'degraded';

export interface CapabilityRequirement {
  readonly domain: string;
  readonly label: string;
  /** What stops working when this domain is missing. Shown to the user verbatim. */
  readonly purpose: string;
  readonly severity: CapabilitySeverity;
}

export const REQUIREMENTS: readonly CapabilityRequirement[] = [
  {
    domain: 'resource',
    label: 'NAP-RESOURCE',
    purpose: 'Fetching blobs from Blossom servers. Nothing can be browsed without it.',
    severity: 'essential',
  },
  {
    domain: 'outbox',
    label: 'NAP-OUTBOX',
    purpose: 'Resolving npub and naddr references, and reading author server lists.',
    severity: 'degraded',
  },
  {
    domain: 'config',
    label: 'NAP-CONFIG',
    purpose: 'Reading the configured Blossom servers. Defaults are used without it.',
    severity: 'degraded',
  },
  {
    domain: 'link',
    label: 'NAP-LINK',
    purpose: 'Opening a single-blob file at its Blossom URL in a browser tab.',
    severity: 'degraded',
  },
  {
    domain: 'fs',
    label: 'NAP-FS',
    purpose: 'Saving a file to disk.',
    severity: 'degraded',
  },
  {
    domain: 'media',
    label: 'NAP-MEDIA',
    purpose: 'Shell transport controls while an audio or video preview plays.',
    severity: 'degraded',
  },
  {
    domain: 'intent',
    label: 'NAP-INTENT',
    purpose: 'Handing a file off to another napplet.',
    severity: 'degraded',
  },
  {
    domain: 'inc',
    label: 'NAP-INC',
    purpose: 'Receiving a reference opened from elsewhere in the shell.',
    severity: 'degraded',
  },
  {
    domain: 'storage',
    label: 'NAP-STORAGE',
    purpose: 'Remembering recently opened trees.',
    severity: 'degraded',
  },
];

export interface CapabilityReport {
  readonly missingEssential: readonly CapabilityRequirement[];
  readonly missingDegraded: readonly CapabilityRequirement[];
}

/** Pure so it can be unit tested against a fake domain table. */
export function classifyCapabilities(
  requirements: readonly CapabilityRequirement[],
  present: (domain: string) => boolean,
): CapabilityReport {
  const missing = requirements.filter((requirement) => !present(requirement.domain));
  return {
    missingEssential: missing.filter((requirement) => requirement.severity === 'essential'),
    missingDegraded: missing.filter((requirement) => requirement.severity === 'degraded'),
  };
}

export function reportCapabilities(): CapabilityReport {
  return classifyCapabilities(REQUIREMENTS, hasDomain);
}
