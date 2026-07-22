export type BubbleRole = 'note' | 'reply' | 'root' | 'zap' | 'reaction';

export interface TrailPoint {
  x: number;
  y: number;
  time: number;
}

export interface Bubble {
  id: string;
  eventId: string;
  pubkey: string;
  imageUrl: string;
  shape?: string;
  messagePreview: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  createdAt: number;
  expiresAt: number;
  hue: number;
  role: BubbleRole;
  rootEventId?: string;
  replyEventId?: string;
  zapAmountSats?: number;
  trail?: TrailPoint[];
  enteredViewport?: boolean;
  cracks?: number;
  explodingAt?: number;
  targetSpeed?: number;
}

export type BubbleDensityMode = 'auto' | 'manual';
export type BubbleSourceMode = 'popular' | 'contacts';

export interface BubbleSettings {
  sourceMode: BubbleSourceMode;
  bubbleDensityMode: BubbleDensityMode;
  bubbleTargetCount: number;
  enableReactions: boolean;
  includeZaps: boolean;
  includeOnchainZaps: boolean;
  zapBreaksBubbles: boolean;
  contactBatchSize: number;
}

export const DEFAULT_SETTINGS: BubbleSettings = {
  sourceMode: 'popular',
  bubbleDensityMode: 'auto',
  bubbleTargetCount: 44,
  enableReactions: true,
  includeZaps: true,
  includeOnchainZaps: true,
  zapBreaksBubbles: true,
  contactBatchSize: 500,
};

export const MAX_BUBBLES = 112;
export const MAX_ROOT_BUBBLES = 18;
export const BUBBLE_SPAWN_RATE_WINDOW = 30_000;
export const AUTO_BUBBLE_TARGET_MIN = 18;
export const AUTO_BUBBLE_TARGET_MAX = 72;
export const MANUAL_BUBBLE_TARGET_MIN = 8;
export const MANUAL_BUBBLE_TARGET_MAX = 96;
export const PERSISTENT_AREA_BUDGET = 0.18;
export const NOTE_RADIUS_RANGE = [28, 74] as const;
export const ROOT_RADIUS_RANGE = [34, 58] as const;
export const ZAP_RADIUS_RANGE = [15, 28] as const;
export const REACTION_RADIUS_RANGE = [18, 30] as const;
export const ZAP_TRAIL_DURATION = 1850;
export const EXPLOSION_DURATION = 560;
export const MAX_CRACKS = 2;
export const EXPLOSION_PARTICLE_ANGLES = Array.from({ length: 9 }, (_, i) => (i * Math.PI * 2) / 9);

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function getAutoBubbleTarget(width: number, height: number): number {
  return Math.round(clampNumber((width * height) / 45_000, AUTO_BUBBLE_TARGET_MIN, AUTO_BUBBLE_TARGET_MAX));
}

export function getRoleRadiusRange(role: BubbleRole): readonly [number, number] {
  if (role === 'root') return ROOT_RADIUS_RANGE;
  if (role === 'zap') return ZAP_RADIUS_RANGE;
  if (role === 'reaction') return REACTION_RADIUS_RANGE;
  return NOTE_RADIUS_RANGE;
}

export function isPersistentBubbleRole(role: BubbleRole): boolean {
  return role === 'note' || role === 'reply' || role === 'root';
}

export function getDiscArea(radius: number): number {
  return Math.PI * radius * radius;
}

export function getBubbleLifetime(role: BubbleRole, targetCount: number, spawnRatePerSecond: number): number {
  const targetLifetime = targetCount / Math.max(spawnRatePerSecond, 1 / (BUBBLE_SPAWN_RATE_WINDOW / 1000));
  const roleMultiplier = role === 'root' ? 1.24 : role === 'zap' ? 0.95 : role === 'reaction' ? 0.26 : 1;
  const lifetime = targetLifetime * roleMultiplier * 1000;
  if (role === 'root') return clampNumber(lifetime, 14_000, 70_000);
  if (role === 'zap') return clampNumber(lifetime, 12_000, 50_000);
  if (role === 'reaction') return clampNumber(lifetime, 3_500, 12_000);
  return clampNumber(lifetime, 8_000, 60_000);
}

export function pruneForBubbleArea(bubbles: Bubble[], incomingArea: number, stageArea: number): Bubble[] {
  const budget = stageArea * PERSISTENT_AREA_BUDGET;
  let currentArea = incomingArea;
  for (const bubble of bubbles) {
    if (isPersistentBubbleRole(bubble.role)) currentArea += getDiscArea(bubble.radius);
  }
  if (currentArea <= budget) return bubbles;
  const evictable = bubbles.filter((bubble) => isPersistentBubbleRole(bubble.role)).sort((a, b) => a.createdAt - b.createdAt);
  const toEvict = new Set<string>();
  for (const bubble of evictable) {
    if (currentArea <= budget) break;
    toEvict.add(bubble.id);
    currentArea -= getDiscArea(bubble.radius);
  }
  return toEvict.size > 0 ? bubbles.filter((bubble) => !toEvict.has(bubble.id)) : bubbles;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) chunks.push(items.slice(i, i + safeSize));
  return chunks;
}
