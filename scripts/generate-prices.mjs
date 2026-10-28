import { readFileSync, writeFileSync } from 'node:fs'
import { providers, generatedAt } from '@opencode-ai/models/snapshot'

const source = '@opencode-ai/models@0.0.87/snapshot'
const compact = {}
for (const [provider, { models }] of Object.entries(providers)) {
  const entries = {}
  for (const [id, model] of Object.entries(models)) {
    const cost = {}
    for (const key of ['input', 'output', 'cache_read', 'cache_write']) {
      const value = model.cost?.[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) cost[key] = value
    }
    if (cost.input === undefined || cost.output === undefined) continue
    entries[id] = { cost, ...(model.canonical_model_id ? { canonical_model_id: model.canonical_model_id } : {}) }
  }
  if (Object.keys(entries).length > 0) compact[provider] = { models: entries }
}
const path = 'src/client/modelPrices.json'
const previous = (() => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error } })()
const unchanged = previous?.source === source && previous?.snapshotGeneratedAt === generatedAt && JSON.stringify(previous?.providers) === JSON.stringify(compact)
writeFileSync(path, JSON.stringify({ source, snapshotGeneratedAt: generatedAt, generatedAt: unchanged ? previous.generatedAt : new Date().toISOString(), providers: compact }) + '\n')
