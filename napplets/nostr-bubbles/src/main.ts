import '@napplelets/theme-hypr/styles.css';
import { installThemeClient } from '@napplelets/theme-hypr';
import {
  common,
  config,
  identity,
  outbox,
  relay,
  resource,
  type RelayEventResult,
  type Subscription,
} from '@napplet/sdk';
import './styles.css';
import { getAvatarShapeMaskUrl } from './lib/avatar-shape';
import {
  BUBBLE_SPAWN_RATE_WINDOW,
  DEFAULT_SETTINGS,
  EXPLOSION_DURATION,
  EXPLOSION_PARTICLE_ANGLES,
  MAX_BUBBLES,
  MAX_CRACKS,
  MAX_ROOT_BUBBLES,
  ZAP_TRAIL_DURATION,
  clampNumber,
  chunk,
  getAutoBubbleTarget,
  getBubbleLifetime,
  getDiscArea,
  getRoleRadiusRange,
  isPersistentBubbleRole,
  pruneForBubbleArea,
  randomBetween,
  type Bubble,
  type BubbleRole,
  type BubbleSettings,
} from './lib/bubble-model';
import {
  KIND_ONCHAIN_ZAP,
  KIND_REACTION,
  KIND_TEXT_NOTE,
  KIND_ZAP_RECEIPT,
  getMessagePreview,
  getOnchainZapAmountSats,
  getReactionEmoji,
  getReactionTargetEventId,
  getZapAmountSats,
  getZapSenderPubkey,
  isSelfOnchainZap,
  parseThreadReference,
  sanitizeHttpsUrl,
} from './lib/event-parsing';
import type { NostrEvent, NostrFilter } from './lib/nostr';

type ConnectionState = 'connecting' | 'live' | 'offline' | 'no-identity' | 'no-contacts' | 'error';

interface ProfileCacheEntry {
  imageUrl: string;
  shape?: string;
  objectUrl?: string;
}

interface ThreadLink {
  id: string;
  from: Bubble;
  to: Bubble;
  relation: 'root' | 'reply';
}

const DEFAULT_PROFILE_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 160 160%22%3E%3Cdefs%3E%3CradialGradient id=%22g%22 cx=%2235%25%22 cy=%2225%25%22 r=%2275%25%22%3E%3Cstop offset=%220%25%22 stop-color=%22%23f0f9ff%22/%3E%3Cstop offset=%2245%25%22 stop-color=%22%239be564%22/%3E%3Cstop offset=%22100%25%22 stop-color=%22%23e5c464%22/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width=%22160%22 height=%22160%22 rx=%2280%22 fill=%22url(%23g)%22/%3E%3Ccircle cx=%2280%22 cy=%2265%22 r=%2228%22 fill=%22white%22 fill-opacity=%22.9%22/%3E%3Cpath d=%22M36 134c8-28 26-43 44-43s36 15 44 43%22 fill=%22white%22 fill-opacity=%22.78%22/%3E%3C/svg%3E';
const PROFILE_CACHE_LIMIT = 500;
const ROOT_CACHE_LIMIT = 400;
const RECENT_EVENT_LIMIT = 800;
const STREAM_SINCE_SECONDS = 8;
const MAX_FILTER_AUTHORS = 200;
// Mirrored from ../nostr-tv-bubbles/src/lib/appRelays.ts default app relays.
const POPULAR_RELAYS = [
  'wss://relay.ditto.pub',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
] as const;

const themeHandle = installThemeClient();

const elements = {
  app: requireElement<HTMLElement>('#app'),
  effects: requireElement<SVGSVGElement>('#effects'),
  bubbleLayer: requireElement<HTMLDivElement>('#bubbleLayer'),
  footerBar: requireElement<HTMLButtonElement>('#footerBar'),
  status: requireElement<HTMLOutputElement>('#status'),
  message: requireElement<HTMLParagraphElement>('#message'),
  contactCount: requireElement<HTMLElement>('#contactCount'),
  noteCount: requireElement<HTMLElement>('#noteCount'),
  satsCount: requireElement<HTMLElement>('#satsCount'),
  orbCount: requireElement<HTMLElement>('#orbCount'),
  settingsOverlay: requireElement<HTMLElement>('#settingsOverlay'),
  closeSettingsButton: requireElement<HTMLButtonElement>('#closeSettingsButton'),
  openSettingsButton: requireElement<HTMLButtonElement>('#openSettingsButton'),
  restartButton: requireElement<HTMLButtonElement>('#restartButton'),
  emptyState: requireElement<HTMLElement>('#emptyState'),
};

let identitySubscription: Subscription | null = null;
let configSubscription: Subscription | null = null;
let nostrSubscriptions: Subscription[] = [];
let activeOutboxStreams = 0;
let streamToken = 0;
let animationFrame = 0;
let lastFrame: number | undefined;
let renderTime = performance.now();
let connectionState: ConnectionState = 'connecting';
let contactCount = 0;
let noteCount = 0;
let zapCount = 0;
let satsCount = 0;
let settings: BubbleSettings = { ...DEFAULT_SETTINGS };
let bubbles: Bubble[] = [];

const profileCache = new Map<string, ProfileCacheEntry>();
const pendingProfiles = new Set<string>();
const rootEventCache = new Map<string, NostrEvent | null>();
const pendingRoots = new Set<string>();
const recentEvents = new Set<string>();
let spawnTimestamps: number[] = [];

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function isNapDomainPresent(domain: string): boolean {
  const napplet = (globalThis as unknown as { napplet?: Record<string, unknown> }).napplet;
  return Boolean(napplet?.[domain]);
}

