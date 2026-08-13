<script lang="ts">
  import { formatBytes } from '../lib/bytes.js';
  import { LINK_FANOUT } from '../lib/manifest.js';
  import type { TreeLink } from '../lib/manifest.js';
  import { entryKind } from '../lib/tree.js';
  import { mimeForName } from '../lib/mime.js';
  import type { SortKey } from '../lib/view.js';

  interface Props {
    entries: readonly TreeLink[];
    selectedHash: string | null;
    listing: boolean;
    sortKey: SortKey;
    sortAscending: boolean;
    onSort: (key: SortKey) => void;
    onOpen: (entry: TreeLink) => void;
  }

  const { entries, selectedHash, listing, sortKey, sortAscending, onSort, onOpen }: Props =
    $props();

  const sorted = $derived.by(() => {
    const direction = sortAscending ? 1 : -1;
    const copy = [...entries];
    copy.sort((a, b) => {
      // Directories first regardless of direction: that is a grouping, not an order.
      const aDir = entryKind(a) === 'directory';
      const bDir = entryKind(b) === 'directory';
      if (aDir !== bDir) return aDir ? -1 : 1;
      if (sortKey === 'size') return (a.size - b.size) * direction;
      if (sortKey === 'kind') {
        return mimeForName(a.name ?? '').localeCompare(mimeForName(b.name ?? '')) * direction;
      }
      return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }) * direction;
    });
    return copy;
  });

  const arrow = (key: SortKey) => (sortKey !== key ? '' : sortAscending ? ' ▲' : ' ▼');

  function describe(entry: TreeLink): string {
    if (entryKind(entry) === 'directory') {
      return entry.type === LINK_FANOUT ? 'Folder (sharded)' : 'Folder';
    }
    const mime = mimeForName(entry.name ?? '');
    return mime === 'application/octet-stream' ? 'File' : mime;
  }
</script>

<div class="listing" role="group" aria-label="Directory entries">
  <div class="listing-head" role="row">
    <button type="button" class="col-name" onclick={() => onSort('name')} role="columnheader">
      Name{arrow('name')}
    </button>
    <button type="button" class="col-kind" onclick={() => onSort('kind')} role="columnheader">
      Type{arrow('kind')}
    </button>
    <button type="button" class="col-size" onclick={() => onSort('size')} role="columnheader">
      Size{arrow('size')}
    </button>
  </div>

  <ul class="listing-body">
    {#each sorted as entry (entry.hash + (entry.name ?? ''))}
      <li>
        <button
          type="button"
          class="row"
          class:row-selected={entry.hash === selectedHash}
          onclick={() => onOpen(entry)}
          ondblclick={() => onOpen(entry)}
        >
          <span class="col-name">
            <span class="row-icon" aria-hidden="true">
              {entryKind(entry) === 'directory' ? '📁' : '📄'}
            </span>
            <span class="row-name">{entry.name}</span>
          </span>
          <span class="col-kind">{describe(entry)}</span>
          <span class="col-size">{entry.size === 0 ? '—' : formatBytes(entry.size)}</span>
        </button>
      </li>
    {/each}
  </ul>

  {#if listing}
    <p class="listing-status"><span class="loading loading-spinner loading-xs"></span> Loading…</p>
  {:else if entries.length === 0}
    <p class="listing-status">This folder is empty.</p>
  {/if}
</div>
