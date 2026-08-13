<script lang="ts">
  import { formatBytes } from '../lib/bytes.js';
  import { mimeForName } from '../lib/mime.js';
  import {
    directBlobUrlBlocker,
    mediaMetadataFor,
    startMediaSession,
    type MediaSessionHandle,
  } from '../lib/actions.js';
  import type { TreeTarget } from '../lib/tree.js';
  import type { PreviewState } from '../lib/view.js';

  interface Props {
    target: TreeTarget;
    treeLabel: string;
    htreeUri: string;
    nhash: string | null;
    directUrl: string | null;
    preview: PreviewState | null;
    canSave: boolean;
    saving: boolean;
    onPreview: () => void;
    onCancel: () => void;
    onSave: () => void;
    onOpenBrowser: () => void;
    onCopy: (value: string) => void;
    onClose: () => void;
  }

  const {
    target,
    treeLabel,
    htreeUri,
    nhash,
    directUrl,
    preview,
    canSave,
    saving,
    onPreview,
    onCancel,
    onSave,
    onOpenBrowser,
    onCopy,
    onClose,
  }: Props = $props();

  const name = $derived(target.name ?? 'file');
  const mime = $derived(mimeForName(name));
  const blocker = $derived(directBlobUrlBlocker(target));
  const progress = $derived(
    preview !== null && preview.total > 0 ? Math.round((preview.loaded / preview.total) * 100) : 0,
  );

  let mediaElement = $state<HTMLMediaElement | null>(null);
  let session: MediaSessionHandle | null = null;

  // The element only exists while an audio/video preview is mounted, so the
  // session's lifetime is exactly the element's.
  $effect(() => {
    const element = mediaElement;
    if (element === null) return;
    session = startMediaSession(element, mediaMetadataFor(name, treeLabel));
    const report = (status: 'playing' | 'paused' | 'stopped') => () =>
      session?.update(status, element.currentTime);
    const onPlay = report('playing');
    const onPause = report('paused');
    const onEnded = report('stopped');
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('ended', onEnded);
    return () => {
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('ended', onEnded);
      session?.close();
      session = null;
    };
  });
</script>

<aside class="panel" aria-label="File details">
  <header class="panel-head">
    <h2 class="panel-title" title={name}>{name}</h2>
    <button type="button" class="btn btn-ghost btn-xs" onclick={onClose} aria-label="Close details">
      ✕
    </button>
  </header>

  <dl class="facts">
    <dt>Size</dt>
    <dd>{target.size === 0 ? 'unknown' : formatBytes(target.size)}</dd>
    <dt>Type</dt>
    <dd>{mime}</dd>
    <dt>Storage</dt>
    <dd>
      {target.type === 0 ? 'single blob' : 'chunked file manifest'}{target.key === null
        ? ''
        : ', encrypted'}
    </dd>
    <dt>Hash</dt>
    <dd><code class="hash" data-napplet-select="all">{target.hash}</code></dd>
  </dl>

  <div class="actions">
    {#if preview === null || preview.status === 'idle' || preview.status === 'error'}
      <button type="button" class="btn btn-sm btn-primary" onclick={onPreview}>Preview</button>
    {:else if preview.status === 'loading'}
      <button type="button" class="btn btn-sm" onclick={onCancel}>Cancel</button>
    {/if}

    {#if directUrl !== null}
      <button type="button" class="btn btn-sm" onclick={onOpenBrowser}>Open in browser</button>
    {/if}

    {#if canSave}
      <button type="button" class="btn btn-sm" disabled={saving} onclick={onSave}>
        {saving ? 'Saving…' : 'Save…'}
      </button>
    {/if}

    <button type="button" class="btn btn-sm btn-ghost" onclick={() => onCopy(htreeUri)}>
      Copy htree://
    </button>
    {#if nhash !== null}
      <button type="button" class="btn btn-sm btn-ghost" onclick={() => onCopy(nhash)}>
        Copy nhash
      </button>
    {/if}
  </div>

  {#if directUrl === null && blocker !== null}
    <p class="note">{blocker}</p>
  {/if}

  {#if preview !== null}
    <div class="preview">
      {#if preview.status === 'loading'}
        <p class="preview-status">
          Fetching {preview.total > 0 ? `${formatBytes(preview.loaded)} of ${formatBytes(preview.total)}` : 'chunks'}…
        </p>
        <progress class="progress" value={progress} max="100"></progress>
      {:else if preview.status === 'error'}
        <p class="preview-status preview-error">{preview.error}</p>
      {:else if preview.status === 'ready'}
        {#if preview.kind === 'image' && preview.url !== null}
          <img class="preview-media" src={preview.url} alt={name} />
        {:else if preview.kind === 'video' && preview.url !== null}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            class="preview-media"
            bind:this={mediaElement}
            src={preview.url}
            controls
            preload="metadata"
          ></video>
        {:else if preview.kind === 'audio' && preview.url !== null}
          <audio
            class="preview-audio"
            bind:this={mediaElement}
            src={preview.url}
            controls
            preload="metadata"
          ></audio>
        {:else if preview.kind === 'text' && preview.text !== null}
          <pre class="preview-text" data-napplet-select="text">{preview.text}</pre>
          {#if preview.truncated}
            <p class="note">Showing the first part of the file only.</p>
          {/if}
        {:else}
          <p class="preview-status">
            No in-napplet preview for this type. Save it to disk to open it elsewhere.
          </p>
        {/if}
      {/if}
    </div>
  {/if}
</aside>
