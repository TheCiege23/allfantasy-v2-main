/**
 * AI insight for matchup simulation (Prompt 133).
 * DeepSeek: distribution interpretation.
 * Grok: storyline framing.
 * OpenAI: clear matchup explanation.
 * When a provider is unavailable, deterministic fallbacks keep the overlay usable.
 */

import OpenAI from 'openai'
import { deepseekChat } from '@/lib/deepseek-client'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import type {
  MatchupProviderInsights,
  MatchupSimulationOutput,
  MatchupSimulationTeamSummary,
} from './types'

function getOpenAIClient(): OpenAI | null {
  /*
   * PROVIDER BOUNDARY. Three providers live in this file: deepseekChat comes
   * from the GUARDED @/lib/deepseek-client, while this OpenAI client and the
   * Grok one below were built here and metered by nothing. A census asking
   * whether a module references a guarded client answers yes and moves on —
   * ask what a file CONSTRUCTS instead.
   *
   * Non-throwing to match the contract, and to match this file's own header:
   * the factories return `OpenAI | null` and the callers fall back to
   * deterministic output when a provider is unavailable. A spend refusal is
   * exactly that case, so it degrades rather than fails.
   */
  if (!isAiSpendEnabled()) return null

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({
    apiKey,
    baseURL:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1',
  })
}

function getGrokClient(): OpenAI | null {
  // Same boundary, second provider. Guarded separately because either factory
  // can be reached without the other.
  if (!isAiSpendEnabled()) return null

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
  if (!apiKey) return null
  return new OpenAI({
    apiKey,
    baseURL:
      process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
  })
}

function summarizeSwingSlot(teamSummary?: MatchupSimulationTeamSummary): string {
  const topSlot = [...(teamSummary?.lineup ?? [])]
    .sort((slotA, slotB) => Math.abs(slotB.scheduleImpact) - Math.abs(slotA.scheduleImpact))[0]

  if (!topSlot) return 'No major slot-level swing registered.'
  if (Math.abs(topSlot.scheduleImpact) < 0.2) {
    return `${topSlot.slotLabel} stays close to baseline.`
  }

  const direction = topSlot.scheduleImpact > 0 ? 'lift' : 'drag'
  return `${topSlot.playerName} (${topSlot.slotLabel}) carries the largest ${direction} at ${topSlot.scheduleImpact.toFixed(1)} points.`
}

function buildContext(out: MatchupSimulationOutput, teamAName: string, teamBName: string): string {
  const lines = [
    `Sport: ${out.sport}. Matchup: ${teamAName} vs ${teamBName}.`,
    `Expected score: ${out.expectedScoreA.toFixed(1)} - ${out.expectedScoreB.toFixed(1)}.`,
    `Win probability: ${(out.winProbabilityA * 100).toFixed(1)}% vs ${(out.winProbabilityB * 100).toFixed(1)}%.`,
    `Likely ranges: ${out.scoreRangeA?.[0]?.toFixed(1) ?? '0'}-${out.scoreRangeA?.[1]?.toFixed(1) ?? '0'} for ${teamAName}; ${out.scoreRangeB?.[0]?.toFixed(1) ?? '0'}-${out.scoreRangeB?.[1]?.toFixed(1) ?? '0'} for ${teamBName}.`,
    `Upset chance: ${out.upsetChance}%. Volatility: ${out.volatilityTag}. Iterations: ${out.iterations}. Seed: ${out.deterministicSeed ?? 'n/a'}.`,
    `Schedule adjustments: ${teamAName} ${out.teamSummaryA?.scheduleAdjustment?.toFixed(1) ?? '0.0'} points; ${teamBName} ${out.teamSummaryB?.scheduleAdjustment?.toFixed(1) ?? '0.0'} points.`,
    `${teamAName} swing slot: ${summarizeSwingSlot(out.teamSummaryA)}`,
    `${teamBName} swing slot: ${summarizeSwingSlot(out.teamSummaryB)}`,
  ]
  if (out.upsideScenario) {
    lines.push(
      `Upside scenario (${out.upsideScenario.percentile}th percentile): ${out.upsideScenario.teamA.toFixed(1)} - ${out.upsideScenario.teamB.toFixed(1)}.`
    )
  }
  if (out.downsideScenario) {
    lines.push(
      `Downside scenario (${out.downsideScenario.percentile}th percentile): ${out.downsideScenario.teamA.toFixed(1)} - ${out.downsideScenario.teamB.toFixed(1)}.`
    )
  }
  return lines.join(' ')
}

