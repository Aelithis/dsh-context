import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, test, vi, expect } from 'vitest'
import { CommsPanel, type CommsPanelProps } from '../../../src/client/components/commsPanel'
import type { FleetDetailState } from '../../../src/client/fleetModel'
import type { CommsRow } from '../../../src/client/fleetDetail'
import { channelKeyOf, type CommsAgent } from '../../../src/client/commsModel'
import { makeRichText } from '../../../src/client/components/richText'
import type { FleetDetail } from '../../../src/shared/types'
import { click, makeKit, mount, query, queryAll, text, typeText } from '../helpers/kit'

const kit = makeKit()
const rich = makeRichText(kit)

const AGENTS = new Map<string, CommsAgent>([
  ['root', { id: 'root', name: 'Lead', role: 'lead', self: true, hue: 'hsl(210 60% 50%)', description: 'Main session' }],
  ['w1', { id: 'w1', name: 'host-cleaner', role: 'teammate', self: false, hue: 'hsl(120 45% 45%)', description: 'Host scope' }],
  ['w2', { id: 'w2', name: 'tests-host', role: 'teammate', self: false, hue: 'hsl(30 60% 50%)' }],
])

const SETTLED_SUMMARY = 'Background subagent w1 finished and will do no further work unless you send it more.'
const SETTLED_REPORT = 'All gates green.\n\n- check passed'
const LONG = 'x'.repeat(400) + '…'

const COMMS: CommsRow[] = [
  { key: 'w1:10:8000:relay', to: 'w1', seq: 10, time: 8000, kind: 'relay', from: 'root', text: 'how far along?' },
  { key: 'root:9:7000:relay', to: 'root', seq: 9, time: 7000, kind: 'relay', from: 'w1', text: 'task done — all gates green' },
  {
    key: 'root:8:6000:settled',
    to: 'root',
    seq: 8,
    time: 6000,
    kind: 'settled',
    from: 'w1',
    text: `${SETTLED_SUMMARY}Its closing message:${SETTLED_REPORT}\nStructured result: {"ok":true}provider warning`,
    summary: SETTLED_SUMMARY,
    report: SETTLED_REPORT,
    structured: '{"ok":true}',
    diagnostic: 'provider warning',
  },
  { key: 'w2:7:5000:relay', to: 'w2', seq: 7, time: 5000, kind: 'relay', from: 'root', text: 'check the tests' },
  { key: 'root:6:4000:mailbox', to: 'root', seq: 6, time: 4000, kind: 'mailbox', from: 'w2', fromName: 'tests-host', text: 'legacy delivery' },
  { key: 'w2:5:3000:relay', to: 'w2', seq: 5, time: 3000, kind: 'relay', from: 'w1', text: 'peer sync' },
  { key: 'root:4:2000:relay', to: 'root', seq: 4, time: 2000, kind: 'relay', from: 'w2', text: LONG, clipped: true },
  { key: 'root:3:1500:mailbox', to: 'root', seq: 3, time: 1500, kind: 'mailbox', fromName: 'legacy', text: 'ancient mailbox' },
  { key: 'w1:2:1000:relay', to: 'w1', seq: 2, time: 1000, kind: 'relay', from: 'root', text: 'kickoff' },
  { key: 'root:1:500:relay', to: 'root', seq: 1, time: 500, kind: 'relay', text: 'mystery' },
]

function detailsOf(over: Partial<FleetDetailState> = {}): FleetDetailState {
  return {
    landed: new Map(),
    fullLanded: new Map(),
    pending: new Set(),
    fullPending: new Set(),
    request: vi.fn(),
    requestFull: vi.fn(),
    ...over,
  }
}

function propsOf(over: Partial<CommsPanelProps> = {}): CommsPanelProps {
  return {
    details: detailsOf(),
    comms: COMMS,
    agents: AGENTS,
    titles: new Map(),
    attested: new Map(),
    anchorId: 'root',
    pickId: null,
    onPickClear: () => {},
    pinnedId: null,
    onSelect: () => {},
    onOpen: () => {},
    onEnter: () => {},
    rich,
    t: kit.t,
    ...over,
  }
}

