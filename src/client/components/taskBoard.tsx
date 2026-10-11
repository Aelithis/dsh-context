/**
 * The Fleet work board — every piece of work in the family on one vertical board: the agent
 * team's shared tasks (the `agentTeam` projection's DAG — readiness, dependency chains, write
 * scopes), then each plain subagent's delegation read as a task of its own (the prompt is the
 * subject, the session state is the status, the run's live figures ride the row). Rows group
 * under their owner — team members in roster order, subagents in spawn order, the unowned pool
 * last — so the board reads agent-first, like the members board beside it. The toolbar's search
 * and status filter steer the whole board; a graph-node or member-card pick narrows it to that
 * agent, a row pick rings its owner, and a blocker pick flashes the row and lights its whole
 * prerequisite chain.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { IconChecklistOutlineRegular, IconUserOutlineRegular, IconUsersOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentForest, AgentNode } from '../agentTree'
import { familyHue, pressureColorOf } from '../agentTree'
import { familyOthersOf, memberIdByName, type FleetTeam, type FleetTeamTask } from '../fleetTeam'
import { BRAND_HUE, memberStyle, runMetaOf } from './memberBoard'
import type { ViewKit } from '../viewkit'

export interface TaskBoardProps {
  /** Null when the session never composed the agent-team plugin — subagent delegations still board. */
  team: FleetTeam | null
  /** The family forest; null (not landed yet) boards the team's tasks alone. */
  forest: AgentForest | null
  /** The picked owner narrowing the board: a membership NAME, or a subagent's session id. */
  ownerFilter: string | null
  onOwnerFilter: (key: string | null) => void
  /** The focused task (blocker picks land here); its prerequisite chain lights with it. */
  focusTaskId: string | null
  onFocusTask: (id: string | null) => void
  onPinMember: (id: string | null) => void
  /** Row hovers steer the graph's lineage focus toward the task's owner. */
  onHoverMember: (id: string | null) => void
  t: ViewKit['t']
  fmt: ViewKit['fmt']
}

type TaskStatus = 'in_progress' | 'pending' | 'completed'
type StatusFilter = 'all' | TaskStatus

const STATUS_ORDER: readonly TaskStatus[] = ['in_progress', 'pending', 'completed']

/** One row on the work board: a team task, or a subagent's delegation read as one. */
interface WorkRow {
  key: string
  kind: 'team' | 'agent'
  subject: string
  status: TaskStatus
  dot: 'done' | 'ongoing' | 'idle' | 'warning'
  /** The owner join key: a membership NAME (team rows), the subagent's own session id (agent rows),
   * undefined in the unowned pool — the group key, the owner filter's, and the pin's. */
  ownerKey?: string
  /** The display name for the join key: the membership name, or the agent's label. */
  ownerLabel?: string
  teamTask?: FleetTeamTask
  node?: AgentNode
}

function rowOfTask(task: FleetTeamTask): WorkRow {
  return {
    key: task.id,
    kind: 'team',
    subject: task.subject,
    status: task.status,
    dot: task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'ongoing' : task.ready ? 'idle' : 'warning',
    ...(task.ownerName !== undefined ? { ownerKey: task.ownerName, ownerLabel: task.ownerName } : {}),
    teamTask: task,
  }
}

function rowOfAgent(node: AgentNode): WorkRow {
  const status: TaskStatus = node.running ? 'in_progress' : node.completed ? 'completed' : 'pending'
  return {
    key: node.id,
    kind: 'agent',
    subject: node.label,
    status,
    dot: status === 'in_progress' ? 'ongoing' : status === 'completed' ? 'done' : 'idle',
    ownerKey: node.id,
    ownerLabel: node.label,
    node,
  }
}

/** Board order within a group: in-flight first, then the pending pool ready-first, then done. */
function orderRows(rows: WorkRow[]): WorkRow[] {
  return STATUS_ORDER.flatMap(key =>
    key === 'pending'
      ? rows.filter(row => row.status === 'pending').sort((a, b) => Number(b.teamTask?.ready === true) - Number(a.teamTask?.ready === true))
      : rows.filter(row => row.status === key))
}

/** A group of rows under one owner; `label: null` is the unowned pool. A `stray` owner never
 * served on the roster — it keeps its own band, but no icon and no pin target. Agent groups
 * render headless: the single delegation row IS the agent (its family hue rides the row icon). */
interface OwnerGroup {
  key: string
  label: string | null
  hue: string
  role: 'lead' | 'teammate' | 'agent' | 'stray' | 'unowned'
  /** The pin/hover target: the member's session id, or the subagent's own. */
  nodeId?: string
  rows: WorkRow[]
}

