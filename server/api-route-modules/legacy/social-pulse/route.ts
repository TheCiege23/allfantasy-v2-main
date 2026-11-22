import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server"
import { SocialPulseRequestSchema, SocialPulseResponseSchema } from "@/lib/social-pulse-schema"
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit"
import { xaiChatJson, parseTextFromXaiChatCompletion, XaiTool } from "@/lib/xai-client"
import { getUniversalAIContext } from "@/lib/ai-player-context"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

const SYSTEM = `
You are a fantasy sports "market sentiment" analyst with LIVE access to X (Twitter) and web search.
You will NOT give trade advice or a verdict.
You will summarize CURRENT, REAL-TIME public social narratives in a neutral way.

${getUniversalAIContext()}

CRITICAL INSTRUCTIONS:
1. USE your x_search and web_search tools to find the LATEST information about these players/entities
2. Search for RECENT news: injuries, releases, trades, depth chart changes, coach statements, team transactions
3. If multiple players/entities are provided, ALSO search for connections between them (same team, trade rumors involving both, etc.)
4. Include information about teams, coaches, and front office moves that affect these players
5. Prioritize information from the last 48-72 hours, then extend to last 7 days if needed

Output MUST be strict JSON with:
{
  "summary": "1-2 sentence high-level summary of the CURRENT situation",
  "bullets": ["5-12 bullets with SPECIFIC, DATED information - include transaction dates, injury updates, etc."],
  "market": [{"player":"Name","signal":"up|down|mixed|injury|hype|buy_low|sell_high|released|traded|idp_scarcity","reason":"1 sentence explanation with specific news"}],
  "connections": ["Any connections between the searched players/entities - trades involving both, same team dynamics, etc."],
  "lastUpdated": "Most recent news date found (e.g., 'Feb 1, 2026')",
  "sources": ["URLs or source descriptions you found during search"]
}

Rules:
- Do not include URLs anywhere except in the optional sources array.
- Avoid inflammatory content.
- If uncertain, use "mixed".
- ALWAYS search for latest news before responding - do not rely on training data.
- For teams/coaches, focus on how they affect fantasy value of players.
- If a player was released, traded, or cut - THIS IS CRITICAL NEWS that must be in the first bullet.
- If sport is NFL and idpEnabled is true, include at least one IDP-specific note if relevant.
- Apply tier system knowledge when assessing market sentiment - Tier 0 players rarely move in value.

ACCURACY REQUIREMENTS:
- Only report information you found via tool calls — never hallucinate
- If a search returns no results for a player, say so explicitly
- Include the approximate time of each signal (hours/days ago)
- Distinguish between official team news and fan speculation
- For injuries: only report if you found an official report or beat reporter source
- For trades: only report confirmed or credibly rumored transactions
- Set recencyHours based on the actual timestamp of the source you found
- Set confidence lower (< 60) when information is speculative or unconfirmed
- Set confidence higher (> 80) when information is from official team accounts or beat reporters
`.trim()

function buildUserPrompt(input: {
  sport: "NFL" | "NBA"
  format: "redraft" | "dynasty" | "specialty"
  idpEnabled?: boolean
  players: string[]
}) {
  const lines: string[] = []
  lines.push(`Sport: ${input.sport}`)
  lines.push(`Format: ${input.format}`)
  lines.push(`IDP enabled: ${input.sport === "NFL" ? String(!!input.idpEnabled) : "N/A"}`)
  lines.push(`Search for: ${input.players.join(", ")}`)
  lines.push("")
  lines.push("MANDATORY SEARCH TASKS:")
  lines.push("1. Search X and the web for the LATEST news about EACH of these players/entities")
  lines.push("2. Look for: injuries, releases, trades, depth chart changes, roster moves, coach statements")
  lines.push("3. Find team transaction news that affects these players")
  if (input.players.length > 1) {
    lines.push(`4. Search for any connections between: ${input.players.join(" AND ")} (same team, trade rumors, etc.)`)
  }
  lines.push("5. Search for each player by full name AND common nickname (e.g. CeeDee Lamb and CD Lamb)")
  lines.push('6. Also search for "<player name> fantasy" to capture fantasy-specific discourse')
  if (input.sport === "NFL") {
    lines.push("7. For NFL players, also check relevant team hashtags when useful")
  }
  lines.push("")
  lines.push("Focus on the last 48-72 hours first, then last 7 days.")
  lines.push("Return strict JSON only with the MOST CURRENT information you found.")
  return lines.join("\n")
}

function dedupeSources(sources: string[]) {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of sources) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(value)
  }
  return cleaned.slice(0, 20)
}

function collectSources(rawJson: unknown, annotationCandidates: string[]) {
  const jsonRecord = rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
    ? rawJson as { sources?: unknown }
    : null

  const fromModel = Array.isArray(jsonRecord?.sources)
    ? jsonRecord.sources.filter((source): source is string => typeof source === "string")
    : []

  return dedupeSources([...fromModel, ...annotationCandidates])
}

function parseJsonObject(text: string) {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function parseReasonRecencyHours(reason?: string) {
  const text = (reason ?? "").toLowerCase()
  if (!text) return null

  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)
  if (hourMatch) {
    return Math.max(1, Math.round(Number(hourMatch[1])))
  }

  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/)
  if (dayMatch) {
    return Math.max(1, Math.round(Number(dayMatch[1]) * 24))
  }

  if (/\bjust now\b|\bminutes? ago\b|\btoday\b|\bthis morning\b|\bthis afternoon\b|\bthis evening\b|\btonight\b/.test(text)) {
    return 2
  }

  if (/\byesterday\b|\blast night\b/.test(text)) {
    return 24
  }

  return null
}

