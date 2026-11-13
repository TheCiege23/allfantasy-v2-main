/**
 * Social Media Content Generator — caption templates per content type.
 * All captions include required hashtags (see constants).
 */

import { REQUIRED_HASHTAGS_STRING } from './constants'
import type { SocialContentType } from './types'
import type {
  DraftResultsContext,
  WeeklyRecapContext,
  TradeReactionContext,
  PowerRankingsContext,
} from './types'

function appendHashtags(text: string): string {
  return `${text.trim()}\n\n${REQUIRED_HASHTAGS_STRING}`
}

function getDraftResultsCaption(data: DraftResultsContext): string {
  const parts: string[] = []
  if (data.winnerName && data.grade) {
    parts.push(`Draft results are in. ${data.winnerName} takes the top grade with a ${data.grade}.`)
  } else if (data.topTeam) {
    parts.push(`${data.leagueName} draft grades: ${data.topTeam} leads the way.`)
  } else {
    parts.push(`${data.leagueName} — ${data.season} draft results are in.`)
  }
  if (data.highlight) parts.push(data.highlight)
  return appendHashtags(parts.join(' '))
}

function getWeeklyRecapCaption(data: WeeklyRecapContext): string {
  const parts: string[] = []
  if (data.week != null) parts.push(`Week ${data.week} recap.`)
  else parts.push('Weekly recap.')
  if (data.leagueName) parts.push(`${data.leagueName}.`)
  if (data.wins != null && data.losses != null) {
    parts.push(`Record: ${data.wins}-${data.losses}.`)
  }
  if (data.highlight) parts.push(data.highlight)
  if (data.summary) parts.push(data.summary)
  return appendHashtags(parts.join(' '))
}

function getTradeReactionCaption(data: TradeReactionContext): string {
  const sideAText = data.sideA.length ? data.sideA.join(', ') : 'Side A'
  const sideBText = data.sideB.length ? data.sideB.join(', ') : 'Side B'
  const parts: string[] = [
    `Trade reaction: ${sideAText} for ${sideBText}.`,
  ]
  if (data.grade) parts.push(`Grade: ${data.grade}.`)
  if (data.verdict) parts.push(data.verdict)
  if (data.insight) parts.push(data.insight)
  return appendHashtags(parts.join(' '))
}

function getPowerRankingsCaption(data: PowerRankingsContext): string {
  const parts: string[] = []
  if (data.leagueName) parts.push(`${data.leagueName} power rankings.`)
  parts.push(`#${data.rank} ${data.teamName}.`)
  if (data.change) parts.push(`(${data.change})`)
  if (data.blurb) parts.push(data.blurb)
  if (data.insight) parts.push(data.insight)
  return appendHashtags(parts.join(' '))
}

export function getCaptionForType(
  type: SocialContentType,
  data: DraftResultsContext | WeeklyRecapContext | TradeReactionContext | PowerRankingsContext
): string {
  switch (type) {
    case 'draft_results':
      return getDraftResultsCaption(data as DraftResultsContext)
    case 'weekly_recap':
      return getWeeklyRecapCaption(data as WeeklyRecapContext)
    case 'trade_reaction':
      return getTradeReactionCaption(data as TradeReactionContext)
    case 'power_rankings':
      return getPowerRankingsCaption(data as PowerRankingsContext)
    default:
      return appendHashtags('Fantasy football on AllFantasy.')
  }
}
