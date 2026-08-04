import {
  common,
  config,
  identity,
  outbox,
  type NostrEvent,
  type OutboxSubscription,
  type Subscription,
} from '@napplet/sdk';
import './styles.css';
import { DIFFICULTIES, MinesweeperGame, type Difficulty } from './game';
import {
  MINESWEEPER_EVENT_KIND,
  captureGameResult,
  chunkAuthors,
  createGameEventTemplate,
  mergeFeedEntries,
  parseGameEvent,
  type FeedEntry,
  type PublishedGameResult,
} from './social';

const requireElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};

const ui = {
  window: requireElement<HTMLDivElement>('#gameWindow'),
  board: requireElement<HTMLDivElement>('#board'),
  mines: requireElement<HTMLOutputElement>('#mineCounter'),
  timer: requireElement<HTMLOutputElement>('#timer'),
  face: requireElement<HTMLButtonElement>('#faceButton'),
  difficulty: requireElement<HTMLDivElement>('#difficultyPicker'),
  settings: requireElement<HTMLButtonElement>('#settingsButton'),
  hint: requireElement<HTMLParagraphElement>('#gameHint'),
  gameTab: requireElement<HTMLButtonElement>('#gameTab'),
  friendsTab: requireElement<HTMLButtonElement>('#friendsTab'),
  gameView: requireElement<HTMLElement>('#gameView'),
  friendsView: requireElement<HTMLElement>('#friendsView'),
  publishRow: requireElement<HTMLDivElement>('#publishRow'),
  publishButton: requireElement<HTMLButtonElement>('#publishButton'),
  publishMessage: requireElement<HTMLInputElement>('#publishMessage'),
  publishStatus: requireElement<HTMLSpanElement>('#publishStatus'),
  refreshFeed: requireElement<HTMLButtonElement>('#refreshFeed'),
  feedStatus: requireElement<HTMLParagraphElement>('#feedStatus'),
  feedList: requireElement<HTMLDivElement>('#feedList'),
};

