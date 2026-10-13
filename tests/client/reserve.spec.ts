// The auto-compaction reserve geometry (src/client/reserve.ts): dsh-compaction-basic's pressure
// trigger priced against the session's real window and routed output cap, plus the mask extents the
// composition bar paints. The two masks must always tile [threshold, window].

import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { COMPACT_HEADROOM_TOKENS, COMPACT_THRESHOLD_RATIO, reserveGeometry } from '../../src/client/reserve'

/** The reserve always closes the window: trigger + headroom mask + output mask. */
function tiles(reserve: NonNullable<ReturnType<typeof reserveGeometry>>, window: number): boolean {
  return reserve.threshold + reserve.headroom + reserve.output === window
}

describe('reserveGeometry', () => {
  test('no positive window: no reserve', () => {
    assert.equal(reserveGeometry(undefined, 256_000), undefined)
    assert.equal(reserveGeometry(0, 256_000), undefined)
    assert.equal(reserveGeometry(-1_000, 256_000), undefined)
    assert.equal(reserveGeometry(Number.NaN, 256_000), undefined)
    assert.equal(reserveGeometry(Number.POSITIVE_INFINITY, 256_000), undefined)
  })

  test('the deepseek defaults: the pressure budget binds, and the headroom mask IS headroomTokens', () => {
    // W = 1,000,000, O = 256,000 (the routed envelope cap), B = 65,536 (dsh's default):
    // threshold = min(floor(W × 0.8), W − O − B) = min(800,000, 678,464).
    const reserve = reserveGeometry(1_000_000, 256_000)
    assert.deepEqual(reserve, { threshold: 678_464, headroom: COMPACT_HEADROOM_TOKENS, output: 256_000 })
    assert.ok(tiles(reserve!, 1_000_000))
  })

  test('a small output cap leaves the ratio binding, and the headroom mask grows to the ratio slack', () => {
    // threshold = min(800,000, 926,464) = 800,000; the mask runs to the output reservation's edge.
    const reserve = reserveGeometry(1_000_000, 8_000)
    assert.deepEqual(reserve, { threshold: 800_000, headroom: 192_000, output: 8_000 })
    assert.equal(reserve!.threshold, Math.floor(1_000_000 * COMPACT_THRESHOLD_RATIO))
    assert.ok(tiles(reserve!, 1_000_000))
  })

  test('an unknown, non-positive, or non-finite output cap reserves nothing', () => {
    for (const cap of [undefined, 0, -8_000, Number.NaN, Number.POSITIVE_INFINITY] as const) {
      const reserve = reserveGeometry(1_000, cap)
      assert.deepEqual(reserve, { threshold: 0, headroom: 1_000, output: 0 }, String(cap))
    }
    // The wire can carry any type: a non-number cap reserves nothing rather than poisoning the math.
    assert.deepEqual(reserveGeometry(1_000, 'junk' as unknown as number), { threshold: 0, headroom: 1_000, output: 0 })
  })

  test('a cap at or past the window reserves the whole window', () => {
    assert.deepEqual(reserveGeometry(1_000, 1_000), { threshold: 0, headroom: 0, output: 1_000 })
    assert.deepEqual(reserveGeometry(1_000, 5_000), { threshold: 0, headroom: 0, output: 1_000 })
  })

  test('a headroom wider than the window still holds reserves it all, with no trigger left', () => {
    // W − O = 800 < B: dsh's own config error path; the bar stays truthful by reserving what fits.
    assert.deepEqual(reserveGeometry(1_000, 200), { threshold: 0, headroom: 800, output: 200 })
  })
})
