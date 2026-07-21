import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

type ShareType = 'legacy' | 'trade' | 'rankings' | 'exposure' | 'waiver'

type ShareInput = {
  sleeper_username: string
  share_type?: ShareType
  ranking_preview?: {
    career?: { xp?: number; level?: number; tier?: number; tier_name?: string }
    yearly_projection?: {
      baseline_year_xp?: number
      ai_low_year_xp?: number
      ai_mid_year_xp?: number
      ai_high_year_xp?: number
    }
  }
  trade_data?: {
    side_a: string[]
    side_b: string[]
    grade?: string
    verdict?: string
    league_type?: string
  }
  rankings_data?: {
    league_name?: string
    rank?: number
    total_teams?: number
    roster_value?: string
    outlook?: string
  }
  exposure_data?: {
    player_name?: string
    ownership_pct?: number
    leagues_owned?: number
    total_leagues?: number
    signal?: string
  }
  waiver_data?: {
    player_name?: string
    recommendation?: string
    faab_pct?: number
    reason?: string
  }
  style?: 'clean' | 'funny' | 'hype' | 'balanced' | 'humble' | 'trash_talk'
  platform?: 'x' | 'tiktok' | 'instagram' | 'threads'
}

type ShareOutput = { caption: string; alt_captions: string[]; hashtags: string[] }

function getPlatformConfig(platform: string) {
  switch (platform) {
    case 'tiktok':
      return { maxLen: 150, name: 'TikTok', hashtagStyle: 'trending' }
    case 'instagram':
      return { maxLen: 2200, name: 'Instagram', hashtagStyle: 'many' }
    case 'threads':
      return { maxLen: 500, name: 'Threads', hashtagStyle: 'minimal' }
    case 'x':
    default:
      return { maxLen: 280, name: 'X/Twitter', hashtagStyle: 'minimal' }
  }
}

function getStyleGuide(style: string) {
  switch (style) {
    case 'trash_talk':
      return 'confident and spicy trash talk, playful but not hateful, witty and competitive'
    case 'humble':
      return 'humble and grateful, low ego, share progress without bragging'
    case 'balanced':
      return 'balanced and relatable, a light flex with friendly tone'
    case 'funny':
      return 'humorous and playful, use wit and self-deprecating humor where appropriate'
    case 'hype':
      return 'high energy hype mode, confident and bold, flex the stats'
    case 'clean':
    default:
      return 'clean and professional, straightforward stats presentation'
  }
}

function stripJsonFences(s: string) {
  const t = (s || '').trim()
  if (t.startsWith('```')) return t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  return t
}

