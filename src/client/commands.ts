/** The command panel's derivation: the served execution log joined with the archive's `gone` stamps, plus the display
 * reads (preview text, duration, filter/sort) the card maps over. */

import type { CommandRecord, CommandStats, SurfaceNode } from '../shared/types'
import { firstLineOf, headProgramOf, hideableCdPrefix } from '../shared/commands'

export type Command = CommandRecord
export type CommandFilter = 'all' | 'failed' | 'slow' | 'background'
export type CommandSort = 'latest' | 'slowest'

/** A run at or past this wall time earns the Slow chip. */
export const SLOW_MS = 10_000

/** The surface node the run's result lives on: a nested Code-Mode record reveals on its parent run_code result;
 * a run without a result yet has nothing to reveal. */
export function surfaceSeqOf(rec: CommandRecord): number | undefined {
  return rec.parent ?? rec.resultSeq
}

/** `gone` joins off the archive exactly like the file-op log's (fileActivity.activityOfOps). */
export function commandsOf(records: readonly CommandRecord[], archive: readonly SurfaceNode[]): Command[] {
  const goneBySeq = new Map<number, number>()
  for (const n of archive) if (n.gone !== undefined) goneBySeq.set(n.seq, n.gone)
  return records.map((rec) => {
    const key = surfaceSeqOf(rec)
    const gone = key === undefined ? undefined : goneBySeq.get(key)
    return gone !== undefined && rec.gone === undefined ? { ...rec, gone } : rec
  })
}

export function durationOf(rec: CommandRecord): number | undefined {
  return rec.end === undefined ? undefined : Math.max(0, rec.end - rec.start)
}

/** The collapsed one-line display of a command text: first line, minus a leading `cd <workspace> && ` prefix. */
export function previewTextOf(cmd: string, workspace: string | undefined): string {
  return firstLineOf(cmd.slice(hideableCdPrefix(cmd, workspace)))
}

/** The collapsed row's command text: the first line, minus a leading `cd <workspace> && ` prefix. */
export function previewOf(rec: CommandRecord, workspace: string | undefined): string {
  return previewTextOf(rec.cmd, workspace)
}

export function matchesFilter(rec: CommandRecord, filter: CommandFilter): boolean {
  if (filter === 'failed') return rec.status === 'failed' || rec.status === 'killed'
  if (filter === 'slow') {
    const d = durationOf(rec)
    return d !== undefined && d >= SLOW_MS
  }
  if (filter === 'background') return rec.background === true
  return true
}

export function matchesQuery(rec: CommandRecord, q: string): boolean {
  if (q === '') return true
  const needle = q.toLowerCase()
  if (rec.cmd.toLowerCase().includes(needle)) return true
  if (rec.description !== undefined && rec.description.toLowerCase().includes(needle)) return true
  if (rec.cwd !== undefined && rec.cwd.toLowerCase().includes(needle)) return true
  return programOf(rec).toLowerCase().includes(needle)
}

export function byLatest(a: CommandRecord, b: CommandRecord): number {
  return (b.time - a.time) || (b.seq - a.seq)
}

export function bySlowest(a: CommandRecord, b: CommandRecord): number {
  return (durationOf(b) ?? -1) - (durationOf(a) ?? -1) || byLatest(a, b)
}

/** The title tally's fallback when the host serves no whole-log stats (a pre-field row): count the retained list.
 * Mirrors the host's tally moments: runs/failed/ms settle at the terminal transition, background at the flag. */
export function tallyOfCommands(records: readonly CommandRecord[]): CommandStats {
  const stats: CommandStats = { runs: 0, failed: 0, ms: 0, bg: 0 }
  for (const rec of records) {
    if (rec.background === true) stats.bg += 1
    if (rec.status === 'running') continue
    stats.runs += 1
    if (rec.status === 'failed' || rec.status === 'killed') stats.failed += 1
    const d = durationOf(rec)
    if (d !== undefined) stats.ms += d
  }
  return stats
}

/** A record's program identity for the rail: the shell head word (dialect-aware), the tool itself for code programs. */
export function programOf(rec: CommandRecord): string {
  if (rec.tool === 'bash' || rec.tool === 'pwsh') {
    const head = headProgramOf(rec.cmd, rec.tool)
    return head === '' ? (rec.tool === 'pwsh' ? 'pwsh' : 'shell') : head
  }
  return rec.tool
}

export interface ProgramCount {
  name: string
  n: number
}

/** The rail's program ranking over the RETAINED list (the floor note already scopes a trimmed log): every program,
 * most-run first with a stable name tie-break. */
export function programsOf(records: readonly CommandRecord[]): ProgramCount[] {
  const counts = new Map<string, number>()
  for (const rec of records) {
    const name = programOf(rec)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => (b.n - a.n) || (a.name < b.name ? -1 : 1))
}

/** The rail's Attention facts over the retained list; each key drives a list lens in the card. */
export interface CommandAttention {
  /** The slowest settled run (only when it crossed the second mark). */
  slowest?: { cmd: string; ms: number }
  /** The program with the most failed/killed runs. */
  failing?: { program: string; count: number }
  /** The most repeated exact command. */
  repeats?: { cmd: string; count: number }
  /** Background dispatches in the list. */
  background?: number
}

export function attentionOf(records: readonly CommandRecord[]): CommandAttention {
  const out: CommandAttention = {}
  let slowest: { cmd: string; ms: number } | undefined
  const failByProgram = new Map<string, number>()
  const repeats = new Map<string, number>()
  let background = 0
  for (const rec of records) {
    const d = durationOf(rec)
    if (rec.status !== 'running' && d !== undefined && d >= 1000 && (slowest === undefined || d > slowest.ms)) {
      slowest = { cmd: rec.cmd, ms: d }
    }
    if (rec.status === 'failed' || rec.status === 'killed') {
      const p = programOf(rec)
      failByProgram.set(p, (failByProgram.get(p) ?? 0) + 1)
    }
    if (rec.background === true) background++
    if (rec.status !== 'running') repeats.set(rec.cmd, (repeats.get(rec.cmd) ?? 0) + 1)
  }
  if (slowest !== undefined) out.slowest = slowest
  let failing: { program: string; count: number } | undefined
  for (const [program, count] of failByProgram) {
    if (failing === undefined || count > failing.count) failing = { program, count }
  }
  if (failing !== undefined) out.failing = failing
  let top: { cmd: string; count: number } | undefined
  for (const [cmd, count] of repeats) {
    if (count >= 2 && (top === undefined || count > top.count)) top = { cmd, count }
  }
  if (top !== undefined) out.repeats = top
  if (background > 0) out.background = background
  return out
}
