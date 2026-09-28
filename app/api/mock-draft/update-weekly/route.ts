import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'

const openai = getOpenAIRouteClient()

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gated = await aiCostGate(req, 'mock_weekly_ai', session.user.id)
    if (gated) return gated

    const { leagueId } = await req.json()

    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
    }

    const league = await prisma.league.findFirst({
      where: { id: leagueId, userId: session.user.id },
      include: {
        teams: {
          include: {
            performances: { orderBy: { week: 'desc' }, take: 5 },
          },
        },
        rosters: {
          select: { platformUserId: true, playerData: true },
          take: 20,
        },
      },
    })

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    const sport = String((league as any).sport || 'NFL').toUpperCase()
    if (sport !== 'NFL') {
      return NextResponse.json(
        { error: `Weekly re-simulation is currently available for NFL mock drafts only. ${sport} mocks already use the imported ${sport} player pool.` },
        { status: 400 },
      )
    }

    const latestMock = await prisma.mockDraft.findFirst({
      where: { leagueId, userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: { rounds: true, metadata: true },
    })

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentNews = await prisma.sportsNews.findMany({
      where: {
        sport: 'NFL',
        createdAt: { gte: oneWeekAgo },
      },
      orderBy: { publishedAt: 'desc' },
      take: 25,
      select: { playerName: true, title: true, content: true, team: true },
    })

    const injuryContext = recentNews
      .filter(n => {
        const text = `${n.title || ''} ${n.content || ''}`.toLowerCase()
        return text.includes('injury') || text.includes('out') || text.includes('questionable') || text.includes('doubtful')
      })
      .map(n => `${n.playerName || n.team || 'Unknown'}: ${n.title}`)
      .join('; ') || 'No major injuries reported recently'

    const numTeams = league.leagueSize || league.teams.length || 12
    const rounds = Math.max(1, Number((latestMock?.metadata as any)?.rounds ?? latestMock?.rounds ?? 15))
    const teamNames = league.teams.length > 0
      ? league.teams.map(t => t.teamName || t.ownerName || 'Unknown')
      : Array.from({ length: numTeams }, (_, i) => `Team ${i + 1}`)

    let performanceContext = ''
    if (league.teams.some(t => t.performances.length > 0)) {
      const perfSummaries = league.teams.map(t => {
        if (t.performances.length === 0) return null
        const avgPts = t.performances.reduce((s, p) => s + p.points, 0) / t.performances.length
        const trend = t.performances.length >= 2
          ? t.performances[0].points > t.performances[1].points ? 'trending up' : 'trending down'
          : 'stable'
        return `${t.teamName || t.ownerName}: ${avgPts.toFixed(1)} avg pts (${trend}), record ${t.wins}-${t.losses}`
      }).filter(Boolean)
      if (perfSummaries.length > 0) {
        performanceContext = `\n\nRecent team performance (last 5 weeks):\n${perfSummaries.join('\n')}`
      }
    }

    let rosterContext = ''
    if (league.rosters.length > 0) {
      const summaries = league.rosters.slice(0, numTeams).map((r, i) => {
        const data = r.playerData as any
        if (Array.isArray(data)) {
          return `${teamNames[i] || `Team ${i + 1}`}: ${data.length} players rostered`
        }
        return `${teamNames[i] || `Team ${i + 1}`}: roster data available`
      })
      rosterContext = `\n\nCurrent rosters:\n${summaries.join('\n')}`
    }

    const userTeamIdx = 0

    const systemPrompt = `You are an expert fantasy football mock draft simulator. This is a WEEKLY UPDATE re-simulation using the latest real-world data.

Rules:
- Generate a full ${rounds}-round mock draft for a ${numTeams}-team league
- Use snake draft order (odd rounds ascending, even rounds descending)
- Factor in recent injuries, news, and performance trends
- Each AI manager should have a distinct draft style
- Team at index ${userTeamIdx} ("${teamNames[userTeamIdx]}") is the user's team — mark those picks with isUser: true
- League format: ${league.scoring || 'PPR'}, ${league.isDynasty ? 'Dynasty' : 'Redraft'}
- Include real NFL player names with correct positions and teams
- Adjust ADP and values based on recent news and injuries

Return a JSON object with a "draftResults" array. Each pick object:
{ "round": number, "pick": number, "overall": number, "playerName": string, "position": string, "team": string, "manager": string, "confidence": number, "isUser": boolean, "value": number, "notes": string }`

    const userPrompt = `Re-simulate mock draft with UPDATED real-world data for this ${numTeams}-team ${league.isDynasty ? 'dynasty' : 'redraft'} ${league.scoring || 'PPR'} league.

Team names in draft order: ${teamNames.join(', ')}
User controls "${teamNames[userTeamIdx]}" (pick #${userTeamIdx + 1}).

Recent injuries/news: ${injuryContext}${performanceContext}${rosterContext}

Generate all ${rounds * numTeams} picks reflecting these latest updates.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: 8000,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
    }

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      console.error('[mock-draft-weekly] Failed to parse AI response:', content.slice(0, 500))
      return NextResponse.json({ error: 'Invalid AI response format' }, { status: 500 })
    }

    const draftResults = parsed?.draftResults || parsed?.draft_results || (Array.isArray(parsed) ? parsed : null)
    if (!Array.isArray(draftResults)) {
      console.error('[mock-draft-weekly] Unexpected response shape:', Object.keys(parsed))
      return NextResponse.json({ error: 'Invalid AI response format' }, { status: 500 })
    }

    try {
      await prisma.mockDraft.create({
        data: {
          leagueId,
          userId: session.user.id,
          rounds,
          results: draftResults,
        },
      })
    } catch (saveErr) {
      console.error('[mock-draft-weekly] Failed to save draft:', saveErr)
    }

    return NextResponse.json({ draftResults, success: true })
  } catch (err: any) {
    console.error('[mock-draft-weekly] Error:', err)
    return NextResponse.json({ error: err.message || 'Failed to update mock draft' }, { status: 500 })
  }
}