function parseLastUpdatedRecencyHours(lastUpdated?: string) {
  if (!lastUpdated) return null

  const timestamp = Date.parse(lastUpdated)
  if (Number.isNaN(timestamp)) return null

  const diffMs = Date.now() - timestamp
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  return Math.max(1, diffHours)
}

function resolveRecencyHours(recencyHours: number | undefined, reason?: string, lastUpdated?: string) {
  if (typeof recencyHours === "number" && Number.isFinite(recencyHours) && recencyHours >= 0) {
    return recencyHours
  }

  return parseReasonRecencyHours(reason) ?? parseLastUpdatedRecencyHours(lastUpdated) ?? 24
}

function estimateSignalConfidence(signal: string, reason?: string) {
  let base = 62
  if (signal === 'traded' || signal === 'released' || signal === 'injury') base += 18
  if (signal === 'mixed') base -= 10
  const text = (reason || '').toLowerCase()
  if (text.includes('confirmed') || text.includes('official')) base += 8
  if (text.includes('rumor') || text.includes('speculation')) base -= 12
  return Math.max(30, Math.min(98, base))
}

function estimateImpactScore(signal: string, reason?: string) {
  let score = 45
  if (signal === 'injury') score += 25
  if (signal === 'traded' || signal === 'released') score += 30
  if (signal === 'up' || signal === 'down' || signal === 'buy_low' || signal === 'sell_high') score += 12
  const txt = (reason || '').toLowerCase()
  if (txt.includes('starter') || txt.includes('depth chart')) score += 10
  if (txt.includes('season') || txt.includes('ir')) score += 10
  return Math.max(20, Math.min(100, score))
}

export const POST = withApiUsage({ endpoint: "/api/legacy/social-pulse", tool: "LegacySocialPulse" })(async (req: NextRequest) => {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Sign in to use Social Pulse." },
        { status: 401 }
      )
    }

    // AF Legacy (`legacy_social_pulse`): the /af-legacy Market Board's lock was the only one. Before the model call.
    const plan = await requireFeatureEntitlement({ userId: session.user.id, userEmail: session.user.email ?? null, featureId: "legacy_social_pulse" })
    if (!plan.ok) return plan.response

    const body = await req.json()
    const parsed = SocialPulseRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request format", details: parsed.error.issues },
        { status: 400 }
      )
    }

    const ip = getClientIp(req)
    const bucketKey = `social:${parsed.data.sport}:${parsed.data.format}:${ip}`

    const rl = consumeRateLimit({
      scope: "ai",
      action: "social_pulse",
      sleeperUsername: bucketKey,
      ip,
      maxRequests: 10,
      windowMs: 60_000,
      includeIpInKey: true,
    })

    if (!rl.success) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded. Please try again later.",
          retryAfterSec: rl.retryAfterSec,
          remaining: rl.remaining,
        },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      )
    }

    const userPrompt = buildUserPrompt(parsed.data)
    
    const today = new Date()
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const fromDate = sevenDaysAgo.toISOString().split('T')[0]
    const toDate = today.toISOString().split('T')[0]
    
    const tools: XaiTool[] = [
      { type: "x_search", from_date: fromDate, to_date: toDate },
      { type: "web_search", user_location_country: "US" }
    ]

    const grok = await xaiChatJson({
      model: "grok-4-fast-non-reasoning",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1500,
      tools,
      responseFormat: { type: "json_object" },
    })

    if (!grok.ok) {
      console.error("Social Pulse xAI error:", { status: grok.status, details: grok.details.slice(0, 500) })
      return NextResponse.json(
        { error: "Failed to fetch social pulse", details: grok.details.slice(0, 500) },
        { status: 500 }
      )
    }

    const text = parseTextFromXaiChatCompletion(grok.json)
    if (!text) {
      return NextResponse.json({ error: "Failed to parse xAI response" }, { status: 500 })
    }

    const json = parseJsonObject(text)
    if (!json) {
      return NextResponse.json({ error: "xAI did not return valid JSON" }, { status: 500 })
    }

    const annotationSources = dedupeSources(
      (grok._annotations ?? [])
        .flatMap((annotation) => [annotation.title, annotation.url])
        .filter((source): source is string => typeof source === "string" && source.trim().length > 0)
    )
    const sources = collectSources(json, annotationSources)

    const out = SocialPulseResponseSchema.safeParse({
      ...json,
      sources,
    })
    if (!out.success) {
      console.error("Social Pulse validation failed:", out.error)
      return NextResponse.json({
        success: true,
        data: { ...json, sources },
        result: { ...json, sources },
        validated: false,
        rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
      })
    }

    const enrichedMarket = (out.data.market || []).map((m) => ({
      ...m,
      confidence: m.confidence ?? estimateSignalConfidence(m.signal, m.reason),
      impactScore: m.impactScore ?? estimateImpactScore(m.signal, m.reason),
      recencyHours: resolveRecencyHours(m.recencyHours, m.reason, out.data.lastUpdated),
    }))

    const pulseScore = enrichedMarket.length > 0
      ? Math.round(enrichedMarket.reduce((sum, m) => sum + (m.impactScore || 50) * ((m.confidence || 50) / 100), 0) / enrichedMarket.length)
      : 50

    const responseData = {
      ...out.data,
      market: enrichedMarket,
      pulseScore: out.data.pulseScore ?? pulseScore,
      sources,
    }

    return NextResponse.json({
      success: true,
      data: responseData,
      result: responseData,
      validated: true,
      rate_limit: { remaining: rl.remaining, retryAfterSec: rl.retryAfterSec },
    })
  } catch (e) {
    console.error("Social Pulse error:", e)
    return NextResponse.json({ error: "Failed to fetch social pulse", details: String(e) }, { status: 500 })
  }
})
