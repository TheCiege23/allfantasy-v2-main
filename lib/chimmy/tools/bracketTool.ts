import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeWinProbability } from '@/lib/brackets/intelligence/data-engine'
import { DEFAULT_RISK_PROFILE, recommendPick, type RiskProfile } from '@/lib/brackets/intelligence/strategy-engine'
import type { BracketEvidence } from '@/lib/chimmy/bracketEvidence'

type Kind = 'tournament' | 'world_cup' | 'playoff'
type EntryRef = {
  kind: Kind
  id: string
  name: string
  pool: string
  sport: string
  season: number
  status: string
  score: number | null
  rank: number | null
  updatedAt: Date
  scoreUpdatedAt: Date | null
  href: string
}

const MAX_LIST = 30
const MAX_PICKS = 160
const clean = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 120) : ''
const norm = (value: string) => value.trim().toLocaleLowerCase()
const normSport = (value: string) => norm(value).replace(/[^a-z0-9]/g, '')
const date = (value: Date | null | undefined) => value ? value.toISOString() : 'not recorded'

export function bracketChangeRefFromQuestion(question: string): string | null {
  return /\bchange ref:\s*([0-9a-f-]{36})\b/i.exec(question)?.[1] ?? null
}

/** Supports the bracket pages' prefilled prompts when the model tool loop is unavailable. */
export function bracketSelectionFromQuestion(question: string): Record<string, string> {
  const match = question.match(/\bbracket entry\s+("(?:\\.|[^"\\])*")\s+in pool\s+("(?:\\.|[^"\\])*")/i)
  if (!match) return {}
  try {
    const entryName = JSON.parse(match[1])
    const poolName = JSON.parse(match[2])
    return typeof entryName === 'string' && typeof poolName === 'string' &&
      entryName.length <= 120 && poolName.length <= 120
      ? { entry_name: entryName, pool_name: poolName,
          ...(bracketChangeRefFromQuestion(question) ? { change_ref: bracketChangeRefFromQuestion(question)! } : {}) } : {}
  } catch { return {} }
}

/** Resolve only from entries owned by the signed-in user. Model-supplied database IDs are never accepted. */
export function selectOwnedBracket(entries: EntryRef[], args: Record<string, unknown>):
  | { kind: 'selected'; entry: EntryRef }
  | { kind: 'ambiguous' | 'missing'; entries: EntryRef[] } {
  const name = norm(clean(args.entry_name))
  const pool = norm(clean(args.pool_name))
  const sport = normSport(clean(args.sport))
  const sportEntries = entries.filter((entry) => !sport || normSport(entry.sport) === sport)
  const exactPool = pool ? sportEntries.filter((entry) => norm(entry.pool) === pool) : sportEntries
  const eligible = pool && exactPool.length === 0
    ? sportEntries.filter((entry) => norm(entry.pool).includes(pool)) : exactPool
  if (!name && !pool && args.latest === true && eligible.length) {
    const sorted = [...eligible].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const tied = sorted.filter((entry) => entry.updatedAt.getTime() === sorted[0].updatedAt.getTime())
    return tied.length === 1 ? { kind: 'selected', entry: sorted[0] } : { kind: 'ambiguous', entries: tied }
  }
  const exact = name ? eligible.filter((entry) => norm(entry.name) === name) : eligible
  const candidates = name && exact.length === 0 ? eligible.filter((entry) => norm(entry.name).includes(name)) : exact
  if (candidates.length === 1) return { kind: 'selected', entry: candidates[0] }
  return { kind: candidates.length ? 'ambiguous' : 'missing', entries: candidates.length ? candidates : eligible }
}

