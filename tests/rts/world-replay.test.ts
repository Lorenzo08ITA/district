import { it, expect } from 'vitest';
import { runWorldReplay } from './world-replay';
it('replay combinato: economia, flotte, sbarco, MIRV e SAM con riprese intermedie', () => {
  const a = runWorldReplay(),
    b = runWorldReplay();
  expect(a).toEqual(b);
  expect(a.finalHash).toBe(a.resumedHash);
  expect(a.mirvLaunches).toBe(1);
  expect(a.contaminated).toBeGreaterThan(0);
});
