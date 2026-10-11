/**
 * The Fleet tab — the agent family's standalone home. One shared derivation (fleetModel.ts) feeds
 * an overview strip (family stats + the progress bar: shared tasks when a team exists, subagent
 * completion otherwise), then a two-up cockpit row — the network card left, the members board
 * over the task board right — then the comms timeline. Both boards stay up with guidance notes
 * when the session never formed a team, so the page's shape never jumps between session kinds.
 * Hover, pin, owner filter, and task focus are all lifted here, so a graph node, a member card, an
 * agent row, a task owner chip, a blocker chip, and a comms party all steer each other.
 */

import { createElement as h, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AgentHeads } from '../agentHeads'
import { agentSelfOf } from '../agentTree'
import { displayCurrencyOf } from '../cost'
import { mergeComms } from '../fleetDetail'
import { useFleetDetails, useFleetModel } from '../fleetModel'
import { teamMemberOf, teamOf } from '../fleetTeam'
import { useModelPrices } from '../modelPrices'
import type { ClientCtx, SessionStandardProps } from '../services'
import { openSessionVia, projectionOf, unsupportedOf } from '../services'
import { useContextSession } from '../sessionData'
import type { ViewKit } from '../viewkit'
import type { FleetDetail } from '../../shared/types'
import { makeAgentGraph } from './agentGraph'
import { CommsPanel } from './commsPanel'
import { makeDetailNote } from './detailNote'
import { makeRichText } from './richText'
import { makeErrorBoundary } from './errorBoundary'
import { FleetSummary } from './fleetSummary'
import { MemberBoard } from './memberBoard'
import { TaskBoard } from './taskBoard'
import { makeUpgradeGate } from './upgradeGate'