function events(container: HTMLElement): HTMLElement[] {
  return queryAll<HTMLElement>(container, '.lc-comms-event')
}

function eventOf(container: HTMLElement, key: string): HTMLElement {
  const found = events(container).find(el => el.dataset.commsKey === key)
  if (found === undefined) throw new Error(`event not found: ${key}`)
  return found
}

function channelOf(container: HTMLElement, key: string): HTMLElement {
  const found = queryAll<HTMLElement>(container, '.lc-comms-channel').find(el => el.dataset.channelKey === key)
  if (found === undefined) throw new Error(`channel not found: ${key}`)
  return found
}

describe('CommsPanel — automatic hub', () => {
  test('traffic, channels, and named parties render without a scan action', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    assert.equal(queryAll(m.container, '.lc-comms-scan').length, 0)
    assert.equal(events(m.container).length, 10)
    assert.equal(queryAll(m.container, '.lc-comms-channel').length, 6, 'all card + 5 channels')
    assert.ok(text(m.container).includes(kit.t('fleet.comms.sub', { n: 10, c: 5 })))
    assert.ok(text(m.container).includes('how far along?'))
    assert.ok(text(m.container).includes('host-cleaner'))
    assert.ok(text(m.container).includes('Teammate'))
    assert.ok(text(m.container).includes('Lead'))
    assert.ok(text(m.container).includes('Unknown agent'))
    assert.ok(text(m.container).includes('legacy'))
    const allCard = query<HTMLElement>(m.container, '.lc-comms-channel-all')
    assert.equal(allCard.getAttribute('aria-pressed'), 'true')
    await m.unmount()
  })

  test('a channel card narrows the timeline; picking it again releases the channel', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    const card = channelOf(m.container, channelKeyOf(COMMS[0]!))
    await click(card)
    assert.equal(events(m.container).length, 4)
    assert.equal(card.getAttribute('aria-pressed'), 'true')
    assert.equal(query<HTMLElement>(m.container, '.lc-comms-channel-all').getAttribute('aria-pressed'), 'false')
    await click(card)
    assert.equal(events(m.container).length, 10)
    assert.equal(card.getAttribute('aria-pressed'), 'false')
    await click(query<HTMLElement>(m.container, '.lc-comms-channel-all'))
    assert.equal(events(m.container).length, 10)
    await m.unmount()
  })

  test('kind chips filter reports vs messages and carry their counts', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    const chips = queryAll<HTMLElement>(m.container, '.lc-fleet-filters .lc-gran-btn')
    assert.deepEqual(chips.map(chip => text(chip)), [
      kit.t('fleet.comms.kind.all') + '10',
      kit.t('fleet.comms.kind.message') + '9',
      kit.t('fleet.comms.kind.report') + '1',
    ])
    await click(chips[2]!)
    assert.equal(events(m.container).length, 1)
    assert.equal(events(m.container)[0]!.dataset.kind, 'settled')
    await click(chips[1]!)
    assert.equal(events(m.container).length, 9)
    assert.ok(events(m.container).every(event => event.dataset.kind !== 'settled'))
    await click(chips[0]!)
    assert.equal(events(m.container).length, 10)
    await m.unmount()
  })

  test('search matches text, reports, and party names; no match says so', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    const search = query<HTMLInputElement>(m.container, '.lc-fleet-search')
    await typeText(search, 'host-cleaner')
    assert.equal(events(m.container).length, 5)
    assert.ok(text(query(m.container, '.lc-comms-notes')).includes(kit.t('fleet.comms.filtered', { n: 5, total: 10 })))
    await typeText(search, 'check passed')
    assert.equal(events(m.container).length, 1)
    await typeText(search, 'zzz')
    assert.equal(events(m.container).length, 0)
    assert.ok(text(m.container).includes(kit.t('fleet.comms.noMatch')))
    await m.unmount()
  })

  test('the order toggle flips the timeline', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    assert.equal(events(m.container)[0]!.dataset.commsKey, COMMS[0]!.key)
    await click(query(m.container, '.lc-comms-order'))
    assert.equal(events(m.container)[0]!.dataset.commsKey, COMMS[COMMS.length - 1]!.key)
    assert.ok(text(m.container).includes(kit.t('fleet.comms.orderOldest')))
    await click(query(m.container, '.lc-comms-order'))
    assert.equal(events(m.container)[0]!.dataset.commsKey, COMMS[0]!.key)
    await m.unmount()
  })

  test('a pick narrows the hub, names itself, and clears', async () => {
    const clears: boolean[] = []
    const m = await mount(h(CommsPanel, propsOf({ pickId: 'w2', onPickClear: () => { clears.push(true) } })))
    assert.equal(events(m.container).length, 4)
    assert.equal(queryAll(m.container, '.lc-comms-channel').length, 3, 'all card + two channels')
    const chip = query<HTMLElement>(m.container, '.lc-tasks-filter')
    assert.ok(text(chip).includes('tests-host'))
    await click(chip)
    assert.deepEqual(clears, [true])
    await m.unmount()
  })

  test('a pick without traffic explains the empty scope', async () => {
    const m = await mount(h(CommsPanel, propsOf({ pickId: 'w9' })))
    assert.equal(events(m.container).length, 0)
    assert.ok(text(m.container).includes(kit.t('fleet.comms.noMatch')))
    await m.unmount()
  })

  test('the more-channels card expands and folds a large fleet', async () => {
    const agents = new Map<string, CommsAgent>(AGENTS)
    const rows: CommsRow[] = []
    for (let i = 0; i < 11; i++) {
      const id = `p${i}`
      agents.set(id, { id, name: `peer-${i}`, role: 'subagent', self: false, hue: `hsl(${i * 20} 50% 50%)` })
      rows.push({ key: `${id}:1:${100 + i}:relay`, to: id, seq: 1, time: 100 + i, kind: 'relay', from: 'root', text: `message ${i}` })
    }
    const m = await mount(h(CommsPanel, propsOf({ comms: rows, agents })))
    assert.equal(queryAll(m.container, '.lc-comms-channel').length, 10, 'all + 8 visible + more')
    const more = query<HTMLElement>(m.container, '.lc-comms-channel-more')
    assert.ok(text(more).includes(kit.t('fleet.comms.moreChannels', { n: 3 })))
    await click(more)
    assert.equal(queryAll(m.container, '.lc-comms-channel').length, 13, 'all + 11 channels + fewer')
    const oldest = channelOf(m.container, channelKeyOf(rows[0]!))
    await click(oldest)
    assert.equal(oldest.getAttribute('aria-pressed'), 'true')
    await click(query(m.container, '.lc-comms-channel-more'))
    assert.equal(oldest.getAttribute('aria-pressed'), 'true', 'a selected hidden channel stays pinned above the fold')
    assert.equal(events(m.container).length, 1)
    assert.equal(queryAll(m.container, '.lc-comms-channel').length, 11, 'all + 8 visible + the selected channel + more')
    await m.unmount()
  })

  test('a selected channel dropped from the new data falls back to all traffic', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    const key = channelKeyOf(COMMS[0]!)
    await click(channelOf(m.container, key))
    assert.equal(events(m.container).length, 4)
    const next = COMMS.filter(row => channelKeyOf(row) !== key)
    await m.update(h(CommsPanel, propsOf({ comms: next })))
    assert.equal(query<HTMLElement>(m.container, '.lc-comms-channel-all').getAttribute('aria-pressed'), 'true')
    assert.equal(events(m.container).length, next.length)
    await m.unmount()
  })

})

