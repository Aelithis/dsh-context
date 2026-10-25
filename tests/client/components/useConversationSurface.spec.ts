import assert from 'node:assert/strict'
import { createElement as h, useRef } from 'react'
import { describe, test } from 'vitest'
import { useConversationSurface, type ConversationSurfaceKind } from '../../../src/client/components/useConversationSurface'
import { mount, query } from '../helpers/kit'

const PANE_ATTR = 'data-lc-surface'
const MODAL_ATTR = 'data-lc-modal'

function Probe(props: { kind?: ConversationSurfaceKind; attach?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useConversationSurface(ref, props.kind)
  return h('div', { ...(props.attach === false ? {} : { ref }), 'data-probe': '' })
}

function Scene(props: { kind?: ConversationSurfaceKind; attach?: boolean; second?: boolean }) {
  return h('div', { 'data-conversation-scroll': '' },
    h(Probe, { kind: props.kind, attach: props.attach }),
    props.second === true ? h(Probe, { kind: props.kind }) : null,
  )
}

describe('useConversationSurface', () => {
  test('marks the closest conversation scroller while mounted and clears it last', async () => {
    const m = await mount(h(Scene, {}))
    const host = query(m.container, '[data-conversation-scroll]')
    assert.equal(host.hasAttribute(PANE_ATTR), true)
    await m.unmount()
    assert.equal(host.hasAttribute(PANE_ATTR), false)
  })

  test('keeps the marker until every surface releases it', async () => {
    const m = await mount(h(Scene, { second: true }))
    const host = query(m.container, '[data-conversation-scroll]')
    assert.equal(host.hasAttribute(PANE_ATTR), true)
    await m.update(h(Scene, {}))
    assert.equal(host.hasAttribute(PANE_ATTR), true, 'the remaining surface still owns the pane')
    await m.unmount()
    assert.equal(host.hasAttribute(PANE_ATTR), false)
  })

  test('marks the modal separately and keeps the two surface kinds independent', async () => {
    const m = await mount(h(Scene, { kind: 'modal' }))
    const host = query(m.container, '[data-conversation-scroll]')
    assert.equal(host.hasAttribute(MODAL_ATTR), true)
    assert.equal(host.hasAttribute(PANE_ATTR), false)
    await m.update(h(Scene, {}))
    assert.equal(host.hasAttribute(MODAL_ATTR), false, 'the modal released its width-handle mark')
    assert.equal(host.hasAttribute(PANE_ATTR), true)
    await m.unmount()
    assert.equal(host.hasAttribute(PANE_ATTR), false)
  })

  test('moves the mark when the kind changes on one mounted surface', async () => {
    const m = await mount(h(Scene, {}))
    const host = query(m.container, '[data-conversation-scroll]')
    assert.equal(host.hasAttribute(PANE_ATTR), true)
    await m.update(h(Scene, { kind: 'modal' }))
    assert.equal(host.hasAttribute(PANE_ATTR), false)
    assert.equal(host.hasAttribute(MODAL_ATTR), true)
    await m.unmount()
    assert.equal(host.hasAttribute(MODAL_ATTR), false)
  })

  test('ignores an unattached ref and a host without the scroller', async () => {
    const unattached = await mount(h(Scene, { attach: false }))
    assert.equal(query(unattached.container, '[data-conversation-scroll]').hasAttribute(PANE_ATTR), false)
    await unattached.unmount()

    const bare = await mount(h(Probe, {}))
    assert.equal(bare.container.querySelector('[data-conversation-scroll]'), null)
    await bare.unmount()
  })
})
