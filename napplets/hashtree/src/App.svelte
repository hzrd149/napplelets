<script lang="ts">
  import Breadcrumbs from './components/Breadcrumbs.svelte';
  import EntryList from './components/EntryList.svelte';
  import EntryScreen from './components/EntryScreen.svelte';
  import FilePanel from './components/FilePanel.svelte';
  import InspectorView from './components/InspectorView.svelte';
  import MissingNaps from './components/MissingNaps.svelte';
  import TreeSidebar from './components/TreeSidebar.svelte';

  import { directBlobUrl, copyText, openInBrowser, saveToDisk } from './lib/actions.js';
  import { BlobStore, describeResourceLimits } from './lib/blobs.js';
  import { BlobTrace } from './lib/trace.js';
  import { formatBytes } from './lib/bytes.js';
  import type { TreeLink } from './lib/manifest.js';
  import { previewKindFor, mimeForName, TEXT_PREVIEW_BYTES } from './lib/mime.js';
  import { reportCapabilities } from './lib/nap.js';
  import { encodeNhash, formatHtreeUri, parseTreeRef, type TreeRef } from './lib/refs.js';
  import { resolveRoot, type ResolvedRoot } from './lib/resolve.js';
  import { fetchAuthorServers, mergeServers, subscribeUserServers } from './lib/servers.js';
  import {
    DEFAULT_SETTINGS,
    loadRecents,
    mergeRecent,
    openSettings,
    saveRecents,
    subscribeSettings,
    type RecentTree,
    type Settings,
  } from './lib/session.js';
  import {
    isDirectoryLink,
    listDirectory,
    readFile,
    readFileRange,
    resolvePath,
    targetFromLink,
    type TreeTarget,
  } from './lib/tree.js';
  import type { PreviewState, SortKey } from './lib/view.js';

  /** Refuse to hold more than this in memory for a preview. */
  const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

  const capabilityReport = reportCapabilities();

  let settings = $state<Settings>(DEFAULT_SETTINGS);
  let userServers = $state<readonly string[]>([]);
  let authorServers = $state<readonly string[]>([]);

  // The user's own BUD-03 servers lead: they are where the blobs a user browses
  // are most likely to be, and to stay. Configured servers are the fallback for
  // a user who publishes no list; the tree author's list is the last resort.
  const activeServers = $derived(mergeServers(userServers, settings.blossomServers, authorServers));

  // Recording is unconditional: the inspector has to be able to explain fetches
  // that happened before it was opened.
  const trace = new BlobTrace();

  const store = new BlobStore({
    servers: () => activeServers,
    maxCacheBytes: () => settings.maxCacheBytes,
    onEvent: (event) => trace.record(event),
  });

  let stage = $state<'entry' | 'browsing'>('entry');
  let inputValue = $state('');
  let opening = $state(false);
  let entryError = $state<string | null>(null);
  let limitsWarning = $state<string | null>(null);
  let recents = $state<readonly RecentTree[]>([]);
  let notice = $state<string | null>(null);

  let ref = $state<TreeRef | null>(null);
  let resolved = $state<ResolvedRoot | null>(null);
  let dirPath = $state<readonly string[]>([]);
  let entries = $state<readonly TreeLink[]>([]);
  let listing = $state(false);
  let listError = $state<string | null>(null);
  let selected = $state<TreeTarget | null>(null);
  /** The directory being listed, so the inspector has a subject with no file selected. */
  let currentTarget = $state<TreeTarget | null>(null);
  let view = $state<'browse' | 'inspect'>('browse');

  let sortKey = $state<SortKey>('name');
  let sortAscending = $state(true);

  let preview = $state<PreviewState | null>(null);
  let previewController: AbortController | null = null;
  let previewUrl: string | null = null;
  let saving = $state(false);

  let navToken = 0;

  const rootTarget = $derived(
    resolved === null ? null : { hash: resolved.rootHash, key: resolved.rootKey },
  );

  const rootLabel = $derived.by(() => {
    if (ref === null) return 'root';
    return ref.kind === 'mutable' ? ref.treeName : `${ref.rootHash.slice(0, 10)}…`;
  });

  const selectedUri = $derived(
    ref === null || selected === null
      ? ''
      : formatHtreeUri(ref, [...dirPath, selected.name ?? '']),
  );

  const selectedNhash = $derived(
    selected === null ? null : encodeNhash(selected.hash, selected.key),
  );

  const directUrl = $derived(
    selected === null ? null : directBlobUrl(selected, activeServers),
  );

  // Inspect whatever the user is actually looking at: the selected file, or the
  // directory they are in when nothing is selected.
  const inspectTarget = $derived(selected ?? currentTarget);

  const message = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  function flash(text: string): void {
    notice = text;
    setTimeout(() => {
      if (notice === text) notice = null;
    }, 4000);
  }

  // --- lifecycle -----------------------------------------------------------

  $effect(() => subscribeSettings((next) => (settings = next)));

  // Re-runs when the setting is toggled, so a disabled list is never queried at
  // all rather than being fetched and then filtered out.
  $effect(() => {
    if (!settings.useUserServerList) {
      userServers = [];
      return;
    }
    return subscribeUserServers((servers) => (userServers = servers));
  });

  $effect(() => {
    void loadRecents().then((loaded) => (recents = loaded));
    void describeResourceLimits().then((warning) => (limitsWarning = warning));
    return () => {
      previewController?.abort();
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    };
  });

  // --- opening a tree ------------------------------------------------------

  async function open(reference: string): Promise<void> {
    const parsed = parseTreeRef(reference);
    if (!parsed.ok) {
      entryError = parsed.error;
      return;
    }

    opening = true;
    entryError = null;
    try {
      const root = await resolveRoot(parsed.ref);
      ref = parsed.ref;
      resolved = root;

      // BUD-18 gives `htree://` no server hint, so for a mutable root the
      // author's BUD-03 list is the closest thing to one.
      authorServers =
        parsed.ref.kind === 'mutable' && settings.useAuthorServerList
          ? await fetchAuthorServers(parsed.ref.pubkey, parsed.ref.relays)
          : [];

      stage = 'browsing';
      store.clear();
      await navigate([...parsed.ref.path]);

      recents = mergeRecent(recents, {
        reference,
        label: parsed.ref.kind === 'mutable' ? parsed.ref.treeName : `${root.rootHash.slice(0, 10)}…`,
        openedAt: Date.now(),
      });
      void saveRecents(recents);
    } catch (error) {
      entryError = message(error);
      stage = 'entry';
      resolved = null;
      ref = null;
    } finally {
      opening = false;
    }
  }

  function leaveTree(): void {
    navToken += 1;
    clearPreview();
    stage = 'entry';
    ref = null;
    resolved = null;
    entries = [];
    dirPath = [];
    selected = null;
    currentTarget = null;
    view = 'browse';
    listError = null;
    authorServers = [];
  }

  // --- navigation ----------------------------------------------------------

  async function navigate(path: readonly string[]): Promise<void> {
    const root = rootTarget;
    if (root === null) return;

    const token = (navToken += 1);
    listing = true;
    listError = null;

    try {
      const { target, trail } = await resolvePath(store, root, path);
      if (token !== navToken) return;

      if (isDirectoryLink(target.type)) {
        dirPath = path;
        currentTarget = target;
        selected = null;
        clearPreview();
        entries = [];
        const listed = await listDirectory(store, target, {
          onPartial: (partial) => {
            if (token === navToken) entries = [...partial];
          },
        });
        if (token !== navToken) return;
        entries = listed;
      } else {
        // A path that names a file: show its folder and select it.
        const parent = trail.at(-2) ?? root;
        // `trail[0]` is the root, so there is always a directory to fall back to.
        currentTarget = trail.at(-2) ?? trail[0] ?? null;
        dirPath = path.slice(0, -1);
        const listed = await listDirectory(store, parent);
        if (token !== navToken) return;
        entries = listed;
        selectTarget(target);
      }
    } catch (error) {
      if (token === navToken) listError = message(error);
    } finally {
      if (token === navToken) listing = false;
    }
  }

  function onOpenEntry(entry: TreeLink): void {
    if (isDirectoryLink(entry.type)) {
      void navigate([...dirPath, entry.name ?? '']);
      return;
    }
    selectTarget(targetFromLink(entry));
  }

  function selectTarget(target: TreeTarget): void {
    clearPreview();
    selected = target;
    if (settings.autoPreview) void loadPreview();
  }

  function onSort(key: SortKey): void {
    if (sortKey === key) {
      sortAscending = !sortAscending;
      return;
    }
    sortKey = key;
    sortAscending = true;
  }

  // --- preview -------------------------------------------------------------

  function clearPreview(): void {
    previewController?.abort();
    previewController = null;
    if (previewUrl !== null) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    preview = null;
  }

  async function loadPreview(): Promise<void> {
    const target = selected;
    if (target === null) return;

    clearPreview();
    const controller = new AbortController();
    previewController = controller;

    const name = target.name ?? 'file';
    const kind = previewKindFor(name);
    preview = {
      hash: target.hash,
      kind,
      status: 'loading',
      url: null,
      text: null,
      truncated: false,
      error: null,
      loaded: 0,
      total: target.size,
    };

    try {
      let bytes: Uint8Array;
      let truncated = false;

      if (kind === 'text' && target.size > TEXT_PREVIEW_BYTES) {
        // Only the covering chunks are fetched, not the whole file.
        bytes = await readFileRange(store, target, 0, TEXT_PREVIEW_BYTES, {
          signal: controller.signal,
        });
        truncated = true;
      } else {
        bytes = await readFile(store, target, {
          signal: controller.signal,
          maxParallel: settings.maxParallelChunks,
          maxBytes: MAX_PREVIEW_BYTES,
          onProgress: (loaded, total) => {
            if (previewController === controller && preview !== null) {
              preview = { ...preview, loaded, total };
            }
          },
        });
      }

      if (previewController !== controller) return;

      let url: string | null = null;
      let text: string | null = null;
      if (kind === 'text') {
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } else if (kind !== 'none') {
        // Object URLs are opaque-origin and therefore usable only inside this
        // iframe -- which is exactly where they are used.
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeForName(name) }));
        previewUrl = url;
      }

      preview = {
        hash: target.hash,
        kind,
        status: 'ready',
        url,
        text,
        truncated,
        error: null,
        loaded: bytes.length,
        total: bytes.length,
      };
    } catch (error) {
      if (previewController !== controller) return;
      preview = {
        hash: target.hash,
        kind,
        status: 'error',
        url: null,
        text: null,
        truncated: false,
        error: message(error),
        loaded: 0,
        total: target.size,
      };
    }
  }

  function cancelPreview(): void {
    clearPreview();
  }

  // --- file actions --------------------------------------------------------

  async function onSave(): Promise<void> {
    const target = selected;
    if (target === null) return;
    saving = true;
    try {
      const bytes = await readFile(store, target, {
        maxParallel: settings.maxParallelChunks,
      });
      const result = await saveToDisk(bytes, target.name ?? 'download');
      flash(result.ok ? (result.detail ?? 'Saved.') : result.error);
    } catch (error) {
      flash(message(error));
    } finally {
      saving = false;
    }
  }

  async function onOpenBrowser(): Promise<void> {
    if (directUrl === null) return;
    const result = await openInBrowser(directUrl, selected?.name);
    if (!result.ok) flash(result.error);
  }

  async function onCopy(value: string): Promise<void> {
    const result = await copyText(value);
    flash(result.ok ? 'Copied.' : result.error);
  }