const shell = (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
const hasDomain = (domain: string): boolean => Boolean(shell?.[domain]);

let difficulty = DIFFICULTIES[0];
let game = new MinesweeperGame(difficulty);
let startedAt = 0;
let elapsed = 0;
let timerId: number | undefined;
let completedResult: PublishedGameResult | null = null;
let publishState: 'idle' | 'publishing' | 'published' | 'signed-out' | 'error' = 'idle';
let configSubscription: Subscription | null = null;
let identitySubscription: Subscription | null = null;
let feedSubscriptions: OutboxSubscription[] = [];
let feedEntries: FeedEntry[] = [];
let feedLoaded = false;
let currentPubkey: string | null = null;
const profileNames = new Map<string, string>();
const expandedEvents = new Set<string>();

function formatCounter(value: number): string {
  const clamped = Math.max(-99, Math.min(999, value));
  return clamped < 0
    ? `-${String(Math.abs(clamped)).padStart(2, '0')}`
    : String(clamped).padStart(3, '0');
}

function cellLabel(index: number): string {
  const cell = game.cells[index];
  if (!cell) return 'Unknown square';
  const row = Math.floor(index / difficulty.width) + 1;
  const column = (index % difficulty.width) + 1;
  if (game.status === 'lost' && cell.flagged && !cell.mine)
    return `Incorrect flag, row ${row}, column ${column}`;
  if (cell.flagged) return `Flagged square, row ${row}, column ${column}`;
  if (!cell.revealed) return `Covered square, row ${row}, column ${column}`;
  if (cell.mine) return `Mine, row ${row}, column ${column}`;
  return cell.adjacent === 0
    ? `Empty square, row ${row}, column ${column}`
    : `${cell.adjacent} adjacent mines, row ${row}, column ${column}`;
}

function paintCell(button: HTMLButtonElement, index: number): void {
  const cell = game.cells[index];
  if (!cell) return;
  button.className = 'cell';
  button.textContent = '';
  button.dataset.value = '';
  if (cell.revealed) {
    button.classList.add('is-revealed');
    if (cell.mine) {
      button.classList.add(cell.exploded ? 'is-exploded' : 'is-mine');
      button.textContent = '✹';
    } else if (cell.adjacent > 0) {
      button.dataset.value = String(cell.adjacent);
      button.textContent = String(cell.adjacent);
    }
  } else if (cell.flagged) {
    button.classList.add('is-flagged');
    button.textContent = '⚑';
  }
  if (game.status === 'lost' && cell.flagged && !cell.mine) {
    button.classList.add('is-wrong');
    button.textContent = '×';
  }
  button.setAttribute('aria-label', cellLabel(index));
  button.setAttribute('aria-pressed', String(cell.flagged));
  button.disabled = game.status === 'won' || game.status === 'lost';
}

function renderPublish(): void {
  ui.publishRow.hidden = completedResult === null;
  ui.publishButton.disabled = publishState === 'publishing' || publishState === 'published';
  ui.publishMessage.disabled = publishState === 'publishing' || publishState === 'published';
  ui.publishButton.textContent = publishState === 'error' ? 'Retry Publish' : 'Publish Result';
  ui.publishStatus.textContent =
    publishState === 'publishing'
      ? 'Publishing…'
      : publishState === 'published'
        ? 'Published to Nostr.'
        : publishState === 'signed-out'
          ? 'Sign in to publish.'
          : publishState === 'error'
            ? 'Publish failed.'
            : '';
}

function render(): void {
  [...ui.board.querySelectorAll<HTMLButtonElement>('.cell')].forEach((button, index) =>
    paintCell(button, index),
  );
  ui.mines.value = formatCounter(difficulty.mines - game.flags);
  ui.timer.value = formatCounter(elapsed);
  ui.face.textContent = game.status === 'lost' ? '☹' : game.status === 'won' ? '😎' : '☺';
  ui.face.setAttribute('aria-label', game.status === 'ready' ? 'Start a new game' : 'Restart game');
  ui.hint.textContent =
    game.status === 'won'
      ? `You cleared the field in ${elapsed} seconds!`
      : game.status === 'lost'
        ? 'Boom! Select the face to try again.'
        : 'Reveal with click. Flag with right-click. Chord a number with double-click.';
  renderPublish();
}

function buildBoard(): void {
  ui.board.replaceChildren();
  ui.board.style.setProperty('--board-columns', String(difficulty.width));
  ui.board.setAttribute(
    'aria-label',
    `${difficulty.label} minefield, ${difficulty.width} by ${difficulty.height}`,
  );
  const fragment = document.createDocumentFragment();
  game.cells.forEach((_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cell';
    button.dataset.index = String(index);
    fragment.append(button);
  });
  ui.board.append(fragment);
  render();
}

function stopTimer(): void {
  if (timerId !== undefined) window.clearInterval(timerId);
  timerId = undefined;
}

function startTimer(): void {
  if (timerId !== undefined) return;
  startedAt = Date.now() - elapsed * 1000;
  timerId = window.setInterval(() => {
    elapsed = Math.min(999, Math.floor((Date.now() - startedAt) / 1000));
    ui.timer.value = formatCounter(elapsed);
    if (elapsed >= 999) stopTimer();
  }, 250);
}

function newGame(nextDifficulty: Difficulty = difficulty): void {
  stopTimer();
  difficulty = nextDifficulty;
  game = new MinesweeperGame(difficulty);
  elapsed = 0;
  completedResult = null;
  publishState = 'idle';
  ui.publishMessage.value = '';
  for (const button of ui.difficulty.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.difficulty === difficulty.id));
  }
  buildBoard();
}

function afterMove(previousStatus: typeof game.status): void {
  if (previousStatus === 'ready' && game.status === 'playing') startTimer();
  if (game.status === 'won' || game.status === 'lost') {
    stopTimer();
    if (!completedResult) completedResult = captureGameResult(game, difficulty, elapsed);
  }
  render();
}

function indexFromTarget(target: EventTarget | null): number | null {
  const button = target instanceof Element ? target.closest<HTMLButtonElement>('.cell') : null;
  if (!button || !ui.board.contains(button)) return null;
  const index = Number(button.dataset.index);
  return Number.isInteger(index) ? index : null;
}

function showView(view: 'game' | 'friends'): void {
  const friends = view === 'friends';
  ui.gameView.hidden = friends;
  ui.friendsView.hidden = !friends;
  ui.gameTab.setAttribute('aria-selected', String(!friends));
  ui.friendsTab.setAttribute('aria-selected', String(friends));
  if (friends && !feedLoaded) void loadFeed();
}

function closeFeedSubscriptions(): void {
  for (const subscription of feedSubscriptions) subscription.close();
  feedSubscriptions = [];
}

function eventEntry(event: NostrEvent): FeedEntry | null {
  const result = parseGameEvent(event);
  return result ? { event, result } : null;
}

