import 'server-only'

import { getCachedAiResult, saveAiResult } from '@/lib/ai/ai-result-cache'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { routeTextCall } from '@/lib/ai/providerRouter'
import type { ReceiptsLeague } from './decisionReceipts'
import { getRoutineFacts } from './weeklyRoutine'
import { buildWeeklyStory, headlineFacts, headlinePrompt, validateHeadline, type WeeklyStory } from './weeklyStoryModel'

/**
 * Weekly Career Story — the I/O half. The facts are the home's own (`getRoutineFacts`), so the story
 * and the "Your week" card can never disagree about last week.
 *
 * ⚠ CHIMMY WRITES ONE LINE, ON OPEN, ONCE PER USER-WEEK (user decision 2026-10-01). The cards are
 * deterministic; only the cover headline is generated, and only when the viewer is opened — so a
 * week nobody looks at costs nothing. It is cached per user and per FACTS: a Monday-night game that
 * settles after the first open changes the facts, and with them the cache key, so a headline written
 * about 2-1 is never served over a 2-2 week.
 */

const FEATURE = 'career_weekly_story_headline'
/** A week's story stops being opened once the next one exists; eight days covers the Tuesday lag. */
const HEADLINE_TTL_SECONDS = 8 * 24 * 60 * 60

export async function getWeeklyStory(args: {
  userId: string
  leagues: readonly ReceiptsLeague[]
  /** Weekly awards are keyed by the Sleeper user id; absent means none are matched. */
  ownerSleeperId?: string | null
}): Promise<WeeklyStory | null> {
  const facts = await getRoutineFacts({
    userId: args.userId,
    leagues: args.leagues,
    currentWeek: null, // the story is last week; this week's adds are not part of it
    ownerSleeperId: args.ownerSleeperId ?? null,
  })
  return buildWeeklyStory({
    lastWeek: facts.lastWeek,
    topScorer: facts.topScorer,
    awards: facts.awards.map((a) => ({ leagueId: a.leagueId, leagueName: a.leagueName, label: a.label, value: a.value, unit: a.unit })),
    upsets: facts.upsets.map((u) => ({
      leagueId: u.leagueId,
      leagueName: u.leagueName,
      winChance: u.winChance,
      pointsFor: u.pointsFor,
      pointsAgainst: u.pointsAgainst,
    })),
  })
}

export type StoryHeadline = { text: string; source: 'chimmy' | 'template' }

/**
 * The cover line. Never throws: every failure — spend switched off, no provider, a refused line —
 * is the template, which is always true.
 *
 * ⚠ A REFUSED LINE IS CACHED AS THE TEMPLATE. Otherwise a model that keeps quoting a number the
 * facts do not hold would be asked again, and paid again, on every open of the same week.
 */
export async function getWeeklyStoryHeadline(userId: string, story: WeeklyStory): Promise<StoryHeadline> {
  const template: StoryHeadline = { text: story.templateHeadline, source: 'template' }
  if (!isAiSpendEnabled()) return template

  const key = { feature: FEATURE, scopeType: 'user_week', scopeId: `${userId}:${story.id}`, payload: headlineFacts(story).lines }
  const cached = await getCachedAiResult(key).catch(() => null)
  if (cached?.resultText) {
    try {
      const hit = JSON.parse(cached.resultText) as StoryHeadline
      if (typeof hit.text === 'string' && (hit.source === 'chimmy' || hit.source === 'template')) return hit
    } catch {
      // A corrupt entry is a miss.
    }
  }

  const result = await routeTextCall({
    messages: [{ role: 'user', content: headlinePrompt(story) }],
    maxTokens: 80,
    temperature: 0.7,
    profile: 'cheap',
    feature: FEATURE,
    userId,
  }).catch(() => null)
  if (!result?.ok) return template // a provider outage is not cached: the next open may succeed

  const valid = validateHeadline(result.text, story)
  const headline: StoryHeadline = valid ? { text: valid, source: 'chimmy' } : template
  await saveAiResult({
    ...key,
    provider: result.provider,
    model: result.model ?? null,
    resultText: JSON.stringify(headline),
    status: valid ? 'ok' : 'refused',
    ttlSeconds: HEADLINE_TTL_SECONDS,
  }).catch(() => undefined)
  return headline
}
