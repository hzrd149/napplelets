<script lang="ts">
  import { formatBytes } from '../lib/bytes.js';
  import { summarizeEvents, type BlobEvent, type BlobTrace } from '../lib/trace.js';

  interface Props {
    trace: BlobTrace;
    /** When set, only events for this hash are shown. */
    filterHash: string | null;
    onCopy: (value: string) => void;
  }

  const { trace, filterHash, onCopy }: Props = $props();

  let events = $state<readonly BlobEvent[]>([]);

  // The trace keeps recording while this view is closed, so subscribing here
  // shows the history that led to the current state, not just what happens next.
  $effect(() => trace.subscribe((next) => (events = next)));

  const shown = $derived(
    filterHash === null ? events : events.filter((event) => event.hash === filterHash),
  );
  const totals = $derived(summarizeEvents(events));

  /** Servers are shown by host: the scheme adds a column of noise. */
  const host = (server: string): string => {
    const withoutScheme = server.replace(/^https?:\/\//, '');
    return withoutScheme.replace(/\/$/, '');
  };
</script>

<section class="ins-trace" aria-label="Blob fetches">
  <header class="ins-trace-head">
    <h3 class="ins-section-title">Fetches</h3>
    <span class="ins-trace-totals">
      {totals.network} network<span class="ins-sep">·</span>{totals.cache} cached<span
        class="ins-sep">·</span
      >{totals.inflight} coalesced<span class="ins-sep">·</span>{formatBytes(totals.fetchedBytes)}
      {#if totals.failed > 0}
        <span class="ins-sep">·</span><span class="ins-trace-failed">{totals.failed} failed</span>
      {/if}
    </span>
    <button type="button" class="btn btn-ghost btn-xs" onclick={() => trace.clear()}>Clear</button>
  </header>

  {#if shown.length === 0}
    <p class="ins-empty">
      {filterHash === null ? 'No blobs fetched yet.' : 'Nothing fetched for this node yet.'}
    </p>
  {:else}
    <ol class="ins-events">
      {#each shown as event (event.seq)}
        <li class="ins-event" class:ins-event-failed={!event.ok}>
          <span class="ins-event-source ins-event-source-{event.source}">{event.source}</span>
          <button
            type="button"
            class="ins-hash"
            title="{event.hash} — click to copy"
            onclick={() => onCopy(event.hash)}
          >
            {event.hash.slice(0, 10)}…
          </button>
          <span class="ins-event-server" title={event.server ?? ''}>
            {event.server === null ? '—' : host(event.server)}
          </span>
          <span class="ins-event-size">{event.ok ? formatBytes(event.bytes) : '—'}</span>
          <span class="ins-event-ms">{event.ms} ms</span>
          {#if event.encrypted}
            <span class="ins-flag" title="Decrypted after verifying">🔒</span>
          {/if}

          {#if event.error !== null}
            <p class="ins-event-error">{event.error}</p>
          {/if}

          {#if event.attempts.length > 0}
            <ul class="ins-attempts">
              {#each event.attempts as attempt (attempt.server)}
                <li>
                  <span class="ins-event-server">{host(attempt.server)}</span>
                  <span class="ins-attempt-error">{attempt.error}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>
