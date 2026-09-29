/**
 * GET /api/ai/validation — AI system validation: areas (draft, chat, trades, waivers, war room)
 * and provider availability. Session required. Use for "ensure AI works everywhere" check.
 */

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { checkProviderAvailability } from "@/lib/ai-orchestration"
import { isOpenClawConfigured, isOpenClawGrowthConfigured } from "@/lib/openclaw/config"

export const dynamic = "force-dynamic"

const AREAS = [
  {
    id: "draft",
    description: "Draft AI: pick suggestions, mock draft simulation, in-league orphan pick",
    endpoints: [
      "POST /api/mock-draft/ai-pick",
      "POST /api/mock-draft/simulate",
      "POST /api/mock-draft/trade-action",
      "POST /api/leagues/[leagueId]/draft/ai-pick",
      "POST /api/draft/recommend",
    ],
  },
  {
    id: "chat",
    description: "Chat (Chimmy): AI assistant, tools, multi-provider",
    endpoints: [
      "POST /api/chimmy",
      "POST /api/chat/chimmy",
      "POST /api/ai/chimmy",
    ],
  },
  {
    id: "trades",
    description: "Trades: trade analyzer, AI grades, orphan trade decision",
    endpoints: [
      "POST /api/trade-evaluator",
      "POST /api/dynasty-trade-analyzer",
      "POST /api/legacy/trade/analyze",
      "POST /api/leagues/[leagueId]/trade/ai-decision",
    ],
  },
  {
    id: "waivers",
    description: "Waivers: Waiver AI priorities, FAAB, trends",
    endpoints: [
      "POST /api/waiver-ai",
      "POST /api/legacy/waiver/analyze",
      "POST /api/ai/waiver",
    ],
  },
  {
    id: "war_room",
    description: "War room: mock-draft helpers + AF War Room AI routes (session, recommend, compare, outlook, queue, intel, post-draft)",
    endpoints: [
      "POST /api/mock-draft/ai-pick",
      "POST /api/mock-draft/needs",
      "POST /api/mock-draft/predict-board",
      "POST /api/draft/live-brain",
      "POST /api/war-room/session",
      "POST /api/war-room/recommend",
      "POST /api/war-room/compare",
      "POST /api/war-room/outlook",
      "POST /api/war-room/queue",
      "POST /api/war-room/opponent-tendencies",
      "POST /api/war-room/post-draft-report",
      "POST /api/ai-tools/war-room/dashboard",
    ],
  },
  {
    id: "matchup_prep",
    description: "Matchup Prep: head-to-head projections, edge, and game plan from synced league data",
    endpoints: ["POST /api/ai-tools/matchup-prep/dashboard"],
  },
] as const

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const providers = checkProviderAvailability()
  const openclaw = isOpenClawConfigured()
  const openclawGrowth = isOpenClawGrowthConfigured()
  const atLeastOne = [...Object.values(providers), openclaw, openclawGrowth].some(Boolean)

  return NextResponse.json({
    ok: atLeastOne,
    areas: AREAS.map((a) => ({
      id: a.id,
      description: a.description,
      endpoints: a.endpoints,
    })),
    providers: {
      ...providers,
      openclaw,
      openclawGrowth,
    },
    message: atLeastOne
      ? "At least one AI provider is available; areas may have additional provider requirements."
      : "No AI providers configured; set OPENAI_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, or OpenClaw tokens.",
  })
}
