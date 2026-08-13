<script lang="ts">
  import Self from './TreeNode.svelte';
  import type { NodeSource } from '../lib/blobs.js';
  import type { TreeLink } from '../lib/manifest.js';
  import { isDirectoryLink, listDirectory } from '../lib/tree.js';

  interface Props {
    store: NodeSource;
    hash: string;
    entryKey: string | null;
    /** Path from the root to this node, used to report navigation. */
    path: readonly string[];
    label: string;
    currentPath: readonly string[];
    depth: number;
    /** Root starts open; everything else waits to be asked for. */
    startExpanded?: boolean;
    onNavigate: (path: string[]) => void;
  }

  const {
    store,
    hash,
    entryKey,
    path,
    label,
    currentPath,
    depth,
    startExpanded = false,
    onNavigate,
  }: Props = $props();

  let expanded = $state(startExpanded);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let children = $state<readonly TreeLink[]>([]);

  const isCurrent = $derived(
    currentPath.length === path.length && currentPath.every((part, i) => part === path[i]),
  );

  // On the path to the current folder, so it is worth showing open.
  const onCurrentPath = $derived(
    path.length < currentPath.length && path.every((part, i) => part === currentPath[i]),
  );

  $effect(() => {
    if (onCurrentPath && !expanded) expanded = true;
  });

  async function load(): Promise<void> {
    if (loaded || loading) return;
    loading = true;
    error = null;
    try {
      const entries = await listDirectory(store, { hash, key: entryKey });
      children = entries.filter((entry) => isDirectoryLink(entry.type));
      loaded = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  // Fetching is tied to expansion, so a collapsed branch costs nothing.
  $effect(() => {
    if (expanded) void load();
  });

  function toggle(event: MouseEvent): void {
    event.stopPropagation();
    expanded = !expanded;
  }
</script>

<li class="tree-item">
  <div
    class="tree-row"
    class:tree-row-current={isCurrent}
    class:tree-row-loading={loading}
    aria-busy={loading}
    style="--depth: {depth}"
  >
    <button
      type="button"
      class="tree-twisty"
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      onclick={toggle}
    >
      <!--
        A rotated glyph rather than daisyUI's `.loading`: it keeps the twisty's
        width stable, stays legible at this size, and does not depend on the
        theme package's utility classes being present.
      -->
      {#if loading}
        <span class="tree-spinner" aria-hidden="true">◜</span>
      {:else}
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      {/if}
    </button>
    <button
      type="button"
      class="tree-label"
      onclick={() => onNavigate([...path])}
      title={loading ? `${label} — loading…` : label}
    >
      {label}
    </button>
    {#if loading}
      <span class="tree-loading-note" aria-live="polite">loading…</span>
    {/if}
  </div>

  {#if expanded}
    {#if error !== null}
      <p class="tree-error" style="--depth: {depth + 1}">{error}</p>
    {:else if loaded && children.length === 0}
      <p class="tree-empty" style="--depth: {depth + 1}">no subfolders</p>
    {:else}
      <ul class="tree-list">
        {#each children as child (child.hash + (child.name ?? ''))}
          <Self
            {store}
            hash={child.hash}
            entryKey={child.key}
            path={[...path, child.name ?? '']}
            label={child.name ?? ''}
            {currentPath}
            depth={depth + 1}
            {onNavigate}
          />
        {/each}
      </ul>
    {/if}
  {/if}
</li>
