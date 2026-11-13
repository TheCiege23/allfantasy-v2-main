/**
 * Social Media Content Generator — generate ready-to-post caption + image payload.
 */

import { REQUIRED_HASHTAGS_STRING } from './constants'
import { getCaptionForType } from './templates'
import type {
  SocialContentType,
  SocialContentContext,
  SocialContentResult,
  DraftResultsContext,
  WeeklyRecapContext,
  TradeReactionContext,
  PowerRankingsContext,
} from './types'

function generateCaption(context: SocialContentContext): string {
  return getCaptionForType(context.type, context.data)
}

function getTitleAndCard(
  type: SocialContentType,
  data: DraftResultsContext | WeeklyRecapContext | TradeReactionContext | PowerRankingsContext
): { title: string; bodyLines?: string[]; cardType: SocialContentResult['cardType']; cardPayload: unknown } {
  switch (type) {
    case 'draft_results': {
      const d = data as DraftResultsContext
      const title = d.winnerName
        ? `Winner of the Draft: ${d.winnerName}`
        : `${d.leagueName} — Draft Results`
      return {
        title,
        bodyLines: d.highlight ? [d.highlight] : undefined,
        cardType: 'draft',
        cardPayload: {
          variant: 'draft_winner' as const,
          leagueId: '',
          leagueName: d.leagueName,
          season: d.season,
          winnerName: d.winnerName ?? 'League',
          winnerRosterId: '',
          grade: d.grade,
          score: 0,
          insight: d.highlight ?? `${d.leagueName} ${d.season} draft results.`,
          blurb: d.topTeam,
        },
      }
    }
    case 'weekly_recap': {
      const w = data as WeeklyRecapContext
      const title = w.week != null ? `Week ${w.week} Recap` : 'Weekly Recap'
      const lines: string[] = []
      if (w.leagueName) lines.push(w.leagueName)
      if (w.wins != null && w.losses != null) lines.push(`Record: ${w.wins}-${w.losses}`)
      if (w.highlight) lines.push(w.highlight)
      if (w.summary) lines.push(w.summary)
      return {
        title,
        bodyLines: lines.length ? lines : undefined,
        cardType: 'weekly_recap',
        cardPayload: {
          title,
          bodyLines: lines.length ? lines : [w.summary ?? 'Another week in the books.'],
          leagueName: w.leagueName ?? 'League',
          week: w.week,
        },
      }
    }
    case 'trade_reaction': {
      const t = data as TradeReactionContext
      const title = 'Trade Reaction'
      return {
        title,
        cardType: 'trade_grade',
        cardPayload: {
          variant: 'trade_grade' as const,
          title: 'Trade Reaction',
          insight: t.insight ?? t.verdict ?? 'Breaking down the deal.',
          sideA: t.sideA,
          sideB: t.sideB,
          grade: t.grade,
          verdict: t.verdict,
        },
      }
    }
    case 'power_rankings': {
      const p = data as PowerRankingsContext
      const title = p.leagueName ? `${p.leagueName} Power Rankings` : 'Power Rankings'
      return {
        title,
        cardType: 'power_rankings',
        cardPayload: {
          variant: 'power_rankings' as const,
          title: `#${p.rank} ${p.teamName}`,
          insight: p.insight ?? p.blurb ?? 'Where your team stands.',
          rank: p.rank,
          teamName: p.teamName,
          change: p.change,
          blurb: p.blurb,
        },
      }
    }
    default: {
      return {
        title: 'Fantasy Football',
        cardType: 'weekly_recap',
        cardPayload: {
          title: 'Fantasy Football',
          bodyLines: ['Ready to post.'],
          leagueName: 'League',
        },
      }
    }
  }
}

export function generateContent(context: SocialContentContext): SocialContentResult {
  const caption = generateCaption(context)
  const { title, bodyLines, cardType, cardPayload } = getTitleAndCard(context.type, context.data)
  return {
    caption,
    hashtags: REQUIRED_HASHTAGS_STRING,
    title,
    bodyLines,
    cardType,
    cardPayload,
  }
}