describe('CommsPanel — event detail', () => {
  test('a relay opens its full record, provenance, participants, and actions', async () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    const onEnter = vi.fn()
    const details = detailsOf()
    const m = await mount(h(CommsPanel, propsOf({ details, onSelect, onOpen, onEnter })))
    const event = eventOf(m.container, COMMS[0]!.key)
    assert.equal(queryAll(m.container, '.lc-comms-detail').length, 0)
    await click(query(event, '.lc-comms-hit'))
    assert.equal(queryAll(m.container, '.lc-comms-detail').length, 1)
    const detail = query(m.container, '.lc-comms-detail')
    assert.ok(text(detail).includes('how far along?'))
    assert.ok(text(detail).includes('Recorded in the log of host-cleaner'))
    assert.ok(text(detail).includes('Participants'))
    assert.ok(text(detail).includes('seq 10'))
    expect(details.requestFull).not.toHaveBeenCalled()
    const people = queryAll<HTMLElement>(detail, '.lc-comms-person')
    assert.equal(people.length, 2)
    const rootPerson = people.find(person => text(person).includes('Lead'))!
    assert.equal(queryAll(rootPerson, '.lc-inspector-btn').length, 0, 'the self card offers no navigation')
    const peer = people.find(person => text(person).includes('host-cleaner'))!
    const actions = queryAll<HTMLElement>(peer, '.lc-inspector-btn')
    assert.equal(actions.length, 3)
    assert.ok(text(actions[0]!).includes(kit.t('fleet.comms.detail.filter')))
    await click(actions[0]!)
    await click(actions[1]!)
    await click(actions[2]!)
    assert.deepEqual(onSelect.mock.calls, [['w1']])
    assert.deepEqual(onOpen.mock.calls, [['w1']])
    assert.deepEqual(onEnter.mock.calls, [['w1']])
    await m.unmount()
  })

  test('closing an event removes its detail', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    const hit = query(eventOf(m.container, COMMS[0]!.key), '.lc-comms-hit')
    await click(hit)
    assert.equal(queryAll(m.container, '.lc-comms-detail').length, 1)
    await click(hit)
    assert.equal(queryAll(m.container, '.lc-comms-detail').length, 0)
    await click(hit)
    await click(query(m.container, '.lc-comms-detail-close'))
    assert.equal(queryAll(m.container, '.lc-comms-detail').length, 0)
    await m.unmount()
  })

  test('a clipped row loads its full text and stops flagging the excerpt', async () => {
    const details = detailsOf({ fullPending: new Set(['root']) })
    const m = await mount(h(CommsPanel, propsOf({ details })))
    const event = eventOf(m.container, 'root:4:2000:relay')
    await click(query(event, '.lc-comms-hit'))
    expect(details.requestFull).toHaveBeenCalledWith('root')
    assert.ok(text(m.container).includes(kit.t('fleet.comms.detail.loading')))
    const full: FleetDetail = {
      messages: [{ seq: 4, time: 2000, kind: 'relay', from: 'w2', text: 'y'.repeat(900) }],
      truncated: false,
    }
    const next = detailsOf({ fullLanded: new Map([['root', full]]) })
    await m.update(h(CommsPanel, propsOf({ details: next })))
    assert.ok(text(query(m.container, '.lc-comms-detail-body')).includes('yyyy'))
    assert.ok(!text(m.container).includes(kit.t('fleet.comms.detail.loading')))
    assert.ok(!text(m.container).includes(kit.t('fleet.comms.detail.excerptOnly')))
    await m.unmount()
  })

  test('a null full read also falls back to the excerpt', async () => {
    const m = await mount(h(CommsPanel, propsOf({ details: detailsOf({ fullLanded: new Map([['root', null]]) }) })))
    await click(query(eventOf(m.container, 'root:4:2000:relay'), '.lc-comms-hit'))
    assert.ok(text(m.container).includes(kit.t('fleet.comms.detail.excerptOnly')))
    await m.unmount()
  })

  test('a stale full read whose message is gone also falls back to the excerpt', async () => {
    const stale: FleetDetail = {
      messages: [{ seq: 999, time: 1, kind: 'relay', from: 'w2', text: 'not the one' }],
      truncated: false,
    }
    const m = await mount(h(CommsPanel, propsOf({ details: detailsOf({ fullLanded: new Map([['root', stale]]) }) })))
    await click(query(eventOf(m.container, 'root:4:2000:relay'), '.lc-comms-hit'))
    assert.ok(text(m.container).includes(kit.t('fleet.comms.detail.excerptOnly')))
    await m.unmount()
  })

  test('a settlement with no report, or a future phrasing, still opens to a complete record', async () => {
    const rows: CommsRow[] = [
      { key: 'root:20:9000:settled', to: 'root', seq: 20, time: 9000, kind: 'settled', from: 'w1', text: 'a brand-new phrasing' },
      { key: 'root:21:9100:settled', to: 'root', seq: 21, time: 9100, kind: 'settled', from: 'w1', summary: 'a future summary', text: 'a future summary', structured: 'not-json' },
      { key: 'root:22:9200:relay', to: 'root', seq: 22, time: 9200, kind: 'relay', from: 'w1', text: '' },
    ]
    const m = await mount(h(CommsPanel, propsOf({ comms: rows })))
    const future = eventOf(m.container, 'root:20:9000:settled')
    assert.equal(queryAll(future, '.lc-comms-preview-text').length, 0)
    assert.ok(text(future).includes('a brand-new phrasing'), 'an unknown settlement still previews its raw summary')
    await click(query(future, '.lc-comms-hit'))
    let detail = query(m.container, '.lc-comms-detail')
    assert.ok(text(detail).includes('a brand-new phrasing'))
    assert.ok(!text(detail).includes(kit.t('fleet.comms.detail.noReport')))
    assert.ok(!text(detail).includes(kit.t('fleet.settled.finished')))
    await click(query(future, '.lc-comms-hit'))

    const summarized = eventOf(m.container, 'root:21:9100:settled')
    await click(query(summarized, '.lc-comms-hit'))
    detail = query(m.container, '.lc-comms-detail')
    assert.ok(text(detail).includes('a future summary'))
    assert.ok(text(detail).includes('not-json'))
    assert.ok(text(detail).includes(kit.t('fleet.comms.detail.noReport')))
    await click(query(summarized, '.lc-comms-hit'))

    const empty = eventOf(m.container, 'root:22:9200:relay')
    await click(query(empty, '.lc-comms-hit'))
    detail = query(m.container, '.lc-comms-detail')
    assert.ok(text(detail).includes(kit.t('fleet.comms.detail.noBody')))
    await m.unmount()
  })

  test('a full settlement read supplies the report that the excerpt omitted', async () => {
    const full: FleetDetail = {
      messages: [{
        seq: 8, time: 6000, kind: 'settled', from: 'w1', text: 'full text',
        summary: SETTLED_SUMMARY, report: 'FULL REPORT FROM THE CHILD',
      }],
      truncated: false,
    }
    const m = await mount(h(CommsPanel, propsOf({ details: detailsOf({ fullLanded: new Map([['root', full]]) }) })))
    await click(query(eventOf(m.container, 'root:8:6000:settled'), '.lc-comms-hit'))
    assert.ok(text(query(m.container, '.lc-comms-detail-body')).includes('FULL REPORT FROM THE CHILD'))
    await m.unmount()
  })

  test('a zero-instant channel renders the dash instead of a fabricated time', async () => {
    const rows: CommsRow[] = [{ key: 'root:1:0:relay', to: 'root', seq: 1, time: 0, kind: 'relay', from: 'w1', text: 'at zero' }]
    const m = await mount(h(CommsPanel, propsOf({ comms: rows })))
    assert.ok(text(channelOf(m.container, channelKeyOf(rows[0]!))).includes('—'))
    await m.unmount()
  })

  test('a self-channel drops the redundant role and opens one participant', async () => {
    const rows: CommsRow[] = [{ key: 'root:1:100:relay', to: 'root', seq: 1, time: 100, kind: 'relay', from: 'root', text: 'note to self' }]
    const m = await mount(h(CommsPanel, propsOf({ comms: rows })))
    const card = channelOf(m.container, channelKeyOf(rows[0]!))
    assert.ok(text(card).includes('Lead'))
    assert.ok(!text(card).includes('Lead ↔'))
    assert.ok(!text(card).includes('⇄'), 'a self-channel has no two directions to count')
    await click(query(eventOf(m.container, rows[0]!.key), '.lc-comms-hit'))
    assert.equal(queryAll(m.container, '.lc-comms-person').length, 1)
    assert.ok(text(query(m.container, '.lc-comms-detail')).includes(kit.t('agents.self')))
    await m.unmount()
  })


  test('a party outside the family uses its mailbox name, session title, or a short id', async () => {
    const titled = 'session-outside-123456'
    const attestedId = 'session-attested-123456'
    const untitled = 'deadbeef-0000-1111-2222-333333333333'
    const rows: CommsRow[] = [
      { key: 'root:30:9000:relay', to: 'root', seq: 30, time: 9000, kind: 'relay', from: titled, text: 'from titled' },
      { key: 'root:31:9100:relay', to: 'root', seq: 31, time: 9100, kind: 'relay', from: attestedId, fromName: 'mailbox-worker', text: 'from attested' },
      { key: 'root:32:9200:relay', to: 'root', seq: 32, time: 9200, kind: 'relay', from: untitled, text: 'from unknown' },
    ]
    const m = await mount(h(CommsPanel, propsOf({
      comms: rows,
      titles: new Map([[titled, 'Host Cleanup Session']]),
      attested: new Map([[attestedId, 'mailbox-worker']]),
    })))
    const titledCard = channelOf(m.container, channelKeyOf(rows[0]!))
    assert.ok(text(titledCard).includes('Host Cleanup Session'))
    assert.ok(text(titledCard).includes(kit.t('fleet.role.other')))
    const attestedCard = channelOf(m.container, channelKeyOf(rows[1]!))
    assert.ok(text(attestedCard).includes('mailbox-worker'))
    const untitledCard = channelOf(m.container, channelKeyOf(rows[2]!))
    assert.ok(text(untitledCard).includes(kit.t('fleet.comms.agentId', { id: 'deadbeef…' })))
    assert.ok(!text(untitledCard).includes(untitled))
    await click(query(eventOf(m.container, rows[0]!.key), '.lc-comms-hit'))
    const detail = query(m.container, '.lc-comms-detail')
    assert.ok(text(detail).includes('Host Cleanup Session'))
    assert.ok(text(detail).includes(titled))
    await m.unmount()
  })

  test('a settlement shows its outcome, runtime note, report, structured result, and diagnostic', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    const event = eventOf(m.container, 'root:8:6000:settled')
    assert.ok(text(event).includes(kit.t('fleet.settledShort.finished')))
    await click(query(event, '.lc-comms-hit'))
    const detail = query(m.container, '.lc-comms-detail')
    assert.ok(text(detail).includes(kit.t('fleet.settled.finished')))
    assert.ok(text(detail).includes(kit.t('fleet.comms.detail.settledNote')))
    assert.ok(text(detail).includes('All gates green.'))
    assert.ok(text(detail).includes(kit.t('fleet.comms.detail.structured')))
    assert.ok(text(detail).includes(kit.t('fleet.comms.detail.diagnostic')))
    assert.ok(text(detail).includes('provider warning'))
    await m.unmount()
  })

  test('a pinned participant renders the clear-filter affordance', async () => {
    const m = await mount(h(CommsPanel, propsOf({ pinnedId: 'w1' })))
    await click(query(eventOf(m.container, COMMS[0]!.key), '.lc-comms-hit'))
    const peer = queryAll<HTMLElement>(m.container, '.lc-comms-person').find(person => text(person).includes('host-cleaner'))!
    assert.ok(text(query(peer, '.lc-comms-person-pin-on')).includes(kit.t('fleet.comms.detail.unfilter')))
    await m.unmount()
  })
})

