import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { readCfpSeeds } from "@/lib/playoffs/cfpSeeds"
import { saveCfpSeedsAndApply } from "@/lib/playoffs/cfpSeedAdmin"
import { prisma } from "@/lib/prisma"

/**
 * GET  /api/admin/brackets/cfp-seeds?season=2026  — the saved seeds, if any
 * POST /api/admin/brackets/cfp-seeds              — { season, seeds: string[12] }
 *
 * The College Football Playoff's twelve seeds, entered by an admin after
 * Selection Sunday (owner call, 2026-10-01: no feed carries them). Saving seeds
 * every CFP pool for that season — see lib/playoffs/cfpSeedAdmin.ts.
 *
 * ⚠ `requireAdmin`, NOT `requireAdminOrBearer`. This rewrites bracket slots and
 * picks in other people's pools; it is a human decision, not something a cron
 * secret should be able to make.
 *
 * ⚠ EVERY SAVE WRITES `AdminAuditLog`, with the actor from
 * `resolveAdminAuditActor` (never a bare `user.id`, which is optional and would
 * let the write happen with no audit row). The previous and new seed lists are
 * in the details, so a bad save can be reconstructed and reversed.
 */

export const dynamic = "force-dynamic"

function parseSeason(raw: unknown): number | null {
  const season = Number(raw)
  return Number.isInteger(season) ? season : null
}

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const season = parseSeason(new URL(request.url).searchParams.get("season"))
  if (season == null) return NextResponse.json({ ok: false, error: "season is required" }, { status: 400 })

  const [record, pools] = await Promise.all([
    readCfpSeeds(season),
    (prisma as any).playoffBracketChallenge.count({ where: { sport: "ncaaf", seasonYear: season } }) as Promise<number>,
  ])
  return NextResponse.json({ ok: true, season, record, pools })
}

export async function POST(request: Request) {
  // The gate runs FIRST and returns before anything is read or written.
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  let body: { season?: unknown; seeds?: unknown } | null
  try {
    body = (await request.json()) as { season?: unknown; seeds?: unknown } | null
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 })
  }
  const season = parseSeason(body?.season)
  if (season == null) return NextResponse.json({ ok: false, error: "season is required" }, { status: 400 })

  const actor = resolveAdminAuditActor(gate.user)
  const previous = await readCfpSeeds(season)
  const result = await saveCfpSeedsAndApply({ season, seeds: body?.seeds, userId: actor })

  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 })
  }

  await logAdminAudit({
    adminUserId: actor,
    action: "cfp_seeds.save",
    targetType: "cfp_season",
    targetId: String(season),
    details: {
      previousSeeds: previous?.seeds ?? null,
      seeds: result.record.seeds,
      corrections: result.corrections,
      pools: result.pools,
      corrected: result.corrected,
      sweep: {
        challengesSeeded: result.sweep.challengesSeeded,
        slotsFilled: result.sweep.slotsFilled,
        picksMigrated: result.sweep.picksMigrated,
        slotsUnresolved: result.sweep.slotsUnresolved,
        errors: result.sweep.errors,
      },
    },
  })

  return NextResponse.json({
    ok: true,
    season,
    record: result.record,
    pools: result.pools,
    corrections: result.corrections,
    corrected: result.corrected,
    sweep: result.sweep,
  })
}
