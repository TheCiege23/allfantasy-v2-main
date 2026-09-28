/**
 * Admin — account geo locks (lib/geo/accountGeoLock).
 *
 *   GET  /api/admin/users/geo-lock            the locked accounts, with which lock
 *   POST /api/admin/users/geo-lock  {userId}  unlock one account
 *
 * The owner's rule (2026-09-24): an account seen in Washington on a normal
 * connection stays locked until SUPPORT unlocks it. This is that unlock. It is
 * admin-only through the canonical `requireAdmin`, and there is deliberately no
 * self-service path — a lock the locked person can lift is not a lock.
 *
 * It lifts the CARD lock too (`card_paid_block`: a purchase with a restricted
 * state's billing address was refunded). That one is the likelier support email —
 * a buyer who used a parent's card, or who has moved — and the same rule holds:
 * support decides.
 *
 * ⚠ The unlock takes effect as sessions refresh, not instantly: this process
 * forgets its cached answer at once, other processes within their 10-minute
 * cache, and the user's session token the next time it is re-read. Tell the
 * user to sign out and back in if they need it immediately. Checkout itself reads
 * the database, so a card unlock lets them buy at once.
 */

import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/adminAuth"
import {
  ACCOUNT_CARD_PAID_BLOCK,
  ACCOUNT_FULL_BLOCK,
  accountGeoLockFromLevel,
  forgetAccountGeoLock,
} from "@/lib/geo/accountGeoLock"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const locked = await prisma.appUser.findMany({
    where: { stateRestrictionLevel: { in: [ACCOUNT_FULL_BLOCK, ACCOUNT_CARD_PAID_BLOCK] } },
    select: {
      id: true,
      email: true,
      username: true,
      stateRestrictionLevel: true,
      detectedStateCode: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  })
  return NextResponse.json({
    locked: locked.map(({ stateRestrictionLevel, ...row }) => ({ ...row, lock: stateRestrictionLevel })),
  })
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null
  const userId = typeof body?.userId === "string" ? body.userId.trim() : ""
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 })

  const existing = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, stateRestrictionLevel: true },
  })
  if (!existing) return NextResponse.json({ error: "No such user" }, { status: 404 })
  const lock = accountGeoLockFromLevel(existing.stateRestrictionLevel)
  if (!lock) {
    return NextResponse.json({ ok: true, unlocked: false, note: "This account was not locked." })
  }

  // `detectedStateCode` is kept: it records where the account was seen, and an
  // unlock is a decision about the account, not a claim that the sighting was wrong.
  await prisma.appUser.update({
    where: { id: userId },
    data: { stateRestrictionLevel: null, isStateRestricted: false },
  })
  forgetAccountGeoLock(userId)
  console.warn(`[geo] account unlocked by admin (user ${userId}, was ${lock}).`)
  return NextResponse.json({ ok: true, unlocked: true, was: lock })
}
