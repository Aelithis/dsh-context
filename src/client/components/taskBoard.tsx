/**
 * The Fleet task board — the team's shared task DAG, grouped by status or by owner, with a
 * completion bar in the head. Dependencies read inline: every blocker chip carries the blocker's
 * own status dot, and a chip click focuses that blocker — its whole prerequisite chain lights
 * along, so "what still gates this" never needs a second look. A row pick pins the owner (ringing
 * their graph node and member card), a row hover lights the owner's lineage in the graph, and the
 * owner filter interlocks with the members board's task counts. Without a team the card stays up
 * with a pointer to the team mode.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { IconChecklistOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { memberIdByName, type FleetTeam, type FleetTeamTask } from '../fleetTeam'
import type { ViewKit } from '../viewkit'

export interface TaskBoardProps {
  /** Null when the session never composed the agent-team plugin — the card shows a pointer instead. */
  team: FleetTeam | null
  /** The members board's owner filter (null = every owner). */
  ownerFilter: string | null
  onOwnerFilter: (name: string | null) => void
  /** The focused task (blocker picks land here); its prerequisite chain lights with it. */
  focusTaskId: string | null
  onFocusTask: (id: string | null) => void
  onPinMember: (id: string | null) => void
  /** Row hovers steer the graph's lineage focus toward the task's owner. */
  onHoverMember: (id: string | null) => void
  t: ViewKit['t']
}

type GroupKey = 'in_progress' | 'pending' | 'completed'

const GROUPS: readonly GroupKey[] = ['in_progress', 'pending', 'completed']

function taskDot(task: FleetTeamTask): 'done' | 'ongoing' | 'idle' | 'warning' {
  if (task.status === 'completed') return 'done'
  if (task.status === 'in_progress') return 'ongoing'
  return task.ready ? 'idle' : 'warning'
}

/** Board order within a group: in-flight first, then the pending pool ready-first, then done. */
function orderTasks(tasks: FleetTeamTask[]): FleetTeamTask[] {
  return GROUPS.flatMap(key =>
    key === 'pending'
      ? tasks.filter(task => task.status === 'pending').sort((a, b) => Number(b.ready) - Number(a.ready))
      : tasks.filter(task => task.status === key))
}

/** A group of tasks under one owner; `owner: null` is the unowned pool. */
interface OwnerGroup {
  owner: string | null
  tasks: FleetTeamTask[]
}

