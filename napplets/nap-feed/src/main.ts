import { installThemeClient } from '@napplelets/theme-dsui';
import { config, identity, outbox, type NostrEvent, type RelayEventResult, type Subscription } from '@napplet/sdk';
import { NAPPLET_KIND_NAMED, sortedSummaries, summarizeManifest, upsertNewest, type NappletManifestSummary } from './lib/manifest';
import './styles.css';

interface FeedSettings {
  scanWindowDays: number;
  contactBatchSize: number;
  includeSelf: boolean;
}

type LoadState = 'loading' | 'live' | 'empty' | 'signed-out' | 'error';

const DEFAULT_SETTINGS: FeedSettings = {
  scanWindowDays: 30,
  contactBatchSize: 100,
  includeSelf: true,
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');
const root = app;
const themeHandle = installThemeClient();

let settings = { ...DEFAULT_SETTINGS };
let loadState: LoadState = 'loading';
let statusMessage = 'Starting napplet feed...';
let contactCount = 0;
let scanSettledCount = 0;
let batchCount = 0;
let streamToken = 0;
let copyStatus = '';
let activeSubscriptions: Subscription[] = [];
const manifests = new Map<string, NappletManifestSummary>();

void boot();

async function boot(): Promise<void> {
  render();
  settings = await loadSettings();
  await restartFeed();
}

async function loadSettings(): Promise<FeedSettings> {
  if (!isNapDomainPresent('config')) return { ...DEFAULT_SETTINGS };
  try {
    const values = await config.get();
    return normalizeSettings(values as Record<string, unknown>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeSettings(values: Record<string, unknown>): FeedSettings {
  return {
    scanWindowDays: boundedInteger(values.scanWindowDays, DEFAULT_SETTINGS.scanWindowDays, 1, 365),
    contactBatchSize: boundedInteger(values.contactBatchSize, DEFAULT_SETTINGS.contactBatchSize, 25, 250),
    includeSelf: typeof values.includeSelf === 'boolean' ? values.includeSelf : DEFAULT_SETTINGS.includeSelf,
  };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

async function restartFeed(): Promise<void> {
  const token = streamToken + 1;
  streamToken = token;
  closeFeedSubscriptions();
  manifests.clear();
  contactCount = 0;
  scanSettledCount = 0;
  batchCount = 0;
  loadState = 'loading';
  statusMessage = 'Loading identity and contacts...';
  copyStatus = '';
  render();

  const missingDomains = ['identity', 'outbox'].filter((domain) => !isNapDomainPresent(domain));
  if (missingDomains.length > 0) {
    loadState = 'error';
    statusMessage = `Missing required NAP domain${missingDomains.length === 1 ? '' : 's'}: ${missingDomains.join(', ')}.`;
    render();
    return;
  }

  try {
    const pubkey = await identity.getPublicKey();
    if (token !== streamToken) return;
    if (!pubkey) {
      loadState = 'signed-out';
      statusMessage = 'Connect an identity in the shell to see contacts\' napplets.';
      render();
      return;
    }

    const follows = [...new Set(await identity.getFollows())];
    if (token !== streamToken) return;

    const authors = settings.includeSelf ? unique([pubkey, ...follows]) : follows;
    contactCount = follows.length;
    if (authors.length === 0) {
      loadState = 'empty';
      statusMessage = 'No contacts to scan.';
      render();
      return;
    }

    const since = Math.floor(Date.now() / 1000) - settings.scanWindowDays * 24 * 60 * 60;
    const batches = chunk(authors, settings.contactBatchSize);
    batchCount = batches.length;
    statusMessage = `Scanning ${authors.length.toLocaleString()} author${authors.length === 1 ? '' : 's'} across ${batches.length.toLocaleString()} OUTBOX batch${batches.length === 1 ? '' : 'es'}...`;
    render();

    for (const authorsBatch of batches) {
      if (token !== streamToken) return;
      subscribeBatch(authorsBatch, since, token);
    }
  } catch (error) {
    if (token !== streamToken) return;
    loadState = 'error';
    statusMessage = error instanceof Error ? error.message : 'Could not load the napplet feed.';
    render();
  }
}

function subscribeBatch(authors: string[], since: number, token: number): void {
  const filters = [{ kinds: [NAPPLET_KIND_NAMED], authors, since, limit: 100 }];
  const options = { authors, timeoutMs: 6000 };
  const sub = outbox.subscribe(filters, options);
  activeSubscriptions.push(sub);

  sub.on('event', (result: RelayEventResult) => {
    if (token !== streamToken) return;
    handleManifestResult(result);
    settleLiveState();
  });

  sub.on('closed', () => {
    if (token !== streamToken) return;
    activeSubscriptions = activeSubscriptions.filter((active) => active !== sub);
  });

  void (async () => {
    try {
      const { events } = await outbox.query(filters, options);
      if (token !== streamToken) return;
      for (const result of events) handleManifestResult(result);
    } catch {
      // A live subscription is already open; let it continue and settle this batch.
    } finally {
      if (token !== streamToken) return;
      scanSettledCount += 1;
      settleLiveState();
    }
  })();
}

function handleManifestResult(result: RelayEventResult): void {
  const summary = summarizeManifest(result.event as NostrEvent, relayHintsFromResult(result));
  if (!summary) return;
  if (upsertNewest(manifests, summary)) render();
}

function relayHintsFromResult(result: RelayEventResult): string[] {
  const sidecar = result.sidecar as { relayHints?: unknown; relays?: unknown } | undefined;
  const hints = sidecar?.relayHints ?? sidecar?.relays;
  return Array.isArray(hints) ? hints.filter((hint): hint is string => typeof hint === 'string') : [];
}

function settleLiveState(): void {
  const count = manifests.size;
  if (count > 0) {
    loadState = 'live';
    statusMessage = `Showing ${count.toLocaleString()} napplet${count === 1 ? '' : 's'} from contacts${settings.includeSelf ? ' and you' : ''}.`;
  } else if (scanSettledCount >= batchCount) {
    loadState = 'empty';
    statusMessage = 'No napplet manifests found in the selected scan window.';
  }
  render();
}

function closeFeedSubscriptions(): void {
  for (const sub of activeSubscriptions) sub.close();
  activeSubscriptions = [];
}

function render(): void {
  const items = sortedSummaries(manifests.values());
  root.innerHTML = `
    <main class="shell ${loadState}">
      <section class="status-card" aria-live="polite">
        <div>
          <strong>${escapeHtml(statusMessage)}</strong>
          <span>${contactCount.toLocaleString()} contacts · includes you · no artifact downloads</span>
        </div>
        <button class="refresh" type="button" data-action="refresh">Refresh</button>
        ${copyStatus ? `<p class="copy-status">${escapeHtml(copyStatus)}</p>` : ''}
      </section>

      ${renderBody(items)}
    </main>
  `;

  root.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener('click', () => {
    void restartFeed();
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy-naddr]')) {
    button.addEventListener('click', () => {
      void copyNaddr(button.dataset.copyNaddr ?? '', button.dataset.copyTitle ?? 'napplet');
    });
  }
}

function renderBody(items: NappletManifestSummary[]): string {
  if (loadState === 'signed-out' || loadState === 'error' || (loadState === 'empty' && items.length === 0)) {
    return `<section class="empty"><h2>${stateTitle(loadState)}</h2><p>${escapeHtml(statusMessage)}</p></section>`;
  }

  return `
    <section class="feed" aria-label="Napplet manifests">
      ${items.map(renderCard).join('')}
      ${items.length === 0 ? '<article class="skeleton"><span></span><span></span><span></span></article>' : ''}
    </section>
  `;
}

function renderCard(item: NappletManifestSummary): string {
  const requires = item.requires.length > 0 ? item.requires : ['No special access listed'];
  const archetypes = item.archetypes.length > 0 ? item.archetypes : ['General napplet'];
  const buildLabel = item.isSingleFile ? 'Ready for sandboxed shells' : `${item.pathCount} files listed`;
  const settingsLabel = item.hasConfig ? 'Has settings' : 'No settings listed';

  return `
    <article class="nap-card">
      <div class="card-main">
        <p class="publisher">Published by a contact · Updated ${formatTime(item.createdAt)}</p>
        <h2>${escapeHtml(item.title)}</h2>
        <p class="description">${escapeHtml(item.description || 'No description tag published.')}</p>
      </div>
      <div class="copy-box">
        <button type="button" data-copy-naddr="${escapeHtml(item.naddr)}" data-copy-title="${escapeHtml(item.title)}">Copy naddr</button>
        <details>
          <summary>Show reference</summary>
          <input readonly value="nostr:${escapeHtml(item.naddr)}" aria-label="naddr for ${escapeHtml(item.title)}" />
        </details>
      </div>
      <div class="friendly-facts" aria-label="Napplet details">
        <span>${escapeHtml(buildLabel)}</span>
        <span>${escapeHtml(settingsLabel)}</span>
        <span>App id: ${escapeHtml(item.identifier)}</span>
      </div>
      <p class="section-label">Needs from the shell</p>
      <div class="chips" aria-label="Shell capabilities needed">
        ${requires.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}
      </div>
      <p class="section-label">Works well as</p>
      <div class="chips subtle" aria-label="Suggested uses">
        ${archetypes.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}
      </div>
    </article>
  `;
}

async function copyNaddr(naddr: string, title: string): Promise<void> {
  const text = `nostr:${naddr}`;
  try {
    await navigator.clipboard?.writeText(text);
    copyStatus = `Copied ${title} naddr.`;
  } catch {
    const input = [...root.querySelectorAll<HTMLInputElement>('input[readonly]')].find((candidate) => candidate.value === text);
    input?.focus();
    input?.select();
    copyStatus = 'Clipboard was unavailable; the naddr field is selected for manual copy.';
  }
  render();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function isNapDomainPresent(domain: string): boolean {
  const napplet = (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
  return Boolean(napplet?.[domain]);
}

function stateTitle(state: LoadState): string {
  if (state === 'signed-out') return 'No identity connected';
  if (state === 'error') return 'Feed unavailable';
  return 'Nothing found yet';
}

function formatTime(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

globalThis.addEventListener('beforeunload', () => {
  closeFeedSubscriptions();
  themeHandle.close();
});
