import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { ManagerDnaProfile } from '@/lib/decision-os/phase6/dna/types'

export type LeaguePulseStatus = 'healthy' | 'watch' | 'at-risk' | 'insufficient-data'
export type LeaguePulseTone = 'positive' | 'warning' | 'danger' | 'neutral'

export type LeaguePulseEvidence = {
  label: string
  value: string
  detail?: string
}

export type LeaguePulseMetric = {
  label: string
  value: string
  tone: LeaguePulseTone
}

export type LeaguePulseAction = {
  label: string
  href?: string
  detail: string
}

export type LeaguePulseViewModel = {
  id: string
  title: string
  eyebrow: string
  status: LeaguePulseStatus
  statusLabel: string
  headline: string
  summary: string
  why: string
  confidence: number
  confidenceLabel: 'High' | 'Medium' | 'Low'
  evidence: LeaguePulseEvidence[]
  derivation: string[]
  metrics: LeaguePulseMetric[]
  nextAction: LeaguePulseAction
  lastUpdatedIso: string
  insufficientData?: {
    title: string
    message: string
    missing: string[]
  }
}

export type LeaguePulseLeagueInput = {
  id: string
  name?: string | null
  sport?: string | null
  format?: string | null
  platform?: string | null
  teamCount?: number | null
  status?: string | null
  lifecycleState?: string | null
  currentWeek?: number | null
  draftDate?: string | Date | null
  importedAt?: string | Date | null
  isCommissioner?: boolean | null
}

export type LeaguePulseTeamInput = {
  id: string
  teamName?: string | null
  ownerName?: string | null
  isOrphan?: boolean | null
  claimedByUserId?: string | null
  platformUserId?: string | null
  wins?: number | null
  losses?: number | null
  ties?: number | null
  pointsFor?: number | null
  faabRemaining?: number | null
  waiverPriority?: number | null
}

type BuildDashboardLeaguePulseInput = {
  connectedLeagues: LeaguePulseLeagueInput[]
  entryCount?: number
  /**
   * Optional real Phase 6.2 Manager DNA for the selected league (Phase 8.3
   * dashboard unification). Surfaced as an extra evidence row only — never
   * re-derived. Omitted or null preserves the exact prior evidence/derivation
   * output (same additive pattern as buildLeagueHomePulse/buildCommissionerLeaguePulse).
   */
  managerDna?: ManagerDnaProfile | null
  now?: Date
}

type BuildLeagueHomePulseInput = {
  league: LeaguePulseLeagueInput
  teams: LeaguePulseTeamInput[]
  isCommissioner?: boolean
  /**
   * Optional real Phase 6.2 Manager DNA for the viewing manager, when already
   * resolved elsewhere (Phase 8.1 pipeline unification). League Pulse SURFACES
   * this as an extra evidence row rather than re-deriving manager behavior
   * itself — no duplicated calculation. Omitted or null preserves the exact
   * prior evidence/derivation output (backward compatible, deterministic).
   */
  managerDna?: ManagerDnaProfile | null
  now?: Date
}

type BuildCommissionerLeaguePulseInput = {
  snapshots: CommissionerLeagueHealthSnapshot[]
  /**
   * Optional real Phase 6.2 Manager DNA for the commissioner's own manager
   * profile in their representative league (Phase 8.2 pipeline unification).
   * Surfaced as an extra evidence row only — never re-derived. Omitted or
   * null preserves the exact prior evidence/derivation output.
   */
  managerDna?: ManagerDnaProfile | null
  now?: Date
}

