import 'server-only'
import type { Prisma } from '@prisma/client'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { buildSeasonBlueprint, buildSeededBracket } from './seasonBlueprint'
import { seasonContractHash } from './seasonCalendarVerification'
import type { SeasonStageManifest } from './seasonNativeContract'
import { readSeasonStageScores, type SeasonStageScore } from './seasonStageScores'
import { computeSeasonTournamentStandings, previewSeasonTournamentCut } from './seasonTournamentStandings'
import type { SeasonReportRow, SeasonReportSnapshot } from './seasonReportFormat'

export const SEASON_REPORT_PUBLISHED = 'season_standings_report_published'
export const SEASON_CUT_FINALIZED = 'season_cut_finalized'
export const SEASON_BRACKET_PERIOD_FINALIZED = 'season_bracket_period_finalized'

export type SeasonCutDecision = {
  advancing: { entrantId: string; seed: number; path?: 'automatic' | 'wildcard' }[]
  eliminated: string[]
}
export type SeasonBracketMatch = { a: string | null; b: string | null; aScore: number | null; bScore: number | null; winner: string }
type BracketDecision = { period: number; matches: SeasonBracketMatch[] }
type Board = ReturnType<typeof computeSeasonTournamentStandings>
type CutPreview = ReturnType<typeof previewSeasonTournamentCut>
type ReportHeader = Pick<SeasonReportSnapshot, 'period' | 'revision' | 'status' | 'official' | 'contentHash'> & { id: string }
const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 10_000) / 10_000

function qualifierStatus(entrantId: string, leagueRank: number | null, automaticPerLeague: number, cut: CutPreview | null, official?: SeasonCutDecision): Pick<SeasonReportRow, 'standing' | 'reason'> {
  if (official) {
    const seed = official.advancing.find(entrant => entrant.entrantId === entrantId)
    return seed ? { standing: 'Advanced', reason: 'Seed ' + seed.seed + (seed.path ? ' via ' + seed.path : ' by tournament rank') }
      : { standing: 'Eliminated', reason: 'Outside the finalized cut' }
  }
  if (!cut) return { standing: 'Awaiting scores', reason: 'Projection requires scores for every entrant' }
  if (!cut.ok) return { standing: 'Under review', reason: cut.reason }
  const seat = cut.advancing.find(entrant => entrant.entrantId === entrantId)
  if (seat) return { standing: 'In', reason: seat.path ? 'Projected ' + seat.path + ' berth' : 'Projected above the cut' }
  const outside = cut.eliminated.indexOf(entrantId) + 1
  if (automaticPerLeague && leagueRank === automaticPerLeague + 1) return { standing: 'Bubble', reason: 'One place below the league berth' }
  if (outside <= 2) return { standing: 'Bubble', reason: outside + (outside === 1 ? ' place' : ' places') + ' outside the projected cut' }
  return { standing: 'Out', reason: outside + ' places outside the projected cut' }
}

function bracketPresentation(period: number, brackets: BracketDecision[], entrants: Board['rows']) {
  const previous = brackets.filter(decision => decision.period < period)
  const official = brackets.find(decision => decision.period === period)
  const winners = previous.at(-1)?.matches.map(match => match.winner)
  const seeded = [...entrants].sort((a, b) => a.previousSeed! - b.previousSeed!)
  const pairs = official?.matches ?? (winners
    ? Array.from({ length: winners.length / 2 }, (_, i) => ({ a: winners[i * 2]!, b: winners[i * 2 + 1]! }))
    : buildSeededBracket(seeded.map(row => row.id)).map(pair => ({ a: pair.teamA, b: pair.teamB })))
  const opponents = new Map<string, string | null>()
  for (const { a, b } of pairs) {
    if (a) opponents.set(a, b)
    if (b) opponents.set(b, a)
  }
  return { previous, official, opponents }
}

