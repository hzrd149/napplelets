// napplets/good-morning/src/lib/nap-capabilities.ts
//
// Runtime NAP capability probe for the GM inbox.
//
// good-morning doubles as a runtime/shell debugging napplet: when the host
// runtime does not expose a NAP this napplet depends on, we must SAY SO plainly
// instead of failing into a blank screen or a perpetual "loading contacts…"
// spinner. This module probes each required NAP and classifies the gaps by how
// badly they hurt:
//
//   * `essential` — the inbox cannot function (no pubkey, no notes, no row
//                   interaction). Missing → render the full diagnostic screen.
//   * `degraded`  — the inbox still works but loses something (avatars, theme).
//                   Missing → an inline warning banner.
//
// Two detection signals, both already used elsewhere in this repo:
//   1. `window.napplet[domain]` presence — the @napplet/sdk helpers read this at
//      call time, so an absent object means the call cannot be made at all
//      (NappletGlobal docs: "absence means the domain is unavailable").
//   2. `shell.supports(domain)` — the NAP-SHELL capability check (the same probe
//      the `test` napplet's featureStatus() and gm-origin.ts use). Only
//      meaningful AFTER shell.ready() settles.
//
// A NAP counts as available when EITHER signal is positive; it is reported
// missing only when BOTH are negative — leniency avoids false alarms in runtimes
// that install the domain object but do not implement supports().

import {
  IDENTITY_DOMAIN,
  INC_DOMAIN,
  OUTBOX_DOMAIN,
  RESOURCE_DOMAIN,
  THEME_DOMAIN,
} from '@napplet/sdk';
import { napLog, napNote } from './debug-log';

export type NapSeverity = 'essential' | 'degraded';

export interface NapRequirement {
  /** window.napplet key AND shell.supports() capability name. */
  domain: string;
  /** Human label shown in the diagnostic, e.g. "NAP-IDENTITY". */
  label: string;
  /** What good-morning uses the NAP for. */
  purpose: string;
  /** How the inbox behaves when the NAP is missing. */
  severity: NapSeverity;
}

/**
 * The NAPs good-morning gates on, in report order — mirrors vite.config.ts's
 * `requires: ['identity','inc','outbox','resource','theme']`. The inbox is
 * outbox-only: both note reads and Quick GM publishes route through NAP-OUTBOX
 * (there is no NAP-RELAY fallback), so it is gated essential. Keep the essential
 * set in sync with that policy.
 */
export const GM_NAP_REQUIREMENTS: NapRequirement[] = [
  {
    domain: IDENTITY_DOMAIN,
    label: 'NAP-IDENTITY',
    purpose: 'Reads your public key and follow list (kind 3) so the inbox knows whose GMs to load.',
    severity: 'essential',
  },
  {
    domain: INC_DOMAIN,
    label: 'NAP-INC',
    purpose:
      'Follows identity changes and opens notes, profiles, and the composer when you tap a row.',
    severity: 'essential',
  },
  {
    domain: OUTBOX_DOMAIN,
    label: 'NAP-OUTBOX',
    purpose: "Routes note fetches to each author's own relays and publishes your Quick GM replies.",
    severity: 'essential',
  },
  {
    domain: RESOURCE_DOMAIN,
    label: 'NAP-RESOURCE',
    purpose: 'Loads contact avatar images. Falls back to initials when absent.',
    severity: 'degraded',
  },
  {
    domain: THEME_DOMAIN,
    label: 'NAP-THEME',
    purpose: 'Applies the host shell theme. Falls back to built-in colors when absent.',
    severity: 'degraded',
  },
];

export interface NapCapabilityStatus extends NapRequirement {
  /** window.napplet[domain] is an installed object. */
  domainPresent: boolean;
  /** shell.supports(domain) reported the capability. */
  shellSupports: boolean;
  /** domainPresent || shellSupports. */
  available: boolean;
}

export interface CapabilityReport {
  /** Every requirement, probed. */
  statuses: NapCapabilityStatus[];
  /** All unavailable NAPs (essential + degraded). */
  missing: NapCapabilityStatus[];
  /** Unavailable NAPs the inbox cannot run without. */
  missingEssential: NapCapabilityStatus[];
  /** Unavailable NAPs that only degrade the inbox. */
  missingDegraded: NapCapabilityStatus[];
  /** window.napplet.shell (the NAP-SHELL handshake) was detected. */
  shellPresent: boolean;
  /** Every essential NAP is available. */
  ok: boolean;
}