async function ownedBrackets(userId: string, entryName?: string): Promise<{ entries: EntryRef[]; truncated: boolean; unavailable: string[] }> {
  const where = { userId, ...(entryName ? { name: { contains: entryName, mode: 'insensitive' as const } } : {}) }
  const reads = await Promise.allSettled([
    prisma.bracketEntry.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: MAX_LIST + 1,
      select: { id: true, name: true, status: true, updatedAt: true, leagueId: true,
        league: { select: { name: true, tournamentId: true, tournament: { select: { sport: true, season: true } } } } },
    }),
    prisma.worldCupBracketEntry.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: MAX_LIST + 1,
      select: { id: true, name: true, updatedAt: true, totalScore: true, rank: true, isLocked: true,
        challenge: { select: { id: true, name: true, seasonYear: true, lastSyncedAt: true } } },
    }),
    prisma.playoffBracketEntry.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: MAX_LIST + 1,
      select: { id: true, name: true, updatedAt: true, finalizedAt: true,
        challenge: { select: { id: true, name: true, sport: true, seasonYear: true } } },
    }),
  ])
  const unavailable: string[] = []
  const generic = reads[0].status === 'fulfilled' ? reads[0].value : (unavailable.push('tournament pools'), [])
  const world = reads[1].status === 'fulfilled' ? reads[1].value : (unavailable.push('World Cup challenges'), [])
  const playoff = reads[2].status === 'fulfilled' ? reads[2].value : (unavailable.push('playoff pools'), [])
  const ids = generic.slice(0, MAX_LIST).map((entry) => entry.id)
  const ranks = ids.length ? await prisma.bracketLeaderboard.findMany({
    where: { entryId: { in: ids }, leagueId: { not: null } },
    select: { entryId: true, leagueId: true, rank: true, score: true, updatedAt: true },
  }).catch(() => []) : []
  const rankByEntry = new Map(ranks.map((row) => [`${row.entryId}:${row.leagueId}`, row]))
  const entries: EntryRef[] = [
    ...generic.slice(0, MAX_LIST).map((entry): EntryRef => {
      const rank = rankByEntry.get(`${entry.id}:${entry.leagueId}`)
      return { kind: 'tournament', id: entry.id, name: entry.name, pool: entry.league.name,
        sport: entry.league.tournament.sport, season: entry.league.tournament.season, status: entry.status,
        score: rank?.score ?? null, rank: rank?.rank ?? null, updatedAt: entry.updatedAt,
        scoreUpdatedAt: rank?.updatedAt ?? null,
        href: `/bracket/${entry.league.tournamentId}/entry/${entry.id}` }
    }),
    ...world.slice(0, MAX_LIST).map((entry): EntryRef => ({ kind: 'world_cup', id: entry.id, name: entry.name,
      pool: entry.challenge.name, sport: 'WORLD_CUP', season: entry.challenge.seasonYear,
      status: entry.isLocked ? 'LOCKED' : 'OPEN', score: entry.totalScore, rank: entry.rank,
      updatedAt: entry.updatedAt, scoreUpdatedAt: entry.challenge.lastSyncedAt,
      href: `/brackets/world-cup/${entry.challenge.id}?tab=picks&entry=${entry.id}` })),
    ...playoff.slice(0, MAX_LIST).map((entry): EntryRef => ({ kind: 'playoff', id: entry.id, name: entry.name,
      pool: entry.challenge.name, sport: entry.challenge.sport, season: entry.challenge.seasonYear,
      status: entry.finalizedAt ? 'FINALIZED' : 'OPEN', score: null, rank: null,
      updatedAt: entry.updatedAt, scoreUpdatedAt: null,
      href: `/brackets/leagues/${entry.challenge.id}/entries/${entry.id}` })),
  ]
  return { entries: entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    truncated: generic.length > MAX_LIST || world.length > MAX_LIST || playoff.length > MAX_LIST, unavailable }
}

function describe(entry: EntryRef): string {
  return `${entry.name} — ${entry.pool} (${entry.sport}, ${entry.season}, ${entry.kind}); status ${entry.status}; ` +
    `score ${entry.score ?? 'not available'}; pool rank ${entry.rank ?? 'not available'}; ` +
    `score/rank snapshot ${date(entry.scoreUpdatedAt)}; entry updated ${date(entry.updatedAt)}; ${entry.href}`
}