function buildDistributionFallback(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): string {
  const favorite = out.winProbabilityA >= out.winProbabilityB ? teamAName : teamBName
  const underdog = favorite === teamAName ? teamBName : teamAName
  const favoriteRange =
    favorite === teamAName ? out.scoreRangeA ?? [0, 0] : out.scoreRangeB ?? [0, 0]
  return `${favorite} carries the tighter median path, but ${underdog} still owns a ${out.upsetChance.toFixed(1)}% upset lane. The central scoring band for ${favorite} sits around ${favoriteRange[0].toFixed(1)}-${favoriteRange[1].toFixed(1)}, which matches the ${out.volatilityTag} volatility tag from the deterministic sim.`
}

function buildStorylineFallback(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): string {
  const margin = Math.abs(out.marginMean)
  if (margin < 2) {
    return `${teamAName} and ${teamBName} are on coin-flip ground, so one lineup spike could flip the whole story.`
  }
  const favorite = out.winProbabilityA >= out.winProbabilityB ? teamAName : teamBName
  return `${favorite} has the cleaner path, but the sim still leaves enough chaos for this to stay tense deep into the slate.`
}

function buildExplanationFallback(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): string {
  const favorite = out.winProbabilityA >= out.winProbabilityB ? teamAName : teamBName
  const favoriteScore =
    favorite === teamAName ? out.expectedScoreA.toFixed(1) : out.expectedScoreB.toFixed(1)
  const underdog = favorite === teamAName ? teamBName : teamAName
  return `${favorite} is the favorite because the adjusted lineup projects around ${favoriteScore} points and the deterministic sim puts that side ahead in ${(Math.max(out.winProbabilityA, out.winProbabilityB) * 100).toFixed(1)}% of outcomes. ${underdog} is still live if its high-variance slots land near the upside band, which is why the upset chance stays at ${out.upsetChance.toFixed(1)}%.`
}

async function maybeCallOpenAI(
  system: string,
  user: string
): Promise<string | null> {
  const client = getOpenAIClient()
  if (!client) return null
  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MATCHUP_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 170,
      temperature: 0.4,
    })
    return completion.choices[0]?.message?.content?.trim() || null
  } catch (error) {
    console.error('[MatchupSimulationInsightAI] openai', error)
    return null
  }
}

async function maybeCallGrok(system: string, user: string): Promise<string | null> {
  const client = getGrokClient()
  if (!client) return null
  try {
    const completion = await client.chat.completions.create({
      model: process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-2-latest',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 110,
      temperature: 0.5,
    })
    return completion.choices[0]?.message?.content?.trim() || null
  } catch (error) {
    console.error('[MatchupSimulationInsightAI] grok', error)
    return null
  }
}

async function interpretSimulationDistribution(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): Promise<string> {
  const context = buildContext(out, teamAName, teamBName)
  const result = await deepseekChat({
    systemPrompt:
      'You interpret fantasy matchup simulation distributions. In 2 concise sentences, explain what the deterministic outcome spread says about win odds, range overlap, and the most important swing slot.',
    prompt: context,
    temperature: 0.15,
    maxTokens: 180,
  })
  return result.content?.trim() || buildDistributionFallback(out, teamAName, teamBName)
}

async function buildStorylineFraming(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): Promise<string> {
  const context = buildContext(out, teamAName, teamBName)
  const grokResponse = await maybeCallGrok(
    'You are Grok writing one vivid fantasy sports storyline sentence. Keep it sharp, grounded in the simulation context, and free of numbered bullets.',
    context
  )
  if (grokResponse) return grokResponse
  return buildStorylineFallback(out, teamAName, teamBName)
}

async function buildMatchupExplanation(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): Promise<string> {
  const context = buildContext(out, teamAName, teamBName)
  const openaiResponse = await maybeCallOpenAI(
    'Explain this fantasy matchup clearly in 2-3 sentences. State who is favored, why the schedule and lineup profile matter, and what would need to happen for the underdog to flip it.',
    context
  )
  if (openaiResponse) return openaiResponse
  return buildExplanationFallback(out, teamAName, teamBName)
}

export async function getMatchupSimulationInsight(
  out: MatchupSimulationOutput,
  teamAName: string,
  teamBName: string
): Promise<MatchupProviderInsights> {
  const [deepseek, grok, openai] = await Promise.all([
    interpretSimulationDistribution(out, teamAName, teamBName),
    buildStorylineFraming(out, teamAName, teamBName),
    buildMatchupExplanation(out, teamAName, teamBName),
  ])

  return {
    deepseek,
    grok,
    openai,
  }
}
