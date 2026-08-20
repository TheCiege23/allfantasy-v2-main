import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listInjuryFacts, type InjuryFactListItem } from '@/lib/injuries/injuryReadPort'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'

const openai = getOpenAIRouteClient()

export const GET = withApiUsage({ endpoint: "/api/legacy/community-insights", tool: "LegacyCommunityInsights" })(async (request: NextRequest) => {
  const auth = requireAuthOrOrigin(request)
  if (!auth.authenticated) {
    return forbiddenResponse(auth.error || 'Unauthorized')
  }

  const { searchParams } = new URL(request.url)
  const summarize = searchParams?.get('summarize') === 'true'

  const sourcesUsed: string[] = []
  const missingSources: string[] = []
  const errors: string[] = []

  try {
    let recentNews: any[] = []
    let recentInjuries: InjuryFactListItem[] = []

    const [newsResult, injuryResult] = await Promise.allSettled([
      prisma.sportsNews.findMany({
        where: {
          publishedAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
        orderBy: { publishedAt: 'desc' },
        take: 20,
      }),
      // Slice 18 follow-on — canonical injury read port (one row per player,
      // TTL-respected, freshest source wins) instead of an ad-hoc 48h query.
      listInjuryFacts({
        sport: 'NFL',
        statuses: ['Out', 'Doubtful', 'Questionable', 'IR'],
        maxAgeHours: 48,
        limit: 10,
      }),
    ])

    if (newsResult.status === 'fulfilled') {
      recentNews = newsResult.value
      if (recentNews.length > 0) sourcesUsed.push('news')
    } else {
      errors.push(`news: ${String(newsResult.reason)}`)
      missingSources.push('news')
    }

    if (injuryResult.status === 'fulfilled') {
      recentInjuries = injuryResult.value.facts
      if (recentInjuries.length > 0) sourcesUsed.push('injuries')
    } else {
      errors.push(`injuries: ${String(injuryResult.reason)}`)
      missingSources.push('injuries')
    }

    const trendingTopics: { topic: string; count: number; articles: string[] }[] = []
    const topicMap = new Map<string, { count: number; articles: string[] }>()

    for (const article of recentNews) {
      const team = article.team || 'General'
      const existing = topicMap.get(team) || { count: 0, articles: [] }
      existing.count++
      existing.articles.push(article.title)
      topicMap.set(team, existing)
    }

    for (const [topic, data] of topicMap) {
      if (data.count >= 2) {
        trendingTopics.push({ topic, count: data.count, articles: data.articles.slice(0, 3) })
      }
    }

    trendingTopics.sort((a, b) => b.count - a.count)

    let aiSummary: string | null = null
    if (summarize && recentNews.length >= 3) {
      try {
        const headlines = recentNews.slice(0, 15).map((n: any) => `[${n.source}] ${n.title}`).join('\n')
        const injuryList = recentInjuries.slice(0, 5).map((i: any) => `${i.playerName} (${i.team}): ${i.status}`).join('\n')

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a fantasy sports news analyst. Summarize the trending NFL news and injuries into a brief, actionable fantasy sports briefing. Focus on fantasy-relevant implications. Be concise (3-5 bullet points max). Include specific player names and actionable advice.',
            },
            {
              role: 'user',
              content: `Summarize these trending NFL stories for fantasy managers:\n\nHEADLINES:\n${headlines}\n\nKEY INJURIES:\n${injuryList || 'None reported'}`,
            },
          ],
          max_tokens: 500,
          temperature: 0.5,
        })

        aiSummary = completion.choices[0]?.message?.content || null
        if (aiSummary) sourcesUsed.push('ai_summary')
      } catch (err) {
        errors.push(`ai_summary: ${String(err)}`)
        missingSources.push('ai_summary')
        console.warn('[CommunityInsights] AI summary failed:', err)
      }
    }

    return NextResponse.json({
      trending: trendingTopics.slice(0, 8),
      recentNews: recentNews.slice(0, 10).map((n: any) => ({
        title: n.title,
        source: n.source,
        team: n.team,
        publishedAt: n.publishedAt?.toISOString(),
      })),
      injuries: recentInjuries.map((i: any) => ({
        playerName: i.playerName,
        team: i.team,
        position: i.position,
        status: i.status,
        description: i.description,
      })),
      aiSummary,
      dataFreshness: {
        newsCount: recentNews.length,
        injuryCount: recentInjuries.length,
        trendingTopics: trendingTopics.length,
      },
      audit: {
        sourcesUsed,
        partialData: missingSources.length > 0,
        missingSources,
        errors,
      },
    })
  } catch (error) {
    console.error('Community insights failed:', error)
    return NextResponse.json({
      error: 'Failed to generate community insights',
      audit: {
        sourcesUsed,
        partialData: true,
        missingSources: ['news', 'injuries'],
        errors: [String(error)],
      },
    }, { status: 500 })
  }
})