export async function buildMyBracketsContext(userId: string): Promise<string> {
  const { entries, truncated, unavailable } = await ownedBrackets(userId)
  if (!entries.length) return `No owned bracket entries were found in the readable systems. ${unavailable.length ? `Could not read: ${unavailable.join(', ')}.` : ''} Do not infer the user has no brackets in an unavailable system.`
  return `[YOUR BRACKET ENTRIES — authenticated owner lookup; ${new Date().toISOString()}]\n` +
    entries.map(describe).join('\n') +
    `\n${truncated ? `PARTIAL LIST: only the latest ${MAX_LIST} entries per bracket system were checked. Do not claim this is every entry.` : 'All readable owned entries were checked.'}` +
    `${unavailable.length ? ` Could not read: ${unavailable.join(', ')}.` : ''}\n` +
    'Ranks and scores are stored snapshots, not a live refresh. A missing rank is unknown, not last place. Scores across different pools or formats are not directly comparable.'
}

export async function buildBracketEntryContext(userId: string, args: Record<string, unknown>,
  onEvidence?: (evidence: BracketEvidence) => void): Promise<string> {
  const { entries, truncated, unavailable } = await ownedBrackets(userId, clean(args.entry_name))
  const match = selectOwnedBracket(entries, args)
  if (match.kind !== 'selected') {
    const options = match.entries.slice(0, 12).map((entry) => `${entry.name} in ${entry.pool} (${entry.sport}, ${entry.season})`).join('; ')
    return `${match.kind === 'ambiguous' ? 'Several owned bracket entries match.' : 'No owned bracket entry matched the requested name and pool.'} ` +
      `${options ? `Available candidates: ${options}. ` : ''}` +
      `${truncated ? 'Only the most recently updated entries were checked; an older one may be outside this read. ' : ''}` +
      `${unavailable.length ? `Could not read ${unavailable.join(', ')}. ` : ''}` +
      'Ask for the exact entry and pool name. Do not guess which entry they mean.'
  }
  const entry = match.entry
  const detail = entry.kind === 'tournament' ? await tournamentDetail(userId, entry, args)
    : entry.kind === 'world_cup' ? await worldCupDetail(userId, entry, args)
    : await playoffDetail(userId, entry, args)
  // The second owner check in each detail read may fail after the list read. Never attach a
  // source card when that happens; otherwise the UI would claim to have verified the entry.
  if (!detail.startsWith('[OWN ')) return detail
  onEvidence?.({
    entryName: entry.name, poolName: entry.pool, sport: entry.sport, format: entry.kind,
    href: entry.href, entryUpdatedAt: entry.updatedAt.toISOString(),
    scoreUpdatedAt: entry.scoreUpdatedAt?.toISOString() ?? null, readAt: new Date().toISOString(),
  })
  const requestedChangeRef = clean(args.change_ref)
  const latestChange = await import('@/lib/chimmy/bracketChangeAlerts')
    .then(({ latestBracketChange, bracketChangeSummary }) => latestBracketChange(userId, entry.kind, entry.id,
      requestedChangeRef || undefined)
      .then((change) => change ? { change, summary: bracketChangeSummary(change.before, change.after) } : null))
    .catch(() => null)
  return latestChange?.summary
    ? `${detail}\n[${requestedChangeRef ? 'REQUESTED' : 'LATEST'} RECORDED BRACKET CHANGE — ${latestChange.change.observedAt}] ` +
        `${latestChange.summary}. This saved transition may predate the current bracket snapshot above.`
    : `${detail}\n${requestedChangeRef ? 'The requested change reference is unavailable or expired for this entry.' :
      'No saved before-and-after bracket change is available for this entry; current totals alone cannot establish what changed.'}`
}

