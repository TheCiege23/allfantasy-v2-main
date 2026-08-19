/**
 * G15.12 — Deterministic Story Generator (+ optional LLM-ready prompt output).
 *
 * Produces structured narrative DRAFTS directly from a privacy-safe StoryContext — no LLM call.
 * Every generator is a pure function of the context, so output is deterministic and testable.
 * `buildStoryPrompt` emits an LLM-ready, privacy-safe prompt pair for LATER use; G15.12 does NOT
 * invoke any model.
 *
 * Safety: the context is already privacy-safe (no payloads / user ids / tokens). The generators
 * additionally enforce cautious, non-accusatory framing around engagement, inactivity, tanking,
 * and collusion.
 */
import { STORY_TYPES, type StoryContext, type StoryDraft, type StoryPrompt, type StorySection, type StoryType } from './types'

/** Baked-in safety directive reused across drafts + prompts. */
export const STORY_SAFETY_NOTE =
  'Derived from recorded in-app activity only. Observations, not accusations — no claims of ' +
  'collusion, tanking, or bad faith. Inactivity is described as "appears inactive based on ' +
  'recorded activity".'

const HEALTH_PHRASE: Record<string, string> = {
  healthy: 'looks healthy and active',
  cooling: 'is cooling off a little',
  stale: 'appears quiet based on recorded activity',
  unknown: 'does not have enough recorded activity to assess yet',
}

function titleFor(type: StoryType): string {
  switch (type) {
    case STORY_TYPES.WEEKLY_RECAP: return 'Weekly League Recap'
    case STORY_TYPES.COMMISSIONER_SUMMARY: return 'Commissioner Summary'
    case STORY_TYPES.ACTIVITY_REPORT: return 'League Activity Report'
    case STORY_TYPES.WHAT_HAPPENED_RECENTLY: return 'What Happened Recently'
    case STORY_TYPES.HEALTH_NARRATIVE: return 'League Health Narrative'
    default: return 'League Story'
  }
}

function activityBreakdown(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
}

function renderText(title: string, headline: string, sections: StorySection[]): string {
  const parts = [title, '', headline]
  for (const s of sections) parts.push('', s.heading, s.body)
  return parts.join('\n')
}

/** Build the empty-state draft (not enough recorded activity) or restricted notice. */
function emptyDraft(type: StoryType, ctx: StoryContext): StoryDraft {
  const title = titleFor(type)
  const headline =
    ctx.status === 'restricted'
      ? 'This story is not available for the current viewer.'
      : 'Not enough recorded league activity yet to tell this story.'
  const body =
    ctx.status === 'restricted'
      ? 'Commissioner intelligence for this league is not available to this user.'
      : 'Once the season is underway and members start making moves, recaps will fill in automatically. ' +
        STORY_SAFETY_NOTE
  const sections: StorySection[] = [{ heading: 'Status', body }]
  return {
    type,
    status: ctx.status,
    title,
    headline,
    sections,
    bullets: [headline],
    text: renderText(title, headline, sections),
    empty: true,
    generatedAt: ctx.generatedAt,
    sourceFreshness: ctx.activity.lastActivityAt,
  }
}

// ── Per-type deterministic generators ────────────────────────────────────────

function weeklyRecap(ctx: StoryContext): StorySection[] {
  const breakdown = activityBreakdown(ctx.activity.counts)
  const sections: StorySection[] = [
    {
      heading: 'Activity',
      body:
        `The league logged ${ctx.activity.totalEvents} recorded action(s)` +
        (breakdown.length ? ` — ${breakdown.join(', ')}.` : '.') +
        (ctx.activity.openTradeProposals > 0
          ? ` There ${ctx.activity.openTradeProposals === 1 ? 'is' : 'are'} ${ctx.activity.openTradeProposals} open trade proposal(s) awaiting resolution.`
          : ''),
    },
    {
      heading: 'Engagement',
      body: `${ctx.health.activeManagers} of ${ctx.health.totalManagers} manager(s) have been active recently. The league ${HEALTH_PHRASE[ctx.health.status] ?? 'is active'}.`,
    },
  ]
  if (ctx.recent.length) {
    sections.push({ heading: 'Highlights', body: ctx.recent.slice(0, 5).map((r) => `• ${r.summary}`).join('\n') })
  }
  return sections
}

function commissionerSummary(ctx: StoryContext): StorySection[] {
  const items = ctx.actionItems.length
    ? ctx.actionItems.map((i) => `• [${i.severity}] ${i.message}`).join('\n')
    : '• No action items — the league looks healthy.'
  return [
    { heading: 'Health', body: `Health score ${ctx.health.score}/100 (${ctx.health.status}). The league ${HEALTH_PHRASE[ctx.health.status] ?? 'is active'}.` },
    { heading: 'Needs attention', body: items },
    { heading: 'Activity', body: `${ctx.activity.totalEvents} recorded action(s); ${ctx.activity.openTradeProposals} open trade proposal(s). ${STORY_SAFETY_NOTE}` },
  ]
}

