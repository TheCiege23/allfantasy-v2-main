/**
 * What the "?" next to a term says — one dictionary, English and Spanish, for every `<TopicTip>` (components/core-app/TopicTip.tsx), which renders them
 * through the shared `<InfoTip>` control.
 *
 * ⚠ EACH SENTENCE IS A CLAIM ABOUT HOW THE PRODUCT WORKS, SO IT IS WRITTEN FROM THE CODE, NOT FROM
 * WHAT THE TERM USUALLY MEANS. "Shown once at least 8 leagues are counted" is MIN_LEAGUES_FOR_MARKET
 * in lib/core-app/rosteredMarket.ts; "the ranking uses the provider's figure" is how the waiver
 * boards rank. Change the behaviour and this text is wrong — grep for the topic id.
 *
 * Keep each body to two or three short sentences. A help bubble that needs scrolling has stopped
 * being help.
 */

import { WAIVERS_TOPICS } from './help-topics/waivers'
import { RANKINGS_TOPICS } from './help-topics/rankings'
import { DRAFT_TOPICS } from './help-topics/draft'
import { OUTLOOK_TOPICS } from './help-topics/outlook'
import { CAREER_TOPICS } from './help-topics/career'
import { HOME_TOPICS } from './help-topics/home'
import { TRADES_TOPICS } from './help-topics/trades'

export type HelpText = { title: string; body: string }
export type HelpTopic = { en: HelpText; es: HelpText }

/**
 * Every area's topics, merged. One file per area (lib/core-app/help-topics/*) so screens owned by
 * different people do not all edit one file. ⚠ A topic id must be unique ACROSS areas: a spread
 * silently keeps the last duplicate, so __tests__/core-app/topic-tip.test.tsx checks the count.
 */
export const HELP_TOPIC_AREAS = {
  waivers: WAIVERS_TOPICS,
  rankings: RANKINGS_TOPICS,
  draft: DRAFT_TOPICS,
  outlook: OUTLOOK_TOPICS,
  career: CAREER_TOPICS,
  home: HOME_TOPICS,
  trades: TRADES_TOPICS,
} as const

export const HELP_TOPICS = {
  ...WAIVERS_TOPICS,
  ...RANKINGS_TOPICS,
  ...DRAFT_TOPICS,
  ...OUTLOOK_TOPICS,
  ...CAREER_TOPICS,
  ...HOME_TOPICS,
  ...TRADES_TOPICS,
} satisfies Record<string, HelpTopic>

/** Derived, so a misspelt `topic=` fails the typecheck rather than rendering an empty bubble. */
export type HelpTopicId = keyof typeof HELP_TOPICS

/** The topic in the reader's language; anything but Spanish reads English. */
export function helpTopic(id: HelpTopicId, language: string): HelpText {
  const t: HelpTopic = HELP_TOPICS[id]
  return language === 'es' ? t.es : t.en
}