async function tournamentDetail(userId: string, ref: EntryRef, args: Record<string, unknown>): Promise<string> {
  const entry = await prisma.bracketEntry.findFirst({ where: { id: ref.id, userId }, select: {
    status: true, lockedAt: true, updatedAt: true, leagueId: true,
    league: { select: { tournamentId: true, tournament: { select: { lockAt: true } } } },
    picks: { take: MAX_PICKS + 1, select: { nodeId: true, pickedTeamName: true, points: true, isCorrect: true,
      node: { select: { round: true, region: true, homeTeamName: true, awayTeamName: true, seedHome: true, seedAway: true } } } },
  } })
  if (!entry) return 'This bracket entry could not be verified as yours. No bracket facts were read.'
  const locked = Boolean(entry.lockedAt || ['LOCKED', 'SCORED', 'INVALIDATED'].includes(entry.status) ||
    (entry.league.tournament.lockAt && entry.league.tournament.lockAt <= new Date()))
  const scope = { tournamentId: entry.league.tournamentId, leagueId: entry.leagueId, entryId: ref.id }
  const [simulation, health, leader] = await Promise.all([
    prisma.bracketSimulationSnapshot.findUnique({ where: { tournamentId_leagueId_entryId: scope },
      select: { winLeagueProbability: true, top5Probability: true, expectedRank: true, simulations: true, updatedAt: true } }).catch(() => null),
    prisma.bracketHealthSnapshot.findUnique({ where: { tournamentId_leagueId_entryId: scope },
      select: { healthScore: true, statusLabel: true, updatedAt: true } }).catch(() => null),
    prisma.bracketLeaderboard.findFirst({ where: { tournamentId: scope.tournamentId, leagueId: scope.leagueId },
      orderBy: [{ rank: 'asc' }, { score: 'desc' }], select: { rank: true, score: true, updatedAt: true } }).catch(() => null),
  ])
  const intelligence = [
    leader ? `Pool leader: rank ${leader.rank}, ${leader.score} points (leaderboard updated ${date(leader.updatedAt)}).` :
      'Pool leader score is unavailable.',
    health ? `Bracket health snapshot: ${health.healthScore}/100, ${health.statusLabel} (updated ${date(health.updatedAt)}).` :
      'No bracket health snapshot is available.',
    simulation ? `Simulation snapshot: ${Math.round(simulation.winLeagueProbability * 100)}% win pool, ` +
      `${Math.round(simulation.top5Probability * 100)}% top five, expected rank ${simulation.expectedRank.toFixed(1)} ` +
      `across ${simulation.simulations} simulations (updated ${date(simulation.updatedAt)}). These are model estimates, not guarantees.` :
      'No simulation snapshot is available; do not invent winning odds.',
  ].join(' ')
  const lines = entry.picks.slice(0, MAX_PICKS).map((pick) =>
    `R${pick.node.round}${pick.node.region ? ` ${pick.node.region}` : ''}: ` +
    `${pick.node.homeTeamName ?? 'TBD'}${pick.node.seedHome != null ? ` (#${pick.node.seedHome})` : ''} vs ` +
    `${pick.node.awayTeamName ?? 'TBD'}${pick.node.seedAway != null ? ` (#${pick.node.seedAway})` : ''}; ` +
    `pick ${pick.pickedTeamName ?? 'none'}; result ${pick.isCorrect == null ? 'pending' : pick.isCorrect ? 'correct' : 'incorrect'}; points ${pick.points}`)
  const matchup = await tournamentMatchup(userId, entry.leagueId, entry.league.tournamentId, locked,
    entry.picks, entry.picks.length <= MAX_PICKS, args)
  return `[OWN TOURNAMENT BRACKET — ${new Date().toISOString()}]\n${describe(ref)}\n` +
    `Lock: ${locked ? 'locked; no pick changes should be suggested' : `open; tournament lock ${date(entry.league.tournament.lockAt)}`}. ` +
    `Pick count ${entry.picks.length}${entry.picks.length > MAX_PICKS ? ` (only first ${MAX_PICKS} shown)` : ''}.\n` +
    `${lines.join('\n') || 'No saved picks in this entry.'}\n${intelligence}\n${matchup}\n` +
    'The pool rank is a stored leaderboard snapshot. Generic tournament game scores are not in this read; do not claim a live game result.'
}

async function tournamentMatchup(userId: string, leagueId: string, tournamentId: string, locked: boolean,
  picks: Array<{ nodeId: string; pickedTeamName: string | null }>,
  picksComplete: boolean,
  args: Record<string, unknown>): Promise<string> {
  const asked = norm(clean(args.team))
  if (!asked) return ''
  const opponent = norm(clean(args.opponent))
  const nodes = await prisma.bracketNode.findMany({
    where: { tournamentId, OR: [
      { homeTeamName: { contains: clean(args.team), mode: 'insensitive' } },
      { awayTeamName: { contains: clean(args.team), mode: 'insensitive' } },
    ] },
    select: { id: true, round: true, homeTeamName: true, awayTeamName: true, seedHome: true, seedAway: true },
    take: 25,
  })
  const matches = opponent ? nodes.filter((node) => [node.homeTeamName, node.awayTeamName]
    .some((name) => name && norm(name).includes(opponent))) : nodes
  if (matches.length !== 1) return matches.length ?
    `${clean(args.team)} appears in ${matches.length} tournament matchups. Ask for the opponent or round before analyzing one.` :
    `No verified matchup involving ${clean(args.team)}${opponent ? ` and ${clean(args.opponent)}` : ''} was found in this tournament. Do not invent a pick or matchup.`
  const node = matches[0]
  const savedPick = picks.find((pick) => pick.nodeId === node.id)?.pickedTeamName ?? null
  const { homeTeamName: home, awayTeamName: away, seedHome, seedAway, round } = node
  if (!home || !away || seedHome == null || seedAway == null) return 'Matchup advice unavailable: both teams and seeds are not verified in this bracket node.'
  const probability = computeWinProbability(seedHome, seedAway)
  const poolPicks = await prisma.bracketPick.findMany({
    where: { nodeId: node.id, entry: { leagueId, status: { notIn: ['DRAFT', 'INVALIDATED'] } } },
    select: { pickedTeamName: true }, take: 1001,
  }).catch(() => [])
  const usable = poolPicks.length >= 5 && poolPicks.length <= 1000
  const homePct = usable ? poolPicks.filter((row) => row.pickedTeamName === home).length / poolPicks.length : null
  const awayPct = usable ? poolPicks.filter((row) => row.pickedTeamName === away).length / poolPicks.length : null
  const profileRow = await prisma.bracketRiskProfile.findUnique({ where: { userId }, select: {
    riskTolerance: true, poolCount: true, poolSizeEstimate: true, goal: true,
  } }).catch(() => null)
  const profile: RiskProfile = profileRow &&
    ['conservative', 'balanced', 'chaos'].includes(profileRow.riskTolerance) &&
    ['mincash', 'win_big'].includes(profileRow.goal) ? profileRow as RiskProfile : DEFAULT_RISK_PROFILE
  const strategy = !locked && homePct != null && awayPct != null
    ? recommendPick(home, away, seedHome, seedAway, homePct, awayPct, profile, round) : null
  const favorite = seedHome < seedAway ? home : seedAway < seedHome ? away : null
  const underdog = favorite === home ? away : favorite === away ? home : null
  const favoritePoolPct = favorite === home ? homePct : awayPct
  const underdogPoolPct = underdog === home ? homePct : awayPct
  const caseComparison = favorite && underdog
    ? `Safer seed-based case: ${favorite} has the lower seed and higher seed-only win estimate; ` +
      `this favors advancing more often${favoritePoolPct != null ? `, while ${Math.round(favoritePoolPct * 100)}% of sampled submitted entries share that pick` : ''}. ` +
      `Upset case: ${underdog} has the weaker seed-only estimate but can create separation if it wins` +
      `${underdogPoolPct != null ? `; ${Math.round(underdogPoolPct * 100)}% of sampled submitted entries picked it` : ''}. ` +
      'The upside depends on pool size, scoring, and later-round paths; these inputs do not establish expected value. '
    : 'Both teams have the same seed; the stored seed-only model does not establish a safer or upset side. '
  return `MATCHUP ${home} vs ${away} (round ${round}); your saved pick ${savedPick ?? (picksComplete ? 'none' : 'not verified in truncated list')}. ` +
    `Seed-only heuristic: ${home} ${Math.round(probability.teamA * 100)}%, ${away} ${Math.round(probability.teamB * 100)}%; ` +
    'this is not a live odds feed or calibrated team model. ' +
    (homePct != null && awayPct != null ? `Submitted pool entries picking each: ${home} ${Math.round(homePct * 100)}%, ${away} ${Math.round(awayPct * 100)}% (n=${poolPicks.length}). ` :
      'Pool pick percentages withheld: fewer than five submitted picks, unavailable data, or a truncated sample. ') +
    caseComparison +
    (strategy ? `Bracket strategy engine leans ${strategy.recommendedPick} (${strategy.style}; ${strategy.reasoning}). This is advice, not a guaranteed result or a saved pick.` :
      locked ? 'Entry is locked; discuss implications only, do not suggest changing the pick.' : 'No pool-backed recommendation is available.')
}

async function worldCupDetail(userId: string, ref: EntryRef, args: Record<string, unknown>): Promise<string> {
  const entry = await prisma.worldCupBracketEntry.findFirst({ where: { id: ref.id, userId }, select: {
    championTeamName: true, totalScore: true, maxPossibleScore: true, correctPicks: true, incorrectPicks: true,
    rank: true, isLocked: true, isComplete: true, updatedAt: true,
    challenge: { select: { id: true, status: true, lastSyncedAt: true, pickLockAt: true } },
    picks: { take: MAX_PICKS + 1, select: { selectedTeamName: true, pointsAwarded: true, isCorrect: true,
      match: { select: { round: true, homeTeamName: true, awayTeamName: true, homeScore: true, awayScore: true,
        status: true, winnerTeamName: true, lastScoreSyncedAt: true } } } },
    groupRankingPicks: { take: 60, select: { predictedRank: true, actualRank: true, isCorrect: true, pointsAwarded: true,
      group: { select: { displayName: true } }, team: { select: { name: true } } } },
    thirdPlaceAdvancerPicks: { take: 24, select: { actualAdvanced: true, isCorrect: true, pointsAwarded: true,
      group: { select: { displayName: true } }, team: { select: { name: true } } } },
  } })
  if (!entry) return 'This World Cup entry could not be verified as yours. No bracket facts were read.'
  const asked = norm(clean(args.team))
  const opponent = norm(clean(args.opponent))
  const picks = entry.picks.slice(0, MAX_PICKS)
  const focused = asked ? picks.filter((pick) => [pick.selectedTeamName, pick.match.homeTeamName, pick.match.awayTeamName]
    .some((name) => norm(name).includes(asked)) && (!opponent ||
      [pick.match.homeTeamName, pick.match.awayTeamName].some((name) => norm(name).includes(opponent)))) : picks
  const openMatches = asked && !focused.length ? await prisma.worldCupBracketMatch.findMany({
    where: { challengeId: entry.challenge.id, OR: [
      { homeTeamName: { contains: clean(args.team), mode: 'insensitive' } },
      { awayTeamName: { contains: clean(args.team), mode: 'insensitive' } },
    ] },
    take: 20, select: { round: true, homeTeamName: true, awayTeamName: true, homeScore: true, awayScore: true,
      status: true, winnerTeamName: true, lastScoreSyncedAt: true },
  }).catch(() => []) : []
  const matchingOpen = opponent ? openMatches.filter((match) =>
    [match.homeTeamName, match.awayTeamName].some((name) => norm(name).includes(opponent))) : openMatches
  const locked = entry.isLocked || Boolean(entry.challenge.pickLockAt && entry.challenge.pickLockAt <= new Date())
  return `[OWN WORLD CUP BRACKET — ${new Date().toISOString()}]\n${describe(ref)}\n` +
    `Champion pick ${entry.championTeamName ?? 'not saved'}; score ${entry.totalScore}; max possible ${entry.maxPossibleScore}; ` +
    `correct ${entry.correctPicks}; incorrect ${entry.incorrectPicks}; rank ${entry.rank ?? 'not available'}; ` +
    `complete ${entry.isComplete}; locked ${locked}; challenge status ${entry.challenge.status}; ` +
    `pool data last synced ${date(entry.challenge.lastSyncedAt)}; lock time ${date(entry.challenge.pickLockAt)}.\n` +
    (focused.length ? focused.map((pick) => `${pick.match.round}: ${pick.match.homeTeamName} vs ${pick.match.awayTeamName}; ` +
      `picked ${pick.selectedTeamName}; match ${pick.match.status}; score ${pick.match.homeScore ?? '?'}-${pick.match.awayScore ?? '?'}; ` +
      `winner ${pick.match.winnerTeamName ?? 'unknown'}; result ${pick.isCorrect == null ? 'pending' : pick.isCorrect ? 'correct' : 'incorrect'}; ` +
      `points ${pick.pointsAwarded}; match last synced ${date(pick.match.lastScoreSyncedAt)}`).join('\n') :
      matchingOpen.length ? matchingOpen.map((match) => `${match.round}: ${match.homeTeamName} vs ${match.awayTeamName}; ` +
        `${entry.picks.length > MAX_PICKS ? 'saved pick not verified in truncated list' : 'NO SAVED PICK in this entry'}; ` +
        `match ${match.status}; score ${match.homeScore ?? '?'}-${match.awayScore ?? '?'}; ` +
        `winner ${match.winnerTeamName ?? 'unknown'}; last synced ${date(match.lastScoreSyncedAt)}`).join('\n') :
      asked ? `No saved pick or verified match involving ${clean(args.team)} was found in the checked bracket records.` : 'No saved match picks.') +
    `\nGROUP RANKING PICKS: ${entry.groupRankingPicks.map((pick) => `${pick.group.displayName}: ${pick.team.name} predicted #${pick.predictedRank}, actual #${pick.actualRank ?? '?'}, result ${pick.isCorrect == null ? 'pending' : pick.isCorrect ? 'correct' : 'incorrect'}, points ${pick.pointsAwarded}`).join('; ') || 'none'}.\n` +
    `THIRD-PLACE ADVANCER PICKS: ${entry.thirdPlaceAdvancerPicks.map((pick) => `${pick.team.name} (${pick.group.displayName}): actual advanced ${pick.actualAdvanced == null ? 'unknown' : pick.actualAdvanced}, result ${pick.isCorrect == null ? 'pending' : pick.isCorrect ? 'correct' : 'incorrect'}, points ${pick.pointsAwarded}`).join('; ') || 'none'}.\n` +
    `\n${entry.picks.length > MAX_PICKS ? `PARTIAL: first ${MAX_PICKS} match picks shown. ` : ''}` +
    'Match scores are from the last recorded sync, not necessarily live. No team win probability is supplied for World Cup matches in this read.'
}

async function playoffDetail(userId: string, ref: EntryRef, args: Record<string, unknown>): Promise<string> {
  const entry = await prisma.playoffBracketEntry.findFirst({ where: { id: ref.id, userId }, select: {
    challengeId: true, finalizedAt: true, tiebreakerTotalScore: true, updatedAt: true,
    picks: { take: MAX_PICKS + 1, select: { pickTeamName: true,
      series: { select: { round: true, homeTeamName: true, awayTeamName: true, homeSeed: true, awaySeed: true,
        winnerTeamName: true, homeTeamWins: true, awayTeamWins: true, liveHomeScore: true, liveAwayScore: true,
        status: true, liveStatus: true, lastSyncedAt: true } } } },
  } })
  if (!entry) return 'This playoff entry could not be verified as yours. No bracket facts were read.'
  const asked = norm(clean(args.team))
  const opponent = norm(clean(args.opponent))
  const picks = entry.picks.slice(0, MAX_PICKS)
  const focused = asked ? picks.filter((pick) => [pick.pickTeamName, pick.series.homeTeamName, pick.series.awayTeamName]
    .some((name) => norm(name).includes(asked)) && (!opponent ||
      [pick.series.homeTeamName, pick.series.awayTeamName].some((name) => norm(name).includes(opponent)))) : picks
  const openSeries = asked && !focused.length ? await prisma.playoffBracketSeries.findMany({
    where: { challengeId: entry.challengeId, OR: [
      { homeTeamName: { contains: clean(args.team), mode: 'insensitive' } },
      { awayTeamName: { contains: clean(args.team), mode: 'insensitive' } },
    ] },
    take: 20, select: { round: true, homeTeamName: true, awayTeamName: true, homeSeed: true, awaySeed: true,
      winnerTeamName: true, homeTeamWins: true, awayTeamWins: true, liveHomeScore: true, liveAwayScore: true,
      status: true, liveStatus: true, lastSyncedAt: true },
  }).catch(() => []) : []
  const matchingOpen = opponent ? openSeries.filter((series) =>
    [series.homeTeamName, series.awayTeamName].some((name) => norm(name).includes(opponent))) : openSeries
  return `[OWN PLAYOFF BRACKET — ${new Date().toISOString()}]\n${describe(ref)}\n` +
    `Finalized at ${date(entry.finalizedAt)}; tiebreaker guess ${entry.tiebreakerTotalScore ?? 'not set'}. ` +
    'This bracket system does not store a per-entry score or leaderboard rank in this read.\n' +
    (focused.length ? focused.map((pick) => `${pick.series.round}: ${pick.series.homeTeamName} (#${pick.series.homeSeed}) vs ` +
      `${pick.series.awayTeamName} (#${pick.series.awaySeed}); picked ${pick.pickTeamName}; ` +
      `series status ${pick.series.status}; series wins ${pick.series.homeTeamWins}-${pick.series.awayTeamWins}; ` +
      `live game score ${pick.series.liveHomeScore ?? '?'}-${pick.series.liveAwayScore ?? '?'} (${pick.series.liveStatus ?? 'status unavailable'}); ` +
      `winner ${pick.series.winnerTeamName ?? 'unknown'}; last synced ${date(pick.series.lastSyncedAt)}`).join('\n') :
      matchingOpen.length ? matchingOpen.map((series) => `${series.round}: ${series.homeTeamName} (#${series.homeSeed}) vs ` +
        `${series.awayTeamName} (#${series.awaySeed}); ` +
        `${entry.picks.length > MAX_PICKS ? 'saved pick not verified in truncated list' : 'NO SAVED PICK in this entry'}; series status ${series.status}; ` +
        `series wins ${series.homeTeamWins}-${series.awayTeamWins}; live game score ${series.liveHomeScore ?? '?'}-${series.liveAwayScore ?? '?'} ` +
        `(${series.liveStatus ?? 'status unavailable'}); winner ${series.winnerTeamName ?? 'unknown'}; ` +
        `last synced ${date(series.lastSyncedAt)}`).join('\n') :
      asked ? `No saved pick or verified series involving ${clean(args.team)} was found in the checked bracket records.` : 'No saved series picks.') +
    `\n${entry.picks.length > MAX_PICKS ? `PARTIAL: first ${MAX_PICKS} picks shown. ` : ''}` +
    'Scores and statuses are stored provider snapshots; do not call them live without a recent sync. Unresolved future-series team labels may be placeholders.'
}
