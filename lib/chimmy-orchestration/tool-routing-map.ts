import type { ChimmyOrchestrationIntent } from './types'
import type { ChimmyFollowUpSuggestion, ChimmyToolId, ChimmyToolLaunch } from './types'

export type ToolRoutingContext = {
  leagueId?: string | null
  sport?: string | null
  week?: number | null
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function intentToToolId(intent: ChimmyOrchestrationIntent): ChimmyToolId {
  switch (intent) {
    case 'trade':
      return 'trade_analyzer'
    case 'waiver':
      return 'waiver_ai'
    case 'start_sit':
      return 'player_comparison'
    case 'player_value':
      return 'player_outlook'
    case 'draft':
      return 'draft_assistant'
    case 'commissioner':
      return 'commissioner_report'
    case 'bracket':
      return 'bracket_intelligence'
    case 'injury':
      return 'injury_report'
    case 'weather':
      return 'weather_engine'
    case 'matchup':
      return 'matchup_simulator'
    case 'league_strength':
      return 'league_analysis'
    case 'manager_psychology':
      return 'manager_psychology'
    case 'story_recap':
      return 'story_generator'
    default:
      return 'fantasy_coach'
  }
}

export function resolveToolLaunches(
  intent: ChimmyOrchestrationIntent,
  ctx: ToolRoutingContext
): { primary: ChimmyToolLaunch | null; secondary: ChimmyToolLaunch[] } {
  const sport = ctx.sport ?? undefined
  const w = ctx.week != null ? String(ctx.week) : undefined
  const base = {
    leagueId: ctx.leagueId ?? undefined,
    sport,
    source: 'chimmy_orchestration',
  }

  const launches: ChimmyToolLaunch[] = []

  const push = (id: ChimmyToolId, label: string, href: string, description: string) => {
    launches.push({ id, label, href, description })
  }

  switch (intent) {
    case 'trade':
      push(
        'trade_analyzer',
        'Trade Analyzer',
        `/trade-evaluator${qs({ ...base, week: w })}`,
        'Full trade evaluation with fairness and AI synthesis.'
      )
      break
    case 'waiver':
      push(
        'waiver_ai',
        'Waiver AI',
        `/waiver-ai${qs({ leagueId: ctx.leagueId ?? undefined, sport })}`,
        'Prioritized adds with FAAB and roster fit.'
      )
      break
    case 'start_sit':
      push(
        'player_comparison',
        'Start A vs B',
        `/tools/player-decision${qs({ leagueId: ctx.leagueId ?? undefined, sport, week: w })}`,
        'Deterministic comparison with scenario modes.'
      )
      break
    case 'player_value':
      push(
        'player_outlook',
        'Rankings & outlook',
        `/rankings${qs({ sport })}`,
        'Context for value tiers and rest-of-season outlook.'
      )
      launches.push({
        id: 'player_comparison',
        label: 'Head-to-head compare',
        href: `/tools/player-decision${qs({ sport })}`,
        description: 'Compare two players directly.',
      })
      break
    case 'draft':
      push(
        'draft_assistant',
        'Mock draft / draft room',
        ctx.leagueId ? `/league/${encodeURIComponent(ctx.leagueId)}/draft` : `/mock-draft${qs({ sport })}`,
        'Draft picks with ADP and positional value.'
      )
      if (ctx.leagueId) {
        launches.push({
          id: 'draft_assistant',
          label: 'AF Legacy AI',
          href: `/app/league/${encodeURIComponent(ctx.leagueId)}?tab=war_room`,
          description: 'Tier board, queue, compare, outlook — AF Legacy AI panel.',
        })
      }
      break
    case 'commissioner':
      push(
        'commissioner_report',
        'Commissioner Copilot',
        ctx.leagueId
          ? `/app/league/${encodeURIComponent(ctx.leagueId)}?tab=commissioner`
          : `/leagues${qs({ sport, source: 'chimmy_orchestration' })}`,
        'League health, activity, integrity, announcements, and commissioner reports.'
      )
      break
    case 'bracket':
      push(
        'bracket_intelligence',
        'Bracket Intelligence',
        `/brackets/world-cup${qs({ source: 'chimmy_orchestration' })}`,
        'Cache-grounded bracket, pool, and tournament context.'
      )
      break
    case 'injury':
      push(
        'injury_report',
        'Injury Impact',
        `/ai/tools${qs({ tool: 'injury-impact', sport, leagueId: ctx.leagueId ?? undefined })}`,
        'Roster-aware injury impact using cached injury data.'
      )
      break
    case 'weather':
      push(
        'weather_engine',
        'Weather Engine',
        `/ai/tools${qs({ tool: 'weather', sport, leagueId: ctx.leagueId ?? undefined })}`,
        'Game weather context when cached provider data is available.'
      )
      break
    case 'matchup':
      push(
        'matchup_simulator',
        'Matchup simulator',
        `/matchup-simulator${qs({ sport, leagueId: ctx.leagueId ?? undefined })}`,
        'Simulation-style matchup breakdown.'
      )
      launches.push({
        id: 'matchup_simulator',
        label: 'League matchups',
        href: ctx.leagueId
          ? `/app/matchup-simulation${qs({ leagueId: ctx.leagueId, sport })}`
          : `/matchup-simulator${qs({ sport })}`,
        description: 'League-scoped matchup view when available.',
      })
      break
    case 'league_strength':
      push(
        'league_analysis',
        'League hub',
        ctx.leagueId ? `/app/league/${encodeURIComponent(ctx.leagueId)}` : `/rankings${qs({ sport })}`,
        'Standings, strength, and competitive context.'
      )
      break
    case 'manager_psychology':
      push(
        'manager_psychology',
        'Manager psychology',
        ctx.leagueId
          ? `/app/league/${encodeURIComponent(ctx.leagueId)}/psychological-profiles`
          : `/chimmy/chat${qs({ prompt: 'Help me read manager behavior in my league', sport })}`,
        'Behavioral profiles and league psychology.'
      )
      break
    case 'story_recap':
      push(
        'story_generator',
        'Story & social content',
        `/social-clips${qs({ leagueId: ctx.leagueId ?? undefined, sport })}`,
        'Recaps, clips, and shareable narratives.'
      )
      break
    default:
      push(
        'fantasy_coach',
        'AI tool hub',
        `/ai/tools${qs({ sport })}`,
        'Browse all AllFantasy AI tools.'
      )
  }

  const primary = launches[0] ?? null
  const secondary = launches.slice(1)
  return { primary, secondary }
}

export function buildFollowUps(intent: ChimmyOrchestrationIntent, ctx: ToolRoutingContext): ChimmyFollowUpSuggestion[] {
  const league = ctx.leagueId ? ' in my league' : ''
  const out: ChimmyFollowUpSuggestion[] = []
  switch (intent) {
    case 'trade':
      out.push({ label: 'Fairness check', prompt: `What makes a trade fair for my roster${league}?` })
      break
    case 'waiver':
      out.push({ label: 'Top add', prompt: `Who is the single best waiver add${league} this week?` })
      break
    case 'start_sit':
      out.push({ label: 'Narrow down', prompt: `Given my scoring, who has the safer floor this week?` })
      break
    case 'player_value':
      out.push({ label: 'ROS priority', prompt: `Who should I prioritize for the rest of the season?` })
      break
    case 'commissioner':
      out.push({ label: 'League health', prompt: `What should I do next as commissioner${league}?` })
      break
    case 'bracket':
      out.push({ label: 'Bracket risks', prompt: `What bracket picks need the most attention?` })
      break
    case 'injury':
      out.push({ label: 'Injury impact', prompt: `Which injuries matter most for my roster${league}?` })
      break
    case 'weather':
      out.push({ label: 'Weather check', prompt: `Which games have weather risk this week?` })
      break
    case 'matchup':
      out.push({ label: 'Ceiling week', prompt: `Which of my starters has the highest ceiling this week?` })
      break
    default:
      out.push({ label: 'Go deeper', prompt: `What should I do next based on your last answer?` })
  }
  return out.slice(0, 3)
}
