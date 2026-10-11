// TaskBoard — the family work board: the team's shared task DAG (readiness ordering, inline
// dependency chips with the blocker's own dot and its whole prerequisite chain on focus) beside
// each subagent's delegation read as a task, all grouped under their owners (roster order, spawn
// order, unowned last) with the toolbar's search and status filter steering the board, owner
// picks narrowing it, the completion bar, and the empty states.

import { act, createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { TaskBoard, type TaskBoardProps } from '../../../src/client/components/taskBoard'
import type { AgentForest, AgentNode } from '../../../src/client/agentTree'
import type { FleetTeam } from '../../../src/client/fleetTeam'
import { DICT_EN } from '../../../src/client/i18n'
import { click, hover, makeKit, mount, query, queryAll, text, unhover } from '../helpers/kit'

const kit = makeKit()

/** React's controlled input needs the native setter for the change to register. */
async function typeIn(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function teamOf(over: Partial<FleetTeam> = {}): FleetTeam {
  return {
    members: [
      { id: 'root', name: 'lead', role: 'lead', phase: 'active' },
      { id: 'w1', name: 'worker-bee', role: 'teammate', phase: 'active' },
    ],
    tasks: [
      { id: 'task-1', subject: 'schema parsing', description: 'Parse the spec into the internal shape.', status: 'completed', ownerName: 'worker-bee', blockedBy: [], writeScopes: ['src/'], ready: false, warnings: [] },
      { id: 'task-2', subject: 'wire the view', description: '', status: 'in_progress', blockedBy: ['task-1'], writeScopes: [], ready: false, warnings: ['overlapping scope'] },
      { id: 'task-3', subject: 'polish', description: '', status: 'pending', blockedBy: ['task-2', 'task-1'], writeScopes: [], ready: false, warnings: [] },
      { id: 'task-4', subject: 'docs', description: '', status: 'pending', ownerName: 'ghost', blockedBy: [], writeScopes: [], ready: true, warnings: [] },
      // A dependency on a task the board does not serve (deleted/hostile) renders the bare chip.
      { id: 'task-5', subject: 'orphan dep', description: '', status: 'pending', blockedBy: ['task-99'], writeScopes: [], ready: false, warnings: [] },
    ],
    ...over,
  }
}

function nodeOf(id: string, over: Partial<AgentNode> = {}): AgentNode {
  return {
    id, label: id, depth: 1, family: 0, isCurrent: false, running: false, completed: false,
    subagent: true, updatedAt: 0, head: null, requests: 0, billed: null, costUsage: null,
    durationMs: null, identity: null, ...over,
  }
}

const FOREST: AgentForest = {
  nodes: [
    nodeOf('root', { isCurrent: true, depth: 0 }),
    // A running delegation with live figures; a settled one; an idler that never ran.
    nodeOf('s1', { label: 'scout the edges', running: true, head: { tokens: 800, window: 1000, pct: 80, parts: [] }, requests: 5, durationMs: 42000, updatedAt: 8 }),
    nodeOf('s2', { label: 'archive the wins', completed: true, head: { tokens: 200, window: 1000, pct: 20, parts: [] }, requests: 1, durationMs: 9000, updatedAt: 6 }),
    nodeOf('s3', { label: 'idle helper', updatedAt: 4 }),
  ],
  edges: [],
  overflow: 0,
  solo: false,
}

function propsOf(over: Partial<TaskBoardProps> = {}): TaskBoardProps {
  return {
    team: teamOf(),
    forest: FOREST,
    ownerFilter: null,
    onOwnerFilter: () => {},
    focusTaskId: null,
    onFocusTask: () => {},
    onPinMember: () => {},
    onHoverMember: () => {},
    t: kit.t,
    fmt: kit.fmt,
    ...over,
  }
}

describe('TaskBoard — the owner-grouped board', () => {
  test('groups under each owner: roster order, strays, delegations in spawn order, unowned last', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const heads = queryAll(m.container, '.lc-tasks-group-head')
    // worker-bee owns task-1; ghost served no roster row and keeps its own band; the rest is unowned.
    // Delegations board headless — the single row IS the agent.
    assert.deepEqual(
      heads.map(el => text(el)),
      ['worker-bee1', 'ghost1', `${DICT_EN['fleet.taskUnowned']}3`],
    )
    // The band heads wear the members board's hue icon (a stray none); delegation rows carry their own.
    assert.equal(queryAll(m.container, '.lc-tasks-group-head .lc-member-icon').length, 1)
    assert.equal(queryAll(m.container, '.lc-team-task-head .lc-member-icon').length, 3)
    await m.unmount()
  })

  test('delegation rows read as tasks: status badge, clamped subject, live run figures', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const scout = query(m.container, '[data-task="s1"]')
    assert.ok(text(scout).includes('in progress'))
    assert.ok(text(scout).includes('800 · 42s · 5 steps'))
    assert.ok(text(scout).includes('80%'))
    assert.ok(query(scout, '.lc-team-task-subject').className.includes('lc-team-task-subject-clamp'))
    assert.ok(query(scout, '.lc-team-task-head .lc-member-icon') !== null, 'the row wears the agent hue')
    // The settled delegation reads done; the idler reads pending without a meta line.
    assert.ok(text(query(m.container, '[data-task="s2"]')).includes('completed'))
    const idler = query(m.container, '[data-task="s3"]')
    assert.ok(text(idler).includes('pending'))
    assert.equal(queryAll(idler, '.lc-team-task-run').length, 0)
    await m.unmount()
  })

  test('a row pick pins the owner and a row hover lights them; the row’s own buttons stay theirs', async () => {
    const pins = new Array<string | null>()
    const hovers = new Array<string | null>()
    const focuses = new Array<string | null>()
    const m = await mount(h(TaskBoard, propsOf({
      onPinMember: id => { pins.push(id) },
      onHoverMember: id => { hovers.push(id) },
      onFocusTask: id => { focuses.push(id) },
    })))
    const row = query(m.container, '[data-task="task-1"]')
    await hover(row)
    await click(row)
    await unhover(row)
    assert.deepEqual([...pins], ['w1'], 'the roster name joins to the member id')
    assert.deepEqual([...hovers], ['w1', null])

    // A pick landing on a dep chip flashes the blocker instead of pinning the owner.
    const blocked = query(m.container, '[data-task="task-2"]')
    await click(query(blocked, '.lc-team-task-dep'))
    assert.deepEqual([...pins], ['w1'], 'the dep chip never pins')
    assert.deepEqual([...focuses], ['task-1'])

    // An unowned task pins and hovers nothing.
    const ghost = query(m.container, '[data-task="task-4"]')
    await hover(ghost)
    await click(ghost)
    await unhover(ghost)
    assert.deepEqual([...pins], ['w1'])
    assert.deepEqual([...hovers], ['w1', null, null, null], 'an off-roster owner hovers null')

    // A delegation row pins and hovers the subagent itself.
    const scout = query(m.container, '[data-task="s1"]')
    await hover(scout)
    await click(scout)
    await unhover(scout)
    assert.deepEqual([...pins], ['w1', 's1'])
    assert.deepEqual([...hovers], ['w1', null, null, null, 's1', null])
    await m.unmount()
  })

  test('an owner pick narrows the board by member name or subagent session id', async () => {
    const m = await mount(h(TaskBoard, propsOf({ ownerFilter: 'worker-bee' })))
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['schema parsing'])
    assert.ok(text(query(m.container, '.lc-tasks-filter')).includes('worker-bee'))
    await m.unmount()

    // A subagent pick narrows to its own delegation; the chip names the label, not the id.
    const picked = await mount(h(TaskBoard, propsOf({ ownerFilter: 's1' })))
    assert.deepEqual(queryAll(picked.container, '.lc-team-task').length, 1)
    assert.ok(text(query(picked.container, '.lc-tasks-filter')).includes('scout the edges'))
    await picked.unmount()

    // A pick the board cannot resolve chips its raw key over an empty board.
    const ghostly = await mount(h(TaskBoard, propsOf({ ownerFilter: 'zzz-ghost' })))
    assert.equal(queryAll(ghostly.container, '.lc-team-task').length, 0)
    assert.ok(text(query(ghostly.container, '.lc-tasks-filter')).includes('zzz-ghost'))
    await ghostly.unmount()

    // The pick chip clears the narrowing.
    const filters = new Array<string | null>()
    const clearing = await mount(h(TaskBoard, propsOf({ ownerFilter: 's1', onOwnerFilter: key => { filters.push(key) } })))
    await click(query(clearing.container, '.lc-tasks-filter'))
    assert.deepEqual([...filters], [null])
    await clearing.unmount()
  })

  test('the lead’s own band carries the brand hue and the users glyph', async () => {
    const lead = teamOf({
      tasks: [{ id: 'task-9', subject: 'steer', description: '', status: 'in_progress', ownerName: 'lead', blockedBy: [], writeScopes: [], ready: false, warnings: [] }],
    })
    const m = await mount(h(TaskBoard, propsOf({ team: lead, forest: null })))
    assert.ok(query(m.container, '.lc-tasks-group-head .lc-member-icon')?.getAttribute('style')?.includes('--lc-member-hue: var(--dsw-alias-brand-primary'))
    await m.unmount()
  })

  test('the owner chip pins the member; an owner off the roster is inert', async () => {
    const pins = new Array<string | null>()
    const m = await mount(h(TaskBoard, propsOf({ onPinMember: id => { pins.push(id) } })))
    // Group-head buttons first (worker-bee, then the stray ghost), then the rows' own chips.
    const owners = queryAll(m.container, '.lc-team-task-owner')
    await click(owners[0])
    await click(owners[1])
    await click(owners[2])
    await click(owners[3])
    assert.deepEqual([...pins], ['w1', 'w1'], 'the ghost head and chip never pin')
    await m.unmount()
  })
})

