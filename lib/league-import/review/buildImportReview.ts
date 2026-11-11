/**
 * Pure builder for the "Review your import" screen. No I/O — the caller passes in what the
 * database said about player matching and about the league AF already holds.
 *
 * ⚠ EVERY WARNING HERE MUST SAY WHAT AF WILL DO, not only what is wrong. A commissioner who reads
 * "unsupported roster slot: IDP_FLEX" learns nothing they can act on; one who reads "AF uses its
 * standard lineup for that spot — change it in League Settings" knows whether to care.
 */

import { diffImportAgainstPrevious } from './importReviewDiff'
import type {
  ImportReview,
  ImportReviewCanonicalInput,
  ImportReviewPlayer,
  ImportReviewPreviewInput,
  ImportReviewSettingRow,
  ImportReviewSlot,
  ImportReviewTeam,
  ImportReviewWarning,
  PreviousImportSnapshot,
} from './types'

export interface BuildImportReviewInput {
  platform: string
  preview: ImportReviewPreviewInput
  canonical?: ImportReviewCanonicalInput | null
  /**
   * source player id → matched in AF's player database. `null` means the check did not run
   * (timed out, or the provider has no id bridge); that is reported as "not checked", never as
   * "everything matched".
   */
  playerMatches: Record<string, boolean> | null
  previous?: PreviousImportSnapshot | null
}

/** Team defenses and kickers-by-team are keyed by team code on most platforms; they always "match". */
const TEAM_UNIT_POSITIONS = new Set(['DEF', 'DST', 'D/ST', 'TEAM', 'TQB', 'HC'])

const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: 'Superflex',
  SUPERFLEX: 'Superflex',
  FLEX: 'Flex (RB/WR/TE)',
  REC_FLEX: 'Flex (WR/TE)',
  WRRB_FLEX: 'Flex (RB/WR)',
  IDP_FLEX: 'IDP flex',
  BN: 'Bench',
  BENCH: 'Bench',
  IR: 'Injured reserve',
  RES: 'Injured reserve',
  TAXI: 'Taxi',
}

export function labelRosterSlot(slot: string): string {
  const upper = String(slot).toUpperCase()
  return SLOT_LABELS[upper] ?? upper
}

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  mfl: 'MyFantasyLeague',
  fantrax: 'Fantrax',
  yahoo: 'Yahoo',
  fleaflicker: 'Fleaflicker',
}

export function labelPlatform(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform
}

const LEAGUE_TYPE_LABELS: Record<string, string> = {
  redraft: 'Redraft',
  keeper: 'Keeper',
  dynasty: 'Dynasty',
  best_ball: 'Best Ball',
  guillotine: 'Guillotine',
  salary_cap: 'Salary cap',
  devy: 'Devy',
  c2c: 'Campus to Canton',
  survivor: 'Survivor',
  big_brother: 'Big Brother',
  zombie: 'Zombie',
  tournament: 'Tournament',
}

export function resolveImportLeagueType(
  preview: ImportReviewPreviewInput,
  canonical?: ImportReviewCanonicalInput | null,
): { id: string; label: string } {
  const facts = preview.reviewFacts ?? {}
  const concept = (canonical?.inferredConcept ?? '').toLowerCase()
  const raw = (facts.rawLeagueType ?? '').toLowerCase()
  let id = 'redraft'
  if (concept && LEAGUE_TYPE_LABELS[concept]) id = concept
  else if (facts.isDynasty || raw === 'dynasty' || raw === '2') id = 'dynasty'
  else if (facts.isKeeper || raw === 'keeper' || raw === '1') id = 'keeper'
  // Keeper leagues are reported as "dynasty" by several adapters (they share `isDynasty`); the
  // explicit keeper flag is the more specific signal.
  if (id === 'dynasty' && facts.isKeeper && !facts.isDynasty) id = 'keeper'
  return { id, label: LEAGUE_TYPE_LABELS[id] ?? id }
}

