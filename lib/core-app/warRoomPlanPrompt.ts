import { pct, signedPts } from './outlookCopy'
import { seasonOutlookSentence } from './outlookSpanish'
import type { WarFrontCard, WarOrder } from './warRoomFront'
import type { WarTrades } from './warRoomTrades'
import type { FormatBrief } from './warRoomFormat'
import type { NextSeasonView } from './warRoomNextSeason'
import type { WarCampaign } from './warRoomCampaign'
import type { warRoomPlanMessages } from './messages/warRoomPlan'
import type { warRoomBriefMessages } from './messages/warRoomBrief'

/**
 * War Room phase 4 — the war plan, written by Chimmy from what the War Room already computed.
 *
 * ── 🛑 IT IS A PREFILL, NEVER A SEND ────────────────────────────────────
 *
 * The button puts this text in Chimmy's composer and stops (commsEvents.ts: "a screen that fires a
 * question off on the user's behalf has spent their request allowance on something they never typed").
 * The user reads it, can edit it, and presses send — so the plan is billed through Chimmy's existing
 * allowance and no new model path exists. That is also why the brief is plain text the user can read:
 * nothing is hidden in it.
 *
 * ── WHAT GOES IN, AND WHAT DOES NOT ─────────────────────────────────────
 *
 * Only what the War Room already showed this viewer: The Front's card, the trade ideas (present only
 * when the viewer's plan includes them — a locked viewer's `trades` is null, so a paid idea can never
 * leak into a free user's prompt), the format brief's edge, hole and scarcest position, and the
 * next-season read. Rivals appear only as the facts the screens already print.
 *
 * ⚠ LENGTH IS BUDGETED, NOT HOPED FOR. Chimmy's route rejects a message over 4,000 characters
 * (MAX_MESSAGE_CHARS in app/api/chat/chimmy/route.ts). The brief is held under MAX_PROMPT_CHARS by
 * dropping its least decisive lines first; the closing request is never dropped.
 *
 * Pure. The caller resolves both message catalogs for the viewer's language.
 */

/** Well under the route's 4,000, leaving room for the user to add their own words. */
export const MAX_PROMPT_CHARS = 1_800

type PlanCopy = (typeof warRoomPlanMessages)['en']
type BriefCopy = (typeof warRoomBriefMessages)['en']

export type WarPlanInput = {
  leagueName: string
  card: WarFrontCard | null
  trades: WarTrades | null
  format: FormatBrief | null
  nextSeason: NextSeasonView | null
  /** The road ahead (phase 5). Optional so a caller without it still builds a brief. */
  campaign?: WarCampaign | null
}

/** A line and how readily it is dropped when the brief is too long: higher drops first. */
type Line = { text: string; drop: number }

const p1 = (n: number) => n.toFixed(1)

function orderOf<K extends WarOrder['kind']>(card: WarFrontCard | null, kind: K): Extract<WarOrder, { kind: K }> | null {
  return (card?.orders.find((o) => o.kind === kind) as Extract<WarOrder, { kind: K }> | undefined) ?? null
}

export function warPlanPrompt(input: WarPlanInput, m: PlanCopy, b: BriefCopy, language: string): string {
  const { card, trades, format, nextSeason } = input
  const lines: Line[] = []
  const add = (text: string | null | undefined, drop: number) => {
    if (text) lines.push({ text, drop })
  }

  if (card) {
    add(m.posture(card.posture), 0)
    if (card.odds) add(m.odds(pct(card.odds.playoff), card.odds.bye == null ? null : pct(card.odds.bye), pct(card.odds.title)), 0)
    if (card.record) {
      const r = card.record
      add(
        m.record(
          `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`,
          card.seed != null && card.teams != null ? `${card.seed}/${card.teams}` : null,
          card.weeksRemaining != null ? m.weeksLeft(card.weeksRemaining) : null,
        ),
        3,
      )
    }
    const swing = orderOf(card, 'swing_game')
    if (swing) add(m.swing(swing.week, swing.opponent, pct(swing.ifWin), pct(swing.ifLose)), 1)
    const decides = orderOf(card, 'what_decides')
    if (decides) add(m.decides(seasonOutlookSentence(decides.text, language)), 2)
    const deadline = orderOf(card, 'trade_deadline')
    if (deadline) add(m.deadline(deadline.week, deadline.weeksLeft), 1)
  }

  const campaign = input.campaign ?? null
  if (campaign?.kind === 'games') {
    const big = campaign.games.find((g) => g.biggest)
    // The card's swing order already names next week's game; repeat it only when a later week matters more.
    const swingWeek = orderOf(card, 'swing_game')?.week ?? null
    if (big && big.week !== swingWeek) add(m.biggestGame(big.week, big.opponent.name, pct(big.ifWin), pct(big.ifLose)), 1)
  }
  if (campaign?.tiebreak) {
    const near = campaign.tiebreak.rows
      .filter((r) => !r.isYou && r.name)
      .map((r) => m.tiebreakTeam(r.name!, `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`, signedPts(r.pointsGap)))
    if (near.length > 0) add(m.tiebreak(near.join('; ')), 3)
  }

  if (trades?.mode === 'win_now' && trades.ideas[0]) {
    const i = trades.ideas[0]
    const delta = trades.rankedBy === 'title' ? i.titleDelta : i.playoffDelta
    if (delta != null) add(m.trade(i.send.name, i.receive.name, i.partnerName, signedPts(delta), trades.rankedBy), 1)
  } else if (trades?.mode === 'sell' && trades.ideas[0]?.partners[0]) {
    add(m.sell(trades.ideas[0].player.name, trades.ideas[0].partners[0].name), 1)
  } else if (trades?.mode === 'closed') {
    add(m.deadlinePassed, 2)
  }

  if (format) {
    const ranked = format.scarcity.filter((r) => r.youVsLeague != null)
    const edge = [...ranked].sort((a, b) => b.youVsLeague! - a.youVsLeague!)[0]
    const hole = [...ranked].sort((a, b) => a.youVsLeague! - b.youVsLeague!)[0]
    if (edge && edge.youVsLeague! >= 1) add(m.edge(edge.position, p1(edge.youVsLeague!)), 4)
    if (hole && hole.youVsLeague! <= -1) add(m.hole(hole.position, p1(Math.abs(hole.youVsLeague!))), 2)
    const scarce = format.scarcity[0]
    if (scarce?.gap != null) add(m.scarce(scarce.position, p1(scarce.gap)), 5)
  }

  if (nextSeason?.kind === 'dynasty') add(m.dynasty(b.window(nextSeason.window), b.posture(nextSeason.posture)), 2)
  else if (nextSeason?.kind === 'keeper' && nextSeason.recommended.length > 0) {
    add(m.keepers(nextSeason.recommended.map((k) => k.name).join(', '), nextSeason.maxKeepers), 2)
  }

  const head = m.header(input.leagueName)
  const tail = m.ask
  const build = (ls: Line[]) => [head, ...ls.map((l) => l.text), tail].join('\n')
  // Drop the least decisive lines first until the brief fits; the header and the request always stay.
  let kept = lines
  while (build(kept).length > MAX_PROMPT_CHARS && kept.length > 0) {
    const worst = Math.max(...kept.map((l) => l.drop))
    const idx = kept.map((l) => l.drop).lastIndexOf(worst)
    kept = kept.filter((_, i) => i !== idx)
  }
  return build(kept)
}
