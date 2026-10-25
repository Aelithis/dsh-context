import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  channelKeyOf,
  channelsOf,
  fromPartyOf,
  includesAgent,
  initialsOf,
  kindGroupOf,
  nameOfParty,
  NAME_PARTY_PREFIX,
  previewOf,
  settledToneOf,
  UNKNOWN_PARTY,
} from '../../src/client/commsModel'
import type { CommsRow } from '../../src/client/fleetDetail'

function row(over: Partial<CommsRow> & { seq: number; to: string; time: number; text: string }): CommsRow {
  return { key: `${over.to}:${over.seq}:${over.time}:relay`, kind: 'relay', ...over }
}

describe('party keys', () => {
  test('an id wins over a name; a name-only party gets its own key; the bare arrow is unknown', () => {
    assert.equal(fromPartyOf(row({ seq: 1, to: 'a', time: 1, text: 'x', from: 'b', fromName: 'Bee' })), 'b')
    assert.equal(fromPartyOf(row({ seq: 1, to: 'a', time: 1, text: 'x', fromName: 'Bee' })), NAME_PARTY_PREFIX + 'Bee')
    assert.equal(fromPartyOf(row({ seq: 1, to: 'a', time: 1, text: 'x' })), UNKNOWN_PARTY)
    assert.equal(nameOfParty(NAME_PARTY_PREFIX + 'Bee'), 'Bee')
    assert.equal(nameOfParty('session-a'), undefined)
  })

  test('the channel key is unordered', () => {
    const forward = row({ seq: 1, to: 'b', time: 1, text: 'x', from: 'a' })
    const back = row({ seq: 2, to: 'a', time: 2, text: 'y', from: 'b' })
    assert.equal(channelKeyOf(forward), channelKeyOf(back))
  })

  test('agent scope matches either side', () => {
    const forwarded = row({ seq: 1, to: 'b', time: 1, text: 'x', from: 'a' })
    assert.equal(includesAgent(forwarded, 'a'), true)
    assert.equal(includesAgent(forwarded, 'b'), true)
    assert.equal(includesAgent(forwarded, 'c'), false)
  })
})

describe('channelsOf', () => {
  const rows: CommsRow[] = [
    row({ key: 'b:4:400:relay', seq: 4, to: 'b', time: 400, text: 'later', from: 'a' }),
    { key: 'a:3:300:settled', seq: 3, to: 'a', time: 300, kind: 'settled', from: 'b', text: 'done', summary: 'done' },
    row({ key: 'a:2:200:mailbox', seq: 2, to: 'a', time: 200, kind: 'mailbox', from: 'b', text: 'older', fromName: 'Bee' }),
    row({ key: 'b:1:100:relay', seq: 1, to: 'b', time: 100, text: 'first', from: 'a' }),
    row({ key: 'c:1:50:relay', seq: 1, to: 'c', time: 50, text: 'side', fromName: 'legacy' }),
  ]

  test('one channel per unordered pair, anchor first, directional counts and kinds', () => {
    const channels = channelsOf(rows, 'b')
    assert.equal(channels.length, 2)
    const main = channels[0]!
    assert.equal(main.a, 'b')
    assert.equal(main.b, 'a')
    assert.equal(main.out, 2)
    assert.equal(main.back, 2)
    assert.deepEqual(main.kinds, { relay: 2, mailbox: 1, settled: 1 })
    assert.equal(main.lastTime, 400)
    assert.equal(main.firstTime, 100)
    assert.deepEqual(main.rows.map(item => item.time), [400, 300, 200, 100])
    const side = channels[1]!
    assert.equal(side.a, NAME_PARTY_PREFIX + 'legacy')
    assert.equal(side.b, 'c')
    assert.equal(side.out, 1)
    assert.equal(side.back, 0)
  })

  test('without an anchor the party that sent more leads; a tie is deterministic', () => {
    const channels = channelsOf(rows)
    const main = channels.find(channel => channel.key === channelKeyOf(rows[0]!))!
    assert.equal(main.a, 'a')
    assert.equal(main.b, 'b')
    const tied = channelsOf([
      row({ key: 'x:1:1:relay', seq: 1, to: 'y', time: 1, text: 'x', from: 'x' }),
      row({ key: 'y:2:2:relay', seq: 2, to: 'x', time: 2, text: 'y', from: 'y' }),
    ])
    assert.equal(tied[0]!.a, 'x')
  })

  test('a self-addressed row still forms a channel', () => {
    const channels = channelsOf([row({ key: 'a:1:1:relay', seq: 1, to: 'a', time: 1, text: 'me', from: 'a' })])
    assert.equal(channels.length, 1)
    assert.equal(channels[0]!.a, 'a')
    assert.equal(channels[0]!.b, 'a')
    assert.equal(channels[0]!.out, 1)
    assert.equal(channels[0]!.back, 0)
  })

  test('the sparkline normalizes each channel against its own peak', () => {
    const channels = channelsOf([
      row({ key: 'a:1:0:relay', seq: 1, to: 'b', time: 0, text: 'x', from: 'a' }),
      row({ key: 'a:2:50:relay', seq: 2, to: 'b', time: 50, text: 'y', from: 'a' }),
      row({ key: 'a:3:100:relay', seq: 3, to: 'b', time: 100, text: 'z', from: 'a' }),
      row({ key: 'a:4:100:relay', seq: 4, to: 'b', time: 100, text: 'w', from: 'a' }),
    ])
    const spark = channels[0]!.spark
    assert.equal(spark.length, 12)
    assert.equal(spark[0], 0.5)
    assert.equal(spark[6], 0.5)
    assert.equal(spark[11], 1)
    assert.equal(channelsOf([
      row({ key: 'a:1:100:relay', seq: 1, to: 'b', time: 100, text: 'x', from: 'a' }),
    ])[0]!.spark[11], 1)
  })

  test('an empty row list makes no channels', () => {
    assert.deepEqual(channelsOf([]), [])
  })
})

describe('display helpers', () => {
  test('settled tones and kind groups', () => {
    assert.equal(settledToneOf('finished'), 'done')
    assert.equal(settledToneOf('finishedFinal'), 'done')
    assert.equal(settledToneOf('failed'), 'error')
    assert.equal(settledToneOf('stopped'), 'warning')
    assert.equal(settledToneOf('declined'), 'warning')
    assert.equal(settledToneOf(null), 'idle')
    assert.equal(kindGroupOf(row({ seq: 1, to: 'a', time: 1, text: '' })), 'message')
    assert.equal(kindGroupOf({ key: 'a', seq: 1, to: 'a', time: 1, kind: 'settled', text: '' }), 'report')
  })

  test('previews strip fences and markup; unparseable payloads fall back to raw text and cap at 600', () => {
    assert.equal(previewOf('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |'), 'Title a b 1 2')
    assert.equal(previewOf('```js\nconst x = 1\n```'), '```js const x = 1 ```')
    assert.equal(previewOf('`inline` **bold** [link](https://x)'), 'inline bold link')
    const long = previewOf('x'.repeat(800))
    assert.equal(long.length, 601)
    assert.ok(long.endsWith('…'))
  })

  test('initials cover CJK, hyphenated names, single words, and empty names', () => {
    assert.equal(initialsOf('分析 Agent'), '分')
    assert.equal(initialsOf('host-cleaner'), 'HC')
    assert.equal(initialsOf('lead'), 'L')
    assert.equal(initialsOf('  '), '?')
  })
})
