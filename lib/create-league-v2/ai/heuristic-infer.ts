/**
 * Deterministic template + settings inference from free text (no network calls).
 * Replace or wrap with an LLM adapter later while keeping the same output contract.
 */

import type { LeagueAiRecommendation, LeagueAiExtractedSettings } from '@/lib/create-league-v2/ai/types'
import type { LeagueCreationTemplateId } from '@/lib/create-league-v2/templates/types'
import { normalizeLeagueAiRecommendation } from '@/lib/create-league-v2/ai/normalize-recommendation'

const UNSUPPORTED_FORMATS =
  /\b(survivor|keeper\s+league|keeper\s+only|tournament\s+bracket|salary\s*cap|auction\s+only\s+league|idp\s+only|devy\s+only|c2c\s+only|campus\s+to\s+canton\s+only)\b/i

function lower(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Maps natural language to a structured recommendation. Conservative: prefers
 * unsupportedRequests + null template when intent is ambiguous or out of scope.
 */
export function inferLeagueAiRecommendationFromDescription(description: string): LeagueAiRecommendation {
  const raw = description.trim()
  const t = lower(raw)

  const unsupported: string[] = []
  const warnings: string[] = []
  const extracted: LeagueAiExtractedSettings = {}

  if (UNSUPPORTED_FORMATS.test(raw)) {
    const m = raw.match(UNSUPPORTED_FORMATS)
    if (m?.[1]) unsupported.push(`"${m[1]}" is not available in the guided template list yet. Pick Dynasty, Best Ball, Guillotine, or Redraft templates, or use Advanced Create.`)
  }

  if (/\b(auction|linear\s+draft|slow\s+draft)\b/i.test(raw) && !/\b(redraft|dynasty|best\s*ball|guillotine)\b/i.test(raw)) {
    warnings.push('Draft type changes beyond snake defaults are available in Advanced Create after you pick a format.')
  }

  if (/\bpaid\b/i.test(raw) && /\b(redraft|guillotine|keeper)\b/i.test(raw)) {
    warnings.push('Paid entry for redraft-style formats is finalized in Advanced; you can still start private/free and upgrade later.')
  }

  if (/\bnba\b|\bbasketball\b/i.test(raw)) extracted.sport = 'NBA'
  else if (/\bnhl\b|\bhockey\b/i.test(raw)) extracted.sport = 'NHL'
  else if (/\bmlb\b|\bbaseball\b/i.test(raw)) extracted.sport = 'MLB'
  else if (/\bsoccer\b|\bmls\b|\bepl\b|\bpremier\b/i.test(raw)) extracted.sport = 'SOCCER'
  else if (/\bcollege\s+football\b|\bncaaf\b|\bncaa\s+fb\b/i.test(raw)) extracted.sport = 'NCAAF'
  else if (/\bcollege\s+basketball\b|\bncaab\b|\bncaa\s+bb\b/i.test(raw)) extracted.sport = 'NCAAB'
  else if (/\bnfl\b|\bfootball\b/i.test(raw)) extracted.sport = 'NFL'

  if (/\bpublic\b/i.test(raw)) {
    if (/\bdynasty\b/i.test(raw)) extracted.dynastyVisibility = 'public'
    else if (/\bbest\s*ball\b/i.test(raw)) extracted.bestBallVisibility = 'public'
    else extracted.standardDiscoveryVisibility = 'public'
  }
  if (/\binvite[\s-]?only\b/i.test(raw)) {
    extracted.standardDiscoveryVisibility = 'invite_only'
  }
  if (/\bprivate\b/i.test(raw) && !extracted.standardDiscoveryVisibility && !extracted.dynastyVisibility && !extracted.bestBallVisibility) {
    extracted.standardDiscoveryVisibility = 'private'
  }

  if (/\b10\s*teams?\b/i.test(raw)) extracted.teamCount = 10
  if (/\b12\s*teams?\b/i.test(raw)) extracted.teamCount = 12

  let template: LeagueCreationTemplateId | null = null
  let confidence = 0.55
  let explanation = ''

  if (unsupported.length > 0) {
    template = null
    confidence = 0.35
    explanation =
      'Your description mentions formats or rules outside the current guided templates. Use Advanced Create for full control, or pick a supported template below.'
  } else if (/\bdynasty\b/i.test(raw)) {
    template = 'dynasty'
    confidence = /\btaxi\b/i.test(raw) ? 0.88 : 0.82
    explanation = 'Sounds like a multi-season dynasty league. Loading dynasty defaults (taxi + rookie draft friendly setup).'
  } else if (/\bbest\s*ball\b/i.test(raw)) {
    template = 'best_ball'
    confidence = 0.85
    explanation = 'Best ball — set-and-forget scoring with deep rosters. Loading best ball defaults.'
  } else if (/\bguillotine\b/i.test(raw)) {
    template = 'guillotine'
    confidence = 0.8
    explanation = 'Guillotine elimination format. Loading guillotine defaults — review cut rules in Advanced if needed.'
  } else if (/\b(hardcore|serious|competitive|high\s*stakes|experienced)\b/i.test(raw)) {
    template = 'competitive_redraft'
    confidence = 0.72
    explanation = 'Competitive redraft tone detected — 12-team snake defaults tuned for active managers.'
  } else if (
    /\b(casual|beginner|office|work|friends|family|home\s*league|simple|easy|light)\b/i.test(raw) ||
    (t.length > 0 && t.length < 40 && !/\b(hardcore|dynasty|best)\b/i.test(raw))
  ) {
    template = 'casual_redraft'
    confidence = 0.68
    explanation = 'Casual / friendly league tone — 10-team redraft defaults you can relax further below.'
  }

  if (!template && unsupported.length === 0 && t.length > 0) {
    template = 'casual_redraft'
    confidence = 0.45
    explanation = 'Defaulting to Casual Redraft — refine the description or pick another template if that is not what you want.'
    warnings.push('Intent was unclear; applied conservative casual redraft. Review before creating.')
  }

  if (t.length === 0) {
    return normalizeLeagueAiRecommendation({
      recommendedTemplateId: null,
      confidence: 0,
      explanation: 'Enter a short description of the league you want (sport, vibe, size).',
      extractedSettings: {},
      warnings: [],
      unsupportedRequests: [],
    })
  }

  return normalizeLeagueAiRecommendation({
    recommendedTemplateId: template,
    confidence,
    explanation,
    extractedSettings: extracted,
    warnings,
    unsupportedRequests: unsupported,
  })
}
