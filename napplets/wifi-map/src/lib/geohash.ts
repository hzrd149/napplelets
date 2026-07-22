const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BITS = [16, 8, 4, 2, 1] as const;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function isValidGeohash(value: string): boolean {
  return value.length > 0 && [...value.toLowerCase()].every((char) => BASE32.includes(char));
}

export function decodeGeohash(value: string): LatLng | null {
  if (!isValidGeohash(value)) return null;

  let evenBit = true;
  const lat = [-90, 90];
  const lng = [-180, 180];

  for (const char of value.toLowerCase()) {
    const cd = BASE32.indexOf(char);
    for (const mask of BITS) {
      if (evenBit) refineInterval(lng, (cd & mask) !== 0);
      else refineInterval(lat, (cd & mask) !== 0);
      evenBit = !evenBit;
    }
  }

  return {
    lat: (lat[0] + lat[1]) / 2,
    lng: (lng[0] + lng[1]) / 2,
  };
}

export function encodeGeohash(lat: number, lng: number, precision: number): string {
  const safeLat = clamp(lat, -90, 90);
  const safeLng = clamp(lng, -180, 180);
  let evenBit = true;
  let bit = 0;
  let ch = 0;
  let geohash = '';
  const latRange = [-90, 90];
  const lngRange = [-180, 180];

  while (geohash.length < precision) {
    if (evenBit) {
      const mid = (lngRange[0] + lngRange[1]) / 2;
      if (safeLng >= mid) {
        ch |= BITS[bit];
        lngRange[0] = mid;
      } else lngRange[1] = mid;
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (safeLat >= mid) {
        ch |= BITS[bit];
        latRange[0] = mid;
      } else latRange[1] = mid;
    }

    evenBit = !evenBit;
    if (bit < 4) bit += 1;
    else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return geohash;
}

export function geohashesForBounds(bounds: Bounds, precision: number): string[] {
  const south = clamp(Math.min(bounds.south, bounds.north), -85, 85);
  const north = clamp(Math.max(bounds.south, bounds.north), -85, 85);
  const west = clamp(Math.min(bounds.west, bounds.east), -180, 180);
  const east = clamp(Math.max(bounds.west, bounds.east), -180, 180);
  const latSpan = Math.max(0.0001, north - south);
  const lngSpan = Math.max(0.0001, east - west);
  const rows = latSpan > 20 ? 7 : latSpan > 5 ? 5 : 3;
  const cols = lngSpan > 20 ? 7 : lngSpan > 5 ? 5 : 3;
  const hashes = new Set<string>();

  for (let row = 0; row < rows; row += 1) {
    const lat = south + (latSpan * row) / (rows - 1);
    for (let col = 0; col < cols; col += 1) {
      const lng = west + (lngSpan * col) / (cols - 1);
      hashes.add(encodeGeohash(lat, lng, precision));
    }
  }

  return [...hashes];
}

function refineInterval(range: number[], upper: boolean): void {
  const mid = (range[0] + range[1]) / 2;
  if (upper) range[0] = mid;
  else range[1] = mid;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