function activityReport(ctx: StoryContext): StorySection[] {
  const breakdown = activityBreakdown(ctx.activity.counts)
  return [
    { heading: 'Totals', body: `${ctx.activity.totalEvents} recorded action(s) since ${ctx.activity.firstEventAt ?? 'the season began'}.` },
    { heading: 'By type', body: breakdown.length ? breakdown.map((b) => `• ${b}`).join('\n') : '• No categorized activity yet.' },
    { heading: 'Open items', body: `${ctx.activity.openTradeProposals} open trade proposal(s). Last activity: ${ctx.activity.lastActivityAt ?? 'unknown'}.` },
  ]
}

function whatHappenedRecently(ctx: StoryContext): StorySection[] {
  if (!ctx.recent.length) {
    return [{ heading: 'Recent timeline', body: 'No recent recorded activity to report.' }]
  }
  return [
    { heading: 'Recent timeline', body: ctx.recent.map((r) => `• ${r.summary} (${r.occurredAt})`).join('\n') },
  ]
}

function healthNarrative(ctx: StoryContext): StorySection[] {
  const days = ctx.health.daysSinceLastActivity
  const recency = days == null ? 'There is no recorded activity yet.' : `Last activity was about ${days} day(s) ago.`
  return [
    { heading: 'Overall', body: `The league ${HEALTH_PHRASE[ctx.health.status] ?? 'is active'} (health ${ctx.health.score}/100). ${recency}` },
    { heading: 'Participation', body: `${ctx.health.activeManagers} of ${ctx.health.totalManagers} manager(s) active recently.` },
    {
      heading: 'Notes',
      body:
        (ctx.actionItems.length
          ? ctx.actionItems.map((i) => `• ${i.message}`).join('\n') + '\n'
          : '• No concerns flagged.\n') + STORY_SAFETY_NOTE,
    },
  ]
}

const GENERATORS: Record<StoryType, (ctx: StoryContext) => StorySection[]> = {
  [STORY_TYPES.WEEKLY_RECAP]: weeklyRecap,
  [STORY_TYPES.COMMISSIONER_SUMMARY]: commissionerSummary,
  [STORY_TYPES.ACTIVITY_REPORT]: activityReport,
  [STORY_TYPES.WHAT_HAPPENED_RECENTLY]: whatHappenedRecently,
  [STORY_TYPES.HEALTH_NARRATIVE]: healthNarrative,
}

function headlineFor(type: StoryType, ctx: StoryContext): string {
  switch (type) {
    case STORY_TYPES.WEEKLY_RECAP:
      return `${ctx.activity.totalEvents} move(s) this stretch — the league ${HEALTH_PHRASE[ctx.health.status] ?? 'is active'}.`
    case STORY_TYPES.COMMISSIONER_SUMMARY:
      return ctx.actionItems.length ? `${ctx.actionItems.length} item(s) may need your attention.` : 'No action items — the league looks healthy.'
    case STORY_TYPES.ACTIVITY_REPORT:
      return `${ctx.activity.totalEvents} recorded action(s); ${ctx.activity.openTradeProposals} open trade(s).`
    case STORY_TYPES.WHAT_HAPPENED_RECENTLY:
      return ctx.recent.length ? `The latest ${ctx.recent.length} thing(s) that happened.` : 'Nothing new to report.'
    case STORY_TYPES.HEALTH_NARRATIVE:
      return `League health ${ctx.health.score}/100 — ${ctx.health.status}.`
    default:
      return 'League story.'
  }
}

/** Generate a deterministic, privacy-safe story draft from a context. No LLM. */
export function generateStoryDraft(type: StoryType, ctx: StoryContext): StoryDraft {
  if (ctx.status !== 'ok') return emptyDraft(type, ctx)
  const title = titleFor(type)
  const headline = headlineFor(type, ctx)
  const sections = (GENERATORS[type] ?? activityReport)(ctx)
  const bullets = sections.flatMap((s) => s.body.split('\n').map((l) => l.replace(/^•\s?/, '').trim()).filter(Boolean))
  return {
    type, status: 'ok', title, headline, sections, bullets,
    text: renderText(title, headline, sections), empty: false,
    generatedAt: ctx.generatedAt, sourceFreshness: ctx.activity.lastActivityAt,
  }
}

/**
 * LLM-ready, privacy-safe prompt pair for LATER use. Does NOT call any model in G15.12.
 * The `user` content is the already-privacy-safe context (counts/scores/labels/timeline strings).
 */
export function buildStoryPrompt(type: StoryType, ctx: StoryContext): StoryPrompt {
  const system =
    `You are AllFantasy's league storyteller. Write a short, fun, factual "${titleFor(type)}". ` +
    `${STORY_SAFETY_NOTE} Use ONLY the data provided. Do not invent names, scores, or events.`
  const safe = {
    sport: ctx.sport,
    leagueConcept: ctx.leagueConcept,
    activity: ctx.activity,
    health: ctx.health,
    actionItems: ctx.actionItems,
    recent: ctx.recent,
  }
  const user = `Story type: ${type}\nLeague data (privacy-safe):\n${JSON.stringify(safe, null, 2)}`
  return { type, system, user }
}
