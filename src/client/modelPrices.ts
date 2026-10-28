import localPrices from './modelPrices.json'
import { useSyncExternalStore } from 'react'
import { asRecord } from './services'
import { priceIndexOf } from './cost'
import type { ModelBook, ModelPrices, PriceTriple } from './cost'

function rateOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Extract per-model USD rates and build the resolution index; an invalid payload returns null. */
export function pricesBookOf(value: unknown): ModelBook | null {
  const data = asRecord(value)
  if (data === null || Array.isArray(data)) return null
  const book: ModelPrices = {}
  const canonicalOf: Record<string, Record<string, string>> = {}
  for (const providerId of Object.keys(data)) {
    const provider = asRecord(data[providerId])
    if (provider === null) continue
    const modelList = asRecord(provider.models)
    if (modelList === null) continue
    const models: Record<string, PriceTriple> = {}
    for (const id of Object.keys(modelList)) {
      const model = asRecord(modelList[id])
      const cost = model !== null ? asRecord(model.cost) : null
      if (cost === null) continue
      const miss = rateOf(cost.input)
      const out = rateOf(cost.output)
      if (miss === null || out === null) continue
      models[id] = {
        hit: rateOf(cost.cache_read) ?? miss,
        miss,
        write: rateOf(cost.cache_write) ?? miss,
        out,
      }
      const canonical = model?.['canonical_model_id']
      if (typeof canonical === 'string' && canonical.length > 0) {
        const branch = canonicalOf[providerId] ?? (canonicalOf[providerId] = {})
        branch[id] = canonical
      }
    }
    if (Object.keys(models).length > 0) book[providerId] = models
  }
  return { prices: book, index: priceIndexOf(book, canonicalOf) }
}

export interface ModelPricesSnap {
  book: ModelBook | null
  failed: boolean
}

type Loader = () => Promise<unknown>

const defaultLoader: Loader = () => Promise.resolve(localPrices.providers)

let loader: Loader = defaultLoader
let snap: ModelPricesSnap = { book: null, failed: false }
let inFlight = false
const listeners = new Set<() => void>()

function fail(): void {
  snap = { ...snap, failed: true }
}

async function fire(): Promise<void> {
  inFlight = true
  try {
    const book = pricesBookOf(await loader())
    if (book !== null) {
      snap = { book, failed: false }
    } else {
      fail()
    }
  } catch {
    fail()
  }
  inFlight = false
  for (const fn of listeners) fn()
}

function kick(): void {
  if (snap.book !== null || inFlight) return
  void fire()
}

export const subscribeModelPrices = (fn: () => void): (() => void) => {
  listeners.add(fn)
  kick()
  return () => {
    listeners.delete(fn)
  }
}

export const getModelPricesSnap = (): ModelPricesSnap => snap

export function useModelPrices(): ModelPricesSnap {
  return useSyncExternalStore(subscribeModelPrices, getModelPricesSnap)
}

export function resetModelPrices(): void {
  snap = { book: null, failed: false }
  inFlight = false
  listeners.clear()
}

export function setModelPricesLoader(next: Loader | null): void {
  loader = next ?? defaultLoader
}
