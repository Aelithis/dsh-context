import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { browserCapOf } from '../../../src/client/components/contextView'

describe('browserCapOf — the Context browser column\'s height ceiling', () => {
  test('the stacked composition + trend card heights, bounded by the host scrollport slice, rounded', () => {
    assert.equal(browserCapOf([180.4, 321.6], null), 502, 'no measurable scrollport bounds by the row alone')
    assert.equal(browserCapOf([180.4, 321.6], 400), 400, 'the pane slice caps below the row')
    assert.equal(browserCapOf([180.4, 321.6], 4000), 502, 'a tall pane never stretches past the row')
  })

  test('a degenerate pane keeps a minimum rows region (it overflows the pane a little rather than collapsing)', () => {
    assert.equal(browserCapOf([400, 200], 150), 180)
  })

  test('no measurable card (the loading frame) leaves the column uncapped', () => {
    assert.equal(browserCapOf([], null), null)
    assert.equal(browserCapOf([0, 0], 400), null)
  })

  test('a non-finite measured height (a rect stub without height) leaves the column uncapped, not NaN', () => {
    assert.equal(browserCapOf([180, undefined as unknown as number], 400), null)
  })

  test('a non-finite pane fit falls back to the stacked height', () => {
    assert.equal(browserCapOf([180, 200], Number.NaN), 380)
  })
})
