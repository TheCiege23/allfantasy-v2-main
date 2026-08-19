/**
 * G15.12 — Story Engine public barrel.
 *
 * Backend narrative foundation built on the G15 Commissioner Intelligence read models.
 * Safe to import from server code; does NOT pull `server-only`-tainted modules.
 * No UI, no auto-post, no write actions, no LLM call here.
 */
export * from './types'
export { buildStoryContext, type StoryDataSource } from './storyContextBuilder'
export { generateStoryDraft, buildStoryPrompt, STORY_SAFETY_NOTE } from './storyGenerator'
export { StoryEngine, type StoryEngineRequest } from './StoryEngine'
