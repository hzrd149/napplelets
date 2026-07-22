import * as THREE from 'three';
import { CubeModel, randomMove, type Axis, type Coord, type CubeSize, type Move, type Turn } from './cube';
import './styles.css';

interface CubieView {
  mesh: THREE.Mesh;
  state: Coord & { id: string };
}

interface PickedCubie {
  cubie: CubieView;
  face: FaceName;
}

type FaceName = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back';

const COLORS: Record<FaceName | 'inside', number> = {
  inside: 0x11131b,
  right: 0x1f6fff,
  left: 0xffd73a,
  top: 0xff4fd8,
  bottom: 0x40f070,
  front: 0xff3f35,
  back: 0x34e9ff,
};

const FACE_BY_NORMAL: Record<string, FaceName> = {
  '1,0,0': 'right',
  '-1,0,0': 'left',
  '0,1,0': 'top',
  '0,-1,0': 'bottom',
  '0,0,1': 'front',
  '0,0,-1': 'back',
};

const app = requireElement<HTMLDivElement>('#app');
app.innerHTML = `
  <main class="rubik-shell">
    <header class="toolbar">
      <div class="title">
        <strong>Rubik Cube</strong>
        <span>Drag the void to orbit. Drag across a face to twist a layer.</span>
      </div>
      <select class="control" id="sizeSelect" aria-label="Cube size">
        <option value="2">2x2</option>
        <option value="3" selected>3x3</option>
        <option value="4">4x4</option>
      </select>
      <button class="control" id="resetButton">Reset</button>
      <button class="control primary" id="scrambleButton">Scramble</button>
      <button class="control" id="undoButton">Undo</button>
    </header>
    <section class="stage" id="stage" aria-label="Interactive Rubik cube">
      <p class="status" id="status">Solved</p>
      <p class="hint">Tip: start and release on the same visible face. Edge drags turn the outer slices.</p>
    </section>
  </main>
`;

const stage = requireElement<HTMLElement>('#stage');
const statusNode = requireElement<HTMLElement>('#status');
const sizeSelect = requireElement<HTMLSelectElement>('#sizeSelect');
const resetButton = requireElement<HTMLButtonElement>('#resetButton');
const scrambleButton = requireElement<HTMLButtonElement>('#scrambleButton');
const undoButton = requireElement<HTMLButtonElement>('#undoButton');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cubeGroup = new THREE.Group();
const light = new THREE.DirectionalLight(0xffffff, 2.4);
const fill = new THREE.HemisphereLight(0x8899ff, 0x181018, 1.8);

let model = new CubeModel(3);
let cubies: CubieView[] = [];
let rotationX = -0.28;
let rotationY = 0.62;
let fitDistance = 6.2;
let zoomFactor = 1;
let activePointerId: number | null = null;
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let dragStart = { x: 0, y: 0 };
let startRotation = { x: 0, y: 0 };
let startPick: PickedCubie | null = null;
let orbiting = false;
let animating = false;

const activePointers = new Map<number, { x: number; y: number }>();

renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
stage.append(renderer.domElement);
scene.add(cubeGroup, fill);
light.position.set(3, 5, 4);
scene.add(light);

buildCube(3);
setStatus();
resize();
requestAnimationFrame(render);

globalThis.addEventListener('resize', resize);
stage.addEventListener('pointerdown', onPointerDown);
stage.addEventListener('pointermove', onPointerMove);
stage.addEventListener('pointerup', onPointerUp);
stage.addEventListener('pointercancel', clearPointer);
stage.addEventListener('wheel', onWheel, { passive: false });
sizeSelect.addEventListener('change', () => buildCube(parseCubeSize(sizeSelect.value)));
resetButton.addEventListener('click', () => buildCube(model.size));
scrambleButton.addEventListener('click', () => void scramble());
undoButton.addEventListener('click', () => void undo());

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function parseCubeSize(value: string): CubeSize {
  return value === '2' || value === '4' ? Number(value) as CubeSize : 3;
}

function buildCube(size: CubeSize): void {
  model = new CubeModel(size);
  cubies = [];
  cubeGroup.clear();
  zoomFactor = 1;

  for (const state of model.cubies) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), makeMaterials(state, size));
    mesh.position.copy(coordToPosition(state, size));
    mesh.userData.cubieId = state.id;
    cubeGroup.add(mesh);
    cubies.push({ mesh, state });
  }

  setStatus();
  updateFitDistance();
}

function makeMaterials(coord: Coord, size: CubeSize): THREE.Material[] {
  return [
    faceMaterial(coord.x === size - 1 ? COLORS.right : COLORS.inside),
    faceMaterial(coord.x === 0 ? COLORS.left : COLORS.inside),
    faceMaterial(coord.y === size - 1 ? COLORS.top : COLORS.inside),
    faceMaterial(coord.y === 0 ? COLORS.bottom : COLORS.inside),
    faceMaterial(coord.z === size - 1 ? COLORS.front : COLORS.inside),
    faceMaterial(coord.z === 0 ? COLORS.back : COLORS.inside),
  ];
}

function faceMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.03 });
}

function coordToPosition(coord: Coord, size: CubeSize): THREE.Vector3 {
  const spacing = 1.08;
  const offset = (size - 1) / 2;
  return new THREE.Vector3((coord.x - offset) * spacing, (coord.y - offset) * spacing, (coord.z - offset) * spacing);
}

function onPointerDown(event: PointerEvent): void {
  if (animating) return;
  event.preventDefault();
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  activePointerId = event.pointerId;
  stage.setPointerCapture(event.pointerId);
  stage.dataset.dragging = 'true';

  if (activePointers.size >= 2) {
    startPick = null;
    orbiting = false;
    pinchStartDistance = getPinchDistance();
    pinchStartZoom = zoomFactor;
    return;
  }

  dragStart = { x: event.clientX, y: event.clientY };
  startRotation = { x: rotationX, y: rotationY };
  startPick = pickCubie(event.clientX, event.clientY);
  orbiting = !startPick;
}

function onPointerMove(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  event.preventDefault();
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size >= 2) {
    const distance = getPinchDistance();
    if (pinchStartDistance > 0 && distance > 0) {
      zoomFactor = clamp(pinchStartZoom * (pinchStartDistance / distance), 0.55, 2.8);
    }
    return;
  }

  if (event.pointerId !== activePointerId || !orbiting) return;
  const rect = stage.getBoundingClientRect();
  rotationY = startRotation.y + ((event.clientX - dragStart.x) / Math.max(rect.width, 1)) * Math.PI * 1.8;
  rotationX = clamp(startRotation.x + ((event.clientY - dragStart.y) / Math.max(rect.height, 1)) * Math.PI, -1.35, 1.35);
}

function onPointerUp(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  event.preventDefault();
  const wasSinglePointer = activePointers.size === 1;
  if (wasSinglePointer && event.pointerId === activePointerId && !orbiting && startPick) {
    const endPick = pickCubie(event.clientX, event.clientY);
    const move = endPick ? getRotation(startPick, endPick) : null;
    if (move) void rotate(move, 220);
  }
  clearPointer(event);
}

