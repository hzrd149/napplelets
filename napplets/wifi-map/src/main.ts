import '@napplelets/theme-dsui/styles.css';
import { installThemeClient } from '@napplelets/theme-dsui';
import { link, outbox, storage, type RelayEventResult, type Subscription } from '@napplet/sdk';
import { geoMercator, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import usAtlas from 'us-atlas/states-10m.json';
import worldAtlas from 'world-atlas/countries-110m.json';
import './styles.css';
import { geohashesForBounds, type Bounds, type LatLng } from './lib/geohash';
import type { NostrEvent, NostrFilter } from './lib/nostr';
import { isNapDomainPresent } from './lib/runtime-domain';
import { parseWifiNetwork, WIFI_MIN_QUERY_ZOOM, WIFI_NETWORK_KIND, WIFI_QUERY_PRECISION, type WifiNetwork } from './lib/wifi';

interface ViewState {
  center: LatLng;
  zoom: number;
}

type ConnectionState = 'idle' | 'loading' | 'live' | 'zoom-in' | 'error';

const STORAGE_KEY = 'wifi-map:view:v1';
const DEFAULT_VIEW: ViewState = { center: { lat: 20, lng: 0 }, zoom: 2.4 };
const MAX_NETWORKS = 800;
const SVG_NS = 'http://www.w3.org/2000/svg';

type WorldTopology = Topology<{ countries: GeometryCollection }>;
type UsTopology = Topology<{ states: GeometryCollection }>;

const worldTopology = worldAtlas as unknown as WorldTopology;
const usTopology = usAtlas as unknown as UsTopology;
const countryFeatures = feature(worldTopology, worldTopology.objects.countries);
const countryBorders = mesh(worldTopology, worldTopology.objects.countries, (a, b) => a !== b);
const stateBorders = mesh(usTopology, usTopology.objects.states, (a, b) => a !== b);

const themeHandle = installThemeClient();

const elements = {
  app: requireElement<HTMLElement>('#app'),
  mapSvg: requireElement<SVGSVGElement>('#mapSvg'),
  canvas: requireElement<HTMLCanvasElement>('#mapCanvas'),
  markerLayer: requireElement<HTMLDivElement>('#markerLayer'),
  status: requireElement<HTMLOutputElement>('#status'),
  detailPanel: requireElement<HTMLElement>('#detailPanel'),
  networkCount: requireElement<HTMLElement>('#networkCount'),
  zoomInButton: requireElement<HTMLButtonElement>('#zoomInButton'),
  zoomOutButton: requireElement<HTMLButtonElement>('#zoomOutButton'),
  homeButton: requireElement<HTMLButtonElement>('#homeButton'),
};

let view: ViewState = { ...DEFAULT_VIEW, center: { ...DEFAULT_VIEW.center } };
let canvasSize = { width: 1, height: 1, ratio: 1 };
let networks = new Map<string, WifiNetwork>();
let selectedId: string | null = null;
let activeSubscription: Subscription | null = null;
let activeQueryKey = '';
let loadToken = 0;
let saveTimer = 0;
let renderQueued = false;
let dragStart: { x: number; y: number; center: LatLng } | null = null;

void boot();

async function boot(): Promise<void> {
  await loadStoredView();
  wireControls();
  resizeCanvas();
  setStatus('idle', 'Ready');
  requestRender();
  void loadForViewport();
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function wireControls(): void {
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    requestRender();
    void loadForViewport();
  });
  resizeObserver.observe(elements.app);

  elements.zoomInButton.addEventListener('click', () => updateZoom(view.zoom + 1));
  elements.zoomOutButton.addEventListener('click', () => updateZoom(view.zoom - 1));
  elements.homeButton.addEventListener('click', () => {
    view = { ...DEFAULT_VIEW, center: { ...DEFAULT_VIEW.center } };
    selectedId = null;
    saveViewSoon();
    requestRender();
    void loadForViewport();
  });

  elements.canvas.addEventListener('pointerdown', (event) => {
    elements.canvas.setPointerCapture(event.pointerId);
    dragStart = { x: event.clientX, y: event.clientY, center: { ...view.center } };
  });
  elements.canvas.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    const scale = scaleForZoom(view.zoom);
    const startWorld = latLngToWorld(dragStart.center);
    const nextWorld = {
      x: startWorld.x - (event.clientX - dragStart.x) / scale,
      y: startWorld.y - (event.clientY - dragStart.y) / scale,
    };
    view.center = worldToLatLng(nextWorld);
    saveViewSoon();
    requestRender();
  });
  elements.canvas.addEventListener('pointerup', (event) => {
    elements.canvas.releasePointerCapture(event.pointerId);
    dragStart = null;
    void loadForViewport();
  });
  elements.canvas.addEventListener('pointercancel', () => {
    dragStart = null;
  });
  elements.canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      updateZoom(view.zoom + (event.deltaY < 0 ? 0.45 : -0.45));
    },
    { passive: false },
  );
}

