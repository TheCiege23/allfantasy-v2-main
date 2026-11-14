/**
 * LeagueStoryCreatorService — orchestrates story creation: assemble context, one-brain compose, fact guard, format.
 * One-brain merge: deterministic facts → DeepSeek (significance) → Grok (narrative frame) → OpenAI (final story).
 * All stories are fact-grounded; no invented players, matchups, standings, or scores.
 */

import { assembleNarrativeContext } from "./NarrativeContextAssembler"
import { buildDeterministicStoryFallback, composeOneBrainStory } from "./OneBrainNarrativeComposer"
import { validateStoryOutput } from "./StoryFactGuard"
import { formatStoryToSections } from "./NarrativeOutputFormatter"
import type { NarrativeContextPackage, StoryOutput, StoryStyle, StoryType } from "./types"

export interface CreateStoryInput {
  leagueId: string
  sport: string
  season?: number | null
  storyType: StoryType
  style?: StoryStyle
}

export interface CreateStoryResult {
  ok: boolean
  story?: StoryOutput
  sections?: ReturnType<typeof formatStoryToSections>
  context?: NarrativeContextPackage
  factGuardWarnings?: string[]
  factGuardErrors?: string[]
  error?: string
}

/**
 * Create a league story: assemble context, run one-brain composer, validate, format sections.
 */
export async function createLeagueStory(input: CreateStoryInput): Promise<CreateStoryResult> {
  try {
    const context = await assembleNarrativeContext({
      leagueId: input.leagueId,
      sport: input.sport,
      season: input.season ?? null,
      storyType: input.storyType,
    })

    let story =
      (await composeOneBrainStory(context, {
        preferredStyle: input.style,
      })) ?? buildDeterministicStoryFallback(context, input.style ?? "neutral")

    let guard = validateStoryOutput(story, context)
    if (guard.errors.length > 0) {
      const fallbackStory = buildDeterministicStoryFallback(context, input.style ?? "neutral")
      const fallbackGuard = validateStoryOutput(fallbackStory, context)
      story = fallbackStory
      guard = {
        passed: fallbackGuard.passed,
        errors: fallbackGuard.errors,
        warnings: Array.from(
          new Set([
            ...guard.warnings,
            ...guard.errors.map((error) => `Initial draft blocked: ${error}`),
            ...fallbackGuard.warnings,
          ])
        ),
      }
    }

    const sections = formatStoryToSections(story)

    return {
      ok: true,
      story,
      sections,
      context,
      factGuardWarnings: guard.warnings.length ? guard.warnings : undefined,
      factGuardErrors: guard.errors.length ? guard.errors : undefined,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create story"
    return { ok: false, error: message }
  }
}

export { formatStoryToSections, getStoryVariant } from "./NarrativeOutputFormatter"
