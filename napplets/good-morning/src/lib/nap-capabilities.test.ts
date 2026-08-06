import { describe, it, expect } from 'vitest';
import { classifyCapabilities, GM_NAP_REQUIREMENTS, type NapRequirement } from './nap-capabilities';

const REQS: NapRequirement[] = [
  { domain: 'identity', label: 'NAP-IDENTITY', purpose: 'pubkey', severity: 'essential' },
  { domain: 'outbox', label: 'NAP-OUTBOX', purpose: 'routing', severity: 'essential' },
  { domain: 'resource', label: 'NAP-RESOURCE', purpose: 'avatars', severity: 'degraded' },
];

/** Probe that reports the named domains present. */
const present =
  (...domains: string[]) =>
  (domain: string) =>
    domains.includes(domain);

const none = () => false;

describe('classifyCapabilities', () => {
  it('reports ok when every essential NAP is present via the domain object', () => {
    const report = classifyCapabilities(REQS, present('identity', 'outbox', 'resource'));
    expect(report.ok).toBe(true);
    expect(report.missing).toHaveLength(0);
    expect(report.missingEssential).toHaveLength(0);
  });

  it('marks a NAP available when its domain object is present', () => {
    const report = classifyCapabilities(REQS, present('identity', 'outbox', 'resource'));
    const outbox = report.statuses.find((s) => s.domain === 'outbox');
    expect(outbox?.domainPresent).toBe(true);
    expect(outbox?.available).toBe(true);
  });

  it('flags a missing essential NAP and marks the report not ok', () => {
    const report = classifyCapabilities(REQS, present('outbox', 'resource'));
    expect(report.ok).toBe(false);
    expect(report.missingEssential.map((s) => s.domain)).toEqual(['identity']);
    expect(report.missingDegraded).toHaveLength(0);
  });

  it('separates degraded gaps from essential ones and stays ok', () => {
    const report = classifyCapabilities(REQS, present('identity', 'outbox'));
    expect(report.ok).toBe(true);
    expect(report.missingEssential).toHaveLength(0);
    expect(report.missingDegraded.map((s) => s.domain)).toEqual(['resource']);
  });

  it('reports everything missing when the runtime is empty', () => {
    const report = classifyCapabilities(REQS, none);
    expect(report.ok).toBe(false);
    expect(report.missing).toHaveLength(REQS.length);
  });

  it('carries the requirement metadata through onto each status', () => {
    const report = classifyCapabilities(REQS, none);
    const identity = report.missingEssential.find((s) => s.domain === 'identity');
    expect(identity?.label).toBe('NAP-IDENTITY');
    expect(identity?.purpose).toBe('pubkey');
    expect(identity?.severity).toBe('essential');
  });
});

describe('GM_NAP_REQUIREMENTS', () => {
  it('covers every domain declared in the manifest grant list', () => {
    const domains = GM_NAP_REQUIREMENTS.map((r) => r.domain).sort();
    expect(domains).toEqual(['identity', 'intent', 'link', 'outbox', 'resource', 'theme'].sort());
  });

  it('marks identity and outbox essential', () => {
    const essential = GM_NAP_REQUIREMENTS.filter((r) => r.severity === 'essential').map(
      (r) => r.domain,
    );
    expect(essential.sort()).toEqual(['identity', 'outbox'].sort());
  });
});
