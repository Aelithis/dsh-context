import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { createCatalogService } from '../../src/host/catalog'
import { createCostSource } from '../../src/host/cost'
import snapshot from '../../src/host/modelPrices.json'

describe('private price catalogue', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  test('cost reads use the pinned snapshot without fetches, retries or refreshes', async () => {
    const fetchMock = vi.fn(() => { throw new Error('unexpected network') })
    vi.stubGlobal('fetch', fetchMock)
    const service = createCatalogService()
    const cost = createCostSource(service)
    const model = 'deepseek-v4-flash'
    const usage = { deepseek: { [model]: { off: { uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 } } } }
    const book = service.book()
    assert.ok(book !== null)
    assert.equal(snapshot.source, '@opencode-ai/models@0.0.87/snapshot')
    assert.equal(snapshot.snapshotGeneratedAt, '2026-09-27T05:30:14.484Z')
    assert.equal(cost.read(usage)?.usd, snapshot.providers.deepseek.models[model].cost.input)
    assert.equal(cost.ready(), true)
    assert.equal(cost.complete(usage), true)
    assert.equal(cost.version?.(), 1)
    service.ensure()
    await Promise.resolve()
    assert.equal(service.book(), book)
    assert.equal(cost.read({ unknown: { absent: { off: { uncached: 1, cacheRead: 0, cacheWrite: 0, output: 0 } } } })?.usd, null)
    assert.equal(fetchMock.mock.calls.length, 0)
    service.dispose()
    assert.equal(service.book(), null)
  })
})