function normalizeSettings(values: Record<string, unknown>): BubbleSettings {
  const mode = values.bubbleDensityMode === 'manual' ? 'manual' : 'auto';
  return {
    sourceMode: values.sourceMode === 'contacts' ? 'contacts' : 'popular',
    bubbleDensityMode: mode,
    bubbleTargetCount: clampNumber(
      Number(values.bubbleTargetCount ?? DEFAULT_SETTINGS.bubbleTargetCount),
      8,
      96,
    ),
    enableReactions: values.enableReactions !== false,
    includeZaps: values.includeZaps !== false,
    includeOnchainZaps: values.includeOnchainZaps !== false,
    zapBreaksBubbles: values.zapBreaksBubbles !== false,
  };
}

function setConnectionState(next: ConnectionState, message: string): void {
  connectionState = next;
  elements.status.className = `footer-status status-${next}`;
  elements.status.textContent = next.replace('-', ' ');
  elements.message.textContent = message;
}

function updateStats(): void {
  elements.contactCount.textContent = contactCount.toLocaleString();
  elements.noteCount.textContent = noteCount.toLocaleString();
  elements.satsCount.textContent = satsCount.toLocaleString();
  elements.orbCount.textContent = bubbles.length.toLocaleString();
  elements.emptyState.classList.toggle('hidden', bubbles.length > 0 || connectionState === 'live');
}

function stageSize(): { width: number; height: number } {
  const rect = elements.app.getBoundingClientRect();
  return {
    width: Math.max(160, rect.width),
    height: Math.max(160, rect.height),
  };
}

function currentBubbleTarget(width: number, height: number): number {
  return settings.bubbleDensityMode === 'auto'
    ? getAutoBubbleTarget(width, height)
    : settings.bubbleTargetCount;
}

function closeNostrSubscriptions(): void {
  for (const subscription of nostrSubscriptions) subscription.close();
  nostrSubscriptions = [];
  activeOutboxStreams = 0;
}

function resetStreamState(): void {
  closeNostrSubscriptions();
  recentEvents.clear();
  pendingProfiles.clear();
  pendingRoots.clear();
  rootEventCache.clear();
  spawnTimestamps = [];
  bubbles = [];
  noteCount = 0;
  zapCount = 0;
  satsCount = 0;
  updateStats();
}

async function startStream(): Promise<void> {
  const token = ++streamToken;
  resetStreamState();
  contactCount = 0;
  setConnectionState(
    'connecting',
    settings.sourceMode === 'contacts'
      ? 'Reading shell identity and follows...'
      : 'Opening popular relay streams...',
  );
  updateStats();

  if (settings.sourceMode !== 'contacts') {
    startPopularRelayStream(token);
    return;
  }

  if (!isNapDomainPresent('identity') || !isNapDomainPresent('outbox')) {
    setConnectionState('error', 'This shell did not grant NAP-IDENTITY and NAP-OUTBOX.');
    return;
  }

  let pubkey = '';
  try {
    pubkey = await identity.getPublicKey();
  } catch (error) {
    setConnectionState('error', error instanceof Error ? error.message : 'Identity lookup failed.');
    return;
  }
  if (token !== streamToken) return;
  if (!pubkey) {
    setConnectionState(
      'no-identity',
      'Connect an identity in the shell to watch your one-hop contact orbit.',
    );
    return;
  }

  let follows: string[] = [];
  try {
    follows = [...new Set(await identity.getFollows())];
  } catch (error) {
    setConnectionState(
      'error',
      error instanceof Error ? error.message : 'Could not load follows from NAP-IDENTITY.',
    );
    return;
  }
  if (token !== streamToken) return;
  contactCount = follows.length;
  updateStats();
  if (follows.length === 0) {
    setConnectionState('no-contacts', 'Your identity has no contacts to watch.');
    return;
  }

  const kinds = [KIND_TEXT_NOTE, KIND_REACTION];
  if (settings.includeZaps) kinds.push(KIND_ZAP_RECEIPT);
  if (settings.includeOnchainZaps) kinds.push(KIND_ONCHAIN_ZAP);
  const since = Math.floor(Date.now() / 1000) - STREAM_SINCE_SECONDS;
  const batches = chunk(follows, MAX_FILTER_AUTHORS);
  setConnectionState(
    'connecting',
    `Opening ${batches.length.toLocaleString()} contact batch stream${batches.length === 1 ? '' : 's'}...`,
  );

  for (const authors of batches) {
    if (token !== streamToken) return;
    subscribeAuthorBatch(authors, kinds, since, token);
  }
}

