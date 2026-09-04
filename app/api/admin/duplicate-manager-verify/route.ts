import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getDuplicateManagerVerifyPreflight, runDuplicateManagerVerification, TEST_LEAGUE_NAME } from "@/lib/admin-dashboard/DuplicateManagerVerificationService"

/** GET: read-only dry-run — plan + preflight counts. Never creates/deletes anything. */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.res

  const preflight = await getDuplicateManagerVerifyPreflight()
  return NextResponse.json({ ok: true, mode: "dry-run", preflight })
}

/**
 * POST: runs the full isolated create -> exercise -> resolve -> cleanup cycle against
 * real application code. Requires the caller to type the exact test league name as an
 * explicit confirmation, and — in production — an additional opt-in env flag, since this
 * writes real rows (even though every row is isolated and always cleaned up afterward).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.res

  /*
   * 🛑 WAS `NODE_ENV === "production" && VERCEL_ENV === "production"`. Production moved to
   * Railway on 2026-09-02, and Railway never sets VERCEL_ENV — so that second clause was always
   * false there, and this gate never fired in real production. Any admin could run the full
   * create -> exercise -> resolve -> cleanup cycle against the live DB with no opt-in flag.
   *
   * NODE_ENV alone is the same signal nonprodValidationGuard.ts and telemetryDebugAccess.ts
   * already use correctly for this exact question elsewhere in this repo — Railway has no
   * documented preview/staging environment for this app, so there is no second signal to add.
   */
  const isProduction = process.env.NODE_ENV === "production"
  if (isProduction && process.env.ALLOW_DUPLICATE_MANAGER_VERIFY_EXECUTE !== "true") {
    return NextResponse.json(
      { ok: false, error: "Execute mode is disabled in production. Set ALLOW_DUPLICATE_MANAGER_VERIFY_EXECUTE=true in Railway to enable it, then remove it again afterward." },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => ({}))
  if (body?.confirmLeagueName !== TEST_LEAGUE_NAME) {
    return NextResponse.json({ ok: false, error: "Missing or incorrect confirmLeagueName — must exactly match the test league name shown in the dry-run." }, { status: 400 })
  }

  const result = await runDuplicateManagerVerification()
  return NextResponse.json({ ok: result.ok, mode: "execute", result })
}
