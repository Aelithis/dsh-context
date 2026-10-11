// TaskBoard — the shared task DAG: readiness ordering, inline dependency chips with the blocker's
// own dot and its whole prerequisite chain on focus, owner pinning/hovering, owner filtering, the
// completion bar, the status/owner view switch, and the no-team pointer.

import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { TaskBoard, type TaskBoardProps } from '../../../src/client/components/taskBoard'
import type { FleetTeam } from '../../../src/client/fleetTeam'
import { DICT_EN } from '../../../src/client/i18n'
import { click, hover, makeKit, mount, query, queryAll, text, unhover } from '../helpers/kit'

const kit = makeKit()

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

function propsOf(over: Partial<TaskBoardProps> = {}): TaskBoardProps {
  return {
    team: teamOf(),
    ownerFilter: null,
    onOwnerFilter: () => {},
    focusTaskId: null,
    onFocusTask: () => {},
    onPinMember: () => {},
    onHoverMember: () => {},
    t: kit.t,
    ...over,
  }
}

describe('TaskBoard', () => {
  test('groups by status with counts; the pending pool reads ready-first', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const heads = queryAll(m.container, '.lc-tasks-group-head')
    assert.deepEqual(heads.map(el => text(el)), ['In progress1', 'Pending3', 'Done1'])
    // Ready (docs) ahead of blocked (polish) within pending.
    const pendingRows = queryAll(m.container, '.lc-tasks-group-pending .lc-team-task-subject')
    assert.deepEqual(pendingRows.map(el => el.textContent), ['docs', 'polish', 'orphan dep'])
    // The dependency line carries the blocker's own status dot.
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

  test('the head carries the completion bar and the view switch', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const progress = query(m.container, '.lc-tasks-progress')
    assert.ok(text(progress).includes('1/5 done'))
    assert.ok(text(progress).includes('1 in progress'))
    assert.equal(query(progress, '.lc-tasks-progress-track i')?.style.width, '20%')
    await m.unmount()

    // No in-flight work: the active count drops out of the text.
    const calm = teamOf()
    calm.tasks[1] = { ...calm.tasks[1], status: 'completed' }
    const m2 = await mount(h(TaskBoard, propsOf({ team: calm })))
    assert.ok(text(query(m2.container, '.lc-tasks-progress')).includes('2/5 done'))
    assert.ok(!text(query(m2.container, '.lc-tasks-progress')).includes('in progress'))
    await m2.unmount()
  })

  test('the owner chip pins the member; an owner off the roster is inert', async () => {
    const pins = new Array<string | null>()
    const m = await mount(h(TaskBoard, propsOf({ onPinMember: id => { pins.push(id) } })))
    const owners = queryAll(m.container, '.lc-team-task-owner')
    await click(owners[0])
    await click(owners[1])
    assert.deepEqual([...pins], ['w1'])
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
    assert.deepEqual([...pins], ['w1'])
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
    await m.unmount()
  })

  test('the unowned badge stands in when a task has no owner', async () => {
    const bare = teamOf()
    bare.tasks[1] = { ...bare.tasks[1], ownerName: undefined } as never
    const m = await mount(h(TaskBoard, propsOf({ team: bare })))
    assert.ok(text(m.container).includes(DICT_EN['fleet.taskUnowned']))
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
    assert.ok(!query(focused.container, '[data-task="task-4"]').className.includes('lc-team-task-chain'))
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
  })

  test('the owner view regroups under each member with the unowned pool last', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const toggle = queryAll(m.container, '.lc-tasks-view .lc-gran-btn')
    assert.equal(toggle.length, 2)
    await click(toggle[1])
    const heads = queryAll(m.container, '.lc-tasks-group-head')
    // worker-bee owns task-1; ghost (off-roster) owns task-4; the unowned pool carries the rest.
    assert.deepEqual(heads.map(el => text(el)), ['worker-bee1', 'ghost1', `${DICT_EN['fleet.taskUnowned']}3`])
    // Within a group the board order holds: status first, pending ready-first.
    assert.deepEqual(
      queryAll(m.container, '.lc-tasks-group')[2].querySelectorAll('.lc-team-task-subject').item(0).textContent,
      'wire the view',
    )
    // An owner group head pins the member; an off-roster name is inert.
    const pins = new Array<string | null>()
    await m.unmount()
    const m2 = await mount(h(TaskBoard, propsOf({ onPinMember: id => { pins.push(id) } })))
    await click(queryAll(m2.container, '.lc-tasks-view .lc-gran-btn')[1])
    const groupOwners = queryAll(m2.container, '.lc-tasks-group-owner .lc-tasks-group-head .lc-team-task-owner')
    await click(groupOwners[0])
    await click(groupOwners[1])
    assert.deepEqual([...pins], ['w1'], 'the ghost owner never pins')
    // Back to the status view.
    await click(queryAll(m2.container, '.lc-tasks-view .lc-gran-btn')[0])
    assert.ok(text(queryAll(m2.container, '.lc-tasks-group-head')[0]).includes('In progress'))
    await m2.unmount()
  })

  test('the owner filter narrows the board and clears from the chip', async () => {
    const filters = new Array<string | null>()
    const m = await mount(h(TaskBoard, propsOf({ ownerFilter: 'worker-bee', onOwnerFilter: name => { filters.push(name) } })))
    assert.deepEqual(queryAll(m.container, '.lc-team-task-subject').map(el => el.textContent), ['schema parsing'])
    assert.ok(text(query(m.container, '.lc-tasks-filter')).includes('worker-bee'))
    await click(query(m.container, '.lc-tasks-filter'))
    assert.deepEqual([...filters], [null])
    await m.unmount()

    // A filter matching nothing names it — in either view.
    const none = await mount(h(TaskBoard, propsOf({ ownerFilter: 'lead' })))
    assert.ok(text(none.container).includes(DICT_EN['fleet.tasks.noMatch']))
    await click(queryAll(none.container, '.lc-tasks-view .lc-gran-btn')[1])
    assert.equal(queryAll(none.container, '.lc-tasks-group').length, 0)
    await none.unmount()
  })

  test('descriptions clamp and expand; the empty board says so', async () => {
    const m = await mount(h(TaskBoard, propsOf()))
    const expandBtn = query(m.container, '[data-task="task-1"] .lc-inspector-btn')
    await click(expandBtn)
    assert.ok(query(m.container, '[data-task="task-1"] .lc-team-task-desc').className.includes('lc-team-task-desc-open'))
    await click(query(m.container, '[data-task="task-1"] .lc-inspector-btn'))
    assert.ok(!query(m.container, '[data-task="task-1"] .lc-team-task-desc').className.includes('lc-team-task-desc-open'))
    await m.unmount()

    const empty = await mount(h(TaskBoard, propsOf({ team: teamOf({ tasks: [] }) })))
    assert.ok(text(empty.container).includes(DICT_EN['fleet.team.empty']))
    assert.equal(queryAll(empty.container, '.lc-tasks-progress').length, 0, 'no bar without tasks')
    assert.equal(queryAll(empty.container, '.lc-tasks-view').length, 0, 'no view switch without tasks')
    await empty.unmount()
  })

  test('no team: the card stays up with a pointer to the team mode', async () => {
    const m = await mount(h(TaskBoard, propsOf({ team: null })))
    assert.ok(text(m.container).includes(DICT_EN['fleet.tasks.noTeam']))
    assert.equal(queryAll(m.container, '.lc-team-task').length, 0)
    assert.equal(queryAll(m.container, '.lc-tasks-progress').length, 0)
    await m.unmount()
  })
})