function subscribeAuthorBatch(
  authors: string[],
  kinds: number[],
  since: number,
  token: number,
): void {
  const filters: NostrFilter[] = [{ kinds, authors, since, limit: 60 }];
  const options = { authors, timeoutMs: 5000 };
  const sub = outbox.subscribe(filters, options);
  activeOutboxStreams += 1;
  sub.on('event', (result: RelayEventResult) => {
    if (token !== streamToken) return;
    setConnectionState(
      'live',
      `Watching ${contactCount.toLocaleString()} one-hop contacts through NAP-OUTBOX.`,
    );
    handleIncomingEvent(result.event as NostrEvent);
  });
  sub.on('closed', () => {
    if (token !== streamToken) return;
    activeOutboxStreams = Math.max(0, activeOutboxStreams - 1);
    if (activeOutboxStreams === 0)
      setConnectionState('offline', 'The live stream closed. Try restarting.');
  });
  nostrSubscriptions.push(sub);

  void (async () => {
    try {
      const { events } = await outbox.query(filters, options);
      if (token !== streamToken) return;
      for (const result of events) handleIncomingEvent(result.event as NostrEvent);
      setConnectionState(
        'live',
        `Watching ${contactCount.toLocaleString()} one-hop contacts through NAP-OUTBOX.`,
      );
    } catch {
      if (token === streamToken && connectionState === 'connecting')
        setConnectionState('offline', 'Initial OUTBOX scan failed; waiting for live events.');
    }
  })();
}

function startPopularRelayStream(token: number): void {
  if (!isNapDomainPresent('relay')) {
    setConnectionState('error', 'This shell did not grant NAP-RELAY for popular relay mode.');
    return;
  }

  const kinds = [KIND_TEXT_NOTE, KIND_REACTION];
  if (settings.includeZaps) kinds.push(KIND_ZAP_RECEIPT);
  if (settings.includeOnchainZaps) kinds.push(KIND_ONCHAIN_ZAP);
  const filters: NostrFilter[] = [
    { kinds, since: Math.floor(Date.now() / 1000) - STREAM_SINCE_SECONDS, limit: 120 },
  ];
  contactCount = POPULAR_RELAYS.length;
  updateStats();

  for (const relayUrl of POPULAR_RELAYS) {
    const sub = relay.subscribe(
      filters,
      (result: RelayEventResult) => {
        if (token !== streamToken) return;
        setConnectionState(
          'live',
          `Watching ${POPULAR_RELAYS.length.toLocaleString()} popular relays through NAP-RELAY.`,
        );
        handleIncomingEvent(result.event as NostrEvent);
      },
      () => {
        if (token === streamToken && connectionState === 'connecting') {
          setConnectionState(
            'live',
            `Watching ${POPULAR_RELAYS.length.toLocaleString()} popular relays through NAP-RELAY.`,
          );
        }
      },
      { relay: relayUrl },
    );
    nostrSubscriptions.push(sub);
  }
}

function rememberEvent(id: string): boolean {
  if (recentEvents.has(id)) return false;
  recentEvents.add(id);
  while (recentEvents.size > RECENT_EVENT_LIMIT) {
    const oldest = recentEvents.values().next().value as string | undefined;
    if (!oldest) break;
    recentEvents.delete(oldest);
  }
  return true;
}

function handleIncomingEvent(event: NostrEvent): void {
  if (!rememberEvent(event.id)) return;
  if (event.kind === KIND_TEXT_NOTE) handleIncomingNote(event);
  else if (event.kind === KIND_REACTION && settings.enableReactions) handleIncomingReaction(event);
  else if (event.kind === KIND_ZAP_RECEIPT && settings.includeZaps) handleIncomingZap(event);
  else if (event.kind === KIND_ONCHAIN_ZAP && settings.includeOnchainZaps)
    handleIncomingOnchainZap(event);
}

function handleIncomingNote(event: NostrEvent): void {
  noteCount += 1;
  updateStats();
  const thread = parseThreadReference(event);
  const role: BubbleRole = thread ? 'reply' : 'note';
  const radiusRange = getRoleRadiusRange(role);
  const radius = randomBetween(radiusRange[0], radiusRange[1]);
  void fetchProfileAndSpawn(event, {
    role,
    radius,
    rootEventId: thread?.root.eventId,
    replyEventId: thread?.reply?.eventId,
  });

  if (thread?.root && thread.root.eventId !== event.id) {
    void fetchReferencedNoteAndSpawn(thread.root, { role: 'root', maxRadius: radius });
  }
  if (
    thread?.reply &&
    thread.reply.eventId !== event.id &&
    thread.reply.eventId !== thread.root.eventId
  ) {
    void fetchReferencedNoteAndSpawn(thread.reply, {
      role: 'reply',
      rootEventId: thread.root.eventId,
      maxRadius: radius,
    });
  }
}

function handleIncomingReaction(event: NostrEvent): void {
  const targetEventId = getReactionTargetEventId(event);
  if (!targetEventId) return;
  if (
    !bubbles.some(
      (bubble) =>
        bubble.eventId === targetEventId && bubble.role !== 'reaction' && bubble.role !== 'zap',
    )
  )
    return;
  void fetchProfileAndSpawn(
    { ...event, content: getReactionEmoji(event.content) },
    { role: 'reaction', rootEventId: targetEventId },
  );
}

function handleIncomingZap(event: NostrEvent): void {
  const sender = getZapSenderPubkey(event);
  const amount = getZapAmountSats(event);
  if (!sender || !amount) return;
  zapCount += 1;
  satsCount += amount;
  updateStats();
  void fetchProfileAndSpawn(
    { ...event, pubkey: sender, content: '' },
    { role: 'zap', zapAmountSats: amount },
  );
}

function handleIncomingOnchainZap(event: NostrEvent): void {
  const amount = getOnchainZapAmountSats(event);
  if (!amount || isSelfOnchainZap(event)) return;
  zapCount += 1;
  satsCount += amount;
  updateStats();
  void fetchProfileAndSpawn({ ...event, content: '' }, { role: 'zap', zapAmountSats: amount });
}

