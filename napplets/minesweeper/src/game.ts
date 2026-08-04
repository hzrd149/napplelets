export type GameStatus = 'ready' | 'playing' | 'won' | 'lost';

export type Difficulty = {
  id: 'beginner' | 'intermediate' | 'expert';
  label: string;
  width: number;
  height: number;
  mines: number;
};

export type Cell = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
  exploded: boolean;
};

export const DIFFICULTIES: readonly Difficulty[] = [
  { id: 'beginner', label: 'Beginner', width: 9, height: 9, mines: 10 },
  { id: 'intermediate', label: 'Intermediate', width: 16, height: 16, mines: 40 },
  { id: 'expert', label: 'Expert', width: 30, height: 16, mines: 99 },
];

export class MinesweeperGame {
  readonly cells: Cell[];
  status: GameStatus = 'ready';
  minesPlaced = false;
  revealedCount = 0;

  constructor(
    readonly difficulty: Difficulty,
    private readonly random: () => number = Math.random,
  ) {
    this.cells = Array.from({ length: difficulty.width * difficulty.height }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
      exploded: false,
    }));
  }

  get flags(): number {
    return this.cells.reduce((count, cell) => count + Number(cell.flagged), 0);
  }

  neighbors(index: number): number[] {
    const x = index % this.difficulty.width;
    const y = Math.floor(index / this.difficulty.width);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.difficulty.width && ny >= 0 && ny < this.difficulty.height) {
          result.push(ny * this.difficulty.width + nx);
        }
      }
    }
    return result;
  }

  toggleFlag(index: number): boolean {
    const cell = this.cells[index];
    if (!cell || cell.revealed || this.status === 'won' || this.status === 'lost') return false;
    cell.flagged = !cell.flagged;
    return true;
  }

  reveal(index: number): boolean {
    const cell = this.cells[index];
    if (!cell || cell.flagged || cell.revealed || this.status === 'won' || this.status === 'lost') {
      return false;
    }
    if (!this.minesPlaced) this.placeMines(index);
    if (this.status === 'ready') this.status = 'playing';
    if (cell.mine) {
      cell.revealed = true;
      cell.exploded = true;
      this.status = 'lost';
      this.revealMines();
      return true;
    }
    this.revealSafeArea(index);
    this.checkWin();
    return true;
  }

  chord(index: number): boolean {
    const cell = this.cells[index];
    if (!cell?.revealed || cell.adjacent === 0 || this.status !== 'playing') return false;
    const around = this.neighbors(index);
    if (around.filter((neighbor) => this.cells[neighbor]?.flagged).length !== cell.adjacent) {
      return false;
    }
    let changed = false;
    for (const neighbor of around) {
      const next = this.cells[neighbor];
      if (!next || next.flagged || next.revealed) continue;
      changed = this.reveal(neighbor) || changed;
      if (next.mine) break;
    }
    return changed;
  }

  private placeMines(firstIndex: number): void {
    const protectedCells = new Set([firstIndex, ...this.neighbors(firstIndex)]);
    let candidates = this.cells
      .map((_, index) => index)
      .filter((index) => !protectedCells.has(index));
    if (candidates.length < this.difficulty.mines) {
      candidates = this.cells.map((_, index) => index).filter((index) => index !== firstIndex);
    }
    for (let remaining = this.difficulty.mines; remaining > 0; remaining -= 1) {
      const pick = Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length));
      const [index] = candidates.splice(pick, 1);
      if (index !== undefined) this.cells[index].mine = true;
    }
    this.cells.forEach((cell, index) => {
      cell.adjacent = this.neighbors(index).filter((neighbor) => this.cells[neighbor]?.mine).length;
    });
    this.minesPlaced = true;
  }

  private revealSafeArea(start: number): void {
    const queue = [start];
    const queued = new Set(queue);
    while (queue.length) {
      const index = queue.shift();
      if (index === undefined) break;
      const cell = this.cells[index];
      if (!cell || cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      this.revealedCount += 1;
      if (cell.adjacent !== 0) continue;
      for (const neighbor of this.neighbors(index)) {
        if (!queued.has(neighbor)) {
          queued.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  private revealMines(): void {
    for (const cell of this.cells) {
      if (cell.mine) cell.revealed = true;
    }
  }

  private checkWin(): void {
    if (this.revealedCount !== this.cells.length - this.difficulty.mines) return;
    this.status = 'won';
    for (const cell of this.cells) if (cell.mine) cell.flagged = true;
  }
}
