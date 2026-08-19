/**
 * G15.12 — Story Engine service boundary.
 *
 * The single entry point for producing league stories. Wires the privacy-safe context builder to
 * the deterministic generator. Consumes ONLY a StoryDataSource (the IntelligenceQueryService
 * read methods) — no raw DB, provider, payload, or chat access. Never throws (the context builder
 * degrades to empty/restricted). No UI, no auto-post, no write actions, no LLM call.
 */
import type { FeatureGatePrincipal } from '../intelligence/featureGate'
import { buildStoryContext, type StoryDataSource } from './storyContextBuilder'
import { buildStoryPrompt, generateStoryDraft } from './storyGenerator'
import { ALL_STORY_TYPES, type StoryContext, type StoryDraft, type StoryPrompt, type StoryType } from './types'

export interface StoryEngineRequest {
  leagueId: string
  type: StoryType
  principal?: FeatureGatePrincipal
  recentLimit?: number
  now?: Date
}

export class StoryEngine {
  constructor(private readonly source: StoryDataSource) {}

  /** Build the privacy-safe context for a league (shared across story types). */
  async buildContext(req: Omit<StoryEngineRequest, 'type'>): Promise<StoryContext> {
    return buildStoryContext({
      source: this.source,
      leagueId: req.leagueId,
      principal: req.principal,
      recentLimit: req.recentLimit,
      now: req.now,
    })
  }

  /** Generate a single deterministic story draft. */
  async generateStory(req: StoryEngineRequest): Promise<StoryDraft> {
    const ctx = await this.buildContext(req)
    return generateStoryDraft(req.type, ctx)
  }

  /** Generate all initial story types from one context fetch. */
  async generateAllStories(req: Omit<StoryEngineRequest, 'type'>): Promise<StoryDraft[]> {
    const ctx = await this.buildContext(req)
    return ALL_STORY_TYPES.map((type) => generateStoryDraft(type, ctx))
  }

  /** LLM-ready, privacy-safe prompt for a story type. Does NOT call a model. */
  async buildPrompt(req: StoryEngineRequest): Promise<StoryPrompt> {
    const ctx = await this.buildContext(req)
    return buildStoryPrompt(req.type, ctx)
  }
}
