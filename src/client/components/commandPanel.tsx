import { memo, useMemo, useState, type ChangeEvent, type ComponentType, type MouseEvent, type ReactElement } from 'react'
import { attentionOf, byLatest, bySlowest, durationOf, matchesFilter, matchesQuery, previewOf, previewTextOf, programsOf, tallyOfCommands } from '../commands'
import type { Command, CommandFilter, CommandSort } from '../commands'
import { nameColorOf } from '../nameColor'
import { shapeOfCmd } from '../../shared/commands'
import type { CommandStats } from '../../shared/types'
import type { DetailState } from '../timelineSource'
import type { ViewKit } from '../viewkit'
import { makeDetailNote } from './detailNote'

export interface CommandPanelProps {
  commands: Command[]
  /** Whole-log tallies (survive list trimming); absent = the retained list counts itself. */
  stats?: CommandStats
  /** Set when the log trimmed: the list covers only the latest runs. */
  floor?: number
  workspace?: string
  /** The turn/step whose request first carried a run's result node, by node seq; absent = rows print no stamps. */
  stampOf?: (seq: number) => { turn: number; step: number } | null
  /** Reveal the run's result message in the Context Browser; absent = no reveal affordance. */
  onLocate?: (rec: Command) => void
  state?: DetailState
  onRetry?: () => void
}