/** The caller holds the tournament shell lock. Score versions and their official decisions commit together. */
export async function publishSeasonStageReports(tx: Prisma.TransactionClient, input: {
  tournamentId: string
  roundId: string
  freezeId: string
  manifest: SeasonStageManifest
  leagueIds: string[]
  periodRules: { number: number; endsAt: string }[]
  finalTieOrder?: string[]
  reviseFrom?: number
  now: Date
}) {
  const { tournamentId, roundId, freezeId, manifest, leagueIds, now } = input
  const stage = manifest.stage ?? 1
  const ended = input.periodRules.filter(rule => Date.parse(rule.endsAt) <= now.getTime()).map(rule => rule.number).sort((a, b) => a - b)
  if (!ended.length) return
  const stagePlan = buildSeasonBlueprint(manifest.config).stages[stage - 1]!
  const headers = await tx.$queryRaw<ReportHeader[]>`
    SELECT DISTINCT ON ((data->>'period')::int) id, (data->>'period')::int AS period,
      (data->>'revision')::int AS revision, data->>'status' AS status, (data->>'official')::boolean AS official, data->>'contentHash' AS "contentHash"
    FROM tournament_shell_audit_logs
    WHERE "tournamentId" = ${tournamentId} AND "targetId" = ${roundId} AND action = ${SEASON_REPORT_PUBLISHED}
    ORDER BY (data->>'period')::int, (data->>'revision')::int DESC
  `
  const latest = new Map(headers.map(header => [header.period, header]))
  const unfinished = ended.filter(period => {
    const previous = latest.get(period)
    return (input.reviseFrom !== undefined && period >= input.reviseFrom) || (previous?.status !== 'final' && !previous?.official)
  })
  if (!unfinished.length) return
  const records = await tx.tournamentAuditLog.findMany({
    where: { tournamentId, targetId: roundId, action: stage === 3 ? SEASON_BRACKET_PERIOD_FINALIZED : SEASON_CUT_FINALIZED },
    select: { id: true, data: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const bracketEvents = new Map<number, { id: string; data: BracketDecision }>()
  let cut: { id: string; data: SeasonCutDecision } | undefined
  for (const event of records) {
    if (stage === 3) {
      const data = event.data as BracketDecision
      bracketEvents.set(data.period, { id: event.id, data })
    } else cut = { id: event.id, data: event.data as SeasonCutDecision }
  }
  const pending = unfinished.filter(period => stage !== 3 || period === stagePlan.startWeek || bracketEvents.has(period - 1))
  if (!pending.length) return
  const ledger = await readSeasonStageScores(tx, manifest, leagueIds, ended)
  if (!ledger) return
  const leagues = manifest.leagues.map(pool => ({ id: seasonResourceId(freezeId, pool.key), key: pool.key, name: pool.name, division: pool.division }))
  const divisions = new Map(leagues.map(league => [league.id, league.division]))
  const entrants = manifest.leagues.flatMap((pool, i) => pool.members.map(member => ({
    id: member.id, displayName: member.displayName, leagueId: leagues[i]!.id, previousSeed: member.previousSeed ?? null,
  })))
  const brackets = [...bracketEvents.values()].map(event => event.data).sort((a, b) => a.period - b.period)
  const qualification = stagePlan.qualification
  for (const period of pending) {
    const priorWeekId = stage < 3 ? latest.get(period - 1)?.id : undefined
    const priorWeek = priorWeekId ? (await tx.tournamentAuditLog.findUnique({ where: { id: priorWeekId }, select: { data: true } }))?.data as SeasonReportSnapshot | undefined : undefined
    const previousWeekRanks = Object.fromEntries((priorWeek?.rows ?? []).flatMap(row => row.rank === null ? [] : [[row.entrantId, row.rank]]))
    const periods = ended.filter(week => week <= period)
    const results = ledger.filter(score => score.period <= period)
    const board = computeSeasonTournamentStandings({
      stageId: String(stage), entrants, periods, results, tiebreakers: manifest.config.tiebreakers,
      compareWinRate: !!qualification, finalTieOrder: input.finalTieOrder, previousWeekRanks,
    })
    const cutWeek = stage < 3 && period === stagePlan.endWeek
    const decision = stage === 3 ? bracketEvents.get(period) : cutWeek ? cut : undefined
    const final = board.scoresFinal && (stage === 3 || cutWeek ? !!decision : true)
    const bracket = stage === 3 ? bracketPresentation(period, brackets, board.rows) : null
    const officialCut = cutWeek && final ? cut?.data : undefined
    const projection = !bracket && !officialCut && board.rows.every(row => !row.missingPeriods.length)
      ? previewSeasonTournamentCut({ ...board, scoresFinal: true }, qualification)
      : null
    const byEntrant = new Map<string, SeasonStageScore[]>()
    for (const score of results) {
      const group = byEntrant.get(score.entrantId) ?? []
      group.push(score)
      byEntrant.set(score.entrantId, group)
    }
    const byLeague = new Map<string, number>(), byDivision = new Map<string, number>()
    const rows: SeasonReportRow[] = board.rows.map(row => {
      const scores = byEntrant.get(row.id) ?? []
      const weekly = scores.find(score => score.period === period)
      const division = divisions.get(row.leagueId)
      const rank = row.pointsFor === null ? null : row.rank
      const leagueRank = rank === null ? null : (byLeague.get(row.leagueId) ?? 0) + 1
      const divisionRank = rank === null || !division ? null : (byDivision.get(division) ?? 0) + 1
      if (leagueRank !== null) byLeague.set(row.leagueId, leagueRank)
      if (division && divisionRank !== null) byDivision.set(division, divisionRank)
      const base = {
        entrantId: row.id, leagueId: row.leagueId, manager: row.displayName, rank, leagueRank, divisionRank, seedMovement: row.seedMovement,
        weekPoints: weekly?.points ?? null, weekAgainst: weekly?.played ? weekly.against : null,
        pointsFor: row.pointsFor, pointsAgainst: scores.length ? sum(scores.filter(score => score.played).map(score => score.against)) : null,
        wins: scores.filter(score => score.wins === 1).length,
        losses: scores.filter(score => score.played && score.wins === 0).length,
        ties: scores.filter(score => score.wins === 0.5).length,
        missing: row.missingPeriods.length,
      }
      if (!bracket) return { ...base, ...qualifierStatus(row.id, leagueRank, qualification?.automaticPerLeague ?? 0, projection, officialCut) }

      const outcomes = [...bracket.previous, ...(bracket.official ? [bracket.official] : [])].flatMap(event =>
        event.matches.filter(match => match.a === row.id || match.b === row.id))
      const ownScores = outcomes.flatMap(match => match.a === row.id ? [match.aScore!] : [match.bScore!])
      const opponents = outcomes.flatMap(match => match.a === row.id ? (match.bScore === null ? [] : [match.bScore]) : (match.aScore === null ? [] : [match.aScore]))
      const current = bracket.official?.matches.find(match => match.a === row.id || match.b === row.id)
      const alive = bracket.opponents.has(row.id)
      const opponent = bracket.opponents.get(row.id)
      const opponentScore = opponent ? byEntrant.get(opponent)?.find(score => score.period === period)?.points ?? null : null
      const weekPoints = current ? current.a === row.id ? current.aScore : current.bScore : alive ? base.weekPoints : null
      const weekAgainst = current ? current.a === row.id ? current.bScore : current.aScore : opponentScore
      if (weekPoints !== null && !current) ownScores.push(weekPoints)
      if (weekAgainst !== null && !current) opponents.push(weekAgainst)
      const winner = current?.winner === row.id
      const standing = current
        ? winner ? bracket.official!.matches.length === 1 ? 'Champion' : 'Advanced' : 'Eliminated'
        : alive ? 'Alive' : 'Eliminated'
      return {
        ...base, rank: row.previousSeed, leagueRank: null, divisionRank: null, seedMovement: null, weekPoints, weekAgainst,
        pointsFor: ownScores.length ? sum(ownScores) : null, pointsAgainst: opponents.length ? sum(opponents) : null,
        wins: outcomes.filter(match => match.a && match.b && match.winner === row.id).length,
        losses: outcomes.filter(match => match.winner !== row.id).length, ties: 0, missing: alive && weekPoints === null ? 1 : 0,
        standing, reason: current ? current.a && current.b ? 'Official bracket result' : 'Bracket bye'
          : alive ? 'Awaiting official bracket result' : 'Eliminated in an earlier bracket period',
      }
    })
    if (bracket) rows.sort((a, b) => a.rank! - b.rank!)
    const previous = latest.get(period)
    const decisionId = final ? decision?.id ?? null : null
    const contentHash = seasonContractHash({ final, decisionId, rows })
    if (previous?.contentHash === contentHash) continue
    const revision = (previous?.revision ?? 0) + 1
    const id = seasonResourceId(roundId, 'report:' + period + ':' + revision)
    const data: SeasonReportSnapshot = {
      schemaVersion: 1, stage, period, revision, status: final && input.reviseFrom === undefined ? 'final' : previous || input.reviseFrom !== undefined ? 'corrected' : 'provisional',
      ...(final && input.reviseFrom !== undefined ? { official: true } : {}),
      previousId: previous?.id ?? null, decisionId, tournamentName: manifest.config.name, manifestHash: manifest.manifestHash,
      contentHash, leagues, rows,
    }
    await tx.tournamentAuditLog.create({ data: {
      id, tournamentId, roundNumber: stage, actorType: 'system', action: SEASON_REPORT_PUBLISHED,
      targetType: 'round', targetId: roundId, createdAt: now, data: toPrismaJsonInput(data),
    } })
    latest.set(period, { id, period, revision, contentHash, status: data.status, official: data.official })
  }
}
