<script lang="ts">
  import TreeNode from './TreeNode.svelte';
  import type { NodeSource } from '../lib/blobs.js';

  interface Props {
    store: NodeSource;
    rootHash: string;
    rootKey: string | null;
    rootLabel: string;
    currentPath: readonly string[];
    onNavigate: (path: string[]) => void;
  }

  const { store, rootHash, rootKey, rootLabel, currentPath, onNavigate }: Props = $props();
</script>

<!--
  Folders only, expanded on demand. Hidden by a container query on narrow frames
  (see styles.css) where breadcrumbs are the better navigation affordance.
-->
<nav class="tree" aria-label="Folder tree">
  <ul class="tree-list">
    {#key rootHash}
      <TreeNode
        {store}
        hash={rootHash}
        entryKey={rootKey}
        path={[]}
        label={rootLabel}
        {currentPath}
        depth={0}
        startExpanded={true}
        {onNavigate}
      />
    {/key}
  </ul>
</nav>
