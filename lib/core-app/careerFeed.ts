import { leagueSyncAttentionSignals } from '@/lib/decision-os/careerSignals'
import { platformLabel, type CareerWireData, type WireChange } from './careerWireModel'

/**
 * Career feed — "since your last visit", turned into things to do. The pure half: every item is a
 * reading of rows the Career Wire ALREADY holds, so it can never disagree with the cards around it,
 * and it is testable without a database.
 *
 * Two sources, and one action each:
 *
 *   - a league whose sync is failing, gone or never ran   → Sync      (fix the data first)
 *   - a loss or a standings drop since the last visit     → My Team   (set the lineup)
 *   - a win or a climb since the last visit               → Matchup   (the next one)
 *
 * ⚠ THE SYNC ITEMS ARE DECISION OS'S OWN SIGNALS, NOT A SECOND READING OF THEM.
 * `leagueSyncAttentionSignals` is what the Manager Hub's command center uses
 * (`lib/decision-os/careerSignals.ts`), so the wording and the severity cut are the same on both
 * screens.
 *
 * ⚠ NO STAKES (removed 2026-10-01). The feed briefly also carried "a title here would be ring #N",
 * from the same stakes the overview's "In play" card (`LegacyStakes`) renders — so with three live
 * title chances a phone showed six near-identical cards (peer review, measured). The "In play" card
 * keeps them, with its own Chimmy prompt; the feed is what CHANGED.
 *
 * ⚠ NO INJURIES, NO TRADES. The Core home's brief already reports those, and the Career visit
 * marker deliberately leaves the injury snapshot empty (`careerWire.ts`). Adding them here would
 * mean two screens disagreeing about what is new.
 */

export type CareerFeedKind = 'sync' | 'result'
export type CareerFeedTone = 'warn' | 'bad' | 'good'

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
const KIND_ORDER: Record<CareerFeedTone, number> = { warn: 0, bad: 1, good: 2 }

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

export function buildCareerFeed(input: { wire: CareerWireData; now: Date }): CareerFeedItem[] {
  const { wire, now } = input
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

  // Stable within a tone: changes arrive ordered by games played.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => KIND_ORDER[a.item.tone] - KIND_ORDER[b.item.tone] || a.i - b.i)
    .map(({ item }) => item)
}