export function makeCommandPanel(kit: ViewKit): ComponentType<CommandPanelProps> {
  const { t, fmt, fmtTime, fmtDuration } = kit
  const DetailNote = makeDetailNote(kit)

  const FILTERS: readonly CommandFilter[] = ['all', 'failed', 'slow', 'background']
  const SORTS: readonly CommandSort[] = ['latest', 'slowest']

  function statusGlyphOf(rec: Command): { glyph: string; cls: string; tip: string } {
    if (rec.status === 'running') return { glyph: '◐', cls: 'run', tip: t('cmds.status.running') }
    if (rec.status === 'completed') return { glyph: '✓', cls: 'ok', tip: t('cmds.status.completed') }
    if (rec.status === 'failed') return { glyph: '✕', cls: 'fail', tip: t('cmds.status.failed') }
    return { glyph: '⊘', cls: 'kill', tip: t(rec.stopped === true ? 'cmds.status.stopped' : 'cmds.status.killed') }
  }

  return memo(function CommandPanel(props: CommandPanelProps): ReactElement {
    // The memo must not block a locale switch: the tick re-renders on it even when the props are reference-stable.
    kit.useLocaleTick()
    const { commands } = props
    const [filter, setFilter] = useState<CommandFilter>('all')
    const [sort, setSort] = useState<CommandSort>('latest')
    const [query, setQuery] = useState('')
    const [openSeq, setOpenSeq] = useState<number | null>(null)
    const [copiedSeq, setCopiedSeq] = useState<number | null>(null)

    const q = query.trim().toLowerCase()
    // Every matched row renders — the list is the whole point. Offscreen rows skip their paint via
    // `content-visibility: auto` (the file card's own idiom), so a 400-row log costs no layout storm.
    const shown = useMemo(
      () => commands
        .filter(rec => matchesFilter(rec, filter) && matchesQuery(rec, q))
        .sort(sort === 'slowest' ? bySlowest : byLatest),
      [commands, filter, q, sort],
    )
    const tally = props.stats ?? tallyOfCommands(commands)
    const counts = useMemo(() => ({
      all: commands.length,
      failed: commands.filter(r => matchesFilter(r, 'failed')).length,
      slow: commands.filter(r => matchesFilter(r, 'slow')).length,
      background: commands.filter(r => matchesFilter(r, 'background')).length,
    }), [commands])
    const programs = useMemo(() => programsOf(commands), [commands])
    const attention = useMemo(() => attentionOf(commands), [commands])
    const [progQuery, setProgQuery] = useState('')
    /** A rail preview keeps to a tight budget; the full text is one click into the row. */
    const railPreview = (cmd: string): string => {
      const first = previewTextOf(cmd, props.workspace)
      return first.length > 34 ? first.slice(0, 34) + '…' : first
    }
    /** An attention row is an exclusive lens: it clears the previous filter, query and sort before applying its own. */
    const applyLens = (patch: { filter?: CommandFilter; query?: string; sort?: CommandSort }): void => {
      setFilter(patch.filter ?? 'all')
      setQuery(patch.query ?? '')
      setSort(patch.sort ?? 'latest')
    }

    interface AttentionRow {
      key: string
      label: string
      value: string
      n: string
      title?: string
      apply: () => void
    }
    const attentionRows: AttentionRow[] = []
    if (attention.slowest !== undefined) {
      const s = attention.slowest
      attentionRows.push({ key: 'slowest', label: t('cmds.rail.slowest'), value: railPreview(s.cmd), n: fmtDuration(s.ms), title: s.cmd, apply: () => { applyLens({ sort: 'slowest' }) } })
    }
    if (attention.failing !== undefined) {
      const f = attention.failing
      // The click lands on exactly the named program's failures (the query lens covers program identity).
      attentionRows.push({ key: 'failing', label: t('cmds.rail.failing'), value: f.program, n: '×' + fmt(f.count), apply: () => { applyLens({ filter: 'failed', query: f.program }) } })
    }
    if (attention.repeats !== undefined) {
      const r = attention.repeats
      // The full text searches exactly the repeated command (a prefix would catch look-alikes).
      attentionRows.push({ key: 'repeats', label: t('cmds.rail.repeats'), value: railPreview(r.cmd), n: '×' + fmt(r.count), title: r.cmd, apply: () => { applyLens({ query: r.cmd }) } })
    }
    if (attention.background !== undefined) {
      const bg = attention.background
      attentionRows.push({ key: 'background', label: t('cmds.rail.bgRuns'), value: '', n: '×' + fmt(bg), apply: () => { applyLens({ filter: 'background' }) } })
    }
    const totalPrograms = Math.max(1, programs.reduce((sum, p) => sum + p.n, 0))
    const topProgramN = Math.max(1, ...programs.map(p => p.n))
    const pq = progQuery.trim().toLowerCase()
    // The query applies only while its input is visible — a trimmed log could drop the program count past the
    // search threshold with a stale query, and an invisible box cannot be cleared.
    const shownPrograms = programs.length > 6 && pq !== '' ? programs.filter(p => p.name.toLowerCase().includes(pq)) : programs

    const rail = commands.length > 0 ? (
      <div className="lc-cmd-rail">
        <div className="lc-cmd-rail-sec">
          <div className="lc-cmd-rail-h">{t('cmds.rail.summary')}</div>
          <div className="lc-cmd-kpis">
            <div className="lc-cmd-kpi"><b>{fmt(tally.runs)}</b><span>{t('cmds.rail.runs')}</span></div>
            <div className="lc-cmd-kpi lc-cmd-kpi-fail">
              <b>{fmt(tally.failed)}</b>
              <span>{t('cmds.rail.failed')}{tally.runs > 0 ? ' · ' + kit.fmtShare(tally.failed, tally.runs) : ''}</span>
            </div>
            <div className="lc-cmd-kpi lc-cmd-kpi-time"><b>{fmtDuration(tally.ms)}</b><span>{t('cmds.rail.totalTime')}</span></div>
            <div className="lc-cmd-kpi lc-cmd-kpi-bg"><b>{fmt(tally.bg)}</b><span>{t('cmds.rail.background')}</span></div>
          </div>
        </div>
        {attentionRows.length > 0 ? (
          <div className="lc-cmd-rail-sec lc-cmd-attn">
            <div className="lc-cmd-rail-h">{t('cmds.rail.attention')}</div>
            {attentionRows.map(row => (
              <button
                key={row.key}
                type="button"
                className={'lc-cmd-attn-row lc-cmd-attn-' + row.key + ' hover:bg-(--dsw-alias-interactive-bg-hover)'}
                title={row.title}
                onClick={row.apply}
              >
                <i className="lc-cmd-attn-dot" />
                <span className="lc-cmd-attn-k">{row.label}</span>
                <span className="lc-cmd-attn-v">{row.value}</span>
                <span className="lc-cmd-attn-n">{row.n}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="lc-cmd-rail-sec lc-cmd-progs">
          <div className="lc-cmd-rail-h lc-cmd-progs-h">
            <span title={t('cmds.rail.topScope')}>{t('cmds.rail.top', { n: programs.length })}</span>
            {programs.length > 6 ? (
              <input
                className="lc-cmd-prog-search"
                type="search"
                value={progQuery}
                placeholder={t('cmds.rail.topSearch')}
                aria-label={t('cmds.rail.topSearch')}
                onChange={(ev: ChangeEvent<HTMLInputElement>) => { setProgQuery(ev.target.value) }}
              />
            ) : null}
          </div>
          <div className="lc-cmd-progs-list" role="group" aria-label={t('cmds.rail.top', { n: programs.length })}>
            {shownPrograms.map((p) => {
              const color = nameColorOf(p.name)
              const share = Math.round(p.n / totalPrograms * 100)
              return (
                <button
                  key={p.name}
                  type="button"
                  className="lc-cmd-prog"
                  title={t('cmds.rail.topTip', { name: p.name })}
                  onClick={() => { setQuery(p.name) }}
                >
                  <i className="lc-cmd-prog-dot" style={{ background: color }} />
                  <span className="lc-cmd-prog-name">{p.name}</span>
                  <span className="lc-cmd-prog-n">{'×' + fmt(p.n)}</span>
                  <span className="lc-cmd-prog-share">{share}%</span>
                  {/* The underline bar is relative to the heaviest program (the Skills list's idiom). */}
                  <i className="lc-cmd-prog-bar" style={{ width: `calc(${Math.round(p.n / topProgramN * 100)}% - ${Math.round(p.n / topProgramN * 12)}px)`, background: color }} />
                </button>
              )
            })}
            {shownPrograms.length === 0 ? <div className="lc-cmd-prog-none">{t('cmds.noMatch')}</div> : null}
          </div>
        </div>
      </div>
    ) : null

    const copyCommand = (rec: Command): void => {
      const clipboard = (globalThis.navigator as { clipboard?: { writeText?: unknown } } | undefined)?.clipboard
      if (typeof clipboard?.writeText !== 'function') return
      void (clipboard.writeText as (text: string) => Promise<void>).call(clipboard, rec.cmd).then(() => {
        setCopiedSeq(rec.seq)
        setTimeout(() => { setCopiedSeq(cur => (cur === rec.seq ? null : cur)) }, 1200)
      }, () => {})
    }

    const detailOf = (rec: Command): ReactElement => {
      const target = rec.parent ?? rec.resultSeq
      const locatable = props.onLocate !== undefined && target !== undefined
      const facts: ReactElement[] = []
      if (rec.exit !== undefined && rec.tool !== 'run_code') {
        facts.push(
          <span key="exit" title={rec.exitInferred === true ? t('cmds.exitInferredTip') : undefined}>
            {t('cmds.exit', { n: rec.exit })}{rec.exitInferred === true ? ' ≈' : ''}
          </span>,
        )
      }
      const d = durationOf(rec)
      if (d !== undefined) {
        facts.push(
          <span key="dur" title={rec.derived === true ? t('cmds.derivedTip') : undefined}>
            {rec.derived === true ? '≈' : ''}{fmtDuration(d)}
          </span>,
        )
      }
      if (rec.cwd !== undefined) facts.push(<span key="cwd" className="lc-cmd-fact-cwd" title={rec.cwd}>{rec.cwd}</span>)
      if (rec.timeoutMs !== undefined) facts.push(<span key="to">{t('cmds.timeoutSet', { t: fmtDuration(rec.timeoutMs) })}</span>)
      if (rec.outChars !== undefined) {
        facts.push(
          <span key="out">
            {t('cmds.output', { n: fmt(rec.outChars) })}
            {rec.outTruncated === true ? <em>{t('cmds.outTruncated')}</em> : null}
          </span>,
        )
      }
      if (rec.stderr === true) facts.push(<span key="err">{t('cmds.hasStderr')}</span>)
      if (rec.timedOut === true) facts.push(<span key="tout">{t('cmds.timedOut')}</span>)
      if (rec.denied === true) facts.push(<span key="deny">{t('cmds.denied')}</span>)
      if (rec.signal !== undefined) facts.push(<span key="sig">{t('cmds.signalOf', { s: rec.signal })}</span>)
      if (rec.sandbox !== undefined) facts.push(<span key="sand">{t('cmds.sandboxAsk', { s: rec.sandbox })}</span>)
      const stamp = target !== undefined ? props.stampOf?.(target) ?? null : null
      return (
        <div className="lc-cmd-detail">
          {rec.description !== undefined ? <div className="lc-cmd-why">{rec.description}</div> : null}
          <pre className="lc-cmd-full">{rec.cmd}{rec.cmdTruncated === true ? ' …' : ''}</pre>
          <div className="lc-cmd-facts">{facts}</div>
          <div className="lc-cmd-actions">
            {locatable ? (
              <button type="button" className="lc-cmd-act" onClick={() => { props.onLocate?.(rec) }}>
                {t('cmds.reveal')}{stamp !== null ? ` · ${t('browser.stepAt', { t: stamp.turn, s: stamp.step })}` : ''}
              </button>
            ) : null}
            <button type="button" className="lc-cmd-act" onClick={() => { copyCommand(rec) }}>
              {copiedSeq === rec.seq ? t('cmds.copied') : t('cmds.copy')}
            </button>
          </div>
        </div>
      )
    }

    const rowOf = (rec: Command): ReactElement => {
      const open = openSeq === rec.seq
      const shape = shapeOfCmd(rec.cmd)
      const st = statusGlyphOf(rec)
      const preview = previewOf(rec, props.workspace)
      const d = durationOf(rec)
      const target = rec.parent ?? rec.resultSeq
      const stamp = target !== undefined ? props.stampOf?.(target) ?? null : null
      const locatable = props.onLocate !== undefined && target !== undefined
      return (
        <div key={rec.seq} className={'lc-cmd-item' + (open ? ' lc-cmd-item-on' : '')}>
          <button
            type="button"
            className="lc-cmd-row hover:bg-(--dsw-alias-interactive-bg-hover)"
            title={rec.description ?? preview}
            onClick={() => { setOpenSeq(open ? null : rec.seq) }}
          >
            <span className={'lc-br-chev' + (open ? ' lc-br-chev-on' : '')} />
            <span className={'lc-cmd-st lc-cmd-st-' + st.cls} title={st.tip}>{st.glyph}</span>
            <span className="lc-cmd-cmd">
              {rec.tool !== 'bash' ? <span className="lc-cmd-tool">{rec.tool === 'run_code' ? t('cmds.tool.code') : rec.tool}</span> : null}
              {rec.codeMode === true && rec.tool === 'bash' ? <span className="lc-cmd-tool">{t('cmds.tool.nested')}</span> : null}
              {preview}
            </span>
            <span className="lc-cmd-badges">
              {shape.lines > 1 ? <span className="lc-cmd-badge">{t('cmds.lines', { n: shape.lines })}</span> : null}
              {shape.heredoc ? <span className="lc-cmd-badge">{t('cmds.heredoc')}</span> : null}
              {shape.inline ? <span className="lc-cmd-badge">{t('cmds.inline')}</span> : null}
              {rec.background === true ? <span className="lc-cmd-badge lc-cmd-badge-bg">{t('cmds.bgBadge')}</span> : null}
            </span>
            {d !== undefined
              ? (
                <span
                  className={'lc-cmd-dur' + (d >= 60_000 ? ' lc-cmd-dur-3' : d >= 10_000 ? ' lc-cmd-dur-2' : d >= 1000 ? ' lc-cmd-dur-1' : '')}
                  title={rec.derived === true ? t('cmds.derivedTip') : undefined}
                >
                  {rec.derived === true ? '≈' : ''}{fmtDuration(d)}
                </span>
              )
              : <span className="lc-cmd-dur lc-cmd-dur-run">{t('cmds.status.running')}</span>}
            {locatable
              ? (
                <span
                  className="lc-cmd-time lc-cmd-time-link"
                  role="link"
                  title={t('cmds.revealTip')}
                  onClick={(ev: MouseEvent) => {
                    ev.stopPropagation()
                    props.onLocate?.(rec)
                  }}
                >
                  {stamp !== null ? t('browser.stepAt', { t: stamp.turn, s: stamp.step }) + ' · ' : ''}{fmtTime(rec.time)}
                </span>
              )
              : <span className="lc-cmd-time">{stamp !== null ? t('browser.stepAt', { t: stamp.turn, s: stamp.step }) + ' · ' : ''}{fmtTime(rec.time)}</span>}
          </button>
          {open ? detailOf(rec) : null}
        </div>
      )
    }

    return (
      <div className="lc-card lc-cmd-card lc-col flex-1 min-w-[min(360px,100%)]">
        <div className="lc-card-title">
          <span className="lc-card-title-text">{t('cmds.title')}</span>
          <span className="lc-cmd-meta">
            <span>{t('cmds.runs', { n: fmt(tally.runs) })}</span>
            {tally.failed > 0 ? <span className="lc-cmd-meta-fail">{t('cmds.failed', { n: fmt(tally.failed) })}</span> : null}
            {tally.ms > 0 ? <span>{fmtDuration(tally.ms)}</span> : null}
          </span>
          <div className="lc-gran lc-cmd-chips @max-[380px]/lc-card:flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f}
                type="button"
                className={'lc-gran-btn' + (filter === f ? ' lc-gran-on' : '')}
                onClick={() => { setFilter(cur => (cur === f ? 'all' : f)) }}
              >
                {t('cmds.filter.' + f)}
                <b className="lc-fa-n">{fmt(counts[f])}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="lc-cmd-body">
          {rail}
          <div className="lc-cmd-main">
            <div className="lc-cmd-ctl">
              <input
                className="lc-fa-search focus:border-(--dsw-alias-label-dimmed)"
                value={query}
                placeholder={t('cmds.search')}
                onChange={(ev: ChangeEvent<HTMLInputElement>) => { setQuery(ev.target.value) }}
              />
              <span className="lc-gran lc-fa-sort" role="group" title={t('cmds.sortTip')}>
                {SORTS.map(k => (
                  <button
                    key={k}
                    type="button"
                    className={'lc-gran-btn' + (sort === k ? ' lc-gran-on' : '')}
                    onClick={() => { setSort(k) }}
                  >
                    {t('cmds.sort.' + k)}
                  </button>
                ))}
              </span>
            </div>
            {/* The trim floor sits ahead of the list: below a long list it would never be seen. */}
            {props.floor !== undefined && commands.length > 0 ? (
              <div className="lc-cmd-floor">{t('cmds.coverage', { n: fmt(commands.length) })}</div>
            ) : null}
            {commands.length === 0 && props.state === 'loading' ? (
              <DetailNote state="loading" className="lc-empty lc-lane" />
            ) : commands.length === 0 && props.state === 'failed' && props.onRetry !== undefined ? (
              <DetailNote state="failed" onRetry={props.onRetry} className="lc-empty lc-lane" />
            ) : shown.length === 0 ? (
              <div className="lc-empty lc-lane">{t(commands.length === 0 ? 'cmds.empty' : 'cmds.noMatch')}</div>
            ) : (
              <div className="lc-cmd-list">
                {shown.map(rowOf)}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  })
}