/** Probe predicates — the classifier is pure over these two signals. */
export type DomainProbe = (domain: string) => boolean;
export type SupportsProbe = (domain: string) => boolean;

/**
 * Pure classification of the probed surface. Exported (and unit-tested) without
 * any live runtime so the essential/degraded logic is verifiable in isolation.
 */
export function classifyCapabilities(
  requirements: NapRequirement[],
  hasDomain: DomainProbe,
  supports: SupportsProbe,
  shellPresent: boolean,
): CapabilityReport {
  const statuses = requirements.map<NapCapabilityStatus>((req) => {
    const domainPresent = hasDomain(req.domain);
    const shellSupports = supports(req.domain);
    return { ...req, domainPresent, shellSupports, available: domainPresent || shellSupports };
  });
  const missing = statuses.filter((status) => !status.available);
  return {
    statuses,
    missing,
    missingEssential: missing.filter((status) => status.severity === 'essential'),
    missingDegraded: missing.filter((status) => status.severity === 'degraded'),
    shellPresent,
    ok: missing.every((status) => status.severity !== 'essential'),
  };
}

// ── Runtime probes (impure) ─────────────────────────────────────────────────

/** Minimal shape of the shim-installed NAP-SHELL handshake we depend on. */
interface NappletShellHandle {
  ready?(): Promise<unknown>;
  supports?(domain: string, protocol?: string): boolean;
}

function getNapplet(): Record<string, unknown> | null {
  return (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet ?? null;
}

function getShell(): NappletShellHandle | null {
  const napplet = getNapplet() as { shell?: NappletShellHandle } | null;
  return napplet?.shell ?? null;
}

/** True when window.napplet[domain] is an installed (non-null) object. */
function domainIsPresent(domain: string): boolean {
  const napplet = getNapplet();
  return napplet != null && napplet[domain] != null;
}

/**
 * shell.supports(domain) OR shell.supports('nap:'+domain), guarded against a
 * throwing/absent shell — mirrors the `test` napplet's featureStatus().
 */
function shellSupports(shell: NappletShellHandle | null, domain: string): boolean {
  if (!shell?.supports) return false;
  try {
    return Boolean(shell.supports(domain) || shell.supports(`nap:${domain}`));
  } catch {
    return false;
  }
}

/** Cap on how long we wait for a slow/absent shell.ready() before probing. */
const SHELL_READY_TIMEOUT_MS = 5000;

async function awaitShellReady(shell: NappletShellHandle | null): Promise<void> {
  if (!shell?.ready) {
    napNote('NAP-SHELL', 'ready skipped — no shell.ready() (runtime handshake absent)');
    return;
  }
  const call = napLog('NAP-SHELL', 'ready', { caller: 'probeNapCapabilities' });
  // Swallow a rejected ready(): a failed handshake still lets us probe (and
  // report) the degraded surface rather than hang the diagnostic.
  const ready = Promise.resolve(shell.ready()).then(
    () => call.ok('settled'),
    (err) => call.fail(err),
  );
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      call.info('timeout', `no settle within ${SHELL_READY_TIMEOUT_MS}ms`);
      resolve();
    }, SHELL_READY_TIMEOUT_MS);
  });
  await Promise.race([ready, timeout]);
}

/**
 * Probe the live runtime for the NAPs good-morning needs. Resolves AFTER
 * shell.ready() (or a timeout) so shell.supports() reflects the settled
 * handshake.
 */
export async function probeNapCapabilities(
  requirements: NapRequirement[] = GM_NAP_REQUIREMENTS,
): Promise<CapabilityReport> {
  const shell = getShell();
  await awaitShellReady(shell);
  const report = classifyCapabilities(
    requirements,
    domainIsPresent,
    (domain) => {
      // NAP-SHELL capability query, per domain — logs the two signals the
      // classifier ORs together (window.napplet[domain] vs shell.supports()).
      const supported = shellSupports(shell, domain);
      napNote('NAP-SHELL', `supports(${domain})`, {
        shellSupports: supported,
        domainPresent: domainIsPresent(domain),
      });
      return supported;
    },
    shell != null,
  );
  napNote('NAP-SHELL', 'capability report', {
    ok: report.ok,
    shellPresent: report.shellPresent,
    available: report.statuses.filter((s) => s.available).map((s) => s.domain),
    missingEssential: report.missingEssential.map((s) => s.label),
    missingDegraded: report.missingDegraded.map((s) => s.label),
  });
  return report;
}
