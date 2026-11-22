import 'server-only'
import { buildSeasonBlueprint } from './seasonBlueprint'
import { loadSeasonBlueprint } from './seasonBlueprintStore'
import { loadSeasonEntry } from './seasonRegistration'
import { loadSeasonDraftContext } from './seasonDraftRuntime'
import { getSeasonReport, getSeasonReportAccess, listSeasonReportVersions } from './seasonReportAccess'
import { seasonReportPath, seasonReportSummary } from './seasonReportFormat'
import { nbaStartCap } from './seasonRules'

export const seasonAssistantTopics = ['rules', 'draft', 'standings'] as const
export type SeasonAssistantTopic = typeof seasonAssistantTopics[number]

export async function loadSeasonAssistantContext(tournamentId: string, userId: string, leagueId?: string) {
  const access = await getSeasonReportAccess(tournamentId, userId)
  if (!access) return null

  const room = leagueId ? await loadSeasonDraftContext(leagueId).catch(() => null) : null
  const roomMember = room?.pool.members.find(member => member.userId === userId && (access.staff || member.id === access.entrantId))
  if (leagueId && (!room || room.tournamentId !== tournamentId || (!access.staff && !roomMember))) return null

  const blueprint = !room && access.staff ? await loadSeasonBlueprint(tournamentId, userId) : null
  const entry = !room && !access.staff ? await loadSeasonEntry(userId, tournamentId) : null
  const config = room?.config ?? blueprint?.config ?? entry?.config
  const rules = config?.rules
  const publication = room ? { id: room.publicationId, hash: room.rulesHash }
    : blueprint?.publication ?? (entry && { id: entry.publicationId, hash: entry.hash })
  if (!config || !rules || !publication) return null
  if (!room && !access.staff && (!entry || entry.participantId !== access.entrantId || !['registered', 'eliminated', 'champion'].includes(entry.status))) return null

  const assignment = room ? (roomMember && {
    name: room.pool.name, leagueId, stage: room.stage, draftSlot: roomMember.draftSlot,
    startsAt: room.draftWindow.startsAt, completeBy: room.draftWindow.completeBy,
  }) : entry?.assignment
  const plan = blueprint ?? buildSeasonBlueprint(config)
  const stageNumber = room?.stage ?? blueprint?.currentStage ?? assignment?.stage ?? Math.max(1, ...access.stages)
  const stage = plan.stages.find(candidate => candidate.number === stageNumber)
  if (!stage) return null

  const [version] = await listSeasonReportVersions(tournamentId, access, stage.number)
  const result = version ? await getSeasonReport(tournamentId, version.id, access, leagueId) : null
  const ownRow = result?.rows.find(row => row.entrantId === (roomMember?.id ?? access.entrantId))
  const standings = result && result.report.stage === stage.number && (!room || result.report.manifestHash === room.manifestHash) ? {
    id: result.report.id,
    href: seasonReportPath(tournamentId, result.report.id) + (leagueId ? '&leagueId=' + encodeURIComponent(leagueId) : ''),
    scope: leagueId ? 'league' as const : access.staff ? 'stage' as const : 'own_league' as const,
    period: result.report.period,
    revision: result.report.revision,
    status: result.report.status,
    official: result.report.status === 'final' || result.report.official === true,
    publishedAt: result.report.publishedAt,
    summary: seasonReportSummary(result.rows),
    own: ownRow ? { standing: ownRow.standing, leagueRank: ownRow.leagueRank, pointsFor: ownRow.pointsFor } : null,
  } : null
  const page = (access.staff ? '/tournament-hub/' : '/tournament-entry/') + encodeURIComponent(tournamentId)

  return {
    tournamentId,
    name: config.name,
    sport: config.sport,
    scope: access.staff ? 'staff' as const : 'entrant' as const,
    stage: {
      number: stage.number, name: stage.name, startPeriod: stage.startWeek, endPeriod: stage.endWeek,
      advance: plan.stages[stage.number]?.participants ?? null,
      automaticPerLeague: stage.qualification?.automaticPerLeague ?? null,
      wildcards: stage.qualification?.wildcards ?? null,
    },
    rules: {
      scoring: rules.scoringPreset,
      weights: rules.weights,
      starters: rules.starters.filter(slot => slot.count > 0),
      bench: rules.bench,
      ir: rules.ir,
      lineupLock: rules.lineupLock,
      tiebreakers: config.tiebreakers.map(tie => tie === 'wins' && config.competition ? 'win rate' : tie.replaceAll('_', ' ')),
      finalTiebreaker: config.competition?.finalTiebreaker === 'frozen_draw' ? 'frozen draw' : 'commissioner review',
      nbaStarts: config.sport === 'NBA' ? rules.calendar.periods
        .filter(period => period.number >= stage.startWeek && period.number <= stage.endWeek)
        .map(period => ({ period: period.number, cap: nbaStartCap(rules, period.number) })) : null,
    },
    draft: {
      type: config.draftType,
      order: stage.number === 1 ? 'audited shuffle' : config.competition?.draftOrder === 'best_seed_last' ? 'best previous seed picks last' : 'best previous seed picks first',
      timezone: rules.calendar.timezone,
      policy: rules.draftPolicy ?? null,
      assignment: assignment ? {
        league: assignment.name,
        slot: assignment.draftSlot,
        startsAt: assignment.startsAt,
        completeBy: assignment.completeBy ?? null,
        href: assignment.leagueId ? '/league/' + encodeURIComponent(assignment.leagueId) + '/draft' : null,
      } : null,
      stageWindow: !room && access.staff ? rules.calendar.drafts.find(window => window.stage === stage.number) ?? null : null,
      room: room ? { league: room.pool.name, ...room.draftWindow, manifestHash: room.manifestHash } : null,
    },
    standings,
    publication: { id: publication.id, hash: publication.hash, href: page },
  }
}