describe('TaskBoard — the team task DAG', () => {
  test('the pending pool reads ready-first; the dependency line carries the blocker’s own dot', async () => {
    const m = await mount(h(TaskBoard, propsOf({ ownerFilter: null })))
    // Within a group: in-flight first, then the pending pool ready-first, then done.
    const worker = queryAll(m.container, '.lc-tasks-group')[0]
    assert.deepEqual(queryAll(worker, '.lc-team-task-subject').map(el => el.textContent), ['schema parsing'])
    const deps = queryAll(m.container, '.lc-team-task-deps')
    assert.equal(deps.length, 3)
    assert.ok(text(deps[0]).includes('task-1'))
    assert.ok(deps[0].querySelector('span') !== null, 'the blocker dot renders')
    // The unknown blocker chips no dot.
    assert.equal(deps[2].querySelectorAll('span').length, 0)
    // Status badges, scopes, warning, id.
    assert.ok(text(m.container).includes('ready'))
    assert.ok(text(m.container).includes('blocked'))
    assert.ok(text(m.container).includes('Write scopes: src/'))
    assert.ok(text(m.container).includes('overlapping scope'))
    await m.unmount()
  })

  test('a blocker chip flashes its row and lights its whole prerequisite chain; a re-click releases', async () => {
    const focuses = new Array<string | null>()
    const m = await mount(h(TaskBoard, propsOf({ onFocusTask: id => { focuses.push(id) } })))
    const dep = queryAll(m.container, '.lc-team-task-dep')[0]
    await click(dep)
    assert.deepEqual([...focuses], ['task-1'])
    await m.unmount()

    // Focused on task-3: its chain (task-2, then task-1 through it) lights along.
    const focused = await mount(h(TaskBoard, propsOf({ focusTaskId: 'task-3', onFocusTask: id => { focuses.push(id) } })))
    assert.ok(query(focused.container, '[data-task="task-3"]').className.includes('lc-team-task-focus'))
    assert.ok(query(focused.container, '[data-task="task-2"]').className.includes('lc-team-task-chain'))
    assert.ok(query(focused.container, '[data-task="task-1"]').className.includes('lc-team-task-chain'))
    assert.ok(!query(focused.container, '[data-task="s1"]').className.includes('lc-team-task-chain'))
    // The unknown blocker (task-99) has no row to light.
    await focused.unmount()

    // Focused on task-2: clicking task-3's blocker chip (task-2) toggles the ring off.
    const toggle = await mount(h(TaskBoard, propsOf({ focusTaskId: 'task-2', onFocusTask: id => { focuses.push(id) } })))
    assert.ok(query(toggle.container, '[data-task="task-1"]').className.includes('lc-team-task-chain'))
    await click(query(toggle.container, '[data-task="task-3"] .lc-team-task-dep'))
    assert.deepEqual([...focuses].slice(-1), [null])
    await toggle.unmount()

    // A focused leaf with no blockers lights no chain.
    const leaf = await mount(h(TaskBoard, propsOf({ focusTaskId: 'task-1' })))
    assert.equal(queryAll(leaf.container, '.lc-team-task-chain').length, 0)
    await leaf.unmount()

    // A focused task whose blocker the board does not serve walks the chain without it.
    const orphan = await mount(h(TaskBoard, propsOf({ focusTaskId: 'task-5' })))
    assert.ok(query(orphan.container, '[data-task="task-5"]').className.includes('lc-team-task-focus'))
    assert.equal(queryAll(orphan.container, '.lc-team-task-chain').length, 0)
    await orphan.unmount()

    // A focus landing on a delegation row rings it too.
    const agentFocus = await mount(h(TaskBoard, propsOf({ focusTaskId: 's1' })))
    assert.ok(query(agentFocus.container, '[data-task="s1"]').className.includes('lc-team-task-focus'))
    await agentFocus.unmount()
  })

  test('descriptions clamp and expand; the unowned badge stands in', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const expandBtn = query(m.container, '[data-task="task-1"] .lc-inspector-btn')
    await click(expandBtn)
    assert.ok(query(m.container, '[data-task="task-1"] .lc-team-task-desc').className.includes('lc-team-task-desc-open'))
    await click(query(m.container, '[data-task="task-1"] .lc-inspector-btn'))
    assert.ok(!query(m.container, '[data-task="task-1"] .lc-team-task-desc').className.includes('lc-team-task-desc-open'))
    await m.unmount()

    const bare = teamOf()
    bare.tasks[1] = { ...bare.tasks[1], ownerName: undefined } as never
    const unowned = await mount(h(TaskBoard, propsOf({ team: bare })))
    assert.ok(text(unowned.container).includes(DICT_EN['fleet.taskUnowned']))
    await unowned.unmount()
  })
})

