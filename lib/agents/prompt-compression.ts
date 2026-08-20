import 'server-only'

type StructuredFantasyContext = Record<string, unknown> | null | undefined

type UserContextSummary = {
  sport?: string | null
  leagueFormat?: string | null
  scoring?: string | null
  record?: string | null
  leagueId?: string | null
  teamId?: string | null
}

const FORMAT_RULES: Record<string, string> = {
  redraft:
    'REDRAFT: optimize for this season only. Prioritize weekly starting points, playoff schedule, and immediate lineup upgrades. Ignore distant future value.',
  dynasty:
    'DYNASTY: weight age, runway, insulated market value, future picks, and contender-vs-rebuild direction. Young cornerstone QBs/WRs are protected assets.',
  keeper:
    'KEEPER: blend current-year production with future control. Cheap keepers, round cost, eligibility windows, and next-year upside materially change value.',
  best_ball:
    'BEST BALL: ceiling and spike weeks matter more than lineup-setting flexibility. Devalue fragile bench depth and boost big-play profiles with weekly eruption paths.',
  guillotine:
    'GUILLOTINE: prioritize weekly floor, survival odds, and avoiding lineup landmines. Depth matters less than protecting against the lowest-score elimination risk.',
  tournament:
    'TOURNAMENT: optimize for advancement equity and differentiated ceiling. Short-term spike outcomes matter more than safe median projections in knockout windows.',
  salary_cap:
    'SALARY CAP: evaluate salary efficiency, cap flexibility, and replacement cost. A good player on a bad number can be a weaker asset than a slightly worse player on a strong number.',
  idp:
    'IDP: apply defensive scoring, role stability, snap share, tackle/sack profile, and league position rules. Do not treat offensive and IDP depth as interchangeable.',
  devy:
    'DEVY: value college runway, development timelines, transfer volatility, and stash upside. Long-term asset insulation matters more than immediate redraft production.',
  c2c:
    'C2C: balance pro and college asset pools together. Conference/player-pool constraints and staggered development timelines materially change valuation.',
  survivor:
    'SURVIVOR: weekly advancement probability and floor take priority over long-view value. Favor stability over speculative upside when elimination risk is active.',
  zombie:
    'ZOMBIE: evaluate survival state, revival pressure, and what enters or leaves the zombie pool. Opponent drop behavior and attrition matter.',
  big_brother:
    'BIG BROTHER: optimize for avoiding elimination, social pressure, and consistency. Stable weekly production beats volatile boom-bust profiles.',
  superflex:
    'SUPERFLEX / 2QB: materially raise QB value, especially stable starters with job security. Young QBs become premium dynasty assets and scarcity must show up in every verdict.',
  ppr:
    'PPR: boost volume pass-catchers, receiving RBs, and target-driven floor.',
  half_ppr:
    'HALF PPR: blend reception floor with yardage/TD upside; pure volume gets a smaller boost than full PPR.',
  standard:
    'STANDARD: touchdowns, yardage, and role-driven scoring matter more than raw target/catch volume.',
  points:
    'POINTS: evaluate category-independent total output, schedule, and projected minutes/usage rather than category balance.',
  categories:
    'CATEGORIES: value roster-balance, category scarcity, and punt-build fit rather than simple aggregate points.',
  te_premium:
    'TE PREMIUM: materially raise elite and volume-driven TEs. A strong TE advantage can swing trades, draft decisions, and lineup recommendations.',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry)).filter(Boolean)
}

function stripLeagueFormatSection(prompt: string): string {
  const marker = '## LEAGUE FORMAT INTELLIGENCE'
  const start = prompt.indexOf(marker)
  if (start === -1) return prompt.trim()

  const after = prompt.slice(start)
  const nextTopLevelHeading = after.indexOf('\n# ')
  if (nextTopLevelHeading === -1) {
    return prompt.slice(0, start).trim()
  }

  const before = prompt.slice(0, start).trim()
  const rest = after.slice(nextTopLevelHeading + 1).trim()
  return [before, rest].filter(Boolean).join('\n\n')
}

function normalizeFormatName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function readActiveFormats(
  structuredFantasyContext: StructuredFantasyContext,
  ctx: UserContextSummary
): string[] {
  const league = asRecord(asRecord(structuredFantasyContext).league)
  const active = asStringArray(league.activeFormatTypes).map(normalizeFormatName)
  if (active.length > 0) return active

  const fallback = normalizeFormatName(String(ctx.leagueFormat ?? 'redraft'))
  return fallback ? [fallback] : ['redraft']
}