interface SpawnOptions {
  role?: BubbleRole;
  rootEventId?: string;
  replyEventId?: string;
  reuseExisting?: boolean;
  zapAmountSats?: number;
  radius?: number;
  maxRadius?: number;
}

async function fetchProfileAndSpawn(event: NostrEvent, options: SpawnOptions = {}): Promise<void> {
  const cached = profileCache.get(event.pubkey);
  const messagePreview =
    options.role === 'zap'
      ? `${formatSats(options.zapAmountSats ?? 0)} sats`
      : getMessagePreview(event.content);
  if (cached) {
    spawnBubble(event, cached.imageUrl, cached.shape, messagePreview, options);
    return;
  }
  if (pendingProfiles.has(event.pubkey) && !options.reuseExisting) {
    spawnBubble(event, DEFAULT_PROFILE_IMAGE, undefined, messagePreview, options);
    return;
  }
  pendingProfiles.add(event.pubkey);
  try {
    const result = await common.getProfile(event.pubkey);
    const picture =
      typeof result.profile?.picture === 'string' ? result.profile.picture : undefined;
    const shape = typeof result.profile?.shape === 'string' ? result.profile.shape : undefined;
    const entry = await resolveProfileImage(picture);
    entry.shape = shape;
    cacheProfile(event.pubkey, entry);
    spawnBubble(event, entry.imageUrl, shape, messagePreview, options);
  } catch {
    const entry = { imageUrl: DEFAULT_PROFILE_IMAGE };
    cacheProfile(event.pubkey, entry);
    spawnBubble(event, DEFAULT_PROFILE_IMAGE, undefined, messagePreview, options);
  } finally {
    pendingProfiles.delete(event.pubkey);
  }
}

async function resolveProfileImage(picture: string | undefined): Promise<ProfileCacheEntry> {
  const url = sanitizeHttpsUrl(picture);
  if (!url || !isNapDomainPresent('resource')) return { imageUrl: DEFAULT_PROFILE_IMAGE };
  try {
    const blob = await resource.bytes(url);
    const objectUrl = URL.createObjectURL(blob);
    return { imageUrl: objectUrl, objectUrl };
  } catch {
    return { imageUrl: DEFAULT_PROFILE_IMAGE };
  }
}

function cacheProfile(pubkey: string, entry: ProfileCacheEntry): void {
  profileCache.set(pubkey, entry);
  while (profileCache.size > PROFILE_CACHE_LIMIT) {
    const oldest = profileCache.keys().next().value as string | undefined;
    if (!oldest) break;
    const removed = profileCache.get(oldest);
    if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
    profileCache.delete(oldest);
  }
}

async function fetchReferencedNoteAndSpawn(
  reference: { eventId: string; authorHint?: string },
  options: SpawnOptions,
): Promise<void> {
  const cached = rootEventCache.get(reference.eventId);
  if (cached) {
    void fetchProfileAndSpawn(cached, { ...options, reuseExisting: true });
    return;
  }
  if (cached === null || pendingRoots.has(reference.eventId)) return;
  pendingRoots.add(reference.eventId);
  try {
    const lookup = await outbox.getEvent(reference.eventId, {
      author: reference.authorHint,
      timeoutMs: 3000,
    });
    const found = lookup.result?.event as NostrEvent | undefined;
    rootEventCache.set(reference.eventId, found ?? null);
    while (rootEventCache.size > ROOT_CACHE_LIMIT) {
      const oldest = rootEventCache.keys().next().value as string | undefined;
      if (!oldest) break;
      rootEventCache.delete(oldest);
    }
    if (found) void fetchProfileAndSpawn(found, { ...options, reuseExisting: true });
  } finally {
    pendingRoots.delete(reference.eventId);
  }
}

