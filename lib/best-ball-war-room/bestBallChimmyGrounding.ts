/**
 * BEST BALL WAR ROOM → CHIMMY grounding adapter.
 *
 * Mirrors the redraft/dynasty/keeper adapters: returns a deterministic, grounded best-ball
 * WAR ROOM context block (auto-lineup explanation, construction, depth, upside, draft plan,
 * stacks) — or null when the league is not a best-ball league. Reuses the Best Ball War Room
 * context builder + deterministic engines + grounded prompt; NO engine logic is duplicated.
 *
 * Safety:
 * - Only fires for best-ball leagues (the context builder returns non-ok otherwise).
 *   Returns null otherwise so redraft/dynasty/keeper and other formats are unaffected.
 * - Carries the best-ball rules: AUTOMATIC lineup (NO start/sit), construction/depth/ceiling
 *   focus, waivers/trades only when enabled, honest missing-data flags.
 */
import { buildBestBallWarRoomContext } from './bestBallWarRoomContext'
import { evaluateUserRosterConstruction } from './bestBallRosterConstructionEngine'
import { evaluateDepth } from './bestBallDepthEngine'
import { evaluateUpside } from './bestBallUpsideEngine'
import { buildBestBallDraftPlan } from './bestBallDraftPlanEngine'
import { evaluateStacks } from './bestBallStackCorrelationEngine'
import { BEST_BALL_WAR_ROOM_SYSTEM_RULES, buildBestBallWarRoomPrompt } from './bestBallWarRoomPrompt'

export async function buildBestBallContextForChimmy(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null

  const result = await buildBestBallWarRoomContext({ leagueId, userId })
  if (!result.ok) return null
  const context = result.context
  if (!context.ruleConfigurationVerified) {
    return [
      '## BEST BALL AF WAR ROOM CONTEXT (selected league; rule coverage limited)',
      buildBestBallWarRoomPrompt({ context }),
    ].join('\n')
  }

  const rosterId = context.userRosterId
  const construction = rosterId ? evaluateUserRosterConstruction(context) : null
  const depth = rosterId ? evaluateDepth(context, rosterId) : null
  const upside = rosterId ? evaluateUpside(context, rosterId) : null
  const draftPlan = rosterId ? buildBestBallDraftPlan(context, rosterId) : null
  const stacks = rosterId ? evaluateStacks(context, rosterId) : null

  const grounded = buildBestBallWarRoomPrompt({ context, construction, depth, upside, draftPlan, stacks })

  return [
    '## BEST BALL AF WAR ROOM CONTEXT (deterministic, league-specific)',
    'When answering for THIS league, follow these rules and cite the facts below:',
    BEST_BALL_WAR_ROOM_SYSTEM_RULES,
    '',
    grounded,
  ].join('\n')
}