describe('CommsPanel — loading, empty, and notes', () => {
  test('no rows with reads in flight shows the skeleton, not a dead end', async () => {
    const m = await mount(h(CommsPanel, propsOf({ comms: [], details: detailsOf({ pending: new Set(['root']) }) })))
    assert.equal(queryAll(m.container, '.lc-comms-skeleton').length, 1)
    assert.equal(queryAll(m.container, '.lc-comms-channel').length, 0)
    await m.unmount()
  })

  test('before the first read lands, the skeleton stands rather than claiming no traffic', async () => {
    const m = await mount(h(CommsPanel, propsOf({ comms: [] })))
    assert.equal(queryAll(m.container, '.lc-comms-skeleton').length, 1)
    assert.ok(!text(m.container).includes(kit.t('fleet.comms.empty')))
    await m.unmount()
  })

  test('no rows with nothing in flight explains that the fleet has no traffic', async () => {
    const landed = new Map([['root', { detail: { messages: [], truncated: false }, updatedAt: 1 }]])
    const m = await mount(h(CommsPanel, propsOf({ comms: [], details: detailsOf({ landed }) })))
    assert.equal(queryAll(m.container, '.lc-comms-skeleton').length, 0)
    assert.ok(text(m.container).includes(kit.t('fleet.comms.empty')))
    await m.unmount()
  })

  test('hidden history and excerpt rows are disclosed beneath the timeline', async () => {
    const landed = new Map([
      ['root', { detail: { messages: [], messagesTotal: 42, truncated: true }, updatedAt: 1 }],
    ])
    const m = await mount(h(CommsPanel, propsOf({ details: detailsOf({ landed }) })))
    const notes = text(query(m.container, '.lc-comms-notes'))
    assert.ok(notes.includes(kit.t('fleet.comms.hidden', { n: 42 })))
    assert.ok(notes.includes(kit.t('fleet.comms.clipped', { n: 1 })))
    await m.unmount()
  })

  test('the hidden-history note follows the selected channel, not every landed log', async () => {
    const landed = new Map([
      ['root', { detail: { messages: [], messagesTotal: 7, truncated: true }, updatedAt: 1 }],
    ])
    const peer = COMMS[5]!
    const m = await mount(h(CommsPanel, propsOf({ details: detailsOf({ landed }) })))
    await click(channelOf(m.container, channelKeyOf(peer)))
    assert.equal(queryAll(m.container, '.lc-comms-notes').length, 0, 'the peer channel touches no hidden root log')
    await m.unmount()
  })

  test('hidden history alone renders the notes without a clipped warning', async () => {
    const landed = new Map([
      ['root', { detail: { messages: [], messagesTotal: 7, truncated: true }, updatedAt: 1 }],
    ])
    const m = await mount(h(CommsPanel, propsOf({
      comms: COMMS.filter(row => row.clipped !== true),
      details: detailsOf({ landed }),
    })))
    const notes = text(query(m.container, '.lc-comms-notes'))
    assert.ok(notes.includes(kit.t('fleet.comms.hidden', { n: 7 })))
    assert.ok(!notes.includes(kit.t('fleet.comms.clipped', { n: 1 })))
    await m.unmount()
  })

  test('a filter that hides rows reports both the shown count and the total', async () => {
    const m = await mount(h(CommsPanel, propsOf()))
    await click(queryAll<HTMLElement>(m.container, '.lc-fleet-filters .lc-gran-btn')[2]!)
    const notes = text(query(m.container, '.lc-comms-notes'))
    assert.ok(notes.includes(kit.t('fleet.comms.filtered', { n: 1, total: 10 })))
    await m.unmount()
  })
})