</script>

<main class="app">
  <MissingNaps report={capabilityReport} {limitsWarning} />

  {#if capabilityReport.missingEssential.length === 0}
    {#if stage === 'entry'}
      <EntryScreen
        bind:value={inputValue}
        busy={opening}
        error={entryError}
        {recents}
        onOpen={(reference) => void open(reference)}
        onOpenSettings={openSettings}
      />
    {:else}
      <header class="bar">
        <button type="button" class="btn btn-ghost btn-xs" onclick={leaveTree}>← Trees</button>
        <Breadcrumbs
          path={dirPath}
          {rootLabel}
          busy={listing}
          onNavigate={(path) => void navigate(path)}
        />
        <span class="bar-spacer"></span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          class:btn-active={view === 'inspect'}
          aria-pressed={view === 'inspect'}
          disabled={inspectTarget === null}
          title="Show the blob structure and fetches behind what you are looking at"
          onclick={() => (view = view === 'inspect' ? 'browse' : 'inspect')}
        >
          Inspect
        </button>
        {#if resolved !== null}
          <span class="badge badge-ghost bar-source" title={resolved.rootHash}>
            {resolved.source === 'nhash' ? 'pinned' : `kind ${resolved.event?.kind ?? ''}`}
          </span>
        {/if}
      </header>

      {#if resolved !== null && resolved.warnings.length > 0}
        <p class="bar-note">{resolved.warnings.join(' ')}</p>
      {/if}

      {#if view === 'inspect' && inspectTarget !== null}
        <InspectorView
          {store}
          {trace}
          target={inspectTarget}
          label={rootLabel}
          servers={activeServers}
          onCopy={(value) => void onCopy(value)}
          onClose={() => (view = 'browse')}
        />
      {:else}
      <div class="explorer" class:explorer-with-panel={selected !== null}>
        {#if resolved !== null}
          <TreeSidebar
            {store}
            rootHash={resolved.rootHash}
            rootKey={resolved.rootKey}
            {rootLabel}
            currentPath={dirPath}
            onNavigate={(path) => void navigate(path)}
          />
        {/if}

        <div class="explorer-main">
          {#if listError !== null}
            <div class="alert alert-warning explorer-error" role="alert">
              <p>{listError}</p>
            </div>
          {/if}
          <EntryList
            {entries}
            selectedHash={selected?.hash ?? null}
            {listing}
            {sortKey}
            {sortAscending}
            {onSort}
            onOpen={onOpenEntry}
          />
        </div>

        {#if selected !== null}
          <FilePanel
            target={selected}
            treeLabel={rootLabel}
            htreeUri={selectedUri}
            nhash={selectedNhash}
            {directUrl}
            {preview}
            canSave={true}
            {saving}
            onPreview={() => void loadPreview()}
            onCancel={cancelPreview}
            onSave={() => void onSave()}
            onOpenBrowser={() => void onOpenBrowser()}
            onCopy={(value) => void onCopy(value)}
            onClose={() => {
              selected = null;
              clearPreview();
            }}
          />
        {/if}
      </div>
      {/if}

      <footer class="status">
        <span>{entries.length} item{entries.length === 1 ? '' : 's'}</span>
        <span class="status-sep">·</span>
        <span>{activeServers.length} server{activeServers.length === 1 ? '' : 's'}</span>
        {#if selected !== null}
          <span class="status-sep">·</span>
          <span>{formatBytes(selected.size)}</span>
        {/if}
      </footer>
    {/if}
  {/if}

  {#if notice !== null}
    <output class="toast-note" aria-live="polite">{notice}</output>
  {/if}
</main>
