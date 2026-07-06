<script lang="ts">
  import { onMount } from 'svelte';
  import { inc, identity } from '@napplet/sdk';
  const ipc = inc;
  import {
    IDENTITY_CHANGED_TOPIC,
    LEGACY_AUTH_IDENTITY_CHANGED_TOPIC,
    parseIdentityChangedPayload,
    waitForPublicKey,
  } from '@hyprgate/utils';
  import GMInbox from './components/GMInbox.svelte';
  import MissingNaps from './components/MissingNaps.svelte';
  import { probeNapCapabilities, type CapabilityReport } from './lib/nap-capabilities';
  import { napLog, napNote } from './lib/debug-log';

  let pubkey: string | null = $state(null);
  // null while the runtime probe is in flight. good-morning is used to debug
  // runtimes, so it gates on its required NAPs FIRST: a runtime missing an
  // essential NAP gets a diagnostic instead of a silent blank/loading screen.
  let report: CapabilityReport | null = $state(null);

  // Identity comes from two sources (same as the feed napplet): the polled
  // identity.getPublicKey() and live inc 'identity:changed' broadcasts. Use
  // onMount (not $effect) so on() callbacks writing $state don't re-trigger setup.
  onMount(() => {
    const controller = new AbortController();

    // Probe the host NAP surface before wiring identity. The identity poll below
    // is harmless when NAP-IDENTITY is absent (it just never resolves); the
    // report is what decides whether we render the inbox or the diagnostic.
    void probeNapCapabilities().then((result) => {
      if (!controller.signal.aborted) report = result;
    });

    const handleIdentityChanged = (raw: unknown) => {
      napNote('NAP-INC', 'identity:changed broadcast received', raw);
      const identityChange = parseIdentityChangedPayload(raw);
      if (identityChange) pubkey = identityChange.pubkey;
    };
    napNote('NAP-INC', `on(${IDENTITY_CHANGED_TOPIC})`);
    const canonicalSub = ipc.on(IDENTITY_CHANGED_TOPIC, handleIdentityChanged);
    napNote('NAP-INC', `on(${LEGACY_AUTH_IDENTITY_CHANGED_TOPIC})`);
    const legacySub = ipc.on(LEGACY_AUTH_IDENTITY_CHANGED_TOPIC, handleIdentityChanged);

    // waitForPublicKey polls identity.getPublicKey() (NAP-IDENTITY) until it
    // resolves; trace the resolved key and any polling errors.
    const pkCall = napLog('NAP-IDENTITY', 'getPublicKey');
    void waitForPublicKey(identity, {
      signal: controller.signal,
      onError: (err) => pkCall.fail(err),
    }).then((pk) => {
      pkCall.ok(pk);
      if (!controller.signal.aborted && !pubkey && pk) pubkey = pk;
    });

    return () => {
      controller.abort();
      canonicalSub.close();
      legacySub.close();
    };
  });
</script>

<div class="app h-screen w-screen overflow-hidden bg-bg-base text-text-primary font-mono">
  {#if report == null}
    <div class="flex items-center justify-center h-full">
      <p class="text-text-muted text-sm animate-pulse">checking runtime…</p>
    </div>
  {:else if report.missingEssential.length > 0}
    <MissingNaps {report} />
  {:else}
    <div class="flex flex-col h-full">
      {#if report.missingDegraded.length > 0}
        <MissingNaps {report} variant="banner" />
      {/if}
      <div class="flex-1 min-h-0">
        {#if pubkey != null}
          <GMInbox {pubkey} />
        {:else}
          <div class="flex items-center justify-center h-full">
            <p class="text-text-muted text-sm">not logged in</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