function spawnBubble(
  event: NostrEvent,
  imageUrl: string,
  shape: string | undefined,
  messagePreview: string,
  options: SpawnOptions = {},
): void {
  const { width, height } = stageSize();
  const role = options.role ?? 'note';
  const radiusRange = getRoleRadiusRange(role);
  const radius = Math.min(
    options.radius ?? randomBetween(radiusRange[0], radiusRange[1]),
    options.maxRadius ?? Number.POSITIVE_INFINITY,
  );
  const now = performance.now();
  const targetCount = currentBubbleTarget(width, height);
  spawnTimestamps = [...spawnTimestamps, now].filter(
    (timestamp) => now - timestamp <= BUBBLE_SPAWN_RATE_WINDOW,
  );
  const spawnRate = spawnTimestamps.length / (BUBBLE_SPAWN_RATE_WINDOW / 1000);
  const lifetime = getBubbleLifetime(role, targetCount, spawnRate) * randomBetween(0.88, 1.12);
  const maxBubbles = Math.min(MAX_BUBBLES, targetCount + 12);

  if (options.reuseExisting) {
    const existing = bubbles.find((bubble) => bubble.eventId === event.id && bubble.role === role);
    if (existing) {
      existing.expiresAt = Math.max(existing.expiresAt, now + lifetime);
      existing.messagePreview = messagePreview;
      existing.imageUrl = imageUrl;
      existing.shape = shape;
      updateStats();
      return;
    }
  }

  let nextBubbles = bubbles;
  if (role === 'root') {
    const roots = nextBubbles.filter((bubble) => bubble.role === 'root');
    if (roots.length >= MAX_ROOT_BUBBLES)
      nextBubbles = nextBubbles.filter((bubble) => bubble.id !== roots[0]?.id);
  }
  const incomingArea = isPersistentBubbleRole(role) ? getDiscArea(radius) : 0;
  nextBubbles =
    incomingArea > 0 ? pruneForBubbleArea(nextBubbles, incomingArea, width * height) : nextBubbles;

  const startsFromLeft = Math.random() > 0.5;
  const roleSpeed =
    role === 'root'
      ? randomBetween(36, 96)
      : role === 'zap'
        ? randomBetween(620, 1040)
        : role === 'reaction'
          ? randomBetween(360, 720)
          : randomBetween(70, 210);
  const baseAngle =
    role === 'zap'
      ? randomBetween(-Math.PI * 0.32, Math.PI * 0.32)
      : role === 'reaction'
        ? randomBetween(-Math.PI * 0.11, Math.PI * 0.11)
        : randomBetween(0, Math.PI * 2);
  const angle = startsFromLeft ? baseAngle : Math.PI - baseAngle;
  const x =
    role === 'zap'
      ? startsFromLeft
        ? -radius * randomBetween(2.6, 6)
        : width + radius * randomBetween(2.6, 6)
      : role === 'reaction'
        ? startsFromLeft
          ? -radius * randomBetween(3.2, 8)
          : width + radius * randomBetween(3.2, 8)
        : randomBetween(radius, Math.max(radius, width - radius));
  const y =
    role === 'zap' || role === 'reaction'
      ? randomBetween(radius + 80, Math.max(radius + 80, height - radius))
      : randomBetween(radius + 84, Math.max(radius + 84, height - radius));
  const bubble: Bubble = {
    id: `${event.id}-${role}-${now}-${Math.random().toString(36).slice(2)}`,
    eventId: event.id,
    pubkey: event.pubkey,
    imageUrl,
    shape,
    messagePreview,
    x,
    y,
    vx: Math.cos(role === 'zap' || role === 'reaction' ? angle : baseAngle) * roleSpeed,
    vy: Math.sin(role === 'zap' || role === 'reaction' ? angle : baseAngle) * roleSpeed,
    radius,
    createdAt: now,
    expiresAt: now + lifetime,
    hue:
      role === 'root'
        ? randomBetween(34, 62)
        : role === 'zap'
          ? randomBetween(42, 55)
          : role === 'reaction'
            ? randomBetween(280, 340)
            : randomBetween(88, 210),
    role,
    rootEventId: options.rootEventId,
    replyEventId: options.replyEventId,
    zapAmountSats: options.zapAmountSats,
    trail: role === 'zap' ? [{ x, y, time: now }] : undefined,
    enteredViewport: role === 'zap' ? false : undefined,
    targetSpeed: role === 'zap' ? roleSpeed : undefined,
  };
  bubbles = [...nextBubbles.slice(Math.max(0, nextBubbles.length - maxBubbles + 1)), bubble];
  updateStats();
}

function animate(time: number): void {
  const previous = lastFrame ?? time;
  const delta = Math.min(0.032, (time - previous) / 1000);
  lastFrame = time;
  renderTime = time;
  const { width, height } = stageSize();
  const updated = bubbles
    .filter((bubble) => bubble.expiresAt > time)
    .map((bubble) => ({ ...bubble, trail: bubble.trail ? [...bubble.trail] : undefined }));

  for (const bubble of updated) {
    bubble.x += bubble.vx * delta;
    bubble.y += bubble.vy * delta;
    if (bubble.role === 'reaction') {
      const padding = Math.max(180, bubble.radius * 8);
      if (
        bubble.x < -padding ||
        bubble.x > width + padding ||
        bubble.y < -padding ||
        bubble.y > height + padding
      )
        bubble.expiresAt = time;
      continue;
    }
    if (bubble.role === 'zap') {
      const inside =
        bubble.x - bubble.radius >= 0 &&
        bubble.x + bubble.radius <= width &&
        bubble.y - bubble.radius >= 0 &&
        bubble.y + bubble.radius <= height;
      bubble.enteredViewport ||= inside;
      if (bubble.enteredViewport) bounceOffEdges(bubble, width, height);
      if (bubble.targetSpeed && bubble.enteredViewport) {
        const speed = Math.hypot(bubble.vx, bubble.vy);
        if (speed > 0.1 && speed < bubble.targetSpeed) {
          const nextSpeed = speed + (bubble.targetSpeed - speed) * (1 - Math.exp(-0.5 * delta));
          bubble.vx *= nextSpeed / speed;
          bubble.vy *= nextSpeed / speed;
        }
      }
      bubble.trail = [...(bubble.trail ?? []), { x: bubble.x, y: bubble.y, time }]
        .filter((point) => time - point.time <= ZAP_TRAIL_DURATION)
        .slice(-34);
      continue;
    }
    bounceOffEdges(bubble, width, height);
  }
  applyCollisions(updated, time);
  bubbles = updated;
  render();
  animationFrame = window.requestAnimationFrame(animate);
}

