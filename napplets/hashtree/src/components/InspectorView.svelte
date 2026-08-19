<script lang="ts">
  import InspectorNode from './InspectorNode.svelte';
  import InspectorTrace from './InspectorTrace.svelte';
  import type { NodeSource } from '../lib/blobs.js';
  import { formatBytes } from '../lib/bytes.js';
  import { linkKind, type InspectedLink } from '../lib/inspect.js';
  import type { TreeTarget } from '../lib/tree.js';
  import type { BlobTrace } from '../lib/trace.js';

  interface Props {
    store: NodeSource;
    trace: BlobTrace;
    /** What is being inspected: the selected file, else the open directory. */
    target: TreeTarget;
    /** Human name for the subject, used when the target itself has none. */
    label: string;
    servers: readonly string[];
    onCopy: (value: string) => void;
    onClose: () => void;
  }

  const { store, trace, target, label, servers, onCopy, onClose }: Props = $props();

  // The root of an inspection has no link pointing at it, so it gets a synthetic
  // one — the same shape every row below it uses.
  const rootLink = $derived<InspectedLink>({
    index: 0,
    hash: target.hash,
    key: target.key,
    type: target.type,
    kind: linkKind(target.type),
    name: target.name ?? label,
    size: target.size,
    offset: null,
    fanout: null,
    metadataKeys: [],
  });

  let scopeToNode = $state(false);
</script>

<section class="inspector" aria-label="Structure inspector">
  <header class="ins-head">
    <h2 class="ins-title" title={target.name ?? label}>{target.name ?? label}</h2>
    <span class="ins-kind ins-kind-{rootLink.kind}">{rootLink.kind}</span>
    <span class="ins-head-size">{target.size === 0 ? 'size unknown' : formatBytes(target.size)}</span>
    <span class="ins-head-spacer"></span>
    <button type="button" class="btn btn-ghost btn-xs" onclick={onClose}>Close</button>
  </header>

  <p class="ins-subject">
    <button
      type="button"
      class="ins-hash ins-hash-full"
      title="{target.hash} — click to copy"
      onclick={() => onCopy(target.hash)}
    >
      {target.hash}
    </button>
    {#if target.key !== null}
      <span class="ins-flag" title="chk-v1 encrypted; the key stays in this napplet">🔒 encrypted</span>
    {/if}
  </p>

  <div class="ins-panes">
    <section class="ins-structure" aria-label="Blob structure">
      <header class="ins-structure-head">
        <h3 class="ins-section-title">Structure</h3>
        <span class="ins-hint">{servers.length} server{servers.length === 1 ? '' : 's'} in use</span>
      </header>
      <!-- A new subject is a new inspection, not the old one with new props. -->
      {#key target.hash}
        <ul class="ins-list ins-list-root">
          <InspectorNode {store} link={rootLink} depth={0} startExpanded={true} {onCopy} />
        </ul>
      {/key}
    </section>

    <div class="ins-trace-pane">
      <label class="ins-scope">
        <input type="checkbox" bind:checked={scopeToNode} />
        Only this hash
      </label>
      <InspectorTrace {trace} filterHash={scopeToNode ? target.hash : null} {onCopy} />
    </div>
  </div>
</section>
