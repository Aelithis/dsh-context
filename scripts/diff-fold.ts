#!/usr/bin/env bun
/**
 * Differential fold check: proves the plugin's heuristic composition equals token-meter's official `contextBreakdown`
 * on real logs (both sides use the plugin's fixed-density pricing mirror). ONE deliberate divergence: image blocks
 * price via the official calculator where the meter uses its generic JSON branch, so expect `messageTokens` + Σ live
 * image deltas. The projection is copied from a dsh SOURCE checkout (DSH_REPO, default ~/dev/deepseek-harness) with
 * bare imports rewritten — no install. Usage: bun scripts/diff-fold.ts <session.jsonl> [...]; exit 0 = all match.
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// Source, not the built bundle: the check must track the working tree.
import { createContextTimelineDefinition } from '../src/host/timeline.ts'
import { estimateImageTokens } from '../src/shared/imageTokens.ts'

const DSH_REPO = process.env.DSH_REPO || `${process.env.HOME}/dev/deepseek-harness`

const dir = mkdtempSync(join(tmpdir(), 'dsh-diff-fold-'))
const TM = join(DSH_REPO, 'packages/llm/token-meter/src')
const SESS = join(DSH_REPO, 'packages/core/session/src')
const rewrite = (file, fn) => writeFileSync(join(dir, file), fn(String(readFileSync(file.startsWith('/') ? file : join(TM, file)))))
rewrite('breakdown-projection.ts', s => s
  .replace("import { z } from 'zod'", "import { z } from './zod-stub.ts'")
  .replace("from '@deepseek-ai/dsh-session'", "from './session-facade.ts'"))
rewrite('surface-projection.ts', s => s
  .replace("from '@deepseek-ai/dsh-session'", "from './surface.ts'"))
rewrite('estimate.ts', s => s)
rewrite('projection.ts', s => s)
writeFileSync(join(dir, 'surface.ts'), String(readFileSync(join(SESS, 'surface.ts'))))
// Stored headers are already canonical (the loop appends canonicalHeader output), so identity is faithful.
writeFileSync(join(dir, 'session-facade.ts'), `export const canonicalHeader = (h) => h\n`)
// zod stub: the persistence schemas are built at module top level but never exercised — a chainable no-op satisfies construction.
writeFileSync(join(dir, 'zod-stub.ts'), `
const stub: any = new Proxy(() => stub, { get: () => stub, apply: () => stub })
export const z = stub
`)
const { contextBreakdownProjectionDefinition } = await import(pathToFileURL(join(dir, 'breakdown-projection.ts')).href)
const { isSurfaceEvent, deriveEventMessage } = await import(pathToFileURL(join(dir, 'surface.ts')).href)

/** The image-pricing divergence: per image block with known dims, the official calculator price minus the meter's JSON price of the whole
 * block; unknown dims price identically. */
function imageDeltaOf(blocks) {
  let delta = 0
  if (!Array.isArray(blocks)) return 0
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'image') {
      const a = block.attachment
      if (a !== null && typeof a === 'object' && typeof a.width === 'number' && typeof a.height === 'number') {
        const corrected = estimateImageTokens(a.width, a.height)
        if (corrected !== null) delta += corrected - Math.ceil(JSON.stringify(block).length / 4)
      }
    } else if (block.type === 'tool-result') {
      delta += imageDeltaOf(block.content)
    }
  }
  return delta
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: bun tests/diff-fold.ts <session.jsonl> [...]')
  process.exit(2)
}

let failed = 0
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== '')
  const events = []
  for (const line of lines) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev !== null && typeof ev === 'object' && typeof ev.seq === 'number') events.push(ev)
  }

  // Official fold: token-meter's contextBreakdown projection, verbatim (dsh 0.1.1 moved the client view under `wire`; read either
  // contract).
  const officialView = contextBreakdownProjectionDefinition.wire?.view
    ?? contextBreakdownProjectionDefinition.view
  let st = contextBreakdownProjectionDefinition.init()
  for (const ev of events) st = contextBreakdownProjectionDefinition.apply(st, ev)
  const breakdown = officialView(st)

  const def = createContextTimelineDefinition({})
  let mine = def.init()
  for (const ev of events) mine = def.apply(mine, ev)
  const view = def.view(mine)
  const surfaceTotal = view.current.total - view.current.system - view.current.tools

  // Parallel image-delta surface: replay the same surface ops, tracking the per-node image divergence.
  let live = []
  let shadowedSeqs = null
  for (const ev of events) {
    if (ev.type === 'compaction/summary' || ev.type === 'compaction/prune') {
      shadowedSeqs = Array.isArray(ev.data?.shadowedSeqs) ? ev.data.shadowedSeqs : null
      continue
    }
    if (!isSurfaceEvent(ev)) { shadowedSeqs = null; continue }
    const msg = deriveEventMessage(ev)
    const delta = msg === null ? 0 : imageDeltaOf(msg.content)
    const op = ev.surfaceOp
    if (op !== 'append') {
      if (Array.isArray(shadowedSeqs) && shadowedSeqs.length > 0) {
        const shadowed = new Set(shadowedSeqs)
        live = live.filter(n => !shadowed.has(n.seq))
      } else {
        live = live.filter(n => n.seq < op.start || n.seq > op.end)
      }
    }
    shadowedSeqs = null
    live.push({ seq: ev.seq, delta })
  }
  const imageDelta = live.reduce((sum, n) => sum + n.delta, 0)

  const match = view.current.system === breakdown.systemTokens
    && view.current.tools === breakdown.toolsTokens
    && surfaceTotal === breakdown.messageTokens + imageDelta
  if (!match) failed = 1
  console.log(
    (match ? 'MATCH    ' : 'MISMATCH ')
    + file
    + ' official=' + String(breakdown.systemTokens) + '/' + String(breakdown.toolsTokens) + '/' + String(breakdown.messageTokens)
    + ' plugin=' + String(view.current.system) + '/' + String(view.current.tools) + '/' + String(surfaceTotal)
    + (imageDelta !== 0 ? ' imageDelta=' + String(imageDelta) : ''),
  )
}
process.exit(failed)