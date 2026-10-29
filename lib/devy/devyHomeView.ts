/**
 * Pure shaping for the Devy league home (specialty handoff: devy/DevyHome). No I/O — the summary
 * route reads `DevyRights` + `DevyPlayer` + `DevyLifecycleEvent` and hands the rows here.
 *
 * Lifecycle states come from `DEVY_LIFECYCLE_STATE`; nothing here invents a state or a value.
 */
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'

export type DevyStashRightRow = {
  id: string
  devyPlayerId: string
  state: string
  slotCategory?: string | null
  promotedProPlayerId?: string | null
}

export type DevyStashPlayerRow = {
  id: string
  name: string
  position: string
  school: string
  classYear?: number | null
  draftEligibleYear?: number | null
  draftProjectionScore?: number | null
  devyValue?: number | null
}

export type DevyStashItem = {
  rightsId: string
  devyPlayerId: string
  name: string
  position: string
  school: string
  /** "Fr" / "So" / "Jr" / "Sr" from `classYear` (1–4+), null when unknown. */
  classLabel: string | null
  draftEligibleYear: number | null
  state: string
  /** Declared, drafted or promotion-eligible: the player is leaving school. */
  declared: boolean
  /** 0–100, the AF production/projection bar. Null when the player has no score. */
  production: number | null
  promotionEligible: boolean
  promotedProPlayerId: string | null
}

/** States that still sit in the devy stash (not promoted, not expired or orphaned). */
const STASH_STATES = new Set<string>([
  DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE,
  DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI,
  DEVY_LIFECYCLE_STATE.NCAA_DEVY_LOCKED,
  DEVY_LIFECYCLE_STATE.DECLARED,
  DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD,
  DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE,
  // "Return to school" keeps the player in the stash (handoff README).
  DEVY_LIFECYCLE_STATE.RETURNED_TO_SCHOOL,
])

const LEAVING_STATES = new Set<string>([
  DEVY_LIFECYCLE_STATE.DECLARED,
  DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD,
  DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE,
])

export function devyClassLabel(classYear: number | null | undefined): string | null {
  if (classYear == null || !Number.isFinite(classYear)) return null
  if (classYear <= 1) return 'Fr'
  if (classYear === 2) return 'So'
  if (classYear === 3) return 'Jr'
  return 'Sr'
}

/**
 * The bar value: `draftProjectionScore` when present (already 0–100), else `devyValue` scaled
 * against the best value in the same stash. Null when neither exists — the UI then shows no bar
 * rather than an empty one that reads as "zero".
 */
function productionScores(players: DevyStashPlayerRow[]): Map<string, number | null> {
  const maxValue = Math.max(0, ...players.map((p) => (typeof p.devyValue === 'number' ? p.devyValue : 0)))
  const out = new Map<string, number | null>()
  for (const p of players) {
    if (typeof p.draftProjectionScore === 'number' && Number.isFinite(p.draftProjectionScore)) {
      out.set(p.id, Math.max(0, Math.min(100, Math.round(p.draftProjectionScore))))
    } else if (typeof p.devyValue === 'number' && p.devyValue > 0 && maxValue > 0) {
      out.set(p.id, Math.round((p.devyValue / maxValue) * 100))
    } else {
      out.set(p.id, null)
    }
  }
  return out
}

export function buildDevyStash(rights: DevyStashRightRow[], players: DevyStashPlayerRow[]): DevyStashItem[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const scores = productionScores(players)
  const items: DevyStashItem[] = []
  for (const r of rights) {
    if (!STASH_STATES.has(r.state)) continue
    const p = byId.get(r.devyPlayerId)
    if (!p) continue
    items.push({
      rightsId: r.id,
      devyPlayerId: r.devyPlayerId,
      name: p.name,
      position: p.position,
      school: p.school,
      classLabel: devyClassLabel(p.classYear),
      draftEligibleYear: p.draftEligibleYear ?? null,
      state: r.state,
      declared: LEAVING_STATES.has(r.state),
      production: scores.get(p.id) ?? null,
      promotionEligible: r.state === DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE,
      promotedProPlayerId: r.promotedProPlayerId ?? null,
    })
  }
  // Leaving players first, then by draft year, then production.
  return items.sort((a, b) => {
    if (a.declared !== b.declared) return a.declared ? -1 : 1
    const ya = a.draftEligibleYear ?? 9999
    const yb = b.draftEligibleYear ?? 9999
    if (ya !== yb) return ya - yb
    return (b.production ?? -1) - (a.production ?? -1)
  })
}

/** Players expected to turn pro per draft year (declared players count toward the current year). */
export function devyPipelineByYear(stash: DevyStashItem[], seasonYear: number): { year: number; count: number }[] {
  const counts = new Map<number, number>()
  for (const s of stash) {
    const y = s.declared ? Math.max(seasonYear, s.draftEligibleYear ?? seasonYear) : s.draftEligibleYear
    if (y == null) continue
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }))
}

/** The year tag the stash row shows: "Declared", or the draft-eligible year. */
export function devyYearTag(item: Pick<DevyStashItem, 'declared' | 'draftEligibleYear'>): string {
  if (item.declared) return 'Declared'
  return item.draftEligibleYear != null ? String(item.draftEligibleYear) : 'TBD'
}

export type DevyFeedEventRow = {
  id: string
  eventType: string
  devyPlayerId: string | null
  createdAt: Date | string
}

const EVENT_COPY: Record<string, string> = {
  declare_detected: 'declared for the draft',
  promotion: 'was promoted to a pro roster',
  force_promote: 'was promoted by the commissioner',
  revoke_promotion: 'had a promotion reversed',
  return_to_school: 'returned to school',
  rights_expired: 'rights expired',
  pool_assignment: 'joined the devy pool',
  commissioner_override: 'had a commissioner change',
}

/** Feed lines for the rail. Unknown event types are skipped rather than shown raw. */
export function devyFeedItems(
  events: DevyFeedEventRow[],
  nameOf: (devyPlayerId: string) => string | null,
): { id: string; kind: string; title: string; at: string }[] {
  const out: { id: string; kind: string; title: string; at: string }[] = []
  for (const e of events) {
    const copy = EVENT_COPY[e.eventType]
    if (!copy) continue
    const who = e.devyPlayerId ? nameOf(e.devyPlayerId) : null
    out.push({
      id: e.id,
      kind: e.eventType,
      title: who ? `${who} ${copy}` : `A player ${copy}`,
      at: new Date(e.createdAt).toISOString(),
    })
  }
  return out
}