export function TaskBoard(props: TaskBoardProps): ReactElement {
  const { team, t } = props
  /** Task ids with their description unfolded. */
  const [openTasks, setOpenTasks] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useState<'status' | 'owner'>('status')
  const tasks = useMemo(() => team?.tasks ?? [], [team])
  const byId = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const boardRef = useRef<HTMLDivElement | null>(null)

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

  const visible = useMemo(
    () => props.ownerFilter === null ? tasks : tasks.filter(task => task.ownerName === props.ownerFilter),
    [tasks, props.ownerFilter],
  )
  const grouped = GROUPS.map(key => ({
    key,
    // The pending pool reads ready-first: what can start now outranks what waits.
    tasks: key === 'pending'
      ? visible.filter(task => task.status === 'pending').sort((a, b) => Number(b.ready) - Number(a.ready))
      : visible.filter(task => task.status === key),
  }))
  const byOwner = useMemo((): OwnerGroup[] => {
    if (team === null) return []
    const names = team.members.map(m => m.name)
    // Roster order first, then owners off the roster, and the unowned pool always last.
    const stray = new Set<string>()
    let unowned = false
    for (const task of visible) {
      if (task.ownerName === undefined) unowned = true
      else if (!names.includes(task.ownerName)) stray.add(task.ownerName)
    }
    const keys: (string | null)[] = [...names, ...stray, ...(unowned ? [null] : [])]
    return keys
      .map(name => ({ owner: name, tasks: orderTasks(visible.filter(task => (task.ownerName ?? null) === name)) }))
      .filter(group => group.tasks.length > 0)
  }, [team, visible])

  const doneCount = tasks.filter(task => task.status === 'completed').length
  const activeCount = tasks.filter(task => task.status === 'in_progress').length

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

  const pickOwner = (task: FleetTeamTask): void => {
    const owner = memberIdByName(team, task.ownerName)
    if (owner !== undefined) props.onPinMember(owner)
  }

  const hoverOwner = (task: FleetTeamTask | null): void => {
    props.onHoverMember(task === null ? null : memberIdByName(team, task.ownerName) ?? null)
  }

  /** A row pick pins the owner; picks landing on the row's own buttons keep their behavior. */
  const rowClick = (task: FleetTeamTask) => (ev: MouseEvent) => {
    if ((ev.target as HTMLElement).closest('button') !== null) return
    pickOwner(task)
  }

  const renderTask = (task: FleetTeamTask): ReactElement => (
    <li
      key={task.id}
      className={
        'lc-team-task'
        + (props.focusTaskId === task.id ? ' lc-team-task-focus' : '')
        + (chain?.has(task.id) === true ? ' lc-team-task-chain' : '')
      }
      data-task={task.id}
      onClick={rowClick(task)}
      onMouseEnter={() => { hoverOwner(task) }}
      onMouseLeave={() => { hoverOwner(null) }}
    >
      <div className="lc-team-task-head">
        <StateDot state={taskDot(task)} size={9} />
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
            onClick={() => { pickOwner(task) }}
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
                {blocker !== undefined ? <StateDot state={taskDot(blocker)} size={7} /> : null}
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

  return (
    <div className="lc-card lc-tasks flex-1 min-w-[min(360px,100%)]" ref={boardRef}>
      <div className="lc-card-title">
        <span className="lc-card-title-text">
          <IconChecklistOutlineRegular size={14} />
          {t('fleet.tasks.title')}
        </span>
        <span className="lc-card-sub">{t('fleet.tasks.sub')}</span>
        {tasks.length > 0 ? (
          <span className="lc-fleet-filters lc-tasks-view" role="group" aria-label={t('fleet.tasks.view')}>
            {(['status', 'owner'] as const).map(key => (
              <button
                key={key}
                type="button"
                className={'lc-gran-btn' + (view === key ? ' lc-gran-on' : '')}
                onClick={() => { setView(key) }}
              >
                {t(`fleet.tasks.group.${key}`)}
              </button>
            ))}
          </span>
        ) : null}
        {props.ownerFilter !== null ? (
          <button type="button" className="lc-agents-badge lc-tasks-filter" onClick={() => { props.onOwnerFilter(null) }}>
            {props.ownerFilter} ×
          </button>
        ) : null}
      </div>

      {tasks.length > 0 ? (
        <div className="lc-tasks-progress">
          <span className="lc-tasks-progress-track">
            <i style={{ width: `${Math.round((doneCount / tasks.length) * 100)}%` }} />
          </span>
          <span className="lc-tasks-progress-text">
            {t('fleet.tasks.progress', { done: doneCount, total: tasks.length })}
            {activeCount > 0 ? ` · ${t('fleet.tasks.active', { n: activeCount })}` : ''}
          </span>
        </div>
      ) : null}

      {team === null ? (
        <div className="lc-empty">{t('fleet.tasks.noTeam')}</div>
      ) : tasks.length === 0 ? (
        <div className="lc-empty">{t('fleet.team.empty')}</div>
      ) : view === 'status' ? (
        grouped.map(({ key, tasks: groupTasks }) => {
          if (groupTasks.length === 0) return null
          return (
            <div key={key} className={`lc-tasks-group lc-tasks-group-${key}`}>
              <div className="lc-tasks-group-head">
                {t(`fleet.taskCol.${key}`)}
                <span className="lc-kind-n">{groupTasks.length}</span>
              </div>
              <ul className="lc-tasks-rows">
                {groupTasks.map(renderTask)}
              </ul>
            </div>
          )
        })
      ) : (
        byOwner.map(({ owner, tasks: groupTasks }) => (
          <div key={owner ?? 'unowned'} className="lc-tasks-group lc-tasks-group-owner">
            <div className="lc-tasks-group-head">
              {owner === null
                ? t('fleet.taskUnowned')
                : (
                  <button
                    type="button"
                    className="lc-team-task-owner"
                    title={t('fleet.tasks.ownerTip')}
                    onClick={() => {
                      const memberId = memberIdByName(team, owner)
                      if (memberId !== undefined) props.onPinMember(memberId)
                    }}
                  >
                    {owner}
                  </button>
                )}
              <span className="lc-kind-n">{groupTasks.length}</span>
            </div>
            <ul className="lc-tasks-rows">
              {groupTasks.map(renderTask)}
            </ul>
          </div>
        ))
      )}
      {tasks.length > 0 && visible.length === 0 ? (
        <div className="lc-empty">{t('fleet.tasks.noMatch')}</div>
      ) : null}
    </div>
  )
}
