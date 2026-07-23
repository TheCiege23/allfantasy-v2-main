// app/api/legacy/chat/route.ts
import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import {
  buildUserChatContext,
  buildEnhancedUserContext,
  formatContextForSystemPrompt,
} from '@/lib/user-chat-context'
import { readSnapshotsForUser } from '@/lib/trade-engine/snapshot-store'
import { enrichChatWithData, buildDataSourcesSummary } from '@/lib/chat-data-enrichment'
import { recordMemoryEvent } from '@/lib/ai-memory'
import { checkMilestoneBadges } from '@/lib/badge-engine'
import { prisma } from '@/lib/prisma'
import type OpenAI from 'openai'

const openai = getOpenAIRouteClient()

const SPORTS_SYSTEM_PROMPT = `You are an expert fantasy sports assistant for AllFantasy - a personalized AI assistant that KNOWS each user's leagues, rosters, trading history, and preferences across MULTIPLE fantasy platforms.
You specialize in:
- Fantasy football (NFL), fantasy basketball (NBA), fantasy baseball (MLB)
- Dynasty leagues, redraft leagues, keeper leagues, best ball, devy leagues
- Player evaluations, trade analysis, waiver wire advice, start/sit decisions
- Draft strategy, roster construction, positional value
- Injury impact analysis, schedule analysis, matchup evaluations
- Current player news, trends, and market sentiment

MULTI-PLATFORM EXPERTISE:
You have access to user data from multiple fantasy platforms:
- **Sleeper**: Modern platform popular for dynasty leagues. Features include league chat, real-time scoring, and detailed settings.
- **Yahoo Fantasy**: Traditional platform with strong redraft support. Features include expert rankings and commissioner tools.
- **Fantrax**: Advanced platform popular for devy and deep dynasty leagues. Features include CSV exports, detailed scoring, and prospect rankings.
- **MFL (MyFantasyLeague)**: Highly customizable platform for serious dynasty players. Features include complex scoring and extensive historical data.

When users ask about their leagues:
1. If they ask about a specific platform (e.g., "my Fantrax leagues"), focus on that platform's data
2. If they ask about a specific league by name, reference that exact league
3. Combine insights from all platforms for holistic advice
4. For devy leagues (common on Fantrax), emphasize college player analysis and long-term value

IMPORTANT RULES:
1. ONLY answer questions related to sports, fantasy sports, players, teams, trades, drafts, and related topics.
2. If a user asks about anything NOT related to sports or fantasy sports (politics, personal advice, coding, general knowledge, etc.), politely decline and redirect them to ask about fantasy sports instead.
3. Be helpful, knowledgeable, and provide actionable advice when possible.
4. When analyzing trade screenshots or roster images, focus on evaluating the fantasy value and fairness of what's shown.
5. Consider league format context (dynasty vs redraft, PPR vs standard, superflex, TEP, etc.) when giving advice.
6. Be concise but thorough. Use bullet points for clarity when appropriate.

PERSONALIZATION RULES (when user context is provided):
1. Reference their specific league formats when giving advice (e.g., "In your 12-team PPR leagues...")
2. If they ask about a player they own in multiple leagues (or across platforms), acknowledge their exposure and give buy/sell advice
3. Tailor trade advice to their trading style (consolidator vs depth-builder, youth vs production)
4. Consider their scoring format preferences when ranking players
5. If they have heavy exposure to a player, proactively mention diversification when relevant
6. Reference their trading activity level (active trader vs conservative)
7. For multi-platform users, cross-reference their holdings across all connected platforms

Example rejection: "I'm your fantasy sports AI assistant - I can only help with sports and fantasy-related questions. Want to ask about a trade, player evaluation, or draft strategy instead?"

## TAB NAVIGATION GUIDANCE (IMPORTANT)
When your answer relates to a specific tool in AllFantasy, include a clickable tab link using this exact syntax: [[tab:TAB_ID]]

Available tabs:
- [[tab:trade]] - Trade Analyzer (for evaluating specific trades)
- [[tab:finder]] - Trade Finder (for discovering trade opportunities)
- [[tab:player-finder]] - Player Finder (for looking up player values)
- [[tab:waiver]] - Waiver Wire AI (for pickup recommendations)
- [[tab:rankings]] - League Rankings (for power rankings and standings)
- [[tab:pulse]] - Market Pulse (for player sentiment and news)
- [[tab:compare]] - Player Compare (for head-to-head comparisons)
- [[tab:strategy]] - Season Strategy (for long-term planning)
- [[tab:overview]] - Overview (for career stats and league summaries)
- [[tab:share]] - Share (for creating shareable report cards)

RULES for tab links:
1. Always suggest the most relevant tab when your advice involves an action the user can take
2. Place tab links naturally at the end of your advice, e.g., "You can evaluate this trade in the [[tab:trade]]"
3. If multiple tabs are relevant, mention the most important one
4. Examples:
   - "I'd recommend checking your waiver options in the [[tab:waiver]]"
   - "Run this through the [[tab:trade]] to see the full breakdown"
   - "Check how your team stacks up in [[tab:rankings]]"
   - "Compare these two players side by side in [[tab:compare]]"
5. Don't force a tab link if none is relevant - only include when it genuinely helps

## DETERMINISTIC TRADE DATA RULES (CRITICAL - ZERO HALLUCINATIONS)

**RULE 1: Snapshot is Source of Truth**
- If TRADE_SNAPSHOT_DATA exists below, it contains the ONLY valid trade data.
- NEVER invent fairness scores, tiers, player values, or package details.
- ONLY cite exact values from the snapshot payloads.

**RULE 2: League Analysis Data**
When user asks "What trades should I make?" or "Who should I target?":
- Use leagueAnalyze.payload.tradeSuggestions for AI-generated trade ideas
- Use leagueAnalyze.payload.userTeam for user's roster context
- Use leagueAnalyze.payload.scoringType for format context
- If no league_analyze snapshot exists, say: "I don't have league analysis data yet. Please run the Trade Finder first."

**RULE 3: OTB Package Data**
When user asks about On-The-Block players or "cheapest package for X":
- Use otbPackages[].payload.featured for FAIR/AGGRESSIVE/WIN_NOW_OVERPAY offers
- Use otbPackages[].payload.packages[] for all available package cards
- Use otbPackages[].payload.packages[].scores for exact fairness, net value, totals
- Use otbPackages[].payload.packages[].offer.user_sends / user_receives for exact assets
- If no otb_packages snapshot exists for that player, say: "I don't have OTB package data for that player. Please run OTB Packages analysis first."

**RULE 4: Exact Values Only**
- Fairness scores: Quote exact percentage (e.g., "87.3%")
- Tiers: Quote exact tier (S/A/B)
- Labels: Quote exact label (Smash/Great/Fair/Thin)
- Package contents: List exact player names from user_sends/user_receives

**RULE 5: Explain, Don't Override**
Your job is to explain and contextualize the engine's outputs:
- WHY this package is fair (cite the scores)
- WHAT makes this trade work for both sides
- RISKS to consider (age, injury, situation)
Never override or adjust the deterministic fairness scores.`

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string
}