function updateZoom(nextZoom: number): void {
  view.zoom = clamp(nextZoom, 1, 15);
  saveViewSoon();
  requestRender();
  void loadForViewport();
}

async function loadForViewport(): Promise<void> {
  const queryBounds = getViewBounds();
  activeSubscription?.close();
  activeSubscription = null;

  if (view.zoom < WIFI_MIN_QUERY_ZOOM) {
    setStatus('zoom-in', `Zoom in to load hotspots (${networks.size})`);
    activeQueryKey = '';
    updateCount();
    return;
  }

  const geohashes = geohashesForBounds(queryBounds, WIFI_QUERY_PRECISION).sort();
  const queryKey = geohashes.join(',');
  if (queryKey === activeQueryKey) return;
  activeQueryKey = queryKey;
  const token = ++loadToken;
  const filters: NostrFilter[] = [{ kinds: [WIFI_NETWORK_KIND], '#g': geohashes, limit: 200 }];
  setStatus('loading', `Loading ${geohashes.length} cells`);

  try {
    const result = await outbox.query(filters);
    if (token !== loadToken) return;
    for (const eventResult of result.events as RelayEventResult[]) ingestEventResult(eventResult);
    setStatus('live', `${networks.size} hotspots`);
    updateCount();
    requestRender();
  } catch {
    if (token === loadToken) setStatus('error', 'Could not load hotspots');
  }

  try {
    const subscription = outbox.subscribe(filters);
    activeSubscription = subscription;
    subscription.on('event', (eventResult: RelayEventResult) => {
      ingestEventResult(eventResult);
      setStatus('live', `${networks.size} hotspots`);
      updateCount();
      requestRender();
    });
    subscription.on('closed', () => {
      if (activeSubscription === subscription) activeSubscription = null;
    });
  } catch {
    activeSubscription = null;
  }
}

function ingestEventResult(result: RelayEventResult): void {
  const network = parseWifiNetwork(result.event as NostrEvent);
  if (!network) return;
  networks.set(network.id, network);
  if (networks.size > MAX_NETWORKS) {
    const oldest = [...networks.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, networks.size - MAX_NETWORKS);
    for (const item of oldest) networks.delete(item.id);
  }
}

function resizeCanvas(): void {
  const rect = elements.app.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvasSize = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), ratio };
  elements.canvas.width = Math.round(canvasSize.width * ratio);
  elements.canvas.height = Math.round(canvasSize.height * ratio);
  elements.canvas.style.width = `${canvasSize.width}px`;
  elements.canvas.style.height = `${canvasSize.height}px`;
}

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderMap();
    renderMarkers();
    renderDetails();
  });
}

function renderMap(): void {
  const ctx = elements.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(canvasSize.ratio, 0, 0, canvasSize.ratio, 0, 0);
  ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

  const text = getCssColor('--color-base-content', '#f5f1e8');

  drawGrid(ctx, text);
  renderBasemap();
}

