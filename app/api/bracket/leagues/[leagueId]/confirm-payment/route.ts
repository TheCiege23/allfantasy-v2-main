import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"

export const runtime = "nodejs"

export async function POST(req: Request, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const league = await (prisma as any).bracketLeague.findUnique({
    where: { id: params.leagueId },
    select: { id: true, ownerId: true, scoringRules: true },
  })

  if (!league) return NextResponse.json({ error: "LEAGUE_NOT_FOUND" }, { status: 404 })
  if (league.ownerId !== auth.userId) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })

  const rules = { ...(league.scoringRules || {}) } as any
  if (!rules.isPaidLeague) {
    return NextResponse.json({ error: "LEAGUE_IS_NOT_PAID" }, { status: 400 })
  }

  const body = await req.json().catch(() => ({} as any))
  rules.fancredPaymentReference = String(body?.fancredPaymentReference || rules.fancredPaymentReference || "").trim() || null
  rules.commissionerPaymentConfirmedAt = new Date().toISOString()

  await (prisma as any).bracketLeague.update({
    where: { id: params.leagueId },
    data: { scoringRules: rules },
  })

  return NextResponse.json({ ok: true, confirmedAt: rules.commissionerPaymentConfirmedAt })
}
