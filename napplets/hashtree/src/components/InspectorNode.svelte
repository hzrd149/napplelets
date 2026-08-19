<script lang="ts">
  import Self from './InspectorNode.svelte';
  import type { NodeSource } from '../lib/blobs.js';
  import { formatBytes } from '../lib/bytes.js';
  import {
    inspectNode,
    isManifestLink,
    summarizeLinks,
    type InspectedLink,
    type InspectedNode,
  } from '../lib/inspect.js';

  interface Props {
    store: NodeSource;
    /** The link pointing at this node. The root gets a synthetic one. */
    link: InspectedLink;
    depth: number;
    /** The root opens itself; everything below waits to be asked for. */
    startExpanded?: boolean;
    onCopy: (value: string) => void;
  }

  const { store, link, depth, startExpanded = false, onCopy }: Props = $props();

  let expanded = $state(startExpanded);
  let loading = $state(false);
  let node = $state<InspectedNode | null>(null);
  let error = $state<string | null>(null);

  const expandable = $derived(isManifestLink(link.type));
  const label = $derived(link.name ?? `[${link.index}]`);

  async function load(): Promise<void> {
    if (node !== null || loading) return;
    loading = true;
    error = null;
    try {
      node = await inspectNode(store, link);
    } catch (cause) {
      // A manifest that will not decode is the interesting case here, so the
      // message is shown in place rather than collapsing the row.
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (expanded) void load();
  });
</script>

<li class="ins-item">
  <div class="ins-row" class:ins-row-loading={loading} style="--depth: {depth}">
    {#if expandable}
      <button
        type="button"
        class="ins-twisty"
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        onclick={() => (expanded = !expanded)}
      >
        <span aria-hidden="true">{loading ? '◜' : expanded ? '▾' : '▸'}</span>
      </button>
    {:else}
      <span class="ins-twisty ins-twisty-leaf" aria-hidden="true">·</span>
    {/if}

    <span class="ins-kind ins-kind-{link.kind}">{link.kind}</span>
    <span class="ins-label" title={label}>{label}</span>

    {#if link.offset !== null}
      <span class="ins-offset" title="Plaintext byte offset within the file">@{link.offset}</span>
    {/if}

    {#if link.key !== null}
      <span class="ins-flag" title="Encrypted link: the manifest carries a chk-v1 key">🔒</span>
    {/if}

    <button
      type="button"
      class="ins-hash"
      title="{link.hash} — click to copy"
      onclick={() => onCopy(link.hash)}
    >
      {link.hash.slice(0, 10)}…
    </button>

    <span class="ins-size">{link.size === 0 ? '—' : formatBytes(link.size)}</span>
  </div>

  {#if expanded}
    {#if error !== null}
      <p class="ins-error" style="--depth: {depth + 1}">{error}</p>
    {:else if node !== null}
      <p class="ins-facts" style="--depth: {depth + 1}">
        <span>t = {node.nodeType}</span>
        <span class="ins-sep">·</span>
        <span>manifest {node.manifestBytes === null ? '—' : formatBytes(node.manifestBytes)}</span>
        <span class="ins-sep">·</span>
        <span>{summarizeLinks(node.links)}</span>
        {#if node.totalSize > 0}
          <span class="ins-sep">·</span>
          <span>{formatBytes(node.totalSize)} total</span>
        {/if}
      </p>

      {#if link.fanout !== null}
        <p class="ins-bounds" style="--depth: {depth + 1}">
          bounds {JSON.stringify(link.fanout.first)} … {JSON.stringify(link.fanout.last)}
          ({link.fanout.count} entries claimed)
        </p>
      {/if}

      <ul class="ins-list">
        <!-- Keyed by hash as well as position: a row must never keep the node it
             loaded for a different link. -->
        {#each node.links as child (`${child.hash}:${child.index}`)}
          <Self {store} link={child} depth={depth + 1} {onCopy} />
        {/each}
      </ul>
    {/if}
  {/if}
</li>