export function makeFleetView(
  ctx: ClientCtx,
  kit: ViewKit,
  heads: AgentHeads,
): (props: SessionStandardProps) => ReactElement {
  const { t } = kit
  const AgentGraph = makeAgentGraph(ctx, kit, heads)
  const UpgradeGate = makeUpgradeGate(kit)
  const DetailNote = makeDetailNote(kit)
  const ErrorBoundary = makeErrorBoundary(t)
  const rich = makeRichText(kit)

  function FleetBody(props: SessionStandardProps): ReactElement {
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
    const { source, data, pressure, breakdown, usage } = useContextSession(props)
    const self = data !== null ? agentSelfOf(data, pressure, breakdown, usage) : undefined
    // The model arms only once the tab's own timeline landed: while the loading/failure screen
    // stands, no snapshot subscription and no fleet-detail read fire.
    const { forest, team: rowTeam } = useFleetModel(ctx, heads, sessionId, self, data !== null)
    // The freshest team value is the tab's OWN projection when the viewed session leads the team;
    // a teammate's view falls back to the lead row's list-block copy.
    const teamDirect = projectionOf(props, 'agentTeam', teamOf)
    const team = teamDirect ?? rowTeam
    const details = useFleetDetails()
    const [hoverId, setHoverId] = useState<string | null>(null)
    const [pinnedId, setPinnedId] = useState<string | null>(null)
    /** The task board's owner filter and focus flash, shared with the members board. */
    const [ownerFilter, setOwnerFilter] = useState<string | null>(null)
    const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
    const { book } = useModelPrices()
    const currency = displayCurrencyOf(ctx.locale)

    const byId = useMemo(
      () => new Map((forest?.nodes ?? []).map(n => [n.id, n])),
      [forest],
    )

    // A pinned agent that left the family releases the pin instead of ringing a ghost.
    useEffect(() => {
      if (pinnedId !== null && !byId.has(pinnedId)) setPinnedId(null)
    }, [pinnedId, byId])

    // The lead's own detail feeds the members board's roster facts. Every family node's detail
    // rides too: a member card's model and reply, a delegation row's briefing prompt on the task
    // board, and the comms merge's relay rows all fill in on first paint instead of after a scan.
    const leadId = team !== null ? team.members[0]?.id : undefined
    const detailStamp = forest === null ? '' : forest.nodes.map(n => `${n.id}@${n.updatedAt}`).join(',')
    useEffect(() => {
      if (forest === null) return
      for (const node of forest.nodes) details.request(node.id, node.updatedAt)
    }, [forest, detailStamp])

    const landedDetails = useMemo(() => {
      const map = new Map<string, FleetDetail>()
      for (const [id, entry] of details.landed) {
        if (entry.detail !== null) map.set(id, entry.detail)
      }
      return map
    }, [details.landed])
    const comms = useMemo(() => mergeComms(landedDetails), [landedDetails])

    const labelOf = (id: string): string => {
      const node = byId.get(id)
      if (node !== undefined) return node.label
      const member = team?.members.find(m => m.id === id)
      return member?.name ?? id
    }

    const open = (id: string): void => {
      openSessionVia(ctx, id)
    }

    /** A graph-node or member-card pick rings the node, and narrows the task board to that
     * agent's work — members by roster name, plain subagents by their own session; picking again
     * releases both. */
    const select = (id: string): void => {
      const next = pinnedId === id ? null : id
      setPinnedId(next)
      const member = teamMemberOf(team, id)
      if (next !== null) setOwnerFilter(member?.name ?? id)
      else if (ownerFilter === id || (member !== null && ownerFilter === member.name)) setOwnerFilter(null)
    }

    if (data === null) {
      return (
        <div className="lc-root">
          {source.detailState === 'failed'
            ? <DetailNote state="failed" onRetry={source.retryDetail} />
            : <div className="lc-empty">{t('loading')}</div>}
        </div>
      )
    }

    // The baseline gate must not hide behind whichever tab the reader opened: the dismissal ledger is keyed by
    // session, so one dismissal holds across the Context tab and this one.
    const gate = unsupportedOf(data.unsupported)
    const leadDetail = leadId !== undefined ? landedDetails.get(leadId) ?? null : null
    /** A task-board row pick toggles the pin; a release also lets go of a task-board narrowing
     * still pointing at that agent (the same pair select() manages for graph and member picks). */
    const pinToggle = (id: string | null): void => {
      const releasing = pinnedId === id
      setPinnedId(releasing ? null : id)
      if (releasing && id !== null) {
        const member = teamMemberOf(team, id)
        const key = member?.name ?? id
        if (ownerFilter === key) setOwnerFilter(null)
      }
    }
    const taskBoard = (
      <TaskBoard
        team={team}
        forest={forest}
        detailOf={id => details.landed.get(id)}
        ownerFilter={ownerFilter}
        onOwnerFilter={setOwnerFilter}
        focusTaskId={focusTaskId}
        onFocusTask={setFocusTaskId}
        onPinMember={pinToggle}
        onHoverMember={setHoverId}
        rich={rich}
        t={t}
        fmt={kit.fmt}
      />
    )
    // The boards column's two cards stack; the network column is the graph alone, and either seat
    // may be absent (no snapshot at all, or a team whose forest has not landed yet).
    const boardsColumn = forest !== null
      ? (
        <div className="lc-col flex-1 min-w-[min(360px,100%)]">
          <MemberBoard
            team={team}
            forest={forest}
            leadDetail={leadDetail}
            detailOf={id => details.landed.get(id)}
            pinnedId={pinnedId}
            onPin={select}
            onHover={setHoverId}
            onOpen={open}
            ownerFilter={ownerFilter}
            onOwnerFilter={setOwnerFilter}
            t={t}
            fmt={kit.fmt}
          />
          {taskBoard}
        </div>
      )
      : team !== null
        ? <div className="lc-col flex-1 min-w-[min(360px,100%)]">{taskBoard}</div>
        : null
    return (
      <div className="lc-root">
        {forest !== null
          ? <FleetSummary forest={forest} team={team} book={book} currency={currency} t={t} fmt={kit.fmt} />
          : null}
        {forest !== null || boardsColumn !== null
          ? (
            <div className="lc-cols">
              {forest !== null
                ? (
                  <div className="lc-col lc-col-graph flex-1 min-w-[min(420px,100%)]">
                    <AgentGraph
                      sessionId={sessionId}
                      forest={forest}
                      team={team}
                      pinnedId={pinnedId}
                      hoverId={hoverId}
                      onHover={setHoverId}
                      onSelect={select}
                      inspector={false}
                    />
                  </div>
                )
                : null}
              {boardsColumn}
            </div>
          )
          : null}
        {forest !== null && !forest.solo
          ? (
            <CommsPanel
              nodes={forest.nodes}
              details={details}
              comms={comms}
              labelOf={labelOf}
              onPin={setPinnedId}
              t={t}
              fmt={kit.fmt}
            />
          )
          : null}
        <div className="lc-foot">{t('footer')}</div>
        {gate !== null && (
          <UpgradeGate sessionId={sessionId} current={gate.current} minimum={gate.minimum} />
        )}
      </div>
    )
  }

  return function FleetView(props: SessionStandardProps): ReactElement {
    return h(ErrorBoundary, null, h(FleetBody, props))
  }
}
