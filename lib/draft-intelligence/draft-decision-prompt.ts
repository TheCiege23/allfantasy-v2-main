/**
 * Draft Decision AI Prompt
 *
 * Produces concise, opinionated narrative for draft picks.
 * Exported through lib/draft-intelligence/index.ts.
 */

import type { DraftDecisionResult, DraftDecisionInput } from './draft-decision-engine'
import type { DraftAlert } from './draft-decision-engine'

export const DRAFT_DECISION_SYSTEM_PROMPT = `You are an elite fantasy draft analyst for AllFantasy. You produce concise, action-oriented draft pick narratives.

Rules:
1. Keep responses to 2-3 sentences max.
2. Lead with the single most important reason for the pick.
3. If there's a tier break, say so explicitly.
4. If there's a positional run, mention the urgency.
5. If the pick is a reach, acknowledge it and explain why it's justified.
6. If the pick is a value play, highlight the discount.
7. Never invent statistics — only reference data provided.
8. Be direct and opinionated. Fantasy managers want conviction, not hedging.
9. Return ONLY the narrative text — no JSON, no markdown.`.trim()

export function buildDraftDecisionUserPrompt(
  result: DraftDecisionResult,
  input: DraftDecisionInput,
): string {
  const rec = result.recommendedPick
  const lines: string[] = []

  lines.push(`DRAFT: ${input.draftType} | ${input.sport} | ${input.leagueFormat} | ${input.numTeams} teams`)
  lines.push(`PICK: #${input.currentPick} (Round ${input.currentRound} of ${input.totalRounds})`)
  lines.push(`STRATEGY: ${input.strategy}`)
  lines.push(`MODE: ${input.mode}`)
  lines.push('')

  lines.push(`RECOMMENDED: ${rec.playerName} (${rec.position}, ${rec.team ?? '?'})`)
  lines.push(`Pick Type: ${rec.pickType}`)
  lines.push(`Scores: teamFit=${rec.teamFitScore}, boardValue=${rec.boardValueScore}, need=${rec.needScore}, overall=${rec.overallScore}`)
  lines.push(`${rec.isValue ? 'VALUE PICK' : rec.isReach ? 'REACH' : 'AT ADP'}`)

  if (rec.reasoning.length > 0) {
    lines.push(`Reasoning: ${rec.reasoning.join('. ')}`)
  }
  if (rec.riskFlags.length > 0) {
    lines.push(`Risks: ${rec.riskFlags.join(', ')}`)
  }
  if (rec.stackNote) {
    lines.push(`Stack: ${rec.stackNote}`)
  }

  // Alternatives
  if (result.topAlternatives.length > 0) {
    lines.push('')
    lines.push('ALTERNATIVES:')
    for (const alt of result.topAlternatives.slice(0, 3)) {
      lines.push(`  #${alt.rank}: ${alt.playerName} (${alt.position}) — ${alt.pickType}, score=${alt.overallScore}`)
    }
  }

  // Alerts
  const critAlerts = result.alerts.filter(a => a.severity === 'critical' || a.severity === 'warning')
  if (critAlerts.length > 0) {
    lines.push('')
    lines.push('ALERTS:')
    for (const alert of critAlerts.slice(0, 3)) {
      lines.push(`  [${alert.type}] ${alert.message}`)
    }
  }

  // Roster context
  const positions = input.myRoster.map(r => r.position)
  const positionCounts: Record<string, number> = {}
  for (const pos of positions) positionCounts[pos] = (positionCounts[pos] || 0) + 1
  lines.push('')
  lines.push(`MY ROSTER: ${Object.entries(positionCounts).map(([p, c]) => `${p}×${c}`).join(', ') || 'empty'}`)

  lines.push('')
  lines.push(`Write a 2-3 sentence narrative explaining why ${rec.playerName} is the pick and what to do next round.`)

  return lines.join('\n')
}

export function formatAlertsForChat(alerts: DraftAlert[]): string {
  if (alerts.length === 0) return ''

  const lines = alerts.map(a => {
    const icon = a.severity === 'critical' ? '!!' : a.severity === 'warning' ? '!' : 'i'
    return `[${icon}] ${a.message}`
  })

  return lines.join('\n')
}