function bounceOffEdges(bubble: Bubble, width: number, height: number): void {
  if (bubble.x - bubble.radius < 0) {
    bubble.x = bubble.radius;
    bubble.vx = Math.abs(bubble.vx);
  } else if (bubble.x + bubble.radius > width) {
    bubble.x = width - bubble.radius;
    bubble.vx = -Math.abs(bubble.vx);
  }
  if (bubble.y - bubble.radius < 0) {
    bubble.y = bubble.radius;
    bubble.vy = Math.abs(bubble.vy);
  } else if (bubble.y + bubble.radius > height) {
    bubble.y = height - bubble.radius;
    bubble.vy = -Math.abs(bubble.vy);
  }
}

function applyCollisions(items: Bubble[], time: number): void {
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!;
      const b = items[j]!;
      if (
        a.role === 'reaction' ||
        b.role === 'reaction' ||
        a.explodingAt !== undefined ||
        b.explodingAt !== undefined
      )
        continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const minDistance = a.radius + b.radius;
      if (distance >= minDistance) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const totalMass = a.radius * a.radius + b.radius * b.radius;
      const aShare = a.role === 'zap' ? 0 : (b.radius * b.radius) / totalMass;
      const bShare = b.role === 'zap' ? 0 : (a.radius * a.radius) / totalMass;
      a.x -= nx * overlap * aShare;
      a.y -= ny * overlap * aShare;
      b.x += nx * overlap * bShare;
      b.y += ny * overlap * bShare;
      const impact = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (impact >= 0) continue;
      const restitution = a.role === 'zap' || b.role === 'zap' ? 1.08 : 0.96;
      const aMass = a.radius * a.radius;
      const bMass = b.radius * b.radius;
      const impulse = (-(1 + restitution) * impact) / (1 / aMass + 1 / bMass);
      maybeCrackBubble(a, b, time);
      a.vx -= (impulse * nx) / aMass;
      a.vy -= (impulse * ny) / aMass;
      b.vx += (impulse * nx) / bMass;
      b.vy += (impulse * ny) / bMass;
    }
  }
}

function maybeCrackBubble(a: Bubble, b: Bubble, time: number): void {
  if (!settings.zapBreaksBubbles) return;
  const zap = a.role === 'zap' ? a : b.role === 'zap' ? b : null;
  const target = zap === a ? b : zap === b ? a : null;
  if (!zap || !target || !isPersistentBubbleRole(target.role)) return;
  const speed = Math.hypot(zap.vx, zap.vy);
  if (zap.targetSpeed == null || speed < zap.targetSpeed * 0.9) return;
  target.cracks = (target.cracks ?? 0) + 1;
  if (target.cracks >= MAX_CRACKS) {
    target.explodingAt = time;
    target.expiresAt = time + EXPLOSION_DURATION;
    target.vx *= 0.18;
    target.vy *= 0.18;
  }
}

function render(): void {
  renderEffects();
  renderBubbles();
  updateStats();
}

function renderEffects(): void {
  const links = buildThreadLinks();
  const zapTrails = bubbles.filter(
    (bubble) => bubble.role === 'zap' && bubble.trail && bubble.trail.length > 1,
  );
  elements.effects.replaceChildren(
    svgEl('defs', {}, [
      svgEl(
        'linearGradient',
        { id: 'thread-string-gradient', x1: '0', x2: '1', y1: '0', y2: '0' },
        [
          svgEl('stop', { offset: '0%', 'stop-color': 'rgba(229,196,100,.85)' }),
          svgEl('stop', { offset: '100%', 'stop-color': 'rgba(155,229,100,.72)' }),
        ],
      ),
    ]),
    ...zapTrails.flatMap(renderZapTrail),
    ...links.map(renderThreadLink),
  );
}

function renderZapTrail(bubble: Bubble): SVGElement[] {
  const trail = bubble.trail ?? [];
  const group = svgEl('g', {
    opacity: String(Math.min(0.86, Math.max(0, (bubble.expiresAt - renderTime) / 1200))),
  });
  for (let i = 1; i < trail.length; i += 1) {
    const previous = trail[i - 1]!;
    const point = trail[i]!;
    const progress = i / (trail.length - 1);
    group.append(
      svgEl('line', {
        x1: previous.x,
        y1: previous.y,
        x2: point.x,
        y2: point.y,
        stroke: `hsla(${bubble.hue}, 96%, 63%, ${0.03 + progress * 0.22})`,
        'stroke-linecap': 'round',
        'stroke-width': bubble.radius * (0.28 + progress * 1.08),
      }),
      svgEl('line', {
        x1: previous.x,
        y1: previous.y,
        x2: point.x,
        y2: point.y,
        stroke: `hsla(${bubble.hue}, 100%, 72%, ${0.08 + progress * 0.72})`,
        'stroke-linecap': 'round',
        'stroke-width': Math.max(2.5, bubble.radius * (0.08 + progress * 0.4)),
      }),
    );
  }
  return [group];
}