function ingestEvents(events: readonly NostrEvent[]): void {
  const entries = events.flatMap((event) => {
    const entry = eventEntry(event);
    return entry ? [entry] : [];
  });
  feedEntries = mergeFeedEntries(feedEntries, entries);
  renderFeed();
  for (const pubkey of new Set(entries.map((entry) => entry.event.pubkey)))
    void loadProfile(pubkey);
}

async function loadProfile(pubkey: string): Promise<void> {
  if (profileNames.has(pubkey) || !hasDomain('common')) return;
  profileNames.set(pubkey, shortPubkey(pubkey));
  try {
    const result = await common.getProfile(pubkey);
    const name = result.profile?.displayName ?? result.profile?.name;
    if (name) profileNames.set(pubkey, name);
  } catch {
    // A shortened key remains a useful offline-safe fallback.
  }
  renderFeed();
}

async function loadFeed(): Promise<void> {
  closeFeedSubscriptions();
  feedLoaded = true;
  feedEntries = [];
  ui.feedStatus.textContent = 'Loading friends’ games…';
  ui.refreshFeed.disabled = true;
  renderFeed();
  if (!hasDomain('identity') || !hasDomain('outbox')) {
    ui.feedStatus.textContent = 'Friends feed is unavailable in this shell.';
    ui.refreshFeed.disabled = false;
    return;
  }
  try {
    currentPubkey = await identity.getPublicKey();
    if (!currentPubkey) {
      ui.feedStatus.textContent = 'Sign in to see games from you and your friends.';
      ui.refreshFeed.disabled = false;
      return;
    }
    const follows = await identity.getFollows();
    const batches = chunkAuthors([currentPubkey, ...follows]);
    const since = Math.floor(Date.now() / 1000);
    for (const authors of batches) {
      const subscription = outbox.subscribe([{ kinds: [MINESWEEPER_EVENT_KIND], authors, since }], {
        authors,
        limit: 100,
        timeoutMs: 8000,
      });
      subscription.on('event', ({ event }) => ingestEvents([event]));
      feedSubscriptions.push(subscription);
    }
    const results = await Promise.allSettled(
      batches.map((authors) =>
        outbox.query([{ kinds: [MINESWEEPER_EVENT_KIND], authors, limit: 100 }], {
          authors,
          limit: 100,
          timeoutMs: 8000,
        }),
      ),
    );
    ingestEvents(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.events.map((item) => item.event) : [],
      ),
    );
    ui.feedStatus.textContent = feedEntries.length
      ? `Showing ${feedEntries.length} recent game${feedEntries.length === 1 ? '' : 's'}. Live updates are on.`
      : 'No published games from you or your friends yet.';
  } catch {
    ui.feedStatus.textContent = 'Could not load the friends feed. Try Refresh.';
  } finally {
    ui.refreshFeed.disabled = false;
  }
}

