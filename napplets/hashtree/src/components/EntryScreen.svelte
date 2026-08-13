<script lang="ts">
  import { parseTreeRef } from '../lib/refs.js';
  import type { RecentTree } from '../lib/session.js';

  interface Props {
    value: string;
    busy: boolean;
    error: string | null;
    recents: readonly RecentTree[];
    onOpen: (reference: string) => void;
    onOpenSettings: () => void;
  }

  let { value = $bindable(), busy, error, recents, onOpen, onOpenSettings }: Props = $props();

  const parsed = $derived(value.trim() === '' ? null : parseTreeRef(value));

  const summary = $derived.by(() => {
    if (parsed === null || !parsed.ok) return null;
    const ref = parsed.ref;
    const where = ref.path.length === 0 ? '' : ` → /${ref.path.join('/')}`;
    return ref.kind === 'immutable'
      ? `Pinned root ${ref.rootHash.slice(0, 12)}…${ref.rootKey === null ? '' : ' (encrypted)'}${where}`
      : `Tree ${JSON.stringify(ref.treeName)} from kind ${ref.eventKind}${where}`;
  });

  const canOpen = $derived(parsed !== null && parsed.ok && !busy);

  function submit() {
    if (!canOpen) return;
    onOpen(value);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    submit();
  }
</script>

<section class="entry" aria-label="Open a hashtree">
  <div class="entry-field">
    <input
      class="input input-bordered entry-input"
      type="text"
      bind:value
      onkeydown={onKeydown}
      placeholder="htree://… , nhash1… , naddr1… , or a 64 character root hash"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      aria-label="Hashtree reference"
      aria-describedby="entry-hint"
    />
    <button type="button" class="btn btn-primary" disabled={!canOpen} onclick={submit}>
      {busy ? 'Opening…' : 'Open'}
    </button>
  </div>

  <p id="entry-hint" class="entry-hint" class:entry-hint-error={parsed !== null && !parsed.ok}>
    {#if error !== null}
      {error}
    {:else if parsed === null}
      Paste a reference, or send one from another napplet.
    {:else if parsed.ok}
      {summary}
    {:else}
      {parsed.error}
    {/if}
  </p>

  {#if recents.length > 0}
    <div class="recents">
      <p class="recents-title">Recent</p>
      <ul class="recents-list">
        {#each recents as recent (recent.reference)}
          <li>
            <button
              type="button"
              class="recent"
              disabled={busy}
              onclick={() => onOpen(recent.reference)}
              title={recent.reference}
            >
              <span class="recent-label">{recent.label}</span>
              <span class="recent-ref">{recent.reference}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <button type="button" class="btn btn-ghost btn-xs entry-settings" onclick={onOpenSettings}>
    Blossom servers…
  </button>
</section>