function renderThreadLink({ from, to, relation, id }: ThreadLink): SVGElement {
  const opacity = Math.min(
    Math.min(1, Math.max(0, (from.expiresAt - renderTime) / 2200)),
    Math.min(1, Math.max(0, (to.expiresAt - renderTime) / 2200)),
    relation === 'root' ? 0.82 : 0.68,
  );
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - Math.min(88, Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
  return svgEl('g', { opacity, 'data-id': id }, [
    svgEl('path', {
      d: `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`,
      fill: 'none',
      stroke: relation === 'root' ? 'url(#thread-string-gradient)' : 'rgba(168,85,247,.72)',
      'stroke-linecap': 'round',
      'stroke-width': relation === 'root' ? 2.5 : 2,
      'stroke-dasharray': relation === 'root' ? '7 9' : '3 8',
    }),
    svgEl('circle', {
      cx: from.x,
      cy: from.y,
      r: relation === 'root' ? 4 : 3.5,
      fill: relation === 'root' ? 'rgba(229,196,100,.9)' : 'rgba(168,85,247,.8)',
    }),
    svgEl('circle', { cx: to.x, cy: to.y, r: 3, fill: 'rgba(155,229,100,.8)' }),
  ]);
}

function buildThreadLinks(): ThreadLink[] {
  const rootByEventId = new Map<string, Bubble>();
  const relatedByEventId = new Map<string, Bubble>();
  for (const bubble of bubbles) {
    if (bubble.role === 'root') rootByEventId.set(bubble.eventId, bubble);
    if (bubble.role !== 'zap' && bubble.role !== 'reaction')
      relatedByEventId.set(bubble.eventId, bubble);
  }
  return bubbles.flatMap((bubble) => {
    if (bubble.role !== 'reply') return [];
    const links: ThreadLink[] = [];
    const root = bubble.rootEventId ? rootByEventId.get(bubble.rootEventId) : undefined;
    const reply =
      bubble.replyEventId && bubble.replyEventId !== bubble.rootEventId
        ? relatedByEventId.get(bubble.replyEventId)
        : undefined;
    if (root && root.id !== bubble.id)
      links.push({ id: `${root.id}-${bubble.id}-root`, from: root, to: bubble, relation: 'root' });
    if (reply && reply.id !== bubble.id)
      links.push({
        id: `${reply.id}-${bubble.id}-reply`,
        from: reply,
        to: bubble,
        relation: 'reply',
      });
    return links;
  });
}

function renderBubbles(): void {
  elements.bubbleLayer.replaceChildren(...bubbles.map(renderBubble));
}

function renderBubble(bubble: Bubble): HTMLElement {
  const age = renderTime - bubble.createdAt;
  const fadeOut = Math.min(1, Math.max(0, (bubble.expiresAt - renderTime) / 2200));
  const fadeIn = Math.min(1, age / 450);
  const opacity = Math.min(fadeIn, fadeOut);
  const node = document.createElement('div');
  node.className = `bubble bubble-${bubble.role}`;
  node.style.width = `${bubble.role === 'reaction' ? bubble.radius * 5.4 : bubble.radius * 2}px`;
  node.style.height = `${bubble.role === 'reaction' ? bubble.radius * 2.45 : bubble.radius * 2}px`;
  node.style.transform = `translate3d(${bubble.x - bubble.radius}px, ${bubble.y - bubble.radius}px, 0)`;
  node.style.opacity = `${bubble.role === 'reaction' ? opacity * 0.82 : opacity}`;
  node.style.filter = `drop-shadow(0 0 ${Math.round(bubble.radius * (bubble.role === 'zap' ? 1.25 : bubble.role === 'reaction' ? 1.9 : 0.62))}px hsla(${bubble.hue}, 95%, 62%, ${bubble.role === 'zap' || bubble.role === 'reaction' ? '.9' : '.55'}))`;
  if (bubble.role === 'reaction') renderReactionContents(node, bubble);
  else renderOrbContents(node, bubble);
  return node;
}

function renderReactionContents(node: HTMLElement, bubble: Bubble): void {
  const avatar = avatarNode(bubble, 'Nostr reaction avatar');
  const emoji = document.createElement('div');
  emoji.className = 'reaction-emoji';
  emoji.textContent = bubble.messagePreview.slice(0, 4);
  node.append(avatar, emoji);
}

function renderOrbContents(node: HTMLElement, bubble: Bubble): void {
  const isExploding = bubble.explodingAt !== undefined;
  const explosionProgress = isExploding
    ? Math.min(
        1,
        Math.max(0, (renderTime - (bubble.explodingAt ?? renderTime)) / EXPLOSION_DURATION),
      )
    : 0;
  const orb = avatarNode(bubble, `Nostr ${bubble.role} orb`);
  orb.classList.add('orb-core');
  orb.style.setProperty('--hue', String(bubble.hue));
  if ((bubble.cracks ?? 0) > 0) orb.append(cracksNode(bubble.cracks ?? 0));
  if (isExploding) {
    orb.style.opacity = `${Math.max(0, (1 - explosionProgress) * 0.85)}`;
    orb.style.transform = `scale(${1 + explosionProgress * 0.18})`;
    node.append(orb, explosionNode(bubble, explosionProgress));
  } else {
    node.append(orb, labelNode(bubble));
  }
}

function avatarNode(bubble: Bubble, alt: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = bubble.shape ? 'avatar avatar-shaped' : 'avatar';
  if (bubble.shape) {
    const mask = getAvatarShapeMaskUrl(bubble.shape);
    if (mask) {
      wrapper.style.maskImage = `url(${mask})`;
      wrapper.style.webkitMaskImage = `url(${mask})`;
    }
  }
  const image = document.createElement('img');
  image.src = bubble.imageUrl;
  image.alt = alt;
  image.draggable = false;
  image.addEventListener('error', () => {
    image.src = DEFAULT_PROFILE_IMAGE;
  });
  wrapper.append(image, glossNode());
  return wrapper;
}

function glossNode(): HTMLElement {
  const gloss = document.createElement('div');
  gloss.className = 'avatar-gloss';
  return gloss;
}

function labelNode(bubble: Bubble): HTMLElement {
  const label = document.createElement('div');
  label.className = `bubble-label label-${bubble.role}`;
  if (bubble.role === 'zap') {
    label.innerHTML = `<span class="label-kicker">zap</span><strong>${formatSats(bubble.zapAmountSats ?? 0)}</strong><span>sats</span>`;
  } else {
    label.textContent = bubble.messagePreview;
  }
  return label;
}

function cracksNode(cracks: number): SVGSVGElement {
  const svg = svgEl('svg', {
    class: 'cracks',
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
  }) as SVGSVGElement;
  svg.append(
    svgEl('path', { d: 'M 8 52 L 30 44 L 42 56 L 56 38 L 70 52 L 92 46' }),
    svgEl('path', { d: 'M 30 44 L 24 30' }),
    svgEl('path', { d: 'M 56 38 L 60 22' }),
  );
  if (cracks >= 2)
    svg.append(
      svgEl('path', { d: 'M 48 8 L 56 30 L 42 44 L 58 60 L 44 78 L 52 92' }),
      svgEl('path', { d: 'M 56 30 L 70 24' }),
      svgEl('path', { d: 'M 58 60 L 76 64' }),
    );
  return svg;
}

function explosionNode(bubble: Bubble, progress: number): HTMLElement {
  const container = document.createElement('div');
  container.className = 'explosion';
  container.style.setProperty('--hue', String(bubble.hue));
  const ring = document.createElement('div');
  ring.className = 'explosion-ring';
  ring.style.width = `${bubble.radius * 2 * (1 + progress * 1.7)}px`;
  ring.style.height = ring.style.width;
  ring.style.opacity = `${1 - progress}`;
  container.append(ring);
  for (let i = 0; i < EXPLOSION_PARTICLE_ANGLES.length; i += 1) {
    const angle = EXPLOSION_PARTICLE_ANGLES[i]!;
    const particle = document.createElement('div');
    particle.className = 'explosion-particle';
    const distance = bubble.radius * (1.05 + progress * 2.3);
    const size = Math.max(2, bubble.radius * 0.22 * (1 - progress * 0.5));
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.transform = `translate(${Math.cos(angle) * distance - size / 2}px, ${Math.sin(angle) * distance - size / 2}px)`;
    particle.style.opacity = `${1 - progress}`;
    container.append(particle);
  }
  return container;
}

function svgEl(
  name: string,
  attrs: Record<string, unknown> = {},
  children: SVGElement[] = [],
): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  element.append(...children);
  return element;
}