function clearPointer(event: PointerEvent): void {
  activePointers.delete(event.pointerId);
  if (stage.hasPointerCapture(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  if (event.pointerId === activePointerId || activePointers.size === 0) {
    activePointerId = activePointers.keys().next().value ?? null;
    startPick = null;
    orbiting = false;
  }
  if (activePointers.size < 2) {
    pinchStartDistance = 0;
  }
  if (activePointers.size === 0) {
    stage.dataset.dragging = 'false';
  }
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  zoomFactor = clamp(zoomFactor * Math.exp(event.deltaY * 0.001), 0.55, 2.8);
}

function getPinchDistance(): number {
  const [first, second] = [...activePointers.values()];
  if (!first || !second) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pickCubie(clientX: number, clientY: number): PickedCubie | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  pointer.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cubies.map((cubie) => cubie.mesh), false);
  const hit = hits[0];
  if (!hit?.face) return null;
  const cubie = cubies.find((item) => item.mesh === hit.object);
  if (!cubie) return null;
  return { cubie, face: getFaceName(hit.face.normal, cubie.mesh) };
}

function getFaceName(localNormal: THREE.Vector3, mesh: THREE.Object3D): FaceName {
  const normal = localNormal.clone().transformDirection(mesh.matrixWorld);
  const axis = dominantAxis(normal);
  return FACE_BY_NORMAL[`${axis.x},${axis.y},${axis.z}`] ?? 'front';
}

function dominantAxis(vector: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(vector.x);
  const ay = Math.abs(vector.y);
  const az = Math.abs(vector.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(vector.x), 0, 0);
  if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(vector.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(vector.z));
}

function getRotation(startPickValue: PickedCubie, endPick: PickedCubie): Move | null {
  if (startPickValue.face !== endPick.face || startPickValue.cubie === endPick.cubie) return null;
  const size = model.size;
  const start = startPickValue.cubie.state;
  const end = endPick.cubie.state;
  let turns: Turn = -1;
  const interior = (value: number) => value > 0 && value < size - 1;

  switch (startPickValue.face) {
    case 'right':
    case 'left':
      if (interior(start.y) && interior(end.y)) {
        if (startPickValue.face === 'left') turns = invertTurn(turns);
        if (end.z < start.z) turns = invertTurn(turns);
        return { axis: 'y', layer: start.y, turns };
      }
      if (interior(start.z) && interior(end.z)) {
        if (startPickValue.face === 'right') turns = invertTurn(turns);
        if (end.y < start.y) turns = invertTurn(turns);
        return { axis: 'z', layer: start.z, turns };
      }
      return edgeRotation(start, end, 'x');
    case 'top':
    case 'bottom':
      if (interior(start.z) && interior(end.z)) {
        if (startPickValue.face === 'bottom') turns = invertTurn(turns);
        if (end.x < start.x) turns = invertTurn(turns);
        return { axis: 'z', layer: start.z, turns };
      }
      if (interior(start.x) && interior(end.x)) {
        if (startPickValue.face === 'bottom') turns = invertTurn(turns);
        if (end.z < start.z) turns = invertTurn(turns);
        return { axis: 'x', layer: start.x, turns: invertTurn(turns) };
      }
      return edgeRotation(start, end, 'y');
    case 'front':
    case 'back':
      if (interior(start.y) && interior(end.y)) {
        if (startPickValue.face === 'back') turns = invertTurn(turns);
        if (end.x < start.x) turns = invertTurn(turns);
        return { axis: 'y', layer: start.y, turns: invertTurn(turns) };
      }
      if (interior(start.x) && interior(end.x)) {
        if (startPickValue.face === 'back') turns = invertTurn(turns);
        if (end.y < start.y) turns = invertTurn(turns);
        return { axis: 'x', layer: start.x, turns };
      }
      return edgeRotation(start, end, 'z');
  }
}

function edgeRotation(start: Coord, end: Coord, fallbackAxis: Axis): Move | null {
  const changed = (['x', 'y', 'z'] as const).filter((axis) => start[axis] !== end[axis]);
  const layerAxis = (['x', 'y', 'z'] as const).find((axis) => !changed.includes(axis)) ?? fallbackAxis;
  const dragAxis = changed[0];
  if (!dragAxis) return null;
  return { axis: layerAxis, layer: start[layerAxis], turns: end[dragAxis] < start[dragAxis] ? -1 : 1 };
}

function invertTurn(turns: Turn): Turn {
  return (-turns) as Turn;
}

async function scramble(): Promise<void> {
  if (animating) return;
  setControlsDisabled(true);
  for (let i = 0; i < 14; i += 1) {
    await rotate(randomMove(model.size), 70);
  }
  setControlsDisabled(false);
}

async function undo(): Promise<void> {
  if (animating) return;
  const move = model.history.pop();
  if (!move) return;
  const inverse: Move = { ...move, turns: invertTurn(move.turns) };
  animating = true;
  setControlsDisabled(true);
  await animateLayer(inverse, 170);
  model.apply(inverse, false);
  snapCubies();
  setStatus();
  animating = false;
  setControlsDisabled(false);
}

async function rotate(move: Move, durationMs: number): Promise<void> {
  if (animating) return;
  animating = true;
  setControlsDisabled(true);
  await animateLayer(move, durationMs);
  model.apply(move);
  snapCubies();
  setStatus();
  animating = false;
  setControlsDisabled(false);
}

function animateLayer(move: Move, durationMs: number): Promise<void> {
  const layerGroup = new THREE.Group();
  cubeGroup.add(layerGroup);
  const layerCubies = cubies.filter((cubie) => cubie.state[move.axis] === move.layer);
  for (const cubie of layerCubies) layerGroup.attach(cubie.mesh);

  const target = move.turns * Math.PI * 0.5;
  const startTime = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      const progress = clamp((now - startTime) / Math.max(durationMs, 1), 0, 1);
      layerGroup.rotation[move.axis] = ease(progress) * target;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        for (const cubie of layerCubies) cubeGroup.attach(cubie.mesh);
        cubeGroup.remove(layerGroup);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

function snapCubies(): void {
  for (const cubie of cubies) {
    cubie.mesh.position.copy(coordToPosition(cubie.state, model.size));
  }
}

function setControlsDisabled(disabled: boolean): void {
  sizeSelect.disabled = disabled;
  resetButton.disabled = disabled;
  scrambleButton.disabled = disabled;
  undoButton.disabled = disabled;
}

function setStatus(): void {
  statusNode.textContent = model.isSolved() ? 'Solved' : `${model.history.length} moves`;
}

function render(): void {
  const radius = fitDistance * zoomFactor;
  camera.position.set(
    radius * Math.sin(rotationY) * Math.cos(rotationX),
    radius * Math.sin(rotationX),
    radius * Math.cos(rotationY) * Math.cos(rotationX),
  );
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function resize(): void {
  const { width, height } = stage.getBoundingClientRect();
  renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
  camera.aspect = Math.max(width, 1) / Math.max(height, 1);
  camera.updateProjectionMatrix();
  updateFitDistance();
}

function updateFitDistance(): void {
  const { width, height } = stage.getBoundingClientRect();
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const cubeRadius = (model.size * 1.08 * Math.sqrt(3)) / 2;
  const margin = Math.min(width, height) < 360 ? 1.45 : 1.25;
  fitDistance = Math.max(
    cubeRadius / Math.tan(verticalFov / 2),
    cubeRadius / Math.tan(horizontalFov / 2),
  ) * margin;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ease(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