function buildSharePrompt(
  shareType: ShareType,
  body: ShareInput,
  platformConfig: { maxLen: number; name: string; hashtagStyle: string },
  styleGuide: string
): string {
  const username = body.sleeper_username

  if (shareType === 'trade') {
    if (!body.trade_data || !body.trade_data.side_a?.length) {
      // Fallback for missing trade data - shouldn't happen due to client validation
      return `Generate a generic social media caption about fantasy football trades and getting community feedback on allfantasy.ai. Max ${platformConfig.maxLen} chars. Tone: ${styleGuide}. Return JSON only: {"caption": "...", "alt_captions": ["...", "..."], "hashtags": ["...", "...", "..."]}`
    }
    const { side_a, side_b, grade, verdict, league_type } = body.trade_data
    return `Generate a social media caption for a fantasy manager sharing a trade for community feedback/voting.

Trade Details:
- Side A gives: ${side_a.join(', ')}
- Side B gives: ${side_b.join(', ')}
- AI Grade: ${grade || 'Pending'}
- AI Verdict: ${verdict || 'Analyzing...'}
- League Type: ${league_type || 'Dynasty'}

Platform: ${platformConfig.name} (max ${platformConfig.maxLen} characters)
Tone/Style: ${styleGuide}

Requirements:
1) Frame this as asking the community to vote/weigh in on the trade
2) List the key players on each side
3) Include the AI's take if available
4) Make it engaging and encourage discussion
5) Must include "allfantasy.ai" and use 1-2 relevant emojis

Return ONLY valid JSON:
{
  "caption": "primary caption text",
  "alt_captions": ["alternate caption 1", "alternate caption 2"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`
  }

  if (shareType === 'rankings') {
    if (!body.rankings_data || !body.rankings_data.rank) {
      return `Generate a generic social media caption about dynasty fantasy football league rankings and checking standings on allfantasy.ai. Max ${platformConfig.maxLen} chars. Tone: ${styleGuide}. Return JSON only: {"caption": "...", "alt_captions": ["...", "..."], "hashtags": ["...", "...", "..."]}`
    }
    const { league_name, rank, total_teams, roster_value, outlook } = body.rankings_data
    return `Generate a social media caption for a fantasy manager sharing their league standing.

Ranking Details:
- League: ${league_name || 'Dynasty League'}
- Rank: #${rank || '?'} of ${total_teams || '?'} teams
- Roster Value: ${roster_value || 'Calculating...'}
- AI Outlook: ${outlook || 'Analyzing...'}

Platform: ${platformConfig.name} (max ${platformConfig.maxLen} characters)
Tone/Style: ${styleGuide}

Requirements:
1) Highlight their rank and team strength
2) If top 3, flex it. If lower, frame as a comeback story
3) Include roster value if impressive
4) Make it shareable and engaging
5) Must include "allfantasy.ai" and use 1-2 relevant emojis

Return ONLY valid JSON:
{
  "caption": "primary caption text",
  "alt_captions": ["alternate caption 1", "alternate caption 2"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`
  }

  if (shareType === 'exposure') {
    if (!body.exposure_data || !body.exposure_data.player_name) {
      return `Generate a generic social media caption about player exposure and portfolio management in fantasy football on allfantasy.ai. Max ${platformConfig.maxLen} chars. Tone: ${styleGuide}. Return JSON only: {"caption": "...", "alt_captions": ["...", "..."], "hashtags": ["...", "...", "..."]}`
    }
    const { player_name, ownership_pct, leagues_owned, total_leagues, signal } = body.exposure_data
    return `Generate a social media caption for a fantasy manager sharing their player exposure/stock position.

Exposure Details:
- Player: ${player_name}
- Ownership: ${ownership_pct?.toFixed(1) || '?'}% (${leagues_owned || '?'} of ${total_leagues || '?'} leagues)
- AI Signal: ${signal || 'Hold'}

Platform: ${platformConfig.name} (max ${platformConfig.maxLen} characters)
Tone/Style: ${styleGuide}

Requirements:
1) Frame it like a stock market position/play
2) Mention the ownership percentage and signal
3) Ask community if they're buying, selling, or holding
4) Make it engaging for fantasy community discussion
5) Must include "allfantasy.ai" and use 1-2 relevant emojis

Return ONLY valid JSON:
{
  "caption": "primary caption text",
  "alt_captions": ["alternate caption 1", "alternate caption 2"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`
  }

  if (shareType === 'waiver' && body.waiver_data) {
    const { player_name, recommendation, faab_pct, reason } = body.waiver_data
    return `Generate a social media caption for a fantasy manager sharing an AI waiver wire recommendation.

Waiver Details:
- Player: ${player_name}
- AI Recommendation: ${recommendation || 'Add'}
- Suggested FAAB: ${faab_pct || '?'}%
- Reason: ${reason || 'Opportunity knocking'}

Platform: ${platformConfig.name} (max ${platformConfig.maxLen} characters)
Tone/Style: ${styleGuide}

Requirements:
1) Frame it as a hot waiver tip or sleeper alert
2) Include the FAAB suggestion if available
3) Create urgency or hype around the pickup
4) Ask if others are adding this player
5) Must include "allfantasy.ai" and use 1-2 relevant emojis

Return ONLY valid JSON:
{
  "caption": "primary caption text",
  "alt_captions": ["alternate caption 1", "alternate caption 2"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`
  }

  // Default: legacy ranking share
  const career = body.ranking_preview?.career ?? {}
  const projection = body.ranking_preview?.yearly_projection ?? {}
  const tierName = career.tier_name || 'Practice Squad'
  const level = career.level ?? 0
  const tier = career.tier ?? 1
  const careerXp = career.xp ?? 0
  const baselineXp = projection.baseline_year_xp ?? 0
  const aiLow = projection.ai_low_year_xp ?? 0
  const aiMid = projection.ai_mid_year_xp ?? 0
  const aiHigh = projection.ai_high_year_xp ?? 0

  return `Generate social media captions for a fantasy sports player sharing their AllFantasy ranking.

Player Data:
- Username: ${username}
- Tier: ${tier} (${tierName})
- Level: ${level}
- Career XP: ${Number(careerXp).toLocaleString()}
- Baseline Yearly XP: ${Number(baselineXp).toLocaleString()}
- With AI Projected XP Range: ${Number(aiLow).toLocaleString()} - ${Number(aiHigh).toLocaleString()} (mid: ${Number(aiMid).toLocaleString()})

Platform: ${platformConfig.name} (max ${platformConfig.maxLen} characters per caption)
Tone/Style: ${styleGuide}

Requirements:
1) Each caption MUST mention the tier name and level (e.g., "Tier ${tier} ${tierName}, Level ${level}")
2) Each caption MUST include baseline yearly XP and the "with AI" projected range
3) Each caption MUST include "allfantasy.ai"
4) Captions must be under ${platformConfig.maxLen} characters
5) Use 1-2 relevant emojis per caption
6) Make it shareable and engaging
7) If any ranking numbers look missing or zero, write around it without calling it "missing" (still mention tier/level and a general AI improvement range).

Return a JSON object with exactly these fields:
{
  "caption": "primary caption text",
  "alt_captions": ["alternate caption 1", "alternate caption 2"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"]
}

Hashtag style: ${
    platformConfig.hashtagStyle === 'many'
      ? '8-10 hashtags'
      : platformConfig.hashtagStyle === 'trending'
      ? '3-5 trending style'
      : '3-5 minimal'
  }

Return ONLY valid JSON, no other text.`
}

