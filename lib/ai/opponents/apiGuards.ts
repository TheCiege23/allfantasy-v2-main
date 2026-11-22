import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getAiOpponentsSettings } from "./leagueSettings"

export function verifyInternalAiKey(req: NextRequest): boolean {
  const key = process.env.AI_OPPONENTS_INTERNAL_KEY
  if (!key) return false
  return req.headers.get("x-ai-opponents-key") === key
}

export function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.AI_OPPONENTS_CRON_SECRET
  if (!secret) return false
  return req.headers.get("x-cron-secret") === secret
}

export async function assertLeagueAiAllowed(leagueId: string): Promise<{ ok: boolean; reason?: string }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league) return { ok: false, reason: "League not found" }
  const s = getAiOpponentsSettings(league.settings)
  if (!s.enabled) return { ok: false, reason: "Chimmy opponents not enabled for this league" }
  return { ok: true }
}
