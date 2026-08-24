import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyEmailUnsubscribeToken } from "@/lib/email/marketing-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function html(message: string) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AllFantasy Email Preferences</title></head><body style="font-family:Arial,sans-serif;padding:32px;color:#0f172a;"><main style="max-width:640px;margin:auto;"><h1>AllFantasy.ai</h1><p>${message}</p><p><a href="/">Return to AllFantasy</a></p></main></body></html>`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }
  )
}
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token") ?? ""
  const verified = verifyEmailUnsubscribeToken(token)
  if (!verified) {
    return NextResponse.json({ ok: false, error: "Invalid or expired unsubscribe link." }, { status: 400 })
  }

  await prisma.emailPreference.upsert({
    where: { email: verified.email },
    create: {
      email: verified.email,
      productUpdates: false,
      tradeAlerts: false,
      weeklyDigest: false,
      unsubscribedAt: new Date(),
    },
    update: {
      productUpdates: false,
      // tradeAlerts was missing here — an EXISTING preference row kept
      // tradeAlerts=true after "unsubscribing", so the trade-grade blast
      // kept sending. The unsubscribe link must mean what it says.
      tradeAlerts: false,
      weeklyDigest: false,
      unsubscribedAt: new Date(),
    },
  })

  return html("You have been unsubscribed from AllFantasy marketing emails. Transactional account, payment, and pool-invite notices may still be sent when required.")
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token : ""
  const verified = verifyEmailUnsubscribeToken(token)
  if (!verified) {
    return NextResponse.json({ ok: false, error: "Invalid unsubscribe token." }, { status: 400 })
  }

  await prisma.emailPreference.upsert({
    where: { email: verified.email },
    create: {
      email: verified.email,
      productUpdates: false,
      tradeAlerts: false,
      weeklyDigest: false,
      unsubscribedAt: new Date(),
    },
    update: {
      productUpdates: false,
      // tradeAlerts was missing here — an EXISTING preference row kept
      // tradeAlerts=true after "unsubscribing", so the trade-grade blast
      // kept sending. The unsubscribe link must mean what it says.
      tradeAlerts: false,
      weeklyDigest: false,
      unsubscribedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
