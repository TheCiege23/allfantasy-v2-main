import { leagueSyncAttentionSignals, resolveStakeLeagueId } from '@/lib/decision-os/careerSignals'
import type { LegacyStake } from './careerMilestones'
import { platformLabel, type CareerWireData, type WireChange } from './careerWireModel'

/**
 * Career feed — "since your last visit", turned into things to do. The pure half: every item is a
 * reading of rows the Career Wire and the Career screen ALREADY hold, so it can never disagree with
 * the cards around it, and it is testable without a database.
 *
 * Three sources, and one action each:
 *
 *   - a league whose sync is failing, gone or never ran   → Sync      (fix the data first)
 *   - a loss or a standings drop since the last visit     → My Team   (set the lineup)
 *   - a live league that would be a career ring           → Matchup   (the game that decides it)
 *   - a win or a climb since the last visit               → Matchup   (the next one)
 *
 * ⚠ THE SYNC AND STAKE ITEMS ARE DECISION OS'S OWN SIGNALS, NOT A SECOND READING OF THEM.
 * `leagueSyncAttentionSignals` and `resolveStakeLeagueId` are what the Manager Hub's command center
 * uses (`lib/decision-os/careerSignals.ts`), so the wording, the severity cut and the stake→league
 * match are the same on both screens. A stake that does not resolve to exactly one league is dropped
 * there and here — an item with no league has nowhere to send you.
 *
 * ⚠ NO INJURIES, NO TRADES. The Core home's brief already reports those, and the Career visit
 * marker deliberately leaves the injury snapshot empty (`careerWire.ts`). Adding them here would
 * mean two screens disagreeing about what is new.
 */

export type CareerFeedKind = 'sync' | 'result' | 'stake'
export type CareerFeedTone = 'warn' | 'bad' | 'good' | 'stake'

export type CareerFeedItem = {
  key: string
  kind: CareerFeedKind
  tone: CareerFeedTone
  leagueId: string
  leagueName: string
  /** Display label — "Sleeper", "AllFantasy". */
  platform: string
  title: string
  detail: string
  action: { label: string; href: string }
  /** An unsent Chimmy question. Null where Chimmy has nothing to add (a broken sync). */
  ask: string | null
}

const leagueParam = (leagueId: string) => `?league=${encodeURIComponent(leagueId)}`
export const feedHref = {
  sync: (leagueId: string) => `/core/sync${leagueParam(leagueId)}`,
  myTeam: (leagueId: string) => `/core/my-team${leagueParam(leagueId)}`,
  matchup: (leagueId: string) => `/core/matchup${leagueParam(leagueId)}`,
}

/** Problems first, then what you can still change, then good news. */
const KIND_ORDER: Record<CareerFeedTone, number> = { warn: 0, bad: 1, stake: 2, good: 3 }

function recordText(w: number, l: number, t: number): string {
  return `${w}-${l}${t ? `-${t}` : ''}`
}

function rankMove(c: WireChange): number {
  return c.rank != null && c.previousRank != null ? c.previousRank - c.rank : 0
}

function resultItem(c: WireChange): CareerFeedItem | null {
  const played = c.won + c.lost + c.tied > 0
  const move = rankMove(c)
  if (!played && move === 0) return null

  // The standings move is the headline when there is one: a loss that still climbed is good news.
  const bad = move < 0 || (move === 0 && c.lost > c.won)
  const parts: string[] = []
  if (played) parts.push(`Went ${recordText(c.won, c.lost, c.tied)}`)
  parts.push(`now ${recordText(c.wins, c.losses, c.ties)}`)
  if (move !== 0) parts.push(`${move > 0 ? 'up' : 'down'} to #${c.rank} (was #${c.previousRank})`)
  else if (c.rank != null) parts.push(`#${c.rank}`)

  return {
    key: `result:${c.leagueId}`,
    kind: 'result',
    tone: bad ? 'bad' : 'good',
    leagueId: c.leagueId,
    leagueName: c.leagueName,
    platform: platformLabel(c.platform),
    title:
      move < 0
        ? `Slipped to #${c.rank}`
        : move > 0
          ? `Climbed to #${c.rank}`
          : c.won > c.lost
            ? `Won ${recordText(c.won, c.lost, c.tied)}`
            : c.lost > c.won
              ? `Dropped ${recordText(c.won, c.lost, c.tied)}`
              : `Went ${recordText(c.won, c.lost, c.tied)}`,
    detail: parts.join(', '),
    action: bad
      ? { label: 'Set lineup', href: feedHref.myTeam(c.leagueId) }
      : { label: 'Next matchup', href: feedHref.matchup(c.leagueId) },
    ask: c.ask,
  }
}

export function buildCareerFeed(input: {
  wire: CareerWireData
  /** The Career screen's live stakes (`buildLegacyStakes(...).stakes`). Empty under a filter. */
  stakes: readonly LegacyStake[]
  now: Date
}): CareerFeedItem[] {
  const { wire, stakes, now } = input
  const byId = new Map(wire.leagues.map((l) => [l.leagueId, l]))
  const items: CareerFeedItem[] = []

  for (const s of leagueSyncAttentionSignals(wire.leagues, now)) {
    const l = byId.get(s.leagueId)
    if (!l) continue
    items.push({
      key: `sync:${s.leagueId}`,
      kind: 'sync',
      tone: 'warn',
      leagueId: s.leagueId,
      leagueName: l.leagueName,
      platform: platformLabel(l.platform),
      title: s.title,
      detail: s.explanation,
      action: { label: l.status === 'gone' ? 'Open Sync' : 'Re-sync', href: feedHref.sync(s.leagueId) },
      ask: null,
    })
  }

  for (const c of wire.changes) {
    const item = resultItem(c)
    if (item) items.push(item)
  }

  for (const stake of stakes) {
    const leagueId = resolveStakeLeagueId(stake, wire.leagues)
    if (!leagueId) continue
    items.push({
      key: `stake:${leagueId}:${stake.ringNumber}`,
      kind: 'stake',
      tone: 'stake',
      leagueId,
      leagueName: byId.get(leagueId)?.leagueName ?? stake.leagueName,
      platform: platformLabel(byId.get(leagueId)?.platform ?? String(stake.platform).toLowerCase()),
      title: stake.tone === 'streak' ? `A repeat would be ring #${stake.ringNumber}` : `A title would be ring #${stake.ringNumber}`,
      detail: stake.detail,
      action: { label: 'Open matchup', href: feedHref.matchup(leagueId) },
      ask: stake.ask,
    })
  }

  // Stable within a tone: the sources are already ordered (changes by games played, stakes as the card shows them).
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => KIND_ORDER[a.item.tone] - KIND_ORDER[b.item.tone] || a.i - b.i)
    .map(({ item }) => item)
}