function buildFormatRulesSection(activeFormats: string[]): string {
  const snippets = activeFormats
    .map((format) => FORMAT_RULES[format])
    .filter(Boolean)

  if (snippets.length === 0) return ''

  return [
    '## LEAGUE FORMAT INTELLIGENCE',
    `Active formats: ${activeFormats.join(' + ')}`,
    ...snippets.map((snippet) => `- ${snippet}`),
  ].join('\n')
}

function joinList(values: string[], limit = 6): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(', ')
}

function buildLeagueContextSection(structuredFantasyContext: StructuredFantasyContext): string {
  const root = asRecord(structuredFantasyContext)
  const league = asRecord(root.league)
  if (Object.keys(league).length === 0) return ''

  const rosterConstruction = asRecord(league.rosterConstruction)
  const notes = asStringArray(root.specialLeagueNotes)

  const lines = [
    '## LEAGUE CONTEXT',
    `- League: ${String(league.name ?? 'Unknown league')}`,
    `- Sport: ${String(league.sport ?? 'Unknown')}`,
    `- Scoring: ${String(league.scoring ?? 'Unknown')}`,
    `- Size: ${String(league.leagueSize ?? 'Unknown')}`,
    `- Current week: ${String(league.currentWeek ?? 'Unknown')}`,
    `- Waiver type: ${String(league.waiverType ?? 'Unknown')}`,
    `- Trade deadline: ${String(league.tradeDeadlineStatus ?? 'Unknown')}`,
    `- Playoff picture: ${String(league.playoffPicture ?? 'Unknown')}`,
  ]

  if (Object.keys(rosterConstruction).length > 0) {
    lines.push(
      `- Roster construction: starters ${String(rosterConstruction.starterSlots ?? 'n/a')}, bench ${String(rosterConstruction.benchSlots ?? 'n/a')}, IR ${String(rosterConstruction.irSlots ?? 'n/a')}, taxi ${String(rosterConstruction.taxiSlots ?? 'n/a')}`
    )
  }

  if (notes.length > 0) {
    lines.push(`- Special notes: ${joinList(notes, 4)}`)
  }

  return lines.join('\n')
}

function buildUserContextSection(structuredFantasyContext: StructuredFantasyContext, ctx: UserContextSummary): string {
  const root = asRecord(structuredFantasyContext)
  const userRoster = asRecord(root.userRoster)
  const opponent = asRecord(root.opponent)

  const lines = ['## USER CONTEXT']
  lines.push(`- Record: ${String(root.userRecord ?? ctx.record ?? 'Unknown')}`)
  lines.push(`- Team: ${String(userRoster.teamName ?? 'Unknown team')}`)
  lines.push(`- FAAB remaining: ${String(root.faabRemaining ?? 'Unknown')}`)
  lines.push(`- Waiver priority: ${String(root.waiverPriority ?? 'Unknown')}`)

  const strengths = asStringArray(userRoster.strengths)
  const weaknesses = asStringArray(userRoster.weaknesses)
  const starters = asStringArray(userRoster.starters)
  const bench = asStringArray(userRoster.bench)

  if (strengths.length > 0) lines.push(`- Strengths: ${joinList(strengths, 4)}`)
  if (weaknesses.length > 0) lines.push(`- Weaknesses: ${joinList(weaknesses, 4)}`)
  if (starters.length > 0) lines.push(`- Starters: ${joinList(starters, 8)}`)
  if (bench.length > 0) lines.push(`- Bench core: ${joinList(bench, 6)}`)

  if (Object.keys(opponent).length > 0) {
    lines.push(`- Opponent: ${String(opponent.teamName ?? 'Unknown opponent')} (${String(opponent.record ?? 'Unknown record')})`)
  }

  return lines.join('\n')
}

/**
 * Player Command Center (Slice 3) — renders the cross-league player summary
 * (ChimmyCrossLeaguePlayerSummary from crossLeaguePlayerPortfolio.ts) when the
 * pipeline attached one under `crossLeague`. Curated and compact by design:
 * injured players, bye-week players, overexposure, and leagues needing action —
 * never the full portfolio. Absent key → empty string, zero prompt change.
 */
