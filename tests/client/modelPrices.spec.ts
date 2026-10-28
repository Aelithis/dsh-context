import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { getModelPricesSnap, pricesBookOf, resetModelPrices, setModelPricesLoader, subscribeModelPrices } from '../../src/client/modelPrices'
import type { ModelPricesSnap } from '../../src/client/modelPrices'

const FIXTURE = {
  deepseek: {
    npm: '@ai-sdk/openai-compatible',
    models: {
      'deepseek-v4-flash': { cost: { input: 0.15, output: 0.6, reasoning: 0.6, cache_read: 0.003 } },
      'deepseek-v4-pro': { cost: { input: 0.435, output: 0.87 } },
      'glm-free': { cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
      'broken-missing-input': { cost: { output: 1 } },
      'broken-missing-output': { cost: { input: 1 } },
      'broken-negative': { cost: { input: -1, output: 1 } },
      'broken-nan': { cost: { input: Number.NaN, output: Number.POSITIVE_INFINITY } },
      'broken-no-cost': {},
      'broken-not-record': null,
    },
  },
  anthropic: {
    npm: '@ai-sdk/anthropic',
    models: { 'claude-sonnet-5': { cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } } },
  },
  gateway: {
    npm: '@ai-sdk/openai-compatible',
    models: { 'claude-sonnet-5': { cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } } },
  },
  foreign: {
    npm: '@ai-sdk/openai',
    models: { 'claude-sonnet-5': { cost: { input: 9, output: 9, cache_read: 9, cache_write: 9 } } },
  },
  moonshotai: { models: { 'kimi-k2.7-code': { cost: { input: 1.9, output: 8, cache_read: 0.38, cache_write: 3 } } } },
  minimax: { models: { 'broken-input': { cost: { input: 'junk', output: 2 } } } },
  zhipuai: { models: 'nope' },
  'junk-provider': 7,
  'provider-the-plugin-never-maps': { models: { m: { cost: { input: 1, output: 2 } } } },
}

describe('pricesBookOf', () => {
  test('extracts every pricing provider under its registry id, skipping junk entries', () => {
    const { prices } = pricesBookOf(FIXTURE) ?? {}
    assert.deepEqual(prices, {
      deepseek: {
        'deepseek-v4-flash': { hit: 0.003, miss: 0.15, write: 0.15, out: 0.6 },
        'deepseek-v4-pro': { hit: 0.435, miss: 0.435, write: 0.435, out: 0.87 },
        'glm-free': { hit: 0, miss: 0, write: 0, out: 0 },
      },
      anthropic: { 'claude-sonnet-5': { hit: 0.2, miss: 2, write: 2.5, out: 10 } },
      gateway: { 'claude-sonnet-5': { hit: 0.2, miss: 2, write: 2.5, out: 10 } },
      foreign: { 'claude-sonnet-5': { hit: 9, miss: 9, write: 9, out: 9 } },
      moonshotai: { 'kimi-k2.7-code': { hit: 0.38, miss: 1.9, write: 3, out: 8 } },
      'provider-the-plugin-never-maps': { m: { hit: 1, miss: 1, write: 1, out: 2 } },
    })
  })

  test('absent cache prices fall back to the input rate', () => {
    const book = pricesBookOf(FIXTURE)
    assert.equal(book?.prices.deepseek?.['deepseek-v4-pro']?.write, 0.435)
  })

  test('canonical ids join the branch index and mark its labs', () => {
    const book = pricesBookOf({
      p: {
        models: {
          a: { cost: { input: 1, output: 2 }, canonical_model_id: 'lab/a' },
          b: { cost: { input: 3, output: 4 }, canonical_model_id: 'lab/b' },
          c: { cost: { input: 5, output: 6 } },
        },
      },
    })
    const branch = book?.index.branches.get('p')
    assert.equal(branch?.labs.size, 1)
    assert.deepEqual(branch?.byExact.get('a')?.[0], { pid: 'p', mid: 'a', rate: { hit: 1, miss: 1, write: 1, out: 2 }, canonical: 'lab/a', lab: 'lab' })
    assert.equal(branch?.byExact.get('c')?.[0]?.canonical, undefined)
  })

  test('a payload that is not a record prices null; an empty one prices an empty book', () => {
    assert.equal(pricesBookOf(null), null)
    assert.equal(pricesBookOf('x'), null)
    assert.equal(pricesBookOf([FIXTURE]), null)
    assert.deepEqual(pricesBookOf({}), { prices: {}, index: { byModel: new Map(), byNormalized: new Map(), branches: new Map() } })
  })
})

describe('the price store', () => {
  let snaps: ModelPricesSnap[]

  /** Drain the fire() promise chain (fake timers keep setTimeout inert). */
  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    snaps = []
    resetModelPrices()
  })

  afterEach(() => {
    resetModelPrices()
    vi.useRealTimers()
  })

  test('dormant until subscribed, then one fetch fills the book', async () => {
    let calls = 0
    setModelPricesLoader(() => {
      calls++
      return Promise.resolve(FIXTURE)
    })
    assert.deepEqual(getModelPricesSnap(), { book: null, failed: false })
    const seen: ModelPricesSnap[] = []
    const un = subscribeModelPrices(() => seen.push(getModelPricesSnap()))
    const un2 = subscribeModelPrices(() => {})
    await settle()
    assert.equal(calls, 1)
    assert.equal(getModelPricesSnap().failed, false)
    assert.ok(getModelPricesSnap().book !== null)
    assert.ok(seen.length > 0, 'listeners hear the transition')
    un2()
    await settle()
    assert.equal(calls, 1)
    un()
  })

  test('a failed load reports failure without background retries', async () => {
    const load = vi.fn(() => Promise.reject(new Error('down')))
    setModelPricesLoader(load)
    subscribeModelPrices(() => snaps.push(getModelPricesSnap()))
    await settle()
    assert.equal(getModelPricesSnap().failed, true)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    assert.equal(load.mock.calls.length, 1)
    assert.equal(vi.getTimerCount(), 0)
  })

  test('an invalid local payload reports no book', async () => {
    setModelPricesLoader(() => Promise.resolve('garbage'))
    subscribeModelPrices(() => {})
    await settle()
    assert.deepEqual(getModelPricesSnap(), { book: null, failed: true })
  })

  test('the default loads the pinned local snapshot without any network or timer', async () => {
    const fetchMock = vi.fn(() => { throw new Error('unexpected network') })
    vi.stubGlobal('fetch', fetchMock)
    try {
      setModelPricesLoader(null)
      const off = subscribeModelPrices(() => snaps.push(getModelPricesSnap()))
      await settle()
      const book = getModelPricesSnap().book
      assert.ok(book !== null)
      assert.ok(Object.keys(book.prices).length > 0)
      assert.equal(book.prices['private-unknown-provider']?.['private-unknown-model'], undefined)
      assert.equal(fetchMock.mock.calls.length, 0)
      assert.equal(vi.getTimerCount(), 0)
      off()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
