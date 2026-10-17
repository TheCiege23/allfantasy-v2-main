import { computeCareerAwards, TIER_LABEL, type AwardTier } from './careerAwards'
import { nextMark, ordinal } from './careerMilestones'
import type { CareerRow } from './careerModel'
import type { CareerTradeCount } from './careerProfile'

/**
 * Career milestones worth a notification — what a profile rebuild CHANGED, not what it contains.
 *
 * 🛑 ONLY SEASONS THAT JUST FINISHED COUNT. An import that backfills 2019 adds a 2019 title to the
 * profile, and "You won 2019!" pushed to a phone in 2026 is noise at best. So a milestone must be
 * caused by a row that was ALREADY in the previous profile and has now finished (`counted` false →
 * true) or now shows a title it did not before. Rows the previous profile had never seen are
 * history arriving, never news.
 *
 * Awards and win marks are attributed the same way: they are scored on the new rows and on the
 * new rows with ONLY the just-finished seasons reverted, so a tier that a backfill reached does
 * not ride along with a real one.
 *
 * Pure: two profiles in, events out. `careerMilestoneNotify.ts` does the I/O.
 */

export type CareerMilestoneEvent = {
  /** Stable for the life of the account — the dedupe key. */
  key: string
  kind: 'title' | 'award' | 'wins'
  title: string
  body: string
}

export type ProfileSlice = { rows: readonly CareerRow[]; trades: readonly CareerTradeCount[] }

const TIER_RANK: Record<AwardTier, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 }

function countedWins(rows: readonly CareerRow[]): number {
  return rows.filter((r) => r.counted).reduce((n, r) => n + r.wins, 0)
}

export function detectCareerMilestones(prev: ProfileSlice, next: ProfileSlice): CareerMilestoneEvent[] {
  const before = new Map(prev.rows.map((r) => [r.key, r]))
  const finished = next.rows.filter((r) => {
    const was = before.get(r.key)
    if (!was || !r.counted) return false
    return !was.counted || (r.isChampion && !was.isChampion)
  })
  if (finished.length === 0) return []

  const finishedKeys = new Set(finished.map((r) => r.key))
  // The new profile with only the just-finished seasons put back the way they were.
  const reverted = next.rows.map((r) => (finishedKeys.has(r.key) ? (before.get(r.key) as CareerRow) : r))

  const events: CareerMilestoneEvent[] = []

  // 1. Titles, numbered from the rings already on file.
  let rings = reverted.filter((r) => r.counted && r.isChampion).length
  for (const r of finished.filter((x) => x.isChampion).sort((a, b) => a.season - b.season)) {
    rings += 1
    const record = r.wins + r.losses + r.ties > 0 ? ` at ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}` : ''
    events.push({
      key: `title:${r.key}`,
      kind: 'title',
      title: `You won ${r.leagueName}`,
      body: `${r.season} champion${record}. That's the ${ordinal(rings)} title of your career.`,
    })
  }

  // 2. Award tiers the finished seasons — and only they — pushed over a threshold.
  const was = new Map(computeCareerAwards({ rows: reverted, trades: [...next.trades] }).map((a) => [a.key, a]))
  for (const a of computeCareerAwards({ rows: next.rows as CareerRow[], trades: [...next.trades] })) {
    const old = was.get(a.key)
    if (old && TIER_RANK[old.tier] >= TIER_RANK[a.tier]) continue
    events.push({
      key: `award:${a.key}:${a.tier}`,
      kind: 'award',
      title: `New award: ${a.name} ${TIER_LABEL[a.tier]}`,
      body: `${a.evidence}.`,
    })
  }

  // 3. The highest career-wins mark crossed.
  const winsBefore = countedWins(reverted)
  const winsAfter = countedWins(next.rows)
  const { mark } = nextMark(winsBefore)
  if (winsAfter >= mark) {
    let crossed = mark
    while (nextMark(crossed).mark <= winsAfter) crossed = nextMark(crossed).mark
    events.push({
      key: `wins:${crossed}`,
      kind: 'wins',
      title: `${crossed.toLocaleString('en-US')} career wins`,
      body: `You're at ${winsAfter.toLocaleString('en-US')} wins across every finished season you've played.`,
    })
  }

  return events
}
