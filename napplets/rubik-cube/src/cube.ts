export type CubeSize = 2 | 3 | 4;
export type Axis = 'x' | 'y' | 'z';
export type Turn = -2 | -1 | 1 | 2;

export interface Coord {
  x: number;
  y: number;
  z: number;
}

export interface Move {
  axis: Axis;
  layer: number;
  turns: Turn;
}

export interface CubieState extends Coord {
  id: string;
}

export class CubeModel {
  readonly size: CubeSize;
  readonly cubies: CubieState[];
  readonly history: Move[] = [];

  constructor(size: CubeSize = 3) {
    this.size = size;
    this.cubies = [];
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        for (let z = 0; z < size; z += 1) {
          this.cubies.push({ id: `${x}:${y}:${z}`, x, y, z });
        }
      }
    }
  }

  getLayer(axis: Axis, layer: number): CubieState[] {
    return this.cubies.filter((cubie) => cubie[axis] === layer);
  }

  apply(move: Move, record = true): void {
    if (move.layer < 0 || move.layer >= this.size) return;
    const quarterTurns = normalizeTurns(move.turns);
    for (let i = 0; i < Math.abs(quarterTurns); i += 1) {
      for (const cubie of this.getLayer(move.axis, move.layer)) {
        rotateCoord(cubie, move.axis, Math.sign(quarterTurns), this.size);
      }
    }
    if (record) this.history.push(move);
  }

  undo(): Move | null {
    const move = this.history.pop();
    if (!move) return null;
    const inverse: Move = { ...move, turns: invertTurns(move.turns) };
    this.apply(inverse, false);
    return inverse;
  }

  isSolved(): boolean {
    return this.cubies.every((cubie) => cubie.id === `${cubie.x}:${cubie.y}:${cubie.z}`);
  }
}

export function invertTurns(turns: Turn): Turn {
  return (-turns) as Turn;
}

export function normalizeTurns(turns: Turn): Turn {
  return turns === -2 ? 2 : turns;
}

export function randomMove(size: CubeSize): Move {
  const axes: Axis[] = ['x', 'y', 'z'];
  const turns: Turn[] = [-1, 1, 2];
  return {
    axis: axes[Math.floor(Math.random() * axes.length)] ?? 'x',
    layer: Math.floor(Math.random() * size),
    turns: turns[Math.floor(Math.random() * turns.length)] ?? 1,
  };
}

function rotateCoord(coord: Coord, axis: Axis, direction: number, size: number): void {
  const max = size - 1;
  const { x, y, z } = coord;
  if (axis === 'x') {
    coord.y = direction > 0 ? max - z : z;
    coord.z = direction > 0 ? y : max - y;
  } else if (axis === 'y') {
    coord.x = direction > 0 ? z : max - z;
    coord.z = direction > 0 ? max - x : x;
  } else {
    coord.x = direction > 0 ? max - y : y;
    coord.y = direction > 0 ? x : max - x;
  }
}
