import { toImageUrl } from '@/lib/media/imageUrl'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadSleeperAdpBoard, MAX_BOARD_SIZE } from '@/lib/draft/sleeperDraftBoard'
import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * /api/draft/players — the pool the draft board is built from.
 *
 * 🛑 THIS USED TO RETURN THE FIRST 400 PLAYERS ALPHABETICALLY, WITH AN ADP EQUAL TO THEIR
 * ALPHABETICAL POSITION.
 *
 *     orderBy: { name: 'asc' },  take: 400
 *     adp: i + 1
 *
 * So `SportsPlayer` has no rank or ADP column to order by (only `yearsExp` and `status`), and
 * with 24,135 NFL rows the pool was an A-to-roughly-C slice — Ja'Marr Chase was not in it.
 * `PlayerPool.tsx` then rendered `{p.adp}` in a column headed ADP, so a drafting manager read
 * a player's position in the alphabet as their average draft position.
 *
 * The board is now driven BY the ADP, which is both the ordering and the number: `adp_data`
 * consensus, read DB-first through lib/adp/liveAdpFallback.ts (in-process cached, ~2,901 NFL
 * names). Ordering by the thing you are reporting is what makes the two agree by construction.
 *
 * ⚠ A PLAYER WITH NO REAL ADP GETS `null`, NEVER A NUMBER. `DraftPlayerRow.adp` is
 * `number | null` for this reason and the UI renders an em dash. A fabricated ADP is worse
 * than a missing one: the missing one is visibly missing.
 *
 * 🛑 AND THE BOARD'S `id` IS A SLEEPER ID (2026-10-11); THE NFL BOARD NEVER TOUCHES `externalId`.
 * This route used to join the ADP board to `SportsPlayer` BY NAME, with no `source` filter and no
 * `orderBy`, keep whichever row Postgres returned first, and send that row's `externalId` as the
 * player's id. On production that made "Josh Allen" the backfill row `2135` — Josh Hines-Allen's
 * Rolling Insights id and Ha Ha Clinton-Dix's Sleeper id — so the modal showed Clinton-Dix and the
 * autopick drafted either Allen. "Mike Williams" resolved to retired `sleeper:748`.
 *
 * The NFL board is now built by `lib/draft/sleeperDraftBoard.ts`, which resolves each ADP name in
 * the Sleeper namespace only and refuses an ambiguous name rather than guessing. That module
 * documents the id contract every draft-room route shares.
 */

export const dynamic = 'force-dynamic'

const PLAYER_SELECT = {
  externalId: true,
  sleeperId: true,
  name: true,
  position: true,
  team: true,
  imageUrl: true,
  status: true,
} as const

type PlayerRow = {
  externalId: string
  sleeperId?: string | null
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  status: string | null
}

type BoardRow = {
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  status: string | null
}

/**
 * Exactly the shape `DraftPlayerRow` declares — no more.
 *
 * 🛑 THE STUBS ARE GONE RATHER THAN CORRECTED, because the honest value for each was "this
 * field has nothing behind it". Removed: `firstName: ''`, `lastName: ''`, `fullName`,
 * `sport` (already on the envelope), `projPts`, `byeWeek`, `stats: {}` and `isDrafted: false`.
 *
 * `isDrafted: false` is the one that was an actual CLAIM rather than a blank — it asserted
 * every player in the pool was undrafted, which is false the moment a draft starts. Nothing
 * read it (the draft room computes its own from `isPlayerDraftedEntry`, and PlayerPool from
 * `draftedIds.has(p.id)`), so it was a wrong answer nobody asked for.
 *
 * Safe to remove, established by TYPE rather than by grep: both callers annotate the response
 * as `DraftPlayerRow[]` (`PlayerPool.tsx:63`, `DraftShell.tsx:151`) and neither casts, so no
 * undeclared field was reachable. Keeping the response equal to the declared contract is also
 * what stops this drifting back — a field that does not exist cannot be filled with a stub.
 */
function toResponseRow(r: BoardRow, adp: number | null) {
  return {
    id: r.id,
    name: r.name,
    position: r.position ?? '',
    team: r.team ?? '',
    imageUrl: toImageUrl(r.imageUrl),
    status: r.status,
    adp,
    /*
     * 🛑 NULL, NOT 0. `0` is a claim — "we project this player to score nothing" — and it was
     * being made about every player in the pool.
     *
     * There IS a projection table, and it is deliberately not used here:
     * `fantasy_projections` holds 1,001 NFL rows for 2026 at week 1 only. A WEEKLY number is
     * not a draft-board projection, and substituting one would repeat the category error this
     * route already made with ADP — a real number from the wrong question.
     *
     * Nothing reads it today, so null costs nothing now and forces the first real consumer to
     * handle "unknown" instead of silently rendering 0.0 as a projection.
     */
    proj: null,
    /*
     * `SportsPlayer` carries no bye week, so this is genuinely unknown rather than withheld.
     * Null is already the honest answer — noted only so a later reader does not mistake it for
     * an oversight and fill it in.
     */
    bye: null,
    // Declared by DraftPlayerRow and read by nothing. Empty is absence, not an invented label.
    keyStat: '',
  }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sport = (req.nextUrl.searchParams?.get('sport')?.trim() || 'NFL').toUpperCase()
  const _draftId = req.nextUrl.searchParams?.get('draftId')?.trim()
  const take = Math.min(MAX_BOARD_SIZE, Number(req.nextUrl.searchParams?.get('limit')) || 400)

  /*
   * `null` means no ADP board for this sport (only NFL is populated in `adp_data`), handled below
   * by saying so rather than by inventing one. A failed read degrades the same way.
   */
  const board = await loadSleeperAdpBoard({ sport, take }).catch(() => null)
  if (board && board.length > 0) {
    return NextResponse.json({
      sport,
      draftId: _draftId ?? null,
      players: board.map((p) => toResponseRow(p, p.adp)),
    })
  }

  /*
   * No ADP board. The ordering here is admittedly arbitrary; what matters is that it is no longer
   * REPORTED as a draft position (`adp: null`).
   *
   * NFL still answers in Sleeper ids — Sleeper's own rows only, `id` = their `sleeperId` — so a
   * pool built here is queueable and draftable under the same contract as the ADP board. Other
   * sports have no Sleeper namespace and keep their provider ids.
   */
  if (sport === 'NFL') {
    const rows = (await prisma.sportsPlayer.findMany({
      where: { sport, source: 'sleeper', sleeperId: { not: null } },
      select: PLAYER_SELECT,
      take,
      orderBy: { name: 'asc' },
    })) as PlayerRow[]
    return NextResponse.json({
      sport,
      draftId: _draftId ?? null,
      players: rows
        .filter((r) => /^\d+$/.test(String(r.sleeperId ?? '')))
        .map((r) => toResponseRow({ ...r, id: String(r.sleeperId), team: normalizeTeamAbbrev(r.team) }, null)),
    })
  }

  const rows = (await prisma.sportsPlayer.findMany({
    where: { sport },
    select: PLAYER_SELECT,
    take,
    orderBy: { name: 'asc' },
  })) as PlayerRow[]

  return NextResponse.json({
    sport,
    draftId: _draftId ?? null,
    players: rows.map((r) => toResponseRow({ ...r, id: r.externalId }, null)),
  })
}