function drawGrid(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.save();
  ctx.strokeStyle = withAlpha(color, 0.13);
  ctx.lineWidth = 1;

  for (let lng = -180; lng <= 180; lng += 30) {
    const a = projectToScreen({ lat: -78, lng });
    const b = projectToScreen({ lat: 78, lng });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (let lat = -60; lat <= 75; lat += 15) {
    const a = projectToScreen({ lat, lng: -180 });
    const b = projectToScreen({ lat, lng: 180 });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function renderBasemap(): void {
  elements.mapSvg.setAttribute('viewBox', `0 0 ${canvasSize.width} ${canvasSize.height}`);
  const projection = geoMercator()
    .scale(scaleForZoom(view.zoom) / (2 * Math.PI))
    .center([view.center.lng, view.center.lat])
    .translate([canvasSize.width / 2, canvasSize.height / 2]);
  const path = geoPath(projection);
  const countriesPath = path(countryFeatures);
  const countryBordersPath = path(countryBorders);
  const stateBordersPath = view.zoom >= 4 ? path(stateBorders) : null;
  const fragment = document.createDocumentFragment();

  if (countriesPath) fragment.append(svgPath('country-fill', countriesPath));
  if (countryBordersPath) fragment.append(svgPath('country-border', countryBordersPath));
  if (stateBordersPath) fragment.append(svgPath('state-border', stateBordersPath));

  elements.mapSvg.replaceChildren(fragment);
}

function svgPath(className: string, d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', className);
  path.setAttribute('d', d);
  return path;
}

function renderMarkers(): void {
  const fragment = document.createDocumentFragment();
  const visible = [...networks.values()].filter((network) => isPointInView(network));
  visible.sort((a, b) => b.createdAt - a.createdAt);

  for (const network of visible.slice(0, 250)) {
    const point = projectToScreen(network);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `wifi-marker${network.id === selectedId ? ' selected' : ''}`;
    button.style.left = `${point.x}px`;
    button.style.top = `${point.y}px`;
    button.title = network.name || network.ssid || 'WiFi hotspot';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => {
      selectedId = network.id;
      requestRender();
    });
    fragment.append(button);
  }

  elements.markerLayer.replaceChildren(fragment);
}

function renderDetails(): void {
  const selected = selectedId ? networks.get(selectedId) : null;
  if (!selected) {
    elements.detailPanel.replaceChildren(emptyPanel());
    return;
  }

  const title = selected.name || selected.ssid || 'Unnamed hotspot';
  const card = document.createElement('div');
  card.className = 'network-card';
  card.append(
    element('p', 'eyebrow', 'WiFi hotspot'),
    element('h2', '', title),
    detailRow('SSID', selected.ssid || 'Unknown', true),
    detailRow('Password', selected.password || (selected.security === 'nopass' ? 'None required' : 'Not shared'), Boolean(selected.password)),
    detailRow('Security', selected.security || 'Unknown', false),
    detailRow('Captive portal', selected.captive ? 'Yes' : 'No', false),
    detailRow('Hidden network', selected.hidden ? 'Yes' : 'No', false),
  );

  if (selected.description.trim()) card.append(element('p', 'description', selected.description.trim()));

  const actions = document.createElement('div');
  actions.className = 'panel-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    selectedId = null;
    requestRender();
  });
  actions.append(close);

  if (isNapDomainPresent('link')) {
    const osm = document.createElement('button');
    osm.type = 'button';
    osm.textContent = 'Open OSM';
    osm.addEventListener('click', () => {
      void openOsm(selected);
    });
    actions.append(osm);
  }

  card.append(actions);
  elements.detailPanel.replaceChildren(card);
}

function emptyPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel-empty';
  const count = document.createElement('strong');
  count.textContent = String(networks.size);
  panel.append(count, document.createTextNode(networks.size === 1 ? ' hotspot loaded. Select a marker.' : ' hotspots loaded. Select a marker.'));
  return panel;
}

function detailRow(label: string, value: string, selectable: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const labelNode = element('span', 'detail-label', label);
  const valueNode = element('code', selectable ? 'selectable' : '', value);
  row.append(labelNode, valueNode);
  return row;
}

