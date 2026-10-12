import { describe, expect, it } from 'vitest';
import {
  MAP, CIRCLE_IDS, RED_CIRCLES, YELLOW_CROSSINGS, GOULSTON_CROSSING,
  adjacentCircles, alleyDestinations, circlesAroundCrossing, circleNeighbors, coachRoutes, crossingSteps,
} from '../src/map/graph.ts';
import ref from './fixtures/whitechapelR.json' with { type: 'json' };

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Pairs where the independent whitechapelR dataset disagrees with the board.
 * Each one was checked by eye against the board photo and the reference graph image.
 */
const ROAD_REF_ERRORS = {
  // in whitechapelR but not on the board
  missing: ['31-36', '165-186'],
  // on the board but absent from whitechapelR
  extra: ['16-34', '165-189', '169-191', '172-183'],
};
const ALLEY_REF_ERRORS = { missing: ['35-39'], extra: ['183-184', '183-192'] };

describe('map data', () => {
  it('has 195 numbered circles, 8 red, 7 yellow crossings and Goulston Street', () => {
    expect(CIRCLE_IDS).toEqual(Array.from({ length: 195 }, (_, i) => i + 1));
    expect(RED_CIRCLES).toEqual([3, 21, 27, 65, 84, 147, 149, 158]);
    expect(YELLOW_CROSSINGS).toHaveLength(7);
    expect(GOULSTON_CROSSING).not.toBeNull();
  });

  it('every node is on the board image and the street graph is connected', () => {
    const { width, height } = MAP.board;
    for (const n of [...MAP.circles, ...MAP.crossings, ...MAP.junctions]) {
      expect(n.x).toBeGreaterThan(0); expect(n.x).toBeLessThan(width);
      expect(n.y).toBeGreaterThan(0); expect(n.y).toBeLessThan(height);
    }
    const seen = new Set([1]); const stack = [1];
    while (stack.length) for (const n of adjacentCircles(stack.pop()!)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    expect(seen.size).toBe(195);
    for (const x of MAP.crossings) expect(crossingSteps(x.id).length).toBeGreaterThan(0);
  });

  it('circle adjacency matches whitechapelR roads (except verified dataset errors)', () => {
    const mine = new Set<string>();
    for (const c of CIRCLE_IDS) for (const n of adjacentCircles(c)) mine.add(pairKey(c, n));
    const theirs = new Set((ref.roads as number[][]).map(([a, b]) => pairKey(a, b)));
    expect([...theirs].filter((k) => !mine.has(k)).sort()).toEqual(ROAD_REF_ERRORS.missing.sort());
    expect([...mine].filter((k) => !theirs.has(k)).sort()).toEqual(ROAD_REF_ERRORS.extra.sort());
  });

  it('alley (block) connections match whitechapelR alley (except verified dataset errors)', () => {
    const mine = new Set<string>();
    for (const c of CIRCLE_IDS) for (const n of alleyDestinations(c)) mine.add(pairKey(c, n));
    const theirs = new Set((ref.alley as number[][]).map(([a, b]) => pairKey(a, b)));
    expect([...theirs].filter((k) => !mine.has(k)).sort()).toEqual(ALLEY_REF_ERRORS.missing.sort());
    expect([...mine].filter((k) => !theirs.has(k)).sort()).toEqual(ALLEY_REF_ERRORS.extra.sort());
  });
});

describe('rulebook examples', () => {
  it('wretched on 65 may go to 63, 66, 51, 67, 84, 83, 82 (p.13)', () => {
    expect(adjacentCircles(65)).toEqual([51, 63, 66, 67, 82, 83, 84]);
  });
  it('Jack moves 127 -> 103 (p.15)', () => {
    expect(adjacentCircles(127)).toContain(103);
  });
  it('coach 103 -> 69 -> 56 (p.19)', () => {
    expect(coachRoutes(103)).toContainEqual([69, 56]);
  });
  it('alley from 56 reaches the southern block 57, 73, 72, 71, 70, 69 (p.20)', () => {
    expect(alleyDestinations(56)).toEqual(expect.arrayContaining([57, 73, 72, 71, 70, 69]));
    expect(MAP.blocks).toContainEqual([56, 57, 69, 70, 71, 72, 73]);
  });
  it('a crossing next to 99, 100 and 120 does not reach 83 (p.17)', () => {
    const x = MAP.crossings.find((c) => {
      const r = circlesAroundCrossing(c.id);
      return [99, 100, 120].every((n) => r.includes(n));
    });
    expect(x).toBeDefined();
    expect(circlesAroundCrossing(x!.id)).not.toContain(83);
  });
  it('a policeman blocks the street he stands on', () => {
    const x = MAP.crossings.find((c) => circlesAroundCrossing(c.id).includes(99) && circlesAroundCrossing(c.id).includes(120))!;
    expect(circleNeighbors(99)).toContain(120);
    expect(circleNeighbors(99, new Set([x.id]))).not.toContain(120);
  });
});
