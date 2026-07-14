<script lang="ts">
  import { onMount } from 'svelte';
  import { identity } from '@napplet/sdk';
  import { waitForPublicKey } from './lib/identity-client';
  import GMInbox from './components/GMInbox.svelte';
  import MissingNaps from './components/MissingNaps.svelte';
  import { probeNapCapabilities, type CapabilityReport } from './lib/nap-capabilities';

  let pubkey: string | null = $state(null);
  // good-morning is used to debug runtimes, so it gates on its required NAPs
  // FIRST: a runtime missing an essential NAP gets a diagnostic instead of a
  // silent blank/loading screen. Domain presence is synchronous on the
  // NappletGlobal surface, so the probe resolves immediately.
  let report: CapabilityReport | null = $state(probeNapCapabilities());

  // Identity comes from two sources: the polled identity.getPublicKey() and the
  // live NAP-IDENTITY `onChanged` push. Use onMount (not $effect) so the on()
  // callback writing $state doesn't re-trigger setup.
  onMount(() => {
    if (!report?.ok) return;

    const controller = new AbortController();

    const handleIdentityChanged = (nextPubkey: string) => {
      if (controller.signal.aborted) return;
      pubkey = nextPubkey;
    };
    // NAP-IDENTITY owns identity-change notifications; the handler receives the
    // hex pubkey directly (no INC payload to parse).
    let identitySub: { close(): void } | null = null;
    try {
      identitySub = identity.onChanged(handleIdentityChanged);
    } catch {
      // NAP-IDENTITY absent — the capability probe already surfaces that.
      identitySub = null;
    }

    void waitForPublicKey(identity, {
      signal: controller.signal,
      onError: (err) => console.error('[good-morning/App] getPublicKey failed:', err),
    }).then((pk) => {
      if (!controller.signal.aborted && !pubkey && pk) pubkey = pk;
    });

    return () => {
      controller.abort();
      identitySub?.close();
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
