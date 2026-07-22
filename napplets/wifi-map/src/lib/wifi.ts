import { decodeGeohash, type LatLng } from './geohash';
import type { NostrEvent } from './nostr';

export const WIFI_NETWORK_KIND = 38787;
export const WIFI_CORRECTION_KIND = 8787;
export const WIFI_QUERY_PRECISION = 5;
export const WIFI_MIN_QUERY_ZOOM = 8;

export interface WifiNetwork {
  id: string;
  pubkey: string;
  createdAt: number;
  name?: string;
  ssid?: string;
  password?: string;
  security?: string;
  hidden: boolean;
  captive: boolean;
  description: string;
  geohash: string;
  lat: number;
  lng: number;
}

export function parseWifiNetwork(event: NostrEvent): WifiNetwork | null {
  if (event.kind !== WIFI_NETWORK_KIND) return null;
  const geohash = getBestGeohash(event);
  if (!geohash) return null;
  const location = decodeGeohash(geohash);
  if (!location) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    name: getTagValue(event, 'name'),
    ssid: getTagValue(event, 'ssid'),
    password: getTagValue(event, 'password'),
    security: getTagValue(event, 'security'),
    hidden: getTagValue(event, 'h') === 'true',
    captive: getTagValue(event, 'c') === 'true',
    description: event.content,
    geohash,
    lat: location.lat,
    lng: location.lng,
  };
}

export function getBestGeohash(event: Pick<NostrEvent, 'tags'>): string | null {
  let best = '';
  for (const tag of event.tags) {
    if (tag[0] === 'g' && tag[1] && tag[1].length > best.length) best = tag[1].toLowerCase();
  }
  return best || null;
}

export function getTagValue(event: Pick<NostrEvent, 'tags'>, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name && tag[1])?.[1];
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const radius = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}