function formatSats(amount: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount);
}

function setupControls(): void {
  elements.footerBar.addEventListener('click', openSettingsOverlay);
  elements.closeSettingsButton.addEventListener('click', closeSettingsOverlay);
  elements.openSettingsButton.addEventListener('click', () => {
    try {
      config.openSettings();
    } catch {
      setConnectionState('error', 'This shell did not grant NAP-CONFIG settings.');
    }
  });
  elements.settingsOverlay.addEventListener('click', (event) => {
    if (event.target === elements.settingsOverlay) closeSettingsOverlay();
  });
  elements.settingsOverlay.addEventListener('keydown', handleSettingsOverlayKeydown);
  elements.restartButton.addEventListener('click', () => {
    void startStream();
  });
}

function handleSettingsOverlayKeydown(event: KeyboardEvent): void {
  if (elements.settingsOverlay.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSettingsOverlay();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = getSettingsFocusableElements();
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function getSettingsFocusableElements(): HTMLElement[] {
  return Array.from(
    elements.settingsOverlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])',
    ),
  ).filter((element) => element.offsetParent !== null);
}

function openSettingsOverlay(): void {
  elements.settingsOverlay.classList.remove('hidden');
  elements.footerBar.setAttribute('aria-expanded', 'true');
  getSettingsFocusableElements()[0]?.focus();
}

function closeSettingsOverlay(): void {
  elements.settingsOverlay.classList.add('hidden');
  elements.footerBar.setAttribute('aria-expanded', 'false');
  elements.footerBar.focus();
}

async function bootstrap(): Promise<void> {
  setupControls();
  if (isNapDomainPresent('config')) {
    try {
      settings = normalizeSettings(await config.get());
      configSubscription = config.subscribe((values) => {
        const next = normalizeSettings(values);
        if (JSON.stringify(next) === JSON.stringify(settings)) return;
        settings = next;
        updateStats();
        void startStream();
      });
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  }
  if (isNapDomainPresent('identity')) {
    try {
      identitySubscription = identity.onChanged(() => {
        void startStream();
      });
    } catch {
      // startStream will surface missing identity support.
    }
  }
  animationFrame = window.requestAnimationFrame(animate);
  await startStream();
}

window.addEventListener('pagehide', () => {
  streamToken += 1;
  closeNostrSubscriptions();
  identitySubscription?.close();
  configSubscription?.close();
  themeHandle.close();
  window.cancelAnimationFrame(animationFrame);
  for (const entry of profileCache.values())
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
});

void bootstrap().catch((error: unknown) => {
  setConnectionState(
    'error',
    error instanceof Error ? error.message : 'Nostr Bubbles failed to start.',
  );
});
