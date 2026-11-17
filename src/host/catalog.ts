import localPrices from './modelPrices.json'
import { pricesBookOf, type ModelBook } from '../shared/pricing'

export interface CatalogService {
  ensure(): void
  book(): ModelBook | null
  pricesVersion(): number
  dispose(): void
}

export function createCatalogService(): CatalogService {
  let book = pricesBookOf(localPrices.providers)
  return {
    ensure(): void {},
    book(): ModelBook | null { return book },
    pricesVersion(): number { return 1 },
    dispose(): void { book = null },
  }
}