export type SeasonAssistantContext = NonNullable<Awaited<ReturnType<typeof loadSeasonAssistantContext>>>

export function answerSeasonAssistant(context: SeasonAssistantContext, topic: SeasonAssistantTopic) {
  const { sport, name, stage, rules, draft, standings } = context
  const heading = sport + ' · ' + name + ' · Stage ' + stage.number + ' · ' + stage.name
  if (topic === 'rules') {
    const roster = rules.starters.map(slot => slot.count + ' ' + slot.position).join(', ')
    const caps = rules.nbaStarts?.filter(period => period.cap !== null)
    return [
      heading,
      'Scoring periods ' + stage.startPeriod + '–' + stage.endPeriod + '. ' + rules.scoring.replaceAll('_', ' ') + ' scoring.',
      'Starters are ' + roster + ', with ' + rules.bench + ' bench and ' + rules.ir + ' IR slots.',
      'Lineups lock at ' + (rules.lineupLock === 'individual_game' ? 'each player’s game start.' : 'the start of the scoring period.'),
      caps?.length ? 'NBA counted starts by period · ' + caps.map(({ period, cap }) => period + ' (' + cap + ')').join(', ') + '.'
        : rules.nbaStarts ? 'All scheduled NBA starter games count.' : null,
      stage.advance === null ? 'This stage decides the championship.' : stage.advance + ' entrants advance.'
        + (stage.automaticPerLeague === null ? '' : ' ' + stage.automaticPerLeague + ' automatic berths per league and ' + stage.wildcards + ' wildcards.'),
      stage.advance !== null ? 'Qualifier tiebreakers after stage points are ' + [...rules.tiebreakers, rules.finalTiebreaker].join(' → ') + '.' : null,
      'Points per stat · ' + rules.weights.map(weight => weight.statKey.replaceAll('_', ' ') + ' (' + weight.points + ')').join(', ') + '.',
    ].filter(Boolean).join('\n\n')
  }

  if (topic === 'draft') {
    const format = (value: string) => new Intl.DateTimeFormat('en', {
      timeZone: draft.timezone, dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(value)) + ' (' + draft.timezone + ')'
    const window = draft.assignment ?? draft.room ?? draft.stageWindow
    return [
      heading,
      'This stage uses a ' + draft.type + ' draft with ' + draft.order + ' order.',
      draft.policy && (draft.type === 'auction'
        ? 'Auction budget $' + draft.policy.auctionBudget + ', minimum bid $' + draft.policy.minimumBid + ', nomination clock ' + draft.policy.nominationClockSeconds + ' seconds, bid extension ' + draft.policy.bidExtensionSeconds + ' seconds.'
        : 'Pick clock ' + draft.policy.pickClockSeconds + ' seconds.'),
      draft.assignment ? draft.assignment.league + ' · Draft slot ' + draft.assignment.slot + '.' : null,
      window?.startsAt ? (draft.assignment ? 'Your draft starts ' : draft.room ? draft.room.league + ' starts ' : 'The default stage window starts ') + format(window.startsAt) + '.' : 'No draft assignment is available in this view.',
      window?.completeBy ? 'Draft deadline ' + format(window.completeBy) + '.' : null,
      !draft.assignment && draft.stageWindow ? 'A league or division may have a separate published window.' : null,
    ].filter(Boolean).join('\n\n')
  }

  if (!standings) return heading + '\n\nNo standings report is available for this stage in your view.'
  const status = standings.status === 'corrected' ? (standings.official ? 'Corrected official' : 'Corrected provisional')
    : standings.official ? 'Official' : 'Provisional'
  const own = standings.own
  return [
    heading,
    status + ' standings · Period ' + standings.period + ' · Revision ' + standings.revision + '.',
    own ? 'Your standing is ' + own.standing.toLowerCase()
      + (own.leagueRank === null ? '' : ', league rank ' + own.leagueRank)
      + (own.pointsFor === null ? '' : ', ' + own.pointsFor + ' stage points') + '.' : null,
    (standings.scope === 'stage' ? 'Stage standings · ' : standings.scope === 'league' ? 'Draft league · ' : 'Your league · ') + standings.summary + '.',
  ].filter(Boolean).join('\n\n')
}
