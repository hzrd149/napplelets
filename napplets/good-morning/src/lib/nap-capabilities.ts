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
// Detection follows the current NAP model: the runtime injects
// `window.napplet.<domain>` before app code, and @napplet/sdk reads the same
// property at call time. There is no `shell.supports()` / `shell.ready()`
// probing: the NappletGlobal surface has no `shell` property, and
// readiness/transport are runtime concerns.

import {
  IDENTITY_DOMAIN,
  INTENT_DOMAIN,
  LINK_DOMAIN,
  OUTBOX_DOMAIN,
  RESOURCE_DOMAIN,
  THEME_DOMAIN,
} from '@napplet/sdk';
import { isNapDomainPresent } from './runtime-domain';

export type NapSeverity = 'essential' | 'degraded';

export interface NapRequirement {
  /** window.napplet key for the domain. */
  domain: string;
  /** Human label shown in the diagnostic, e.g. "NAP-IDENTITY". */
  label: string;
  /** What good-morning uses the NAP for. */
  purpose: string;
  /** How the inbox behaves when the NAP is missing. */
  severity: NapSeverity;
}

/**
 * The NAPs good-morning reports, in display order. Every entry belongs in
 * vite.config.ts `requires` because current runtimes use it as the injected
 * grant list; severity controls the app's fallback UI. The inbox is outbox-only:
 * both reads and Quick GM publishes route through NAP-OUTBOX.
 */
export const GM_NAP_REQUIREMENTS: NapRequirement[] = [
  {
    domain: IDENTITY_DOMAIN,
    label: 'NAP-IDENTITY',
    purpose: 'Reads your public key and follow list (kind 3) so the inbox knows whose GMs to load.',
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
  {
    domain: INTENT_DOMAIN,
    label: 'NAP-INTENT',
    purpose:
      'Opens notes, profiles, and the composer through installed archetype handlers. Related controls hide when unavailable.',
    severity: 'degraded',
  },
  {
    domain: LINK_DOMAIN,
    label: 'NAP-LINK',
    purpose: 'Opens external URLs through the shell-owned opener. Links are dead without it.',
    severity: 'degraded',
  },
];

export interface NapCapabilityStatus extends NapRequirement {
  /** window.napplet[domain] is a runtime-injected object. */
  domainPresent: boolean;
  /** domainPresent. */
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
  /** Every essential NAP is available. */
  ok: boolean;
}

/** Probe predicate — the classifier is pure over this single signal. */
export type DomainProbe = (domain: string) => boolean;

/**
 * Pure classification of the probed surface. Exported (and unit-tested) without
 * any live runtime so the essential/degraded logic is verifiable in isolation.
 */
export function classifyCapabilities(
  requirements: NapRequirement[],
  hasDomain: DomainProbe,
): CapabilityReport {
  const statuses = requirements.map<NapCapabilityStatus>((req) => {
    const domainPresent = hasDomain(req.domain);
    return { ...req, domainPresent, available: domainPresent };
  });
  const missing = statuses.filter((status) => !status.available);
  return {
    statuses,
    missing,
    missingEssential: missing.filter((status) => status.severity === 'essential'),
    missingDegraded: missing.filter((status) => status.severity === 'degraded'),
    ok: missing.every((status) => status.severity !== 'essential'),
  };
}

/**
 * Probe the live runtime for the NAPs good-morning needs. Domain presence is
 * synchronous on the NappletGlobal surface, so this resolves immediately — no
 * shell handshake to wait on.
 */
export function probeNapCapabilities(
  requirements: NapRequirement[] = GM_NAP_REQUIREMENTS,
): CapabilityReport {
  return classifyCapabilities(requirements, isNapDomainPresent);
}
