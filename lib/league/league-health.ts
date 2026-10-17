/**
 * The commissioner's "League health" panel after the draft: what needs attention, each with the
 * place that fixes it. Pure — the panel fetches existing READ-ONLY endpoints and passes payloads in.
 *
 * Deliberately not used, because their GET writes to the database: finance/summary
 * (getOrCreateLeagueFinance), integrity (upserts its settings row), core/commissioner-queue
 * (reconciles stored tasks) and ai-commissioner (ensureAICommissionerConfig). A dashboard that
 * writes on every page view is not a read.
 */
import { OVERDUE_CLAIM_DAYS } from '@/lib/core-app/commissioner/signals'

export type HealthAction = { kind: 'settings'; panel: string } | { kind: 'tab'; tab: string }

export type HealthItem = {
  id: 'settings' | 'seats' | 'dues' | 'trades_review' | 'trades_vote' | 'waivers_overdue'
  tone: 'danger' | 'warn'
  title: string
  detail: string
  action: HealthAction
  cta: string
}

export type SetupStepLite = { id: string; label: string; done: boolean; optional?: boolean; panel?: string | null }
export type DuesPayload = {
  config?: { enabled?: boolean; entries?: { teamId: string; paid?: boolean; paidSeasons?: number[] }[] } | null
  teams?: { id: string; teamName?: string | null }[]
  currentSeason?: number | null
  isMultiSeason?: boolean
}
export type TradeLite = { status?: string | null }
export type ClaimLite = { createdAt?: string | Date | null }

/** Settings that still matter after the draft. Draft-only steps (format, order, date, room) do not. */
const SETTINGS_STEPS = new Set(['rules', 'scoring'])

export function unpaidTeams(dues: DuesPayload | null | undefined): { id: string; name: string }[] {
  if (!dues?.config?.enabled) return []
  const entries = new Map((dues.config.entries ?? []).map((e) => [e.teamId, e]))
  const season = dues.currentSeason ?? null
  return (dues.teams ?? [])
    .filter((team) => {
      const entry = entries.get(team.id)
      if (!entry) return true
      // Dynasty / keeper / C2C / devy pay per season; a past season's payment does not cover this one.
      if (dues.isMultiSeason && season != null) return !(entry.paidSeasons ?? []).includes(season)
      return !entry.paid
    })
    .map((team) => ({ id: team.id, name: team.teamName?.trim() || 'A team' }))
}

export function overdueClaims(claims: ClaimLite[] | null | undefined, now: string): number {
  const cutoff = new Date(now).getTime() - OVERDUE_CLAIM_DAYS * 24 * 60 * 60 * 1000
  return (claims ?? []).filter((claim) => {
    const at = claim.createdAt ? new Date(claim.createdAt).getTime() : NaN
    return Number.isFinite(at) && at < cutoff
  }).length
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function buildLeagueHealth(input: {
  steps?: SetupStepLite[] | null
  claimedSeats: number
  teamCount: number
  dues?: DuesPayload | null
  trades?: TradeLite[] | null
  waiverClaims?: ClaimLite[] | null
  now: string
}): HealthItem[] {
  const items: HealthItem[] = []

  const unfinished = (input.steps ?? []).filter((s) => SETTINGS_STEPS.has(s.id) && !s.done && !s.optional)
  if (unfinished.length) {
    items.push({
      id: 'settings',
      tone: 'danger',
      title: 'Finish league settings',
      detail: unfinished.map((s) => s.label).join(', '),
      action: { kind: 'settings', panel: unfinished[0].panel || 'general-info' },
      cta: 'Open settings',
    })
  }

  const open = Math.max(0, input.teamCount - input.claimedSeats)
  if (open > 0) {
    items.push({
      id: 'seats',
      tone: 'warn',
      title: `${plural(open, 'seat', 'seats')} still open`,
      detail: 'Send the invite link so someone can claim each open team.',
      action: { kind: 'settings', panel: 'invite' },
      cta: 'Invite managers',
    })
  }

  const unpaid = unpaidTeams(input.dues)
  if (unpaid.length) {
    items.push({
      id: 'dues',
      tone: 'warn',
      title: `${plural(unpaid.length, "team hasn't", "teams haven't")} paid dues`,
      detail: unpaid.slice(0, 3).map((t) => t.name).join(', ') + (unpaid.length > 3 ? ` +${unpaid.length - 3} more` : ''),
      action: { kind: 'settings', panel: 'league-dues' },
      cta: 'Open dues',
    })
  }

  const review = (input.trades ?? []).filter((t) => t.status === 'awaiting_commissioner').length
  if (review) {
    items.push({
      id: 'trades_review',
      tone: 'danger',
      title: `${plural(review, 'trade needs', 'trades need')} your review`,
      detail: 'Both managers accepted. Approve or veto to finish it.',
      action: { kind: 'tab', tab: 'trades' },
      cta: 'Review trades',
    })
  }
  const voting = (input.trades ?? []).filter((t) => t.status === 'awaiting_votes').length
  if (voting) {
    items.push({
      id: 'trades_vote',
      tone: 'warn',
      title: `${plural(voting, 'trade is', 'trades are')} in a league vote`,
      detail: 'Managers are voting on it now.',
      action: { kind: 'tab', tab: 'trades' },
      cta: 'See trades',
    })
  }

  const overdue = overdueClaims(input.waiverClaims, input.now)
  if (overdue) {
    items.push({
      id: 'waivers_overdue',
      tone: 'danger',
      title: `${plural(overdue, 'waiver claim', 'waiver claims')} stuck`,
      detail: `Pending more than ${OVERDUE_CLAIM_DAYS} days. Check that waivers are processing.`,
      action: { kind: 'tab', tab: 'waivers' },
      cta: 'Open waivers',
    })
  }

  return items
}
