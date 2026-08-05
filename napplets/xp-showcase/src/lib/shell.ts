/**
 * Talking to a shell that may only partly exist.
 *
 * Two separate things can be missing, and conflating them is how a napplet
 * ends up with a blank pane:
 *
 *   1. **The domain.** The runtime injects `window.napplet` before this script
 *      runs, and a domain the shell does not offer is simply not a property on
 *      it. There is no readiness handshake and no capability query -- absence
 *      *is* the answer, and it is available synchronously.
 *
 *   2. **The method.** A domain object can be present and hollow. The NAP
 *      conformance reference shell injects `napplet[domain] = {}` for every
 *      declared domain precisely to prove napplets survive it, so
 *      `napplet.config` existing does not mean `config.get` is callable.
 *
 * `hasDomain` answers the first, `attempt` absorbs the second. Every shell call
 * in this napplet goes through one or both.
 */

type NappletGlobal = Record<string, unknown> | undefined;

function shell(): NappletGlobal {
  return (globalThis as { napplet?: Record<string, unknown> }).napplet;
}

export function hasDomain(name: string): boolean {
  return Boolean(shell()?.[name]);
}

/** Runs a shell call that may not exist; returns undefined instead of throwing. */
export function attempt<T>(call: () => T): T | undefined {
  try {
    return call();
  } catch {
    return undefined;
  }
}