export const POST = withApiUsage({ endpoint: "/api/legacy/share", tool: "LegacyShare" })(async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => null)) as ShareInput | null
    const style = (body?.style ?? 'balanced') as ShareInput['style']
    const platform = (body?.platform ?? 'x') as ShareInput['platform']

    /*
     * Was `requireAuthOrOrigin` plus a limiter keyed on the caller-supplied username with
     * `includeIpInKey: false` — so rotating the username bought unlimited model calls.
     * The shared gate keys on the authenticated actor and folds in the IP.
     */
    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: body?.sleeper_username?.trim() || null,
      rateLimit: { action: 'share', maxRequests: 5, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername.toLowerCase()

    const xaiApiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
    if (!xaiApiKey) {
      return NextResponse.json(
        { success: false, error: 'XAI_API_KEY/GROK_API_KEY not configured. Set one in Secrets to enable Grok-powered captions.' },
        { status: 500 }
      )
    }

    const shareType = (body?.share_type || 'legacy') as ShareType
    const platformConfig = getPlatformConfig(platform || 'x')
    const styleGuide = getStyleGuide(style || 'balanced')

    const prompt = buildSharePrompt(shareType, body!, platformConfig, styleGuide)

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xaiApiKey}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a social media caption generator. Always respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        model: process.env.XAI_MODEL || 'grok-3',
        stream: false,
        temperature: 0.8,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return NextResponse.json(
        { success: false, error: 'Grok API request failed', details: errText.slice(0, 500) },
        { status: 500 }
      )
    }

    const grokResponse = await response.json().catch(() => null)
    const rawContent = grokResponse?.choices?.[0]?.message?.content?.trim?.() || ''
    const content = stripJsonFences(rawContent)

    let parsed: ShareOutput | null = null
    try {
      parsed = JSON.parse(content) as ShareOutput
    } catch {
      parsed = null
    }

    if (!parsed?.caption || !Array.isArray(parsed.alt_captions) || !Array.isArray(parsed.hashtags)) {
      return NextResponse.json(
        { success: false, error: 'Failed to parse Grok response', raw: rawContent.slice(0, 500) },
        { status: 500 }
      )
    }

    const hashtagLine = (parsed.hashtags || [])
      .filter(Boolean)
      .map((h) => (String(h).startsWith('#') ? String(h) : `#${h}`))
      .join(' ')
    const share_text = [parsed.caption, hashtagLine].filter(Boolean).join('\n')

    // Track tool usage
    trackLegacyToolUsage('share_generate', null, null, { style, platform, share_type: shareType })

    return NextResponse.json({
      ok: true,
      success: true,
      share_text,
      caption: parsed.caption,
      alt_captions: parsed.alt_captions.slice(0, 2),
      hashtags: parsed.hashtags,
      platform,
      style,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to generate share captions', details: String(error) },
      { status: 500 }
    )
  }
})