function shortPubkey(pubkey: string): string {
  return pubkey.length > 12 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}` : pubkey;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function adjacentCount(result: PublishedGameResult, index: number): number {
  const mines = new Set(result.board.mines);
  const x = index % result.width;
  const y = Math.floor(index / result.width);
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (
        (dx !== 0 || dy !== 0) &&
        nx >= 0 &&
        nx < result.width &&
        ny >= 0 &&
        ny < result.height &&
        mines.has(ny * result.width + nx)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function miniBoard(result: PublishedGameResult): HTMLElement {
  const board = document.createElement('div');
  board.className = 'mini-board';
  board.style.setProperty('--mini-columns', String(result.width));
  const mines = new Set(result.board.mines);
  const flags = new Set(result.board.flags);
  const revealed = new Set(result.board.revealed);
  for (let index = 0; index < result.width * result.height; index += 1) {
    const cell = document.createElement('span');
    cell.className = 'mini-cell';
    if (index === result.board.exploded) cell.classList.add('is-exploded');
    if (mines.has(index)) cell.textContent = '✹';
    else if (flags.has(index)) cell.textContent = '⚑';
    else if (revealed.has(index)) {
      cell.classList.add('is-revealed');
      const adjacent = adjacentCount(result, index);
      cell.textContent = adjacent ? String(adjacent) : '';
    }
    board.append(cell);
  }
  return board;
}

function renderFeed(): void {
  ui.feedList.replaceChildren();
  for (const entry of feedEntries) {
    const item = document.createElement('article');
    item.className = `feed-item is-${entry.result.result}`;
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'feed-summary';
    const difficultyLabel = DIFFICULTIES.find(
      (candidate) => candidate.id === entry.result.difficulty,
    )?.label;
    summary.textContent = `${profileNames.get(entry.event.pubkey) ?? shortPubkey(entry.event.pubkey)} ${entry.result.result === 'won' ? 'won' : 'lost'} · ${difficultyLabel} · ${entry.result.elapsedSeconds}s · ${relativeTime(entry.event.created_at)}`;
    summary.setAttribute('aria-expanded', String(expandedEvents.has(entry.event.id)));
    summary.addEventListener('click', () => {
      if (expandedEvents.has(entry.event.id)) expandedEvents.delete(entry.event.id);
      else expandedEvents.add(entry.event.id);
      renderFeed();
    });
    item.append(summary);
    if (entry.event.content.trim()) {
      const message = document.createElement('p');
      message.className = 'feed-message';
      message.textContent = entry.event.content;
      item.append(message);
    }
    if (expandedEvents.has(entry.event.id)) {
      const scroll = document.createElement('div');
      scroll.className = 'mini-board-scroll';
      scroll.append(miniBoard(entry.result));
      item.append(scroll);
    }
    ui.feedList.append(item);
  }
}

ui.board.addEventListener('click', (event) => {
  const index = indexFromTarget(event.target);
  if (index === null) return;
  const previousStatus = game.status;
  game.reveal(index);
  afterMove(previousStatus);
});

ui.board.addEventListener('dblclick', (event) => {
  const index = indexFromTarget(event.target);
  if (index === null) return;
  event.preventDefault();
  const previousStatus = game.status;
  game.chord(index);
  afterMove(previousStatus);
});

ui.board.addEventListener('auxclick', (event) => {
  if (event.button !== 1) return;
  const index = indexFromTarget(event.target);
  if (index === null) return;
  event.preventDefault();
  const previousStatus = game.status;
  game.chord(index);
  afterMove(previousStatus);
});

ui.board.addEventListener('contextmenu', (event) => {
  const index = indexFromTarget(event.target);
  if (index === null) return;
  event.preventDefault();
  game.toggleFlag(index);
  render();
});

ui.board.addEventListener('pointerdown', (event) => {
  if (indexFromTarget(event.target) !== null && game.status !== 'won' && game.status !== 'lost') {
    ui.face.textContent = '😮';
  }
});
window.addEventListener('pointerup', () => render());

ui.face.addEventListener('click', () => newGame());
ui.gameTab.addEventListener('click', () => showView('game'));
ui.friendsTab.addEventListener('click', () => showView('friends'));
ui.refreshFeed.addEventListener('click', () => void loadFeed());
ui.difficulty.addEventListener('click', (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button[data-difficulty]')
      : null;
  const next = DIFFICULTIES.find((item) => item.id === button?.dataset.difficulty);
  if (next) newGame(next);
});

ui.publishButton.addEventListener('click', async () => {
  if (!completedResult || publishState === 'publishing' || publishState === 'published') return;
  if (!hasDomain('identity') || !hasDomain('outbox')) {
    publishState = 'signed-out';
    renderPublish();
    return;
  }
  publishState = 'publishing';
  renderPublish();
  try {
    currentPubkey = await identity.getPublicKey();
    if (!currentPubkey) {
      publishState = 'signed-out';
    } else {
      const result = await outbox.publish(
        createGameEventTemplate(completedResult, ui.publishMessage.value.trim()),
      );
      publishState = result.ok ? 'published' : 'error';
      if (result.event) ingestEvents([result.event]);
    }
  } catch {
    publishState = 'error';
  }
  renderPublish();
});

if (hasDomain('config')) {
  try {
    configSubscription = config.subscribe((values) => {
      ui.window.classList.toggle('xp-frameless', values.windowFrame === false);
    });
  } catch {
    // The authentic XP frame is the safe default when config is unavailable.
  }
} else {
  ui.settings.hidden = true;
}

if (hasDomain('identity')) {
  try {
    identitySubscription = identity.onChanged(() => {
      currentPubkey = null;
      feedLoaded = false;
      closeFeedSubscriptions();
      if (!ui.friendsView.hidden) void loadFeed();
    });
  } catch {
    // Identity-dependent controls retain their signed-out fallback.
  }
}

ui.settings.addEventListener('click', () => {
  try {
    config.openSettings({ section: 'appearance' });
  } catch {
    ui.settings.hidden = true;
  }
});

window.addEventListener('beforeunload', () => {
  stopTimer();
  closeFeedSubscriptions();
  configSubscription?.close();
  identitySubscription?.close();
});

newGame();
