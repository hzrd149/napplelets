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

  let pubkey: string | null = $state(null);

  // Identity comes from two sources (same as the feed napplet): the polled
  // identity.getPublicKey() and live inc 'identity:changed' broadcasts. Use
  // onMount (not $effect) so on() callbacks writing $state don't re-trigger setup.
  onMount(() => {
    const controller = new AbortController();

    const handleIdentityChanged = (raw: unknown) => {
      const identityChange = parseIdentityChangedPayload(raw);
      if (identityChange) pubkey = identityChange.pubkey;
    };
    const canonicalSub = ipc.on(IDENTITY_CHANGED_TOPIC, handleIdentityChanged);
    const legacySub = ipc.on(LEGACY_AUTH_IDENTITY_CHANGED_TOPIC, handleIdentityChanged);

    void waitForPublicKey(identity, {
      signal: controller.signal,
      onError: (err) => console.error('[good-morning/App] getPublicKey failed:', err),
    }).then((pk) => {
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
  {#if pubkey != null}
    <GMInbox {pubkey} />
  {:else}
    <div class="flex items-center justify-center h-full">
      <p class="text-text-muted text-sm">not logged in</p>
    </div>
  {/if}
</div>
