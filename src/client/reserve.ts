/**
 * The auto-compaction reserve the Current Context bar masks: the window the session is kept out of
 * once compaction would fire, split into its two parts — the compaction headroom and the routed
 * request's output reservation.
 *
 * dsh-compaction-basic prices its pressure trigger as
 * `thresholdTokens = floor(min(contextWindow × thresholdRatio, contextWindow − reservedOutput − headroomTokens))`
 * (`packages/compaction/compaction-basic/src/config.ts`, `resolveCompactSpec`). The context window
 * and the reserved output cap are durable log facts the harness publishes (`request/context`'s
 * `contextWindow`, `request/header`'s materialized `config.maxTokens` — the same envelope cap the
 * backend's own `reservedCompletionTokens` reads), so they are read, never assumed. Its two policy
 * values are mirrored from that package's shipped defaults: the web composition mounts the backend
 * inside each agent preset's isolated realm, whose config no root-level plugin can read.
 */

/** dsh-compaction-basic's default window fraction for pressure (`DEFAULT_THRESHOLD_RATIO`). */
export const COMPACT_THRESHOLD_RATIO = 0.8

/** dsh-compaction-basic's default pressure headroom beyond the output reservation. */
export const COMPACT_HEADROOM_TOKENS = 65_536

/** Where the reserve starts and what it is made of, in WINDOW tokens. */
export interface ContextReserve {
  /** Window tokens at which automatic pressure compaction triggers — the masks' left edge. */
  threshold: number
  /** Window tokens between the trigger and the output reservation — the compaction-headroom mask. */
  headroom: number
  /** The routed request's output reservation at the window's end — the max-output mask. */
  output: number
}

/** Resolve one window's reserve, or undefined when no positive window is known OR the harness
 *  itself refuses to configure pressure compaction for that route (see the budget check below). The
 *  masks tile `[threshold, window]` end to end; `maxOutputTokens` is untrusted wire input, and
 *  anything but a positive finite cap reserves nothing (dsh's own fallback order: envelope cap,
 *  else zero). */
export function reserveGeometry(
  window: number | undefined,
  maxOutputTokens: number | undefined,
): ContextReserve | undefined {
  if (window === undefined || !Number.isFinite(window) || window <= 0) return undefined
  const output = Math.min(
    maxOutputTokens !== undefined && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 0,
    window,
  )
  // dsh-compaction-basic REFUSES this target at config time when the output reservation plus its
  // headroom leave no pressure budget (`resolveCompactSpec` throws `TargetPressureConfigError`,
  // and `compactIfNeeded` then never runs) — it does not clamp. So such a window reserves nothing
  // and gets no masks, matching the harness rather than implying a trigger at zero.
  const pressureBudget = window - output - COMPACT_HEADROOM_TOKENS
  if (pressureBudget <= 0) return undefined
  const threshold = Math.min(Math.floor(window * COMPACT_THRESHOLD_RATIO), pressureBudget)
  return { threshold, headroom: window - output - threshold, output }
}
