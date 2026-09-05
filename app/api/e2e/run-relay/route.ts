/**
 * E2E-ONLY server-side helpers for browser specs. Two jobs, one gate:
 *
 *   POST  drain the outbox once through the audit-feed + intelligence consumers, so a
 *         browser spec can populate the read models after self-seeding a league.
 *   PUT   make the caller's forged session correspond to a real `AppUser` row.
 *
 * Hard-gated: `(NODE_ENV !== 'production' || ALLOW_E2E_SEED === '1') && x-allfantasy-e2e:1`
 * (same model as the seed/register routes). Real production never sets ALLOW_E2E_SEED.
 *
 * ⚠ Both live here rather than in routes of their own because new API routes are not
 * added in this repo — see the no-new-routes rule. `app/api/e2e` is in the production
 * build's exclusion list (scripts/vercel-next-build.cjs), so nothing here ships anyway.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PrismaOutboxStore, OutboxRelay, createPrismaAuditFeedConsumer, type PrismaLike, type AuditFeedPrisma } from '@/lib/events'
import { createIntelligenceSnapshotConsumer } from '@/lib/intelligence/projections/snapshotProjection'

export const dynamic = 'force-dynamic'

function e2eAllowed(request: Request): boolean {
  const envAllows = process.env.NODE_ENV !== 'production' || process.env.ALLOW_E2E_SEED === '1'
  return envAllows && request.headers.get('x-allfantasy-e2e') === '1'
}

export async function POST(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const relay = new OutboxRelay(store, {
    consumers: [createPrismaAuditFeedConsumer(prisma as unknown as AuditFeedPrisma), createIntelligenceSnapshotConsumer(prisma)],
    workerId: 'e2e-relay',
  })
  const summary = await relay.run()
  return NextResponse.json({ ok: true, summary })
}

/**
 * Give a spec's forged session a real `AppUser` row (and a confirmed `UserProfile`).
 *
 * 🛑 WHY THIS EXISTS: `e2e/helpers/session-cookie.ts` mints a signed NextAuth cookie and
 * nothing else. The session is real to middleware and to `getServerSession()`, and absent
 * from the database — so every write that foreign-keys to the user fails **P2003**, and the
 * failure surfaces nowhere near its cause.
 *
 * The measured chain, from CI run 33967522140:
 *   1. `<AgeConfirmationPrompt>` renders on every non-auth path (SafeGlobalChrome) and asks
 *      `/api/auth/confirm-age`. With no `UserProfile` row it gets `confirmed: false` and
 *      opens a modal.
 *   2. The modal's own POST does `userProfile.upsert({ create: { userId } })`, which violates
 *      `user_profiles_userId_fkey` — 16 P2003s in one run — so it can never dismiss itself.
 *   3. Playwright then retries a click 244 times against a button it correctly reports as
 *      "visible, enabled and stable", because the dialog intercepts pointer events, until the
 *      test times out at 180s.
 *
 * The spec looks like a hanging click. The cause is a user that does not exist.
 *
 * ⚠ Written server-side ON PURPOSE, not from the spec process. Importing `@prisma/client`
 * into specs would populate `process.env` from `.env` on import, and this repo's `.env`
 * points at PRODUCTION — a local-looking test is not a local test. The server already holds
 * the right connection for whatever environment it was started in, and this handler is
 * unreachable unless that environment opted into e2e seeding.
 */
export async function PUT(request: Request) {
  if (!e2eAllowed(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { id?: string; email?: string; name?: string; username?: string; confirmAge?: boolean } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  /*
   * Derived from the id so repeat runs are idempotent: `email` and `username` are both
   * @unique, and a value derived from the primary key can only collide with the row we are
   * upserting. A spec that passes its own `username` owns that risk — two specs choosing the
   * same one collide on P2002, which is why the error detail is returned rather than swallowed.
   */
  const email = body.email ?? `${id}@allfantasy.test`
  const username = body.username ?? id
  const displayName = body.name ?? 'E2E User'

  try {
    await prisma.appUser.upsert({
      where: { id },
      update: {},
      create: { id, email, username, displayName },
    })

    // Default on: no spec asserts that the age prompt appears, and every spec that clicks
    // anything needs it gone. `confirmAge: false` is there for one that ever does.
    if (body.confirmAge !== false) {
      await prisma.userProfile.upsert({
        where: { userId: id },
        update: { ageConfirmedAt: new Date() },
        create: { userId: id, ageConfirmedAt: new Date() },
      })
    }

    return NextResponse.json({ ok: true, userId: id })
  } catch (error) {
    // Test-only, header-gated route: naming the cause beats an opaque 500, for the same
    // reason the decision-os seed route returns its detail.
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[e2e/run-relay] ensure-user failed:', error)
    return NextResponse.json({ error: 'Ensure user failed', detail }, { status: 500 })
  }
}