describe('TaskBoard — the toolbar and guidance states', () => {
  test('the head carries the completion bar over every row', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const progress = query(m.container, '.lc-tasks-progress')
    // Team task-1 plus the settled s2 are done, of eight rows.
    assert.ok(text(progress).includes('2/8 done'))
    assert.ok(text(progress).includes('2 in progress'))
    assert.equal(query(progress, '.lc-tasks-progress-track i')?.style.width, '25%')
    await m.unmount()

    // No in-flight work: the active count drops out of the text.
    const calm = teamOf()
    calm.tasks[1] = { ...calm.tasks[1], status: 'completed' }
    const calmForest: AgentForest = { ...FOREST, nodes: [FOREST.nodes[0], { ...FOREST.nodes[1], running: false, completed: true }, FOREST.nodes[2], FOREST.nodes[3]] }
    const m2 = await mount(h(TaskBoard, propsOf({ team: calm, forest: calmForest })))
    assert.ok(text(query(m2.container, '.lc-tasks-progress')).includes('4/8 done'))
    assert.ok(!text(query(m2.container, '.lc-tasks-progress')).includes('in progress'))
    await m2.unmount()
  })

  test('the status filter counts and narrows across both kinds', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const filters = queryAll(m.container, '.lc-fleet-filters .lc-gran-btn')
    // All 8 rows; in progress 2 (task-2, s1); pending 4; done 2.
    assert.ok(text(filters[0]).includes('8'))
    await click(filters[1])
    // Document order: agent groups board ahead of the unowned pool.
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['scout the edges', 'wire the view'])
    await click(filters[2])
    // The ready 'docs' rides the stray band the roster never served.
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['docs', 'idle helper', 'polish', 'orphan dep'])
    await click(filters[3])
    // Roster groups board first: task-1 (worker-bee) ahead of the settled delegation.
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['schema parsing', 'archive the wins'])
    await m.unmount()
  })

  test('search narrows by subject and owner; a dead end names it', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    await typeIn(query(m.container, '.lc-fleet-search'), 'scout')
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['scout the edges'])
    await typeIn(query(m.container, '.lc-fleet-search'), 'worker')
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['schema parsing'])
    await typeIn(query(m.container, '.lc-fleet-search'), 'zzz-no-match')
    assert.equal(queryAll(m.container, '.lc-team-task').length, 0)
    assert.ok(text(m.container).includes(DICT_EN['fleet.tasks.noMatch']))
    await m.unmount()
  })

  test('empty states: no team and no delegations points ahead; a team with no work says so', async () => {
    const m = await mount(h(TaskBoard, propsOf({ team: null, forest: { nodes: [nodeOf('root', { isCurrent: true, depth: 0 })], edges: [], overflow: 0, solo: true } })))
    assert.ok(text(m.container).includes(DICT_EN['fleet.tasks.noTeam']))
    assert.equal(queryAll(m.container, '.lc-team-task').length, 0)
    assert.equal(queryAll(m.container, '.lc-tasks-progress').length, 0)
    await m.unmount()

    const empty = await mount(h(TaskBoard, propsOf({ team: teamOf({ tasks: [] }), forest: null })))
    assert.ok(text(empty.container).includes(DICT_EN['fleet.team.empty']))
    assert.equal(queryAll(empty.container, '.lc-tasks-progress').length, 0, 'no bar without tasks')
    await empty.unmount()
  })
})