type ChatDeterministicContext = {
  activeLeagueId?: string | null
  leagueAnalyze?: {
    leagueId: string
    sleeperUsername: string
    createdAt: string
    season?: number | null
    payload: any
  }
  otbPackages?: Array<{
    leagueId: string
    sleeperUsername: string
    createdAt: string
    season?: number | null
    contextKey?: string | null
    payload: any
  }>
  notes?: {
    leagueAnalyzeMissingForRequestedLeague?: boolean
    requestedLeagueId?: string | null
  }
}

function norm(s?: string) {
  return String(s || '').trim().toLowerCase()
}

function compactName(v: any) {
  const n = String(v ?? '').trim()
  return n.length > 120 ? n.slice(0, 117) + '…' : n
}

function fmtPct(v: any): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return 'N/A'
  const one = Math.round(n * 10) / 10
  return Number.isInteger(one) ? `${one}` : `${one}`
}

function listAssets(arr: any[]): string {
  if (!Array.isArray(arr) || arr.length === 0) return '—'
  const names = arr
    .map((a: any) => a?.display?.name || a?.name || a?.asset_id || a?.id)
    .filter(Boolean)
    .map((x: any) => compactName(x))
  return names.length ? names.join(', ') : '—'
}

function findOtbSnapsByMessage(otbSnaps: any[], msg: string) {
  const text = norm(msg)
  if (!text) return []

  const hints = ['otb', 'on the block', 'package', 'cheapest', 'offer', 'fair', 'aggressive', 'win now']
  const hinted = hints.some((h) => text.includes(h))
  if (!hinted) return []

  const scored: Array<{ snap: any; score: number }> = []

  for (const s of otbSnaps) {
    const p = s?.payload || {}
    const playerName = norm(p?.target?.player_name || p?.target?.playerName || p?.target?.name || s?.contextKey)
    if (!playerName) continue

    let score = 0
    if (playerName && text.includes(playerName)) score += 10

    const toks = playerName.split(/\s+/).filter(Boolean)
    const hit = toks.filter((t) => t.length >= 4 && text.includes(t)).length
    score += hit

    if (score > 0) scored.push({ snap: s, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((x) => x.snap)
}

function buildSnapshotPromptSection(ctx: ChatDeterministicContext): string {
  let section = '\n\n## TRADE_SNAPSHOT_DATA (READ-ONLY - Use these exact values)\n'

  if (ctx.activeLeagueId) {
    section += `Active League ID: ${ctx.activeLeagueId}\n`
  }

  if (ctx.notes?.requestedLeagueId && ctx.notes.requestedLeagueId !== ctx.activeLeagueId) {
    section += `Requested League ID: ${ctx.notes.requestedLeagueId}\n`
  }

  if (ctx.leagueAnalyze) {
    const p = ctx.leagueAnalyze.payload || {}
    section += '\n### LEAGUE ANALYSIS (Source of Truth for Trades)\n'
    section += `League: ${p.leagueName || ctx.leagueAnalyze.leagueId}\n`
    section += `League ID: ${ctx.leagueAnalyze.leagueId}\n`
    section += `Analyzed: ${ctx.leagueAnalyze.createdAt}\n`
    section += `Format: ${p.scoringType || 'Unknown'}\n`

    if (p.userTeam) {
      section += `\nYour Team: ${p.userTeam.displayName}\n`
      section += `Record: ${p.userTeam.record}\n`
      section += `Points For: ${p.userTeam.pointsFor}\n`
      section += `Roster Size: ${p.userTeam.rosterSize}\n`
    }

    if (Array.isArray(p.tradeSuggestions) && p.tradeSuggestions.length > 0) {
      section += `\nTrade Suggestions (${p.tradeSuggestions.length} managers):\n`
      for (const sugg of p.tradeSuggestions.slice(0, 5)) {
        section += `\n**Target: ${sugg.targetDisplayName || sugg.targetManager}** (Fit: ${sugg.overallFit})\n`
        section += `Their Needs: ${(sugg.theirNeeds || []).join(', ') || 'N/A'}\n`
        section += `Your Surplus: ${(sugg.yourSurplus || []).join(', ') || 'N/A'}\n`
        if (Array.isArray(sugg.suggestedTrades) && sugg.suggestedTrades.length > 0) {
          for (const trade of sugg.suggestedTrades.slice(0, 2)) {
            section += `- Trade: Give ${(trade.youGive || []).join(' + ')} → Get ${(trade.youReceive || []).join(' + ')} (Grade: ${trade.tradeGrade})\n`
          }
        }
      }
    } else {
      section += `\nTrade Suggestions: none found in snapshot.\n`
    }

    section += `\nLEAGUE_ANALYZE_JSON_MIN:\n`
    section += `${JSON.stringify(
      {
        leagueName: p.leagueName ?? null,
        scoringType: p.scoringType ?? null,
        userTeam: p.userTeam ?? null,
        tradeSuggestions: Array.isArray(p.tradeSuggestions) ? p.tradeSuggestions.slice(0, 3) : [],
      },
      null,
      2
    )}\n`
  } else {
    section += '\n### LEAGUE ANALYSIS: Not available\n'
    if (ctx.notes?.leagueAnalyzeMissingForRequestedLeague && ctx.notes.requestedLeagueId) {
      section += `No league_analyze snapshot found for league_id=${ctx.notes.requestedLeagueId}.\n`
    } else {
      section += 'User has not run Trade Finder yet for this league (or any league).\n'
    }
  }

  if (ctx.otbPackages && ctx.otbPackages.length > 0) {
    section += '\n### OTB PACKAGES (On-The-Block Trade Offers)\n'

    for (const snap of ctx.otbPackages.slice(0, 3)) {
      const p = snap.payload || {}
      section += `\n**Player: ${p.target?.player_name || snap.contextKey || 'Unknown'}**\n`
      section += `League ID: ${snap.leagueId}\n`
      section += `Position: ${p.target?.position || 'N/A'}\n`
      section += `Value: ${p.target?.value?.number ?? 'N/A'} (${p.context?.format || 'unknown'})\n`
      section += `Posted by: ${p.target?.on_block_by?.display_name || p.target?.on_block_by?.username || 'Unknown'}\n`
      if (p.target?.on_block_by?.notes) {
        section += `Notes: ${compactName(p.target.on_block_by.notes)}\n`
      }

      const fFair = p.featured?.fair
      if (fFair && !fFair.unavailable) {
        section += `\nFAIR OFFER (Recommended):\n`
        section += `- Tier: ${fFair.tier}, Fairness: ${fmtPct(fFair.scores?.fairness_score)}% (${fFair.scores?.fairness_label})\n`
        section += `- You Send: ${listAssets(fFair.offer?.user_sends || [])}\n`
        section += `- You Get: ${listAssets(fFair.offer?.user_receives || [])}\n`
        section += `- Net Value: ${fFair.scores?.net_value > 0 ? '+' : ''}${fFair.scores?.net_value}\n`
      } else if (fFair?.unavailable) {
        section += `\nFAIR OFFER: unavailable (${fFair.reason || 'unknown'})\n`
      }

      const fAgg = p.featured?.aggressive
      if (fAgg && !fAgg.unavailable) {
        section += `\nAGGRESSIVE OFFER (Value Play):\n`
        section += `- Tier: ${fAgg.tier}, Fairness: ${fmtPct(fAgg.scores?.fairness_score)}% (${fAgg.scores?.fairness_label})\n`
        section += `- You Send: ${listAssets(fAgg.offer?.user_sends || [])}\n`
        section += `- You Get: ${listAssets(fAgg.offer?.user_receives || [])}\n`
        section += `- No core assets sent: ${!fAgg.constraints?.sends_core_assets}\n`
      } else if (fAgg?.unavailable) {
        section += `\nAGGRESSIVE OFFER: unavailable (${fAgg.reason || 'unknown'})\n`
      }

      const fWin = p.featured?.win_now_overpay
      if (fWin && !fWin.unavailable) {
        section += `\nWIN-NOW OVERPAY (For Contenders):\n`
        section += `- Tier: ${fWin.tier}, Fairness: ${fmtPct(fWin.scores?.fairness_score)}%\n`
        section += `- You Send: ${listAssets(fWin.offer?.user_sends || [])}\n`
        section += `- You Get: ${listAssets(fWin.offer?.user_receives || [])}\n`
      } else if (fWin?.unavailable) {
        section += `\nWIN-NOW OVERPAY: unavailable (${fWin.reason || 'unknown'})\n`
      }

      const pkgs = Array.isArray(p.packages) ? p.packages : []
      if (pkgs.length > 0) {
        const tiers = [...new Set(pkgs.map((x: any) => x?.tier).filter(Boolean))]
        section += `\nAll Packages: ${pkgs.length} available (Tiers: ${tiers.join(', ') || 'N/A'})\n`
      } else {
        section += `\nAll Packages: none listed in snapshot.\n`
      }

      section += `\nOTB_JSON_MIN:\n`
      section += `${JSON.stringify(
        {
          player: {
            id: p.target?.player_id ?? snap.contextKey ?? null,
            name: p.target?.player_name ?? null,
            pos: p.target?.position ?? null,
            team: p.target?.team ?? null,
            value: p.target?.value?.number ?? null,
          },
          on_block_by: p.target?.on_block_by ?? null,
          featured: p.featured ?? null,
          packages_sample: pkgs.slice(0, 3),
        },
        null,
        2
      )}\n`
    }
  } else {
    section += '\n### OTB PACKAGES: None available\n'
    section += 'No otb_packages snapshots found (or none match this league/player). Run OTB Packages for specific players.\n'
  }

  return section
}

export const POST = withApiUsage({ endpoint: "/api/legacy/chat", tool: "LegacyChat" })(async (request: NextRequest) => {
  try {
    const auth = requireAuthOrOrigin(request)
    if (!auth.authenticated) {
      return forbiddenResponse(auth.error || 'Unauthorized')
    }

    const body = await request.json()

    const {
      messages,
      imageBase64,
      sleeperUsername,
      yahooUserId,
      fantraxUsername,
      mflUsername,
      leagueId,
      contextKey,
    }: {
      messages: ChatMessage[]
      imageBase64?: string
      sleeperUsername?: string
      yahooUserId?: string
      fantraxUsername?: string
      mflUsername?: string
      leagueId?: string
      contextKey?: string
    } = body

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 })
    }

    const lastUserMessage = messages[messages.length - 1]
    if (lastUserMessage.role !== 'user') {
      return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 })
    }

    let systemPrompt = SPORTS_SYSTEM_PROMPT

    const hasMultiplePlatforms =
      [sleeperUsername, yahooUserId, fantraxUsername, mflUsername].filter(Boolean).length > 1
    const hasAnyPlatform = sleeperUsername || yahooUserId || fantraxUsername || mflUsername

    if (hasAnyPlatform) {
      try {
        const userContext =
          hasMultiplePlatforms || yahooUserId || fantraxUsername || mflUsername
            ? await buildEnhancedUserContext(sleeperUsername, yahooUserId, fantraxUsername, mflUsername)
            : await buildUserChatContext(sleeperUsername!)

        if (userContext) {
          systemPrompt += formatContextForSystemPrompt(userContext)
        } else {
          systemPrompt +=
            '\n\nNOTE: No imported league context is available for this user yet. Say so when asked about their leagues — do NOT invent leagues, records, or roster details.'
        }
      } catch (err) {
        console.warn('Failed to build user context for chat:', err)
        // Honesty: the model must know personalization failed, or it will answer as if it can
        // see the user's leagues. Silent omission here produced confidently generic answers
        // presented as personalized ones.
        systemPrompt +=
          '\n\nNOTE: The user\'s imported league context could not be loaded for this conversation. Tell them their league data is temporarily unavailable if they ask about their own leagues, and do NOT invent league details.'
      }
    }

    const deterministicContext: ChatDeterministicContext = {
      activeLeagueId: leagueId ? String(leagueId).trim() : null,
      notes: {
        requestedLeagueId: leagueId ? String(leagueId).trim() : null,
      },
    }

    const sleeperU = sleeperUsername ? norm(sleeperUsername) : ''

    if (sleeperU) {
      try {
        const leagueAnalyzeSnaps = await readSnapshotsForUser({
          sleeperUsername: sleeperU,
          snapshotType: 'league_analyze',
          leagueId: deterministicContext.activeLeagueId || undefined,
          limit: 5,
        })

        let fallbackLeagueAnalyzeSnaps: any[] = []
        if ((!leagueAnalyzeSnaps || leagueAnalyzeSnaps.length === 0) && deterministicContext.activeLeagueId) {
          fallbackLeagueAnalyzeSnaps = await readSnapshotsForUser({
            sleeperUsername: sleeperU,
            snapshotType: 'league_analyze',
            limit: 5,
          })
          deterministicContext.notes!.leagueAnalyzeMissingForRequestedLeague = true
        }

        const bestLeagueAnalyze =
          (leagueAnalyzeSnaps && leagueAnalyzeSnaps.length > 0 ? leagueAnalyzeSnaps[0] : null) ||
          (fallbackLeagueAnalyzeSnaps && fallbackLeagueAnalyzeSnaps.length > 0
            ? fallbackLeagueAnalyzeSnaps[0]
            : null)

        if (bestLeagueAnalyze) {
          deterministicContext.leagueAnalyze = {
            leagueId: bestLeagueAnalyze.leagueId,
            sleeperUsername: bestLeagueAnalyze.sleeperUsername,
            createdAt: bestLeagueAnalyze.createdAt.toISOString(),
            season: bestLeagueAnalyze.season ?? null,
            payload: bestLeagueAnalyze.payload,
          }
          if (!deterministicContext.activeLeagueId) {
            deterministicContext.activeLeagueId = bestLeagueAnalyze.leagueId
          }
        }

        const otbSnaps = await readSnapshotsForUser({
          sleeperUsername: sleeperU,
          snapshotType: 'otb_packages',
          leagueId: deterministicContext.activeLeagueId || undefined,
          limit: 15,
        })

        let relevantOtb = otbSnaps || []
        if (contextKey) {
          const ck = String(contextKey).trim()
          const exact = relevantOtb.filter((s) => String(s.contextKey || '') === ck)
          if (exact.length > 0) relevantOtb = exact
        }

        if (!contextKey && relevantOtb.length > 0) {
          const inferred = findOtbSnapsByMessage(relevantOtb, lastUserMessage.content || '')
          if (inferred.length > 0) {
            relevantOtb = inferred
          } else {
            relevantOtb = relevantOtb.slice(0, 3)
          }
        }

        if (relevantOtb.length > 0) {
          deterministicContext.otbPackages = relevantOtb.slice(0, 5).map((s) => ({
            leagueId: s.leagueId,
            sleeperUsername: s.sleeperUsername,
            createdAt: s.createdAt.toISOString(),
            season: s.season ?? null,
            contextKey: s.contextKey ?? null,
            payload: s.payload,
          }))
        }

        systemPrompt += buildSnapshotPromptSection(deterministicContext)
      } catch (err) {
        console.warn('Failed to load trade snapshots for chat:', err)
      }
    }

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }]

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.role === 'user') {
        if (i === messages.length - 1 && imageBase64) {
          openaiMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.content || 'Please analyze this image.' },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
                  detail: 'high',
                },
              },
            ],
          })
        } else if (msg.imageUrl) {
          openaiMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.content || 'Please analyze this image.' },
              {
                type: 'image_url',
                image_url: {
                  url: msg.imageUrl,
                  detail: 'high',
                },
              },
            ],
          })
        } else {
          openaiMessages.push({ role: 'user', content: msg.content })
        }
      } else {
        openaiMessages.push({ role: 'assistant', content: msg.content })
      }
    }

    let dataEnrichment: { context: string; sources: any } | null = null
    try {
      dataEnrichment = await enrichChatWithData(lastUserMessage.content || '', {
        leagueId,
        sleeperUsername: sleeperUsername || undefined,
      })
      if (dataEnrichment.context) {
        systemPrompt += dataEnrichment.context
      }
    } catch (err) {
      console.warn('Data enrichment failed:', err)
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      max_tokens: 1500,
      temperature: 0.7,
    })

    const response =
      completion.choices[0]?.message?.content || 'I apologize, I could not generate a response.'

    const dataSources = dataEnrichment ? buildDataSourcesSummary(dataEnrichment.sources) : []

    if (sleeperUsername) {
      try {
        await recordMemoryEvent({
          userId: sleeperUsername,
          leagueId: leagueId || undefined,
          eventType: 'chat_interaction',
          subject: (lastUserMessage.content || '').slice(0, 100),
          content: {
            question: (lastUserMessage.content || '').slice(0, 500),
            dataSources,
            responseLength: response.length,
          },
          confidence: 0.6,
        })

        const chatCount = await prisma.aIMemoryEvent.count({
          where: { userId: sleeperUsername, eventType: 'chat_interaction' },
        })
        const newBadges = await checkMilestoneBadges(sleeperUsername, sleeperUsername, 'ai_chat', chatCount)
        if (newBadges.length > 0) {
          return NextResponse.json({ response, dataSources, newBadges })
        }
      } catch (err) {
        console.warn('Memory/badge tracking failed:', err)
      }
    }

    return NextResponse.json({ response, dataSources })
  } catch (error: any) {
    console.error('AI Chat error:', error)
    return NextResponse.json({ error: error.message || 'Failed to process chat' }, { status: 500 })
  }
})