const DEFAULT_NOW = () => new Date()

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function confidenceLabel(confidence: number): LeaguePulseViewModel['confidenceLabel'] {
  if (confidence >= 80) return 'High'
  if (confidence >= 55) return 'Medium'
  return 'Low'
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

function statusFromScore(score: number): Pick<LeaguePulseViewModel, 'status' | 'statusLabel'> {
  if (score >= 75) return { status: 'healthy', statusLabel: 'Healthy' }
  if (score >= 50) return { status: 'watch', statusLabel: 'Watch' }
  return { status: 'at-risk', statusLabel: 'At risk' }
}

function emptyPulse(now: Date, title: string, nextHref: string): LeaguePulseViewModel {
  return {
    id: 'league-pulse-empty',
    title,
    eyebrow: 'Fantasy OS',
    status: 'insufficient-data',
    statusLabel: 'Insufficient data',
    headline: 'League Pulse needs live league data.',
    summary: 'Connect or open a league so Fantasy OS can summarize health, activity, and recommended next actions.',
    why: 'No supported league state was available for deterministic analysis.',
    confidence: 32,
    confidenceLabel: 'Low',
    evidence: [{ label: 'League data', value: 'Not available' }],
    derivation: ['Checked available league inputs', 'Stopped before making unsupported claims'],
    metrics: [
      { label: 'Evidence', value: '0 sources', tone: 'neutral' },
      { label: 'Unsupported claims', value: 'None', tone: 'positive' },
      { label: 'Actionability', value: 'Setup required', tone: 'warning' },
    ],
    nextAction: {
      label: 'Connect a league',
      href: nextHref,
      detail: 'Import or create a league to unlock grounded recommendations.',
    },
    lastUpdatedIso: now.toISOString(),
    insufficientData: {
      title: 'Not enough signal yet',
      message: 'League Pulse is intentionally quiet until it has real league evidence.',
      missing: ['Connected league', 'Team state', 'Activity data'],
    },
  }
}

export function buildDashboardLeaguePulse({
  connectedLeagues,
  entryCount = 0,
  managerDna = null,
  now = DEFAULT_NOW(),
}: BuildDashboardLeaguePulseInput): LeaguePulseViewModel {
  if (connectedLeagues.length === 0) {
    return emptyPulse(now, 'League Pulse', '/import?returnTo=/dashboard')
  }

  const commissionerLeagues = connectedLeagues.filter((league) => league.isCommissioner)
  const activeLeagues = connectedLeagues.filter((league) => {
    const state = String(league.lifecycleState ?? league.status ?? '').toLowerCase()
    return ['in_season', 'active', 'playoffs', 'drafting'].includes(state)
  })
  const sports = new Set(connectedLeagues.map((league) => league.sport).filter(Boolean))
  const missingDraftDates = connectedLeagues.filter((league) => {
    const state = String(league.lifecycleState ?? league.status ?? '').toLowerCase()
    return state === 'pre_draft' && !league.draftDate
  })
  const score = clamp(
    58 +
      Math.min(18, connectedLeagues.length * 4) +
      Math.min(10, activeLeagues.length * 3) +
      Math.min(8, commissionerLeagues.length * 2) -
      missingDraftDates.length * 8,
  )
  const status = statusFromScore(score)
  const evidence: LeaguePulseEvidence[] = [
    { label: 'Connected leagues', value: String(connectedLeagues.length) },
    { label: 'Commissioner leagues', value: String(commissionerLeagues.length) },
    { label: 'Sports represented', value: String(sports.size || 1) },
    { label: 'Tracked entries', value: String(entryCount) },
  ]
  // Confidence is computed from the base evidence set BEFORE the optional Manager DNA row is
  // appended below, so adding real intelligence never changes this deterministic score.
  const confidence = clamp(56 + evidence.length * 7 + Math.min(10, connectedLeagues.length * 2))
  const hasRealManagerDna = Boolean(managerDna && managerDna.primaryIdentity !== 'unknown' && managerDna.confidence > 0)
  if (hasRealManagerDna && managerDna) {
    evidence.push({
      label: 'Manager engagement',
      value: `${Math.round(managerDna.confidence * 100)}% confidence`,
      detail: `Decision Intelligence identity: ${managerDna.primaryIdentity.replace(/_/g, ' ')}`,
    })
  }

  return {
    id: 'league-pulse-dashboard',
    title: 'League Pulse',
    eyebrow: 'Fantasy OS',
    ...status,
    headline:
      missingDraftDates.length > 0
        ? `${formatCount(missingDraftDates.length, 'league')} need draft setup attention.`
        : connectedLeagues.length === 1
          ? 'Your league hub is ready for active monitoring.'
          : `${formatCount(connectedLeagues.length, 'league')} are ready for active monitoring.`,
    summary:
      'Fantasy OS is grounding this dashboard in connected league state, commissioner ownership, and tracked activity.',
    why:
      missingDraftDates.length > 0
        ? 'Pre-draft leagues without draft dates reduce launch confidence.'
        : 'The dashboard has enough connected league evidence to summarize where your attention should go next.',
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    derivation: [
      'Counted connected leagues and commissioner-owned leagues',
      'Checked lifecycle states for active and pre-draft setup signals',
      'Avoided activity claims that are not present in dashboard data',
      ...(hasRealManagerDna ? ['Included the real Phase 6 Manager DNA signal already resolved for this viewer'] : []),
    ],
    metrics: [
      { label: 'Health', value: `${score}%`, tone: score >= 75 ? 'positive' : 'warning' },
      { label: 'Active', value: String(activeLeagues.length), tone: activeLeagues.length ? 'positive' : 'neutral' },
      {
        label: 'Setup risks',
        value: String(missingDraftDates.length),
        tone: missingDraftDates.length ? 'warning' : 'positive',
      },
    ],
    nextAction:
      commissionerLeagues.length > 0
        ? {
            label: 'Open Commissioner Hub',
            href: '/commissioner-hub',
            detail: 'Review health, activity, and recommended commissioner actions.',
          }
        : {
            label: 'Open a league',
            href: connectedLeagues[0]?.id ? `/league/${connectedLeagues[0].id}` : '/dashboard',
            detail: 'Open the league hub for matchup, roster, and activity context.',
          },
    lastUpdatedIso: now.toISOString(),
  }
}

export function buildLeagueHomePulse({
  league,
  teams,
  isCommissioner = false,
  managerDna = null,
  now = DEFAULT_NOW(),
}: BuildLeagueHomePulseInput): LeaguePulseViewModel {
  if (!league.id || teams.length === 0) {
    const pulse = emptyPulse(now, 'League Pulse', `/league/${league.id || ''}/settings`)
    return {
      ...pulse,
      id: 'league-pulse-league-empty',
      headline: 'League Pulse needs team data before it can call the league health.',
      nextAction: {
        label: isCommissioner ? 'Review league setup' : 'Check league setup',
        href: league.id ? `/league/${league.id}/settings` : undefined,
        detail: 'Team and roster state are required before Fantasy OS can summarize this league.',
      },
    }
  }

  // A team carrying an imported platformUserId (e.g. copied from Sleeper at import time) is not
  // the same as a real AllFantasy user having claimed it — claimedByUserId is the only signal that
  // reflects a real person behind a roster. When literally no team has been claimed, there is no
  // behavioral signal to score at all, so say so honestly instead of computing a flattering default.
  const hasAnyClaimedTeam = teams.some((team) => Boolean(team.claimedByUserId))
  if (!hasAnyClaimedTeam) {
    const pulse = emptyPulse(now, 'League Pulse', `/league/${league.id}/settings`)
    return {
      ...pulse,
      id: `league-pulse-${league.id}-unclaimed`,
      headline: 'League Pulse needs at least one claimed team before it can call this league’s health.',
      why: 'No team in this league has been claimed by a real AllFantasy user yet, so a health score would not reflect real activity.',
      nextAction: {
        label: isCommissioner ? 'Invite managers to claim teams' : 'Claim your team',
        href: `/league/${league.id}/settings`,
        detail: 'Team ownership must be confirmed before Fantasy OS can summarize real league health.',
      },
      // LeaguePulseCard's insufficient-data panel renders THESE fields (not headline/why),
      // so the on-screen copy must name the actual missing signal.
      insufficientData: {
        title: 'No claimed teams yet',
        message:
          'No team in this league has been claimed by a real AllFantasy user, so League Pulse will not call this league’s health.',
        missing: ['At least one claimed team'],
      },
    }
  }

  const expectedTeams = Math.max(league.teamCount ?? teams.length, teams.length)
  const orphanTeams = teams.filter((team) => team.isOrphan || (!team.claimedByUserId && !team.platformUserId))
  const scoredTeams = teams.filter((team) => typeof team.pointsFor === 'number')
  const points = scoredTeams.map((team) => Number(team.pointsFor))
  const pointSpread = points.length >= 2 ? Math.max(...points) - Math.min(...points) : null
  const state = String(league.lifecycleState ?? league.status ?? '').toLowerCase()
  const missingDraftDate = state === 'pre_draft' && !league.draftDate
  const claimedRatio = expectedTeams > 0 ? (expectedTeams - orphanTeams.length) / expectedTeams : 0
  const balancePenalty = pointSpread == null ? 0 : pointSpread > 250 ? 10 : pointSpread > 150 ? 5 : 0
  const setupPenalty = orphanTeams.length * 8 + (missingDraftDate ? 12 : 0)
  const score = clamp(70 + claimedRatio * 18 - setupPenalty - balancePenalty)
  const status = statusFromScore(score)
  const confidence = clamp(52 + Math.min(18, teams.length * 3) + (scoredTeams.length >= 2 ? 12 : 0))
  const evidence: LeaguePulseEvidence[] = [
    { label: 'Teams checked', value: `${teams.length}/${expectedTeams}` },
    { label: 'Open manager slots', value: String(orphanTeams.length) },
    { label: 'League state', value: league.lifecycleState ?? league.status ?? 'Unknown' },
  ]
  if (pointSpread != null) {
    evidence.push({ label: 'Points spread', value: pointSpread.toFixed(1), detail: 'Based on current points-for range' })
  }
  const hasRealManagerDna = Boolean(managerDna && managerDna.primaryIdentity !== 'unknown' && managerDna.confidence > 0)
  if (hasRealManagerDna && managerDna) {
    evidence.push({
      label: 'Manager engagement',
      value: `${Math.round(managerDna.confidence * 100)}% confidence`,
      detail: `Decision Intelligence identity: ${managerDna.primaryIdentity.replace(/_/g, ' ')}`,
    })
  }

  return {
    id: `league-pulse-${league.id}`,
    title: 'League Pulse',
    eyebrow: 'Fantasy OS',
    ...status,
    headline:
      orphanTeams.length > 0
        ? `${formatCount(orphanTeams.length, 'manager slot')} need attention.`
        : missingDraftDate
          ? 'Draft setup is the next launch blocker.'
          : 'This league has enough signal for active monitoring.',
    summary:
      'League Pulse is reading team ownership, league state, and competitive balance signals without adding AI guesses.',
    why:
      orphanTeams.length > 0
        ? 'Unclaimed or orphan teams reduce engagement and commissioner confidence.'
        : pointSpread != null && pointSpread > 250
          ? 'The current points gap suggests competitive balance is worth watching.'
          : 'Team ownership and available standings signals do not show an urgent league-health blocker.',
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    derivation: [
      'Compared expected team count to loaded teams',
      'Flagged unclaimed and orphan team slots',
      'Used points-for spread only when enough standings data exists',
      ...(hasRealManagerDna ? ['Included the real Phase 6 Manager DNA signal already resolved for this viewer'] : []),
    ],
    metrics: [
      { label: 'Health', value: `${score}%`, tone: score >= 75 ? 'positive' : 'warning' },
      { label: 'Managers', value: `${expectedTeams - orphanTeams.length}/${expectedTeams}`, tone: orphanTeams.length ? 'warning' : 'positive' },
      {
        label: 'Balance',
        value: pointSpread == null ? 'Pending' : pointSpread > 250 ? 'Watch' : 'Stable',
        tone: pointSpread == null ? 'neutral' : pointSpread > 250 ? 'warning' : 'positive',
      },
    ],
    nextAction:
      orphanTeams.length > 0
        ? {
            label: isCommissioner ? 'Invite managers' : 'View managers',
            href: `/league/${league.id}/settings`,
            detail: 'Fill open manager slots before league activity ramps up.',
          }
        : missingDraftDate
          ? {
              label: 'Set draft date',
              href: `/league/${league.id}/draft`,
              detail: 'A draft date makes the next league milestone clear.',
            }
          : {
              label: 'Open League Intelligence',
              href: `/league/${league.id}/intelligence`,
              detail: 'Review deeper commissioner and manager intelligence for this league.',
            },
    lastUpdatedIso: now.toISOString(),
  }
}

export function buildCommissionerLeaguePulse({
  snapshots,
  managerDna = null,
  now = DEFAULT_NOW(),
}: BuildCommissionerLeaguePulseInput): LeaguePulseViewModel {
  if (snapshots.length === 0) {
    return emptyPulse(now, 'League Pulse', '/create-league')
  }

  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const healthScore = clamp(average(snapshots.map((snapshot) => snapshot.healthScore)))
  const engagementScore = clamp(average(snapshots.map((snapshot) => snapshot.engagementScore)))
  const inactiveTeams = snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.inactiveTeams, 0)
  const missedLineups = snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.missedLineups, 0)
  const pendingWaivers = snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.pendingWaiverClaims, 0)
  const pendingTrades = snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.pendingTrades, 0)
  const alertCount = snapshots.reduce((sum, snapshot) => sum + snapshot.alerts.length, 0)
  const enabledAction = snapshots
    .flatMap((snapshot) => snapshot.actions)
    .find((action) => action.enabled)
  const status = statusFromScore(healthScore)
  const confidencePenalty = snapshots.some((snapshot) => snapshot.dataConfidence === 'low') ? 18 : 0
  const confidence = clamp(70 + Math.min(12, snapshots.length * 3) - confidencePenalty)
  const riskCount = inactiveTeams + missedLineups + alertCount
  const hasRealManagerDna = Boolean(managerDna && managerDna.primaryIdentity !== 'unknown' && managerDna.confidence > 0)
  const evidence: LeaguePulseEvidence[] = [
    { label: 'Managed leagues', value: String(snapshots.length) },
    { label: 'Inactive teams', value: String(inactiveTeams) },
    { label: 'Missed lineups', value: String(missedLineups) },
    { label: 'Open alerts', value: String(alertCount) },
  ]
  if (hasRealManagerDna && managerDna) {
    evidence.push({
      label: 'Manager engagement',
      value: `${Math.round(managerDna.confidence * 100)}% confidence`,
      detail: `Decision Intelligence identity: ${managerDna.primaryIdentity.replace(/_/g, ' ')}`,
    })
  }

  return {
    id: 'league-pulse-commissioner',
    title: 'League Pulse',
    eyebrow: 'Fantasy OS for commissioners',
    ...status,
    headline:
      riskCount > 0
        ? `${formatCount(riskCount, 'commissioner signal')} need review.`
        : 'Your managed leagues are operating without urgent health alerts.',
    summary:
      'Fantasy OS is aggregating commissioner health snapshots into a single action queue for the leagues you run.',
    why:
      riskCount > 0
        ? 'Inactive teams, missed lineups, and open alerts can weaken league trust if they are not handled quickly.'
        : 'Current deterministic health snapshots do not show urgent commissioner intervention needs.',
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    derivation: [
      'Averaged deterministic commissioner health scores',
      'Summed inactive teams, missed lineups, pending waivers, pending trades, and alerts',
      'Selected the first enabled commissioner action as the safest next step',
      ...(hasRealManagerDna ? ['Included the real Phase 6 Manager DNA signal already resolved for this commissioner'] : []),
    ],
    metrics: [
      { label: 'Health', value: `${healthScore}%`, tone: healthScore >= 75 ? 'positive' : 'warning' },
      { label: 'Engagement', value: `${engagementScore}%`, tone: engagementScore >= 70 ? 'positive' : 'warning' },
      {
        label: 'Pending',
        value: String(pendingWaivers + pendingTrades),
        tone: pendingWaivers + pendingTrades > 0 ? 'warning' : 'positive',
      },
    ],
    nextAction: enabledAction
      ? {
          label: enabledAction.label,
          href: enabledAction.href,
          detail: enabledAction.description,
        }
      : {
          label: 'Review health dashboard',
          href: '/commissioner-hub',
          detail: 'Keep an eye on league health, engagement, and fairness trends.',
        },
    lastUpdatedIso: now.toISOString(),
  }
}
