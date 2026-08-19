/**
 * Fantasy OS Suite — Phase OS-A2: League Context Wiring.
 *
 * GET: read a league's financial context. Phase OS-C6.1: now gated by `authorizeLeagueRead` — a real
 * per-league membership check (commissioner/co-commissioner/member/viewer). This is a deliberate
 * reversal of this route's own original design: `leagueContextAuthorization.ts`'s header comment
 * previously documented "reads are NOT gated... enforcement is session-level, not per-league" as an
 * intentional choice, matching every sibling Decision OS read route's own (also unguarded) precedent
 * at the time. The production-readiness audit (`docs/os/FANTASY_OS_PRODUCTION_READINESS_AUDIT.md`)
 * found this was never a real security boundary — this route specifically exposes financial
 * status/amount/currency/escrow-provider, the most sensitive Decision OS read surface, so it gets the
 * hardening first alongside `/mission-control` and `/league-analytics`.
 *
 * POST: confirm free/paid, or reset to unknown. Gated by `authorizeLeagueContextMutation` — the
 * league's own commissioner/co-commissioner, or a site admin. Never infers, never touches
 * LeagueSafe/FanCred/any real escrow provider — this route only records what a real person explicitly
 * states.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  resolveLeagueFinancialContext,
  persistLeagueFinancialConfirmation,
  LeagueContextStoreUnavailableError,
} from '@/lib/decision-os/leagueContext'
import { authorizeLeagueContextMutation } from '@/lib/decision-os/leagueContextAuthorization'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import type { LeagueEscrowProvider } from '@/lib/decision-os/leagueFinancialContext'

export const dynamic = 'force-dynamic'

async function getSessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(request: Request) {
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const context = await resolveLeagueFinancialContext(leagueId)
  return NextResponse.json(context)
}

const VALID_ACTIONS = new Set(['confirm_free', 'confirm_paid', 'reset'])

interface LeagueContextMutationBody {
  leagueId?: string
  action?: string
  buyInAmount?: number | null
  buyInCurrency?: string | null
  financialNotes?: string | null
  escrowProvider?: LeagueEscrowProvider
}

export async function POST(request: Request) {
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: LeagueContextMutationBody
  try {
    body = (await request.json()) as LeagueContextMutationBody
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }
  if (!body.action || !VALID_ACTIONS.has(body.action)) {
    return NextResponse.json(
      { error: `action must be one of: ${Array.from(VALID_ACTIONS).join(', ')}` },
      { status: 400 },
    )
  }

  const gate = await authorizeLeagueContextMutation(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden — only this league\'s commissioner or a site admin can confirm its financial context.' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  try {
    const context =
      body.action === 'reset'
        ? await persistLeagueFinancialConfirmation(leagueId, { type: 'reset' })
        : await persistLeagueFinancialConfirmation(leagueId, {
            type: 'confirm',
            input: {
              financialStatus: body.action === 'confirm_free' ? 'FREE' : 'PAID',
              buyInAmount: body.buyInAmount,
              buyInCurrency: body.buyInCurrency,
              financialNotes: body.financialNotes,
              escrowProvider: body.escrowProvider,
            },
          })
    return NextResponse.json(context)
  } catch (err) {
    if (err instanceof LeagueContextStoreUnavailableError) {
      return NextResponse.json({ error: 'context_store_unavailable' }, { status: 503 })
    }
    throw err
  }
}
