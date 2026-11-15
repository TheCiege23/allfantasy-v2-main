/**
 * GROWTH & REVENUE — the counting, PURE (owner's call 2026-11-15: "build the growth and revenue page").
 * One admin screen for the whole path a person takes — visit → sign up → bring a league → leaguemates →
 * trial → paid — and which features sell the plan. Every number came from somewhere already (the
 * acquisition and monetization events, the referral weeks, the retention events, MRR); they were
 * scattered across the dashboard, so nobody could see where people drop off.
 *
 * ⚠ STAGES ARE "PEOPLE WHO DID THIS IN THE WINDOW", NOT A COHORT. Someone who signed up last month and
 * paid this week counts in "paid" and not in "signed up". That is the honest reading of an event log and
 * the page says so; a strict cohort would need every person's whole history.
 *
 * Each stage is DISTINCT people: a user who imports four leagues is one import. Visitors are distinct
 * anonymous sessions, because a visitor has no account yet.
 */

export type GrowthEvent = {
  event: string
  userId: string | null
  sessionId: string | null
  createdAt: Date
  meta: Record<string, unknown> | null
}

export type GrowthEventNames = {
  landing: string
  signup: string
  emailVerified: string
  importStarted: string
  importCompleted: string
  trialStarted: string
  checkoutStarted: string
  paid: string
}

export type StageKey = 'visitors' | 'signups' | 'imported' | 'trials' | 'paid'

export type Stage = {
  key: StageKey
  label: string
  count: number
  previous: number
  /** Share of the stage before it, this window. Null for the first stage or an empty one before it. */
  fromPrevious: number | null
}

export type SideFigure = { key: string; label: string; count: number; previous: number }

export type EntrySourceRow = { entrySource: string; checkouts: number; trials: number; paid: number }

export type GrowthSummary = {
  days: number
  funnel: Stage[]
  side: SideFigure[]
  whatSells: EntrySourceRow[]
}

const STAGE_LABELS: Record<StageKey, string> = {
  visitors: 'Visited',
  signups: 'Signed up',
  imported: 'Brought a league',
  trials: 'Started a free trial',
  paid: 'Paid',
}

type Bucket = {
  visitors: Set<string>
  signups: Set<string>
  verified: Set<string>
  importStarted: Set<string>
  imported: Set<string>
  joinedLeaguemates: Set<string>
  trials: Set<string>
  paid: Set<string>
  paidFromTrial: Set<string>
}

const bucket = (): Bucket => ({
  visitors: new Set(),
  signups: new Set(),
  verified: new Set(),
  importStarted: new Set(),
  imported: new Set(),
  joinedLeaguemates: new Set(),
  trials: new Set(),
  paid: new Set(),
  paidFromTrial: new Set(),
})

function entrySourceOf(meta: Record<string, unknown> | null): string {
  const v = meta?.entry_source
  return typeof v === 'string' && v.trim() ? v.trim() : 'unknown'
}

export function rateOf(n: number, d: number): number | null {
  return d > 0 ? n / d : null
}

/** "12%" / "—" */
export function formatRate(r: number | null): string {
  return r === null ? '—' : `${Math.round(r * 100)}%`
}

/** "+3" / "−2" / "same", against the window before. */
export function formatDelta(now: number, before: number): string {
  const d = now - before
  if (d === 0) return 'same'
  return d > 0 ? `+${d.toLocaleString('en-US')}` : `−${Math.abs(d).toLocaleString('en-US')}`
}

/**
 * Sorts events into this window [from, to) and the one before it [prevFrom, from), then counts.
 * `whatSells` is this window only, ordered by people who paid, then checkouts started.
 */
export function summarizeGrowth(
  events: readonly GrowthEvent[],
  names: GrowthEventNames,
  window: { from: Date; to: Date; prevFrom: Date; days: number },
): GrowthSummary {
  const now = bucket()
  const before = bucket()
  const sells = new Map<string, { checkouts: Set<string>; trials: Set<string>; paid: Set<string> }>()
  const sellRow = (k: string) => {
    let r = sells.get(k)
    if (!r) sells.set(k, (r = { checkouts: new Set(), trials: new Set(), paid: new Set() }))
    return r
  }

  for (const e of events) {
    const t = e.createdAt.getTime()
    const b = t >= window.from.getTime() && t < window.to.getTime() ? now : t >= window.prevFrom.getTime() && t < window.from.getTime() ? before : null
    if (!b) continue
    const who = e.userId
    switch (e.event) {
      case names.landing:
        if (e.sessionId) b.visitors.add(e.sessionId)
        break
      case names.signup:
        if (who) b.signups.add(who)
        break
      case names.emailVerified:
        if (who) b.verified.add(who)
        break
      case names.importStarted:
        if (who) b.importStarted.add(who)
        break
      case names.importCompleted:
        if (who) {
          b.imported.add(who)
          if (e.meta?.outcome === 'joined_existing') b.joinedLeaguemates.add(who)
        }
        break
      case names.trialStarted:
        if (who) {
          b.trials.add(who)
          if (b === now) sellRow(entrySourceOf(e.meta)).trials.add(who)
        }
        break
      case names.checkoutStarted:
        if (who && b === now) sellRow(entrySourceOf(e.meta)).checkouts.add(who)
        break
      case names.paid:
        if (who) {
          b.paid.add(who)
          if (e.meta?.from_trial === true) b.paidFromTrial.add(who)
          if (b === now) sellRow(entrySourceOf(e.meta)).paid.add(who)
        }
        break
    }
  }

  const order: StageKey[] = ['visitors', 'signups', 'imported', 'trials', 'paid']
  const funnel: Stage[] = order.map((key, i) => {
    const count = now[key].size
    const prevStage = i > 0 ? now[order[i - 1]!].size : 0
    return { key, label: STAGE_LABELS[key], count, previous: before[key].size, fromPrevious: i > 0 ? rateOf(count, prevStage) : null }
  })

  const side: SideFigure[] = [
    { key: 'verified', label: 'Confirmed their email', count: now.verified.size, previous: before.verified.size },
    { key: 'importStarted', label: 'Started an import', count: now.importStarted.size, previous: before.importStarted.size },
    { key: 'joinedLeaguemates', label: 'Joined a league a leaguemate brought', count: now.joinedLeaguemates.size, previous: before.joinedLeaguemates.size },
    { key: 'paidFromTrial', label: 'Paid after a free trial', count: now.paidFromTrial.size, previous: before.paidFromTrial.size },
  ]

  const whatSells: EntrySourceRow[] = [...sells.entries()]
    .map(([entrySource, r]) => ({ entrySource, checkouts: r.checkouts.size, trials: r.trials.size, paid: r.paid.size }))
    .sort((a, b) => b.paid - a.paid || b.checkouts - a.checkouts || a.entrySource.localeCompare(b.entrySource))

  return { days: window.days, funnel, side, whatSells }
}

/** "lock_player_depth" → "Player depth lock", for the few sources we know; the raw tag otherwise. */
export function entrySourceLabel(source: string): string {
  if (source === 'unknown') return 'Not tagged yet'
  const lock = /^lock_(.+)$/.exec(source)
  if (lock) return `${lock[1]!.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())} lock`
  const known: Record<string, string> = {
    ai_daily_cap: 'Daily AI limit reached',
    ai_not_entitled: 'AI feature not in plan',
    referral_week_ending: 'Free referral week ending',
    win_back: 'Win-back email',
  }
  return known[source] ?? source.replace(/[_-]+/g, ' ')
}