export function TaskBoard(props: TaskBoardProps): ReactElement {
  const { team, forest, t, fmt } = props
  /** Task ids with their description unfolded. */
  const [openTasks, setOpenTasks] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const boardRef = useRef<HTMLDivElement | null>(null)

  const teamTasks = useMemo(() => team?.tasks ?? [], [team])
  const byId = useMemo(() => new Map(teamTasks.map(task => [task.id, task])), [teamTasks])
  const agentNodes = useMemo(() => familyOthersOf(forest, team), [forest, team])
  const rows = useMemo(() => [...teamTasks.map(rowOfTask), ...agentNodes.map(rowOfAgent)], [teamTasks, agentNodes])

  // A blocker pick flashes the row and scrolls it into view.
  const focused = props.focusTaskId
  useEffect(() => {
    if (focused === null) return
    /* v8 ignore next 2 -- jsdom has no layout; the browser path is the visual one. */
    const row = boardRef.current?.querySelector(`[data-task="${focused}"]`)
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [focused])

  // The focused task's whole prerequisite chain (transitive blockedBy) lights along with it.
  const chain = useMemo(() => {
    if (focused === null) return null
    const out = new Set<string>()
    const queue = [focused]
    while (queue.length > 0) {
      /* v8 ignore next 1 -- the pop is guarded by the length check. */
      const id = queue.pop() ?? ''
      for (const dep of byId.get(id)?.blockedBy ?? []) {
        if (!out.has(dep)) {
          out.add(dep)
          queue.push(dep)
        }
      }
    }
    out.delete(focused)
    return out
  }, [focused, byId])

  // The owner pick narrows the board to one agent's group; every other group boards only unfiltered.
  const ownerVisible = useMemo(
    () => props.ownerFilter === null ? rows : rows.filter(row => row.ownerKey === props.ownerFilter),
    [rows, props.ownerFilter],
  )

  // The pick chip names a member by roster name, a subagent by its label — never a raw session id.
  const filterLabel = useMemo(() => {
    const key = props.ownerFilter
    if (key === null) return null
    return rows.find(row => row.ownerKey === key)?.ownerLabel ?? key
  }, [props.ownerFilter, rows])

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: ownerVisible.length, in_progress: 0, pending: 0, completed: 0 }
    for (const row of ownerVisible) c[row.status]++
    return c
  }, [ownerVisible])

  const needle = query.trim().toLowerCase()
  const matches = (row: WorkRow): boolean => {
    if (status !== 'all' && row.status !== status) return false
    if (needle === '') return true
    return row.subject.toLowerCase().includes(needle)
      || (row.ownerLabel ?? '').toLowerCase().includes(needle)
      || row.key.toLowerCase().includes(needle)
  }

  const groups = useMemo((): OwnerGroup[] => {
    // Roster order first (the members board's own order — the lead carries the brand hue, the
    // teammates their stable roster hue), then owners the roster never served, then the subagent
    // delegations in spawn order, and the unowned pool always last.
    const out: OwnerGroup[] = []
    const strays: string[] = []
    if (team !== null) {
      team.members.forEach((member, index) => {
        const groupRows = ownerVisible.filter(row => row.ownerKey === member.name && matches(row))
        if (groupRows.length > 0) {
          out.push({
            key: member.name,
            label: member.name,
            hue: member.role === 'lead' ? BRAND_HUE : familyHue(index),
            role: member.role,
            nodeId: member.id,
            rows: orderRows(groupRows),
          })
        }
      })
      for (const row of ownerVisible) {
        if (row.kind !== 'team' || row.ownerKey === undefined || strays.includes(row.ownerKey)) continue
        if (!team.members.some(member => member.name === row.ownerKey)) strays.push(row.ownerKey)
      }
      for (const name of strays) {
        const groupRows = ownerVisible.filter(row => row.ownerKey === name && matches(row))
        if (groupRows.length > 0) {
          out.push({ key: name, label: name, hue: '', role: 'stray', rows: orderRows(groupRows) })
        }
      }
    }
    for (const node of agentNodes) {
      const groupRows = ownerVisible.filter(row => row.ownerKey === node.id && matches(row))
      if (groupRows.length > 0) {
        out.push({
          key: node.id,
          label: node.label,
          hue: familyHue(node.family),
          role: 'agent',
          nodeId: node.id,
          rows: orderRows(groupRows),
        })
      }
    }
    const unowned = ownerVisible.filter(row => row.ownerKey === undefined && matches(row))
    if (unowned.length > 0) {
      out.push({ key: 'unowned', label: null, hue: '', role: 'unowned', rows: orderRows(unowned) })
    }
    return out
  }, [team, agentNodes, ownerVisible, needle, status, props.ownerFilter])

  const doneCount = rows.filter(row => row.status === 'completed').length
  const activeCount = rows.filter(row => row.status === 'in_progress').length
  const visibleCount = groups.reduce((n, group) => n + group.rows.length, 0)

  const toggleOpen = (id: string): void => {
    setOpenTasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const flashTask = (id: string): void => {
    // Toggle semantics: a second click on the same blocker releases the focus ring.
    props.onFocusTask(props.focusTaskId === id ? null : id)
  }

  /** The row owner's session id — members via the roster's name join, subagents themselves. */
  const ownerSessionId = (row: WorkRow): string | undefined =>
    row.kind === 'team' ? memberIdByName(team, row.ownerKey) : row.node?.id

  const pickOwner = (row: WorkRow): void => {
    const id = ownerSessionId(row)
    if (id !== undefined) props.onPinMember(id)
  }

  const hoverOwner = (row: WorkRow | null): void => {
    if (row === null) {
      props.onHoverMember(null)
      return
    }
    props.onHoverMember(ownerSessionId(row) ?? null)
  }

  /** A row pick pins the owner; picks landing on the row's own buttons keep their behavior. */
  const rowClick = (row: WorkRow) => (ev: MouseEvent) => {
    if ((ev.target as HTMLElement).closest('button') !== null) return
    pickOwner(row)
  }

  const renderAgentRow = (row: WorkRow, hue: string): ReactElement => {
    const node = row.node as AgentNode
    const { bits, pct } = runMetaOf(node, t, fmt)
    return (
      <li
        key={row.key}
        className={'lc-team-task' + (props.focusTaskId === row.key ? ' lc-team-task-focus' : '')}
        data-task={row.key}
        onClick={rowClick(row)}
        onMouseEnter={() => { hoverOwner(row) }}
        onMouseLeave={() => { hoverOwner(null) }}
      >
        <div className="lc-team-task-head">
          {/* The delegation IS the agent here: its family hue rides the row's own icon, so the
              band needs no group head above a subject that would only repeat it. The session id
              rides the tooltip — same-prompt delegations differ only by their figures otherwise. */}
          <span className="lc-member-icon lc-tasks-row-icon" style={memberStyle(hue)}>
            <IconUserOutlineRegular size={13} />
          </span>
          <StateDot state={row.dot} size={9} />
          <b className="lc-team-task-subject lc-team-task-subject-clamp" title={`${row.subject} · ${node.id}`}>{row.subject}</b>
          <span className="lc-agents-badge">{t(`fleet.task.${row.status}`)}</span>
        </div>
        {bits.length > 0 || pct !== null ? (
          <div className="lc-team-task-run">
            <span className="lc-team-task-run-text" title={bits.join(' · ')}>{bits.join(' · ')}</span>
            {pct !== null ? <span className="lc-team-task-run-pct" style={{ color: pressureColorOf(pct) }}>{pct}%</span> : null}
          </div>
        ) : null}
      </li>
    )
  }

  const renderTeamRow = (row: WorkRow): ReactElement => {
    const task = row.teamTask as FleetTeamTask
    return (
      <li
        key={row.key}
        className={
          'lc-team-task'
          + (props.focusTaskId === task.id ? ' lc-team-task-focus' : '')
          + (chain?.has(task.id) === true ? ' lc-team-task-chain' : '')
        }
        data-task={task.id}
        onClick={rowClick(row)}
        onMouseEnter={() => { hoverOwner(row) }}
        onMouseLeave={() => { hoverOwner(null) }}
      >
        <div className="lc-team-task-head">
          <StateDot state={row.dot} size={9} />
          <b className="lc-team-task-subject">{task.subject}</b>
          {task.status === 'pending'
            ? (
              <span className={'lc-agents-badge' + (task.ready ? ' lc-agents-badge-on' : '')}>
                {t(task.ready ? 'fleet.taskReady' : 'fleet.taskBlocked')}
              </span>
            )
            : null}
          {task.ownerName !== undefined ? (
            <button
              type="button"
              className="lc-team-task-owner"
              title={t('fleet.tasks.ownerTip')}
              onClick={() => { pickOwner(row) }}
            >
              {task.ownerName}
            </button>
          ) : <span className="lc-agents-badge">{t('fleet.taskUnowned')}</span>}
        </div>
        {task.description !== '' ? (
          <div className={'lc-team-task-desc' + (openTasks.has(task.id) ? ' lc-team-task-desc-open' : '')}>
            {task.description}
          </div>
        ) : null}
        {task.blockedBy.length > 0 ? (
          <div className="lc-team-task-deps">
            {t('fleet.tasks.dependsOn')}
            {task.blockedBy.map((dep) => {
              const blocker = byId.get(dep)
              return (
                <button
                  key={dep}
                  type="button"
                  className="lc-team-task-dep"
                  title={t('fleet.tasks.depTip', { id: dep })}
                  onClick={() => { flashTask(dep) }}
                >
                  {blocker !== undefined ? <StateDot state={rowOfTask(blocker).dot} size={7} /> : null}
                  {dep}
                </button>
              )
            })}
          </div>
        ) : null}
        <div className="lc-team-task-meta">
          <span className="lc-team-task-id">{task.id}</span>
          {task.writeScopes.length > 0 ? (
            <span className="lc-team-task-scopes">{t('fleet.taskScopes')} {task.writeScopes.join(', ')}</span>
          ) : null}
          {task.description !== '' ? (
            <button type="button" className="lc-inspector-btn" onClick={() => { toggleOpen(task.id) }}>
              {t(openTasks.has(task.id) ? 'fleet.collapse' : 'fleet.expand')}
            </button>
          ) : null}
        </div>
        {task.warnings.length > 0 ? (
          <div className="lc-team-task-warning">{task.warnings.join(' · ')}</div>
        ) : null}
      </li>
    )
  }

  const renderGroup = (group: OwnerGroup): ReactElement => (
    <div key={group.key} className="lc-tasks-group lc-tasks-group-owner">
      {group.role !== 'agent' ? (
        <div className="lc-tasks-group-head">
          {group.label !== null ? (
            <>
              {group.role !== 'stray' ? (
                <span className="lc-member-icon lc-tasks-group-icon" style={memberStyle(group.hue)}>
                  {group.role === 'lead' ? <IconUsersOutlineRegular size={13} /> : <IconUserOutlineRegular size={13} />}
                </span>
              ) : null}
              <button
                type="button"
                className="lc-team-task-owner"
                title={t('fleet.tasks.ownerTip')}
                onClick={() => {
                  if (group.nodeId !== undefined) props.onPinMember(group.nodeId)
                }}
              >
                {group.label}
              </button>
            </>
          ) : (
            <span className="lc-agents-badge">{t('fleet.taskUnowned')}</span>
          )}
          <span className="lc-kind-n">{group.rows.length}</span>
        </div>
      ) : null}
      <ul className="lc-tasks-rows">
        {group.rows.map(row => (row.kind === 'team' ? renderTeamRow(row) : renderAgentRow(row, group.hue)))}
      </ul>
    </div>
  )

  // The toolbar earns its keep only with at least two entries to sift; a filtered-empty board
  // keeps it so the reader can back out of the filter.
  const bare = query === '' && status === 'all'
  const showToolbar = rows.length > 1 || !bare

  return (
    <div className="lc-card lc-tasks flex-1 min-w-[min(360px,100%)]" ref={boardRef}>
      <div className="lc-card-title">
        <span className="lc-card-title-text">
          <IconChecklistOutlineRegular size={14} />
          {t('fleet.tasks.title')}
        </span>
        <span className="lc-card-sub">{t('fleet.tasks.sub')}</span>
        {filterLabel !== null ? (
          <button type="button" className="lc-agents-badge lc-tasks-filter" title={filterLabel} onClick={() => { props.onOwnerFilter(null) }}>
            {filterLabel} ×
          </button>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="lc-tasks-progress">
          <span className="lc-tasks-progress-track">
            <i style={{ width: `${Math.round((doneCount / rows.length) * 100)}%` }} />
          </span>
          <span className="lc-tasks-progress-text">
            {t('fleet.tasks.progress', { done: doneCount, total: rows.length })}
            {activeCount > 0 ? ` · ${t('fleet.tasks.active', { n: activeCount })}` : ''}
          </span>
        </div>
      ) : null}

      {showToolbar ? (
        <div className="lc-fleet-toolbar">
          <input
            type="search"
            className="lc-fleet-search"
            placeholder={t('fleet.tasks.search')}
            value={query}
            onChange={(ev) => { setQuery(ev.target.value) }}
          />
          <div className="lc-fleet-filters" role="group" aria-label={t('fleet.tasks.filter')}>
            {(['all', 'in_progress', 'pending', 'completed'] as const).map(key => (
              <button
                key={key}
                type="button"
                className={'lc-gran-btn' + (status === key ? ' lc-gran-on' : '')}
                onClick={() => { setStatus(key) }}
              >
                {key === 'all' ? t('fleet.filter.all') : t(`fleet.taskCol.${key}`)}
                <span className="lc-kind-n">{fmt(counts[key])}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {groups.map(renderGroup)}

      {rows.length === 0 ? (
        <div className="lc-empty">{team === null ? t('fleet.tasks.noTeam') : t('fleet.team.empty')}</div>
      ) : visibleCount === 0 ? (
        <div className="lc-empty">{t('fleet.tasks.noMatch')}</div>
      ) : null}
    </div>
  )
}
