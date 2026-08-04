import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, MinesweeperGame, type Difficulty } from './game';

const tiny: Difficulty = { id: 'beginner', label: 'Tiny', width: 4, height: 4, mines: 2 };

describe('MinesweeperGame', () => {
  it('keeps the first revealed square and its neighbors safe', () => {
    const game = new MinesweeperGame(DIFFICULTIES[0], () => 0);
    game.reveal(40);
    expect(game.cells[40]?.revealed).toBe(true);
    expect([40, ...game.neighbors(40)].every((index) => !game.cells[index]?.mine)).toBe(true);
    expect(game.cells.filter((cell) => cell.mine)).toHaveLength(10);
  });

  it('toggles flags only on covered cells', () => {
    const game = new MinesweeperGame(tiny, () => 0);
    expect(game.toggleFlag(0)).toBe(true);
    expect(game.flags).toBe(1);
    expect(game.reveal(0)).toBe(false);
    expect(game.toggleFlag(0)).toBe(true);
    expect(game.flags).toBe(0);
  });

  it('wins after every safe cell is revealed', () => {
    const game = new MinesweeperGame(tiny, () => 0);
    game.reveal(0);
    game.cells.forEach((cell, index) => {
      if (!cell.mine) game.reveal(index);
    });
    expect(game.status).toBe('won');
    expect(game.flags).toBe(tiny.mines);
  });

  it('loses and reveals mines when a mine is selected', () => {
    let seed = 7;
    const game = new MinesweeperGame(DIFFICULTIES[0], () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    game.reveal(40);
    expect(game.status).toBe('playing');
    const mine = game.cells.findIndex((cell) => cell.mine);
    game.reveal(mine);
    expect(game.status).toBe('lost');
    expect(game.cells[mine]?.exploded).toBe(true);
    expect(game.cells.filter((cell) => cell.mine).every((cell) => cell.revealed)).toBe(true);
  });
});
