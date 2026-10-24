/** Page-lifetime Map hygiene shared by the seq/session-keyed caches: re-inserting moves an entry to the newest end, so
 * a trim always targets the least recently used key. */

/** Mark a key freshly used; false when it was absent (the caller then inserts). */
export function lruTouch<K, T>(map: Map<K, T>, key: K): boolean {
  const known = map.get(key)
  if (known === undefined) return false
  map.delete(key)
  map.set(key, known)
  return true
}

/** Drop the least recently used entries past the cap (a no-op at or under it). The count is explicit: a negative
 * `slice` bound wraps from the end and would empty the map. */
export function lruTrim<K, T>(map: Map<K, T>, max: number): void {
  let excess = map.size - max
  if (excess <= 0) return
  for (const key of map.keys()) {
    if (excess <= 0) break
    map.delete(key)
    excess--
  }
}
