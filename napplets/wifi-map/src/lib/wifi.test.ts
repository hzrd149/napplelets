import { describe, expect, it } from 'vitest';
import { decodeGeohash, encodeGeohash, geohashesForBounds } from './geohash';
import { getBestGeohash, parseWifiNetwork, WIFI_NETWORK_KIND } from './wifi';
import type { NostrEvent } from './nostr';

function event(partial: Partial<NostrEvent>): NostrEvent {
  return {
    id: partial.id ?? 'id',
    pubkey: partial.pubkey ?? 'pubkey',
    created_at: partial.created_at ?? 1,
    kind: partial.kind ?? WIFI_NETWORK_KIND,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: partial.sig ?? 'sig',
  };
}

describe('geohash utilities', () => {
  it('round-trips approximate coordinates', () => {
    const hash = encodeGeohash(40.7128, -74.006, 7);
    const decoded = decodeGeohash(hash);

    expect(hash).toHaveLength(7);
    expect(decoded?.lat).toBeCloseTo(40.7128, 1);
    expect(decoded?.lng).toBeCloseTo(-74.006, 1);
  });

  it('samples geohash query prefixes for bounds', () => {
    const hashes = geohashesForBounds({ south: 40.6, west: -74.1, north: 40.9, east: -73.8 }, 5);

    expect(hashes.length).toBeGreaterThan(1);
    expect(hashes.every((hash) => hash.length === 5)).toBe(true);
  });
});

describe('Wifistr event parsing', () => {
  it('uses the longest g tag and reads wifi tags', () => {
    const network = parseWifiNetwork(
      event({
        content: 'Coffee shop wifi',
        tags: [
          ['g', 'dr5'],
          ['g', 'dr5ru7n'],
          ['ssid', 'corner-coffee-shop'],
          ['name', 'Corner Cafe'],
          ['security', 'WPA2'],
          ['password', 'coffee123'],
          ['h', 'false'],
          ['c', 'true'],
        ],
      }),
    );

    expect(network?.geohash).toBe('dr5ru7n');
    expect(network?.name).toBe('Corner Cafe');
    expect(network?.ssid).toBe('corner-coffee-shop');
    expect(network?.security).toBe('WPA2');
    expect(network?.password).toBe('coffee123');
    expect(network?.hidden).toBe(false);
    expect(network?.captive).toBe(true);
  });

  it('ignores non-wifi events and wifi events without valid location', () => {
    expect(parseWifiNetwork(event({ kind: 1, tags: [['g', 'dr5ru7n']] }))).toBeNull();
    expect(parseWifiNetwork(event({ tags: [['ssid', 'missing-location']] }))).toBeNull();
    expect(parseWifiNetwork(event({ tags: [['g', 'not-a-geohash'], ['ssid', 'bad']] }))).toBeNull();
  });

  it('finds the best geohash from repeated prefix tags', () => {
    expect(getBestGeohash(event({ tags: [['g', '9'], ['g', '9q8yy'], ['g', '9q']] }))).toBe('9q8yy');
  });
});
