import { describe, expect, it } from 'vitest';
import { CubeModel, randomMove, type CubeSize, type Move } from './cube';

describe('CubeModel', () => {
  it('returns to solved after four identical quarter turns', () => {
    const cube = new CubeModel(3);
    const move: Move = { axis: 'z', layer: 2, turns: 1 };

    cube.apply(move);
    cube.apply(move);
    cube.apply(move);
    cube.apply(move);

    expect(cube.isSolved()).toBe(true);
  });

  it('undo reverses the most recent move', () => {
    const cube = new CubeModel(4);

    cube.apply({ axis: 'x', layer: 1, turns: -1 });
    expect(cube.isSolved()).toBe(false);
    cube.undo();

    expect(cube.isSolved()).toBe(true);
  });

  it('generates moves inside the selected cube size', () => {
    const size: CubeSize = 2;

    for (let i = 0; i < 20; i += 1) {
      const move = randomMove(size);
      expect(['x', 'y', 'z']).toContain(move.axis);
      expect(move.layer).toBeGreaterThanOrEqual(0);
      expect(move.layer).toBeLessThan(size);
      expect([-1, 1, 2]).toContain(move.turns);
    }
  });
});