function buildCrossLeagueSection(structuredFantasyContext: StructuredFantasyContext): string {
  const root = asRecord(structuredFantasyContext)
  const summary = asRecord(root.crossLeague)
  if (Object.keys(summary).length === 0) return ''

  const lines = ['## CROSS-LEAGUE PORTFOLIO (all connected leagues)']
  lines.push(`- Connected leagues: ${String(summary.connectedLeagueCount ?? 'Unknown')}`)

  const renderRefs = (value: unknown, label: string, detail: (r: Record<string, unknown>) => string) => {
    if (!Array.isArray(value) || value.length === 0) return
    const rendered = value
      .slice(0, 6)
      .map((raw) => {
        const r = asRecord(raw)
        const leagues = asStringArray(r.leagueNames)
        const leagueNote = leagues.length > 0 ? ` [${joinList(leagues, 3)}]` : ''
        return `${String(r.displayName ?? 'Unknown')}${detail(r)}${leagueNote}`
      })
      .join('; ')
    lines.push(`- ${label}: ${rendered}`)
  }

  renderRefs(summary.injuredPlayers, 'Injured rostered players', (r) => ` (${String(r.injuryStatus ?? 'unknown')})`)
  renderRefs(summary.byeWeekPlayers, 'On bye', (r) => ` (week ${String(r.byeWeek ?? '?')})`)
  renderRefs(
    summary.overexposedPlayers,
    'Overexposed',
    (r) => ` (${Math.round(Number(r.percentageOfUserLeagues ?? 0) * 100)}% of leagues)`,
  )
  renderRefs(
    summary.playersNeedingAction,
    'Needing action',
    (r) => ` (${String(r.criticalCount ?? 0)} critical / ${String(r.highCount ?? 0)} high)`,
  )

  return lines.length > 2 ? lines.join('\n') : ''
}

/**
 * Slice 8 — deterministic replacement options for a mentioned rostered player
 * (from lib/shared-services/league-hub/replacementOptions.ts, the same engine
 * the Player Command Center serves). Rendered as data + a hard instruction so
 * prose answers cite these real deltas instead of inventing alternatives.
 * Absent key → empty string, zero prompt change.
 */
function buildReplacementOptionsSection(structuredFantasyContext: StructuredFantasyContext): string {
  const root = asRecord(structuredFantasyContext)
  const reps = asRecord(root.replacementOptions)
  if (Object.keys(reps).length === 0) return ''

  const playerName = String(reps.playerName ?? 'the player')
  const lines = [`## REPLACEMENT OPTIONS — ${playerName} (deterministic; cite these numbers, do not invent alternatives)`]

  if (reps.limitation === 'no_projection_data') {
    lines.push('- No real projection data exists for this league yet — say so rather than estimating.')
    return lines.join('\n')
  }

  const week = reps.projectionWeek
  const affected = reps.affectedProjection
  if (typeof affected === 'number') {
    lines.push(`- ${playerName} projects ${affected.toFixed(1)}${week != null ? ` (week ${String(week)})` : ''}`)
  }

  const renderList = (value: unknown, label: string) => {
    if (!Array.isArray(value) || value.length === 0) return
    const rendered = value
      .slice(0, 3)
      .map((raw) => {
        const c = asRecord(raw)
        const delta = typeof c.delta === 'number' ? ` (${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(1)})` : ''
        const pos = c.position ? ` ${String(c.position)}` : ''
        const proj = typeof c.projectedPoints === 'number' ? ` ${c.projectedPoints.toFixed(1)} proj` : ''
        return `${String(c.name ?? 'Unknown')}${pos}${proj}${delta}`
      })
      .join('; ')
    lines.push(`- ${label}: ${rendered}`)
  }
  renderList(reps.benchOptions, 'Best on their bench')
  renderList(reps.freeAgentOptions, 'Best available (unrostered)')

  const claim = asRecord(reps.claimTarget)
  if (claim.kind === 'native') {
    lines.push('- Claims for this league happen on the AllFantasy waiver wire (link the user there when relevant).')
  } else if (claim.kind === 'provider') {
    lines.push(`- This league lives on ${String(claim.provider ?? 'another platform')} — AllFantasy advises but cannot execute the claim.`)
  }

  return lines.length > 1 ? lines.join('\n') : ''
}

export function buildCompressedSystemPrompt(args: {
  rawPrompt: string
  structuredFantasyContext?: StructuredFantasyContext
  ctx: UserContextSummary
}): string {
  const activeFormats = readActiveFormats(args.structuredFantasyContext, args.ctx)
  const sections = [
    stripLeagueFormatSection(args.rawPrompt),
    buildFormatRulesSection(activeFormats),
    buildLeagueContextSection(args.structuredFantasyContext),
    buildUserContextSection(args.structuredFantasyContext, args.ctx),
    buildCrossLeagueSection(args.structuredFantasyContext),
    buildReplacementOptionsSection(args.structuredFantasyContext),
  ].filter(Boolean)

  return sections.join('\n\n').trim()
}