function slotFor(id: string, m: ImportReviewPreviewInput['managers'][number]): ImportReviewSlot {
  if (m.reserve?.includes(id)) return 'ir'
  if (m.taxi?.includes(id)) return 'taxi'
  if (m.starters?.includes(id)) return 'starter'
  return 'bench'
}

const SLOT_ORDER: Record<ImportReviewSlot, number> = { starter: 0, bench: 1, ir: 2, taxi: 3 }

function isTeamUnit(position: string | undefined): boolean {
  return TEAM_UNIT_POSITIONS.has(String(position ?? '').toUpperCase())
}

function scoringLabel(format: string | null | undefined, ppr: boolean | undefined): string {
  const f = String(format ?? '').toLowerCase()
  if (f === 'ppr' || f === 'full_ppr') return 'Full PPR (1 point per catch)'
  if (f === 'half' || f === 'half_ppr' || f === '0.5') return 'Half PPR (0.5 points per catch)'
  if (f === 'standard' || f === 'std' || f === 'non_ppr') return 'Standard (no points per catch)'
  if (f === 'points') return 'Points'
  if (f.includes('cat') || f === 'roto') return 'Categories'
  if (ppr === true) return 'PPR'
  if (ppr === false) return 'Standard (no points per catch)'
  return 'Not reported by the platform'
}

function yesNo(v: boolean | undefined): string {
  if (v === undefined) return 'Unknown'
  return v ? 'Yes' : 'No'
}

function countSlots(positions: string[]): Array<{ slot: string; count: number }> {
  const counts = new Map<string, number>()
  for (const p of positions) {
    const label = labelRosterSlot(p)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([slot, count]) => ({ slot, count }))
}

/** Roster spots that hold active players (everything except IR and taxi). */
function activeRosterSpots(positions: string[]): number {
  return positions.filter((p) => !['IR', 'RES', 'TAXI'].includes(String(p).toUpperCase())).length
}