function element<K extends keyof HTMLElementTagNameMap>(tagName: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

async function openOsm(network: WifiNetwork): Promise<void> {
  if (!isNapDomainPresent('link')) return;
  const url = `https://www.openstreetmap.org/?mlat=${network.lat.toFixed(6)}&mlon=${network.lng.toFixed(6)}#map=18/${network.lat.toFixed(6)}/${network.lng.toFixed(6)}`;
  try {
    await link.open(url);
  } catch {
    setStatus('error', 'Could not open map link');
  }
}

function updateCount(): void {
  elements.networkCount.textContent = String(networks.size);
}

function setStatus(state: ConnectionState, message: string): void {
  elements.status.className = `status status-${state}`;
  elements.status.textContent = message;
}

async function loadStoredView(): Promise<void> {
  if (!isNapDomainPresent('storage')) return;
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    if (isFiniteNumber(parsed.zoom) && parsed.center && isFiniteNumber(parsed.center.lat) && isFiniteNumber(parsed.center.lng)) {
      view = {
        zoom: clamp(parsed.zoom, 1, 15),
        center: { lat: clamp(parsed.center.lat, -85, 85), lng: clamp(parsed.center.lng, -180, 180) },
      };
    }
  } catch {
    view = { ...DEFAULT_VIEW, center: { ...DEFAULT_VIEW.center } };
  }
}

function saveViewSoon(): void {
  if (!isNapDomainPresent('storage')) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void storage.setItem(STORAGE_KEY, JSON.stringify(view)).catch(() => undefined);
  }, 300);
}

function getViewBounds(): Bounds {
  const topLeft = screenToLatLng({ x: 0, y: 0 });
  const bottomRight = screenToLatLng({ x: canvasSize.width, y: canvasSize.height });
  return {
    south: bottomRight.lat,
    west: topLeft.lng,
    north: topLeft.lat,
    east: bottomRight.lng,
  };
}

function isPointInView(point: LatLng): boolean {
  const screen = projectToScreen(point);
  return screen.x >= -32 && screen.y >= -32 && screen.x <= canvasSize.width + 32 && screen.y <= canvasSize.height + 32;
}

function projectToScreen(point: LatLng): { x: number; y: number } {
  const center = latLngToWorld(view.center);
  const world = latLngToWorld(point);
  const scale = scaleForZoom(view.zoom);
  return {
    x: canvasSize.width / 2 + (world.x - center.x) * scale,
    y: canvasSize.height / 2 + (world.y - center.y) * scale,
  };
}

function screenToLatLng(point: { x: number; y: number }): LatLng {
  const center = latLngToWorld(view.center);
  const scale = scaleForZoom(view.zoom);
  return worldToLatLng({
    x: center.x + (point.x - canvasSize.width / 2) / scale,
    y: center.y + (point.y - canvasSize.height / 2) / scale,
  });
}

function latLngToWorld(point: LatLng): { x: number; y: number } {
  const sin = Math.sin((clamp(point.lat, -85.05112878, 85.05112878) * Math.PI) / 180);
  return {
    x: (point.lng + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

function worldToLatLng(point: { x: number; y: number }): LatLng {
  const lng = point.x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * point.y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat: clamp(lat, -85, 85), lng: wrapLng(lng) };
}

function scaleForZoom(zoom: number): number {
  return 256 * 2 ** zoom;
}

function getCssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function withAlpha(color: string, alpha: number): string {
  const normalized = color.trim();
  if (normalized.startsWith('#')) {
    const hex = normalized.length === 4 ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}` : normalized;
    const value = Number.parseInt(hex.slice(1), 16);
    if (Number.isFinite(value)) {
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgb(${r} ${g} ${b} / ${alpha})`;
    }
  }
  return `color-mix(in srgb, ${normalized} ${Math.round(alpha * 100)}%, transparent)`;
}

function wrapLng(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

window.addEventListener('beforeunload', () => {
  themeHandle.close();
  activeSubscription?.close();
});