function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function buildImportReview(input: BuildImportReviewInput): ImportReview {
  const { preview, canonical, playerMatches, previous } = input
  const facts = preview.reviewFacts ?? {}
  const platformLabel = labelPlatform(input.platform)
  const leagueType = resolveImportLeagueType(preview, canonical)
  const orphanIds = new Set(facts.orphanTeamIds ?? [])
  const failedIds = new Set(facts.failedRosterTeamIds ?? [])
  const warnings: ImportReviewWarning[] = []

  // ── Teams and rosters ────────────────────────────────────────────────────────────────────
  const teams: ImportReviewTeam[] = preview.managers.map((m) => {
    const owner = (m.displayName || m.username || '').trim()
    const ownerMissing = !owner || orphanIds.has(m.rosterId)
    const players: ImportReviewPlayer[] = (m.players ?? []).map((id) => {
      const info = preview.playerMap[id]
      const position = info?.position ?? ''
      let matched: boolean | null = null
      if (playerMatches) matched = isTeamUnit(position) ? true : playerMatches[id] === true
      return {
        id,
        name: info?.name?.trim() || `Unknown player (${id})`,
        position,
        team: info?.team ?? '',
        slot: slotFor(id, m),
        matched,
      }
    })
    players.sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.position.localeCompare(b.position))
    return {
      teamId: m.rosterId,
      teamName: (m.teamName || '').trim(),
      ownerName: ownerMissing ? '' : owner,
      ownerMissing,
      rosterCount: players.length,
      players,
      rosterFetchFailed: failedIds.has(m.rosterId),
    }
  })

  const declared = Number(preview.league.teamCount) || 0
  if (teams.length === 0) {
    warnings.push({
      code: 'no_teams',
      severity: 'blocking',
      title: 'No teams came across',
      detail: `${platformLabel} did not return any teams for this league. Re-run the import; if it still shows no teams, check that the league has been set up on ${platformLabel}.`,
    })
  } else if (declared > 0 && teams.length < declared) {
    warnings.push({
      code: 'fewer_teams_than_declared',
      severity: 'warning',
      title: `${pluralize(teams.length, 'team')} imported, but ${platformLabel} says the league has ${declared}`,
      detail: `${pluralize(declared - teams.length, 'team is', 'teams are')} missing — usually seats nobody has joined yet. AF will create the league with ${teams.length} teams; you can invite more managers afterwards.`,
      count: declared - teams.length,
    })
  }

  for (const t of teams) {
    if (t.ownerMissing) {
      warnings.push({
        code: 'team_no_owner',
        severity: 'warning',
        title: `${t.teamName || 'A team'} has no owner`,
        detail: 'Nobody is managing this team on the source platform. AF will import it as an open team you can invite someone to claim. Add an owner name now if you know who it is.',
        fix: 'owner',
        teamId: t.teamId,
      })
    }
    if (!t.teamName) {
      warnings.push({
        code: 'team_name_missing',
        severity: 'info',
        title: 'A team has no name',
        detail: 'AF will show the owner’s name instead. Type a team name if you want one.',
        fix: 'team_name',
        teamId: t.teamId,
      })
    }
    if (t.rosterFetchFailed) {
      warnings.push({
        code: 'roster_fetch_failed',
        severity: 'warning',
        title: `We could not read ${t.teamName || 'one team'}’s roster`,
        detail: `${platformLabel} did not answer for this roster. Re-run the import to try again — if AF already has this league, the roster it has now is kept rather than emptied.`,
        teamId: t.teamId,
      })
    }
  }

  // Roster size: compare against the league's own active roster size.
  const expected =
    (typeof facts.rosterSize === 'number' && facts.rosterSize > 0 ? facts.rosterSize : null) ??
    (preview.rosterPositions.length > 0 ? activeRosterSpots(preview.rosterPositions) : null)
  if (expected) {
    const short: string[] = []
    for (const t of teams) {
      if (t.rosterFetchFailed) continue
      const active = t.players.filter((p) => p.slot !== 'ir' && p.slot !== 'taxi').length
      if (active > expected) {
        warnings.push({
          code: 'roster_size_mismatch',
          severity: 'warning',
          title: `${t.teamName || t.ownerName || 'A team'} has ${active} players; the league allows ${expected}`,
          detail: 'AF imports every player, but this team will be over the roster limit and must drop players before it can make moves.',
          teamId: t.teamId,
          count: active - expected,
        })
      } else if (active < expected && preview.draftPickCount > 0) {
        // Never a raw source id: "2 has fewer than 4 players" reads as a number, not a team.
        short.push(t.teamName || t.ownerName || 'An unnamed team')
      }
    }
    if (short.length > 0) {
      warnings.push({
        code: 'roster_size_mismatch',
        severity: 'info',
        title: `${pluralize(short.length, 'team has', 'teams have')} open roster spots`,
        detail: `${short.slice(0, 4).join(', ')}${short.length > 4 ? ` and ${short.length - 4} more` : ''} ${short.length === 1 ? 'has' : 'have'} fewer than ${expected} players. That is normal after drops; it only matters if a roster should be full.`,
        count: short.length,
      })
    }
  }

  // ── Player matching ──────────────────────────────────────────────────────────────────────
  const allPlayers = teams.flatMap((t) => t.players)
  const checkable = allPlayers.filter((p) => !isTeamUnit(p.position))
  const unmatched = playerMatches ? checkable.filter((p) => p.matched === false) : []
  if (!playerMatches && checkable.length > 0) {
    warnings.push({
      code: 'player_matching_unchecked',
      severity: 'info',
      title: 'Player matching was not checked',
      detail: 'AF could not confirm every player against its database this time. The import still works; re-run it to check again.',
    })
  } else if (unmatched.length > 0) {
    warnings.push({
      code: 'players_unmatched',
      severity: 'warning',
      title: `${pluralize(unmatched.length, 'player')} could not be matched to AF’s player database`,
      detail: 'They will still appear on rosters, but without projections, values or news until they are matched. Search for the right player below, or leave them for now.',
      fix: 'player_match',
      playerIds: [...new Set(unmatched.map((p) => p.id))],
      count: unmatched.length,
    })
  }

  // ── Unsupported settings ─────────────────────────────────────────────────────────────────
  const unsupportedSlots = [...new Set((preview.formatSummary?.unsupportedPositions ?? []).map(labelRosterSlot))]
  if (unsupportedSlots.length > 0) {
    warnings.push({
      code: 'unsupported_roster_slots',
      severity: 'warning',
      title: `AF does not support ${unsupportedSlots.length === 1 ? 'this lineup spot' : 'these lineup spots'} yet: ${unsupportedSlots.join(', ')}`,
      detail: `AF will use its standard ${preview.formatSummary?.detectedFormat ?? leagueType.label} lineup for ${unsupportedSlots.length === 1 ? 'that spot' : 'those spots'}. You can adjust lineup spots in League Settings after the import.`,
    })
  }
  for (const w of canonical?.warnings ?? []) {
    if (w.code === 'concept_unmapped') {
      const raw = String(w.metadata?.rawConcept ?? 'this format')
      warnings.push({
        code: 'unsupported_concept',
        severity: 'warning',
        title: `AF does not run “${raw}” leagues yet`,
        detail: 'AF will run it as a standard redraft league. Your teams, rosters and scoring still come across; change the league type in League Settings if a closer one exists.',
      })
    } else if (w.code === 'specialty_partial') {
      warnings.push({
        code: 'specialty_format_partial',
        severity: 'info',
        title: `${leagueType.label} rules may not all come across`,
        detail: `${platformLabel} does not share every ${leagueType.label} rule. Teams and rosters import normally; check the format rules in League Settings after the import.`,
      })
    } else if (w.code === 'scoring_preset_inferred') {
      warnings.push({
        code: 'scoring_preset_assumed',
        severity: 'warning',
        title: 'AF could not read the scoring type',
        detail: 'AF will use Half PPR (0.5 points per catch) until you change it in League Settings. Check it before your first matchup.',
      })
    } else if (w.code === 'scoring_rule_collision') {
      const keys = Array.isArray(w.metadata?.statKeys) ? (w.metadata?.statKeys as string[]) : []
      warnings.push({
        code: 'scoring_rule_collision',
        severity: 'warning',
        title: 'Some scoring rules had two different values',
        detail: `AF kept the last value${keys.length ? ` for ${keys.slice(0, 5).join(', ')}` : ''}. Confirm ${keys.length === 1 ? 'it' : 'them'} in League Settings.`,
      })
    }
  }

  // ── Settings summaries ───────────────────────────────────────────────────────────────────
  const scoring: ImportReviewSettingRow[] = [
    { label: 'Format', value: preview.formatSummary?.detectedFormat ?? leagueType.label },
    { label: 'Points per catch', value: scoringLabel(facts.scoringFormat, preview.league.settings?.ppr) },
    { label: 'Superflex', value: yesNo(preview.league.settings?.superflex) },
    { label: 'TE premium', value: yesNo(preview.league.settings?.tep) },
  ]
  if (typeof facts.scoringRuleCount === 'number') {
    scoring.push({
      label: 'Scoring rules imported',
      value: facts.scoringRuleCount > 0 ? String(facts.scoringRuleCount) : 'None — AF defaults will be used',
    })
  }

  const schedule: ImportReviewSettingRow[] = []
  if (facts.regularSeasonLength) schedule.push({ label: 'Regular season', value: pluralize(facts.regularSeasonLength, 'week') })
  schedule.push({
    label: 'Matchup weeks imported',
    value: preview.matchupWeeks > 0 ? String(preview.matchupWeeks) : 'None yet',
  })
  const playoffTeams = facts.playoffTeamCount ?? preview.league.playoffTeams
  schedule.push({ label: 'Playoff teams', value: playoffTeams ? String(playoffTeams) : 'Not reported — AF default will be used' })
  if (facts.playoffStartWeek) schedule.push({ label: 'Playoffs start', value: `Week ${facts.playoffStartWeek}` })
  if (facts.tradeDeadlineWeek) schedule.push({ label: 'Trade deadline', value: `Week ${facts.tradeDeadlineWeek}` })

  const draft: ImportReviewSettingRow[] = [
    { label: 'Draft picks imported', value: preview.draftPickCount > 0 ? String(preview.draftPickCount) : 'None' },
  ]
  if (typeof facts.tradedPickCount === 'number' && facts.tradedPickCount > 0) {
    draft.push({ label: 'Traded future picks', value: String(facts.tradedPickCount) })
  }
  if (leagueType.id === 'keeper' || facts.isKeeper) {
    draft.push({
      label: 'Keepers per team',
      value: facts.maxKeepers ? String(facts.maxKeepers) : 'Not reported — set it in League Settings',
    })
  }
  if (facts.waiverType) {
    const faab = String(facts.waiverType).toLowerCase().includes('faab') || (facts.faabBudget ?? 0) > 0
    draft.push({
      label: 'Waivers',
      value: faab ? `FAAB${facts.faabBudget ? ` ($${facts.faabBudget} budget)` : ''}` : String(facts.waiverType).replace(/_/g, ' '),
    })
  }
  if (facts.taxiSlots) draft.push({ label: 'Taxi spots', value: String(facts.taxiSlots) })

  const notImported = (preview.dataQuality?.coverageSummary ?? [])
    .filter((c) => c.state === 'partial' || c.state === 'missing')
    .map((c) => ({ key: c.key, label: c.label, state: c.state as 'partial' | 'missing' }))

  const severityRank = { blocking: 0, warning: 1, info: 2 } as const
  warnings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  return {
    version: 1,
    league: {
      name: preview.league.name,
      platform: platformLabel,
      sport: preview.league.sport,
      season: preview.league.season,
      leagueType: leagueType.id,
      leagueTypeLabel: leagueType.label,
      declaredTeamCount: declared,
      importedTeamCount: teams.length,
      rosterSize: expected,
    },
    teams,
    scoring,
    rosterSlots: countSlots(preview.rosterPositions),
    schedule,
    draft,
    notImported,
    warnings,
    playerMatching: {
      checked: playerMatches !== null,
      total: checkable.length,
      matched: playerMatches ? checkable.length - unmatched.length : 0,
      unmatched: unmatched.length,
    },
    changes: previous ? diffImportAgainstPrevious(preview, previous) : null,
  }
}

/** True when nothing on the screen stops the commissioner from confirming. */
export function importReviewHasBlockingIssues(review: ImportReview): boolean {
  return review.warnings.some((w) => w.severity === 'blocking')
}

/**
 * Warnings that still apply once the commissioner's in-place fixes are counted. Used by the
 * review screen to show "2 of 5 fixed" and by analytics for "warnings fixed".
 */
export function resolveOutstandingWarnings(
  review: ImportReview,
  edits: { teamNames?: Record<string, string>; ownerNames?: Record<string, string>; playerMatches?: Record<string, unknown> },
): ImportReviewWarning[] {
  return review.warnings.filter((w) => {
    if (w.fix === 'owner' && w.teamId) return !edits.ownerNames?.[w.teamId]?.trim()
    if (w.fix === 'team_name' && w.teamId) return !edits.teamNames?.[w.teamId]?.trim()
    if (w.fix === 'player_match' && w.playerIds) {
      return w.playerIds.some((id) => !edits.playerMatches?.[id])
    }
    return true
  })
}
