import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Keep `Roster.redraftRosterId` populated.
 *
 * ── 🛑 WHY THIS IS ONE FUNCTION AND NOT A WRITE AT EVERY CREATION SITE ──────────────────────
 * `Roster` rows are created in at least twelve places (league creation, invites, draft slot
 * materialization, Sleeper bootstrap, C2C commit, tournament advancement, survivor exile, admin
 * repair…) and `RedraftRoster` in at least eight. Setting the link at each of them means twenty
 * copies of one rule, and the thirteenth site added next month silently breaks the invariant with
 * nothing failing. That divergence is precisely what produced two guillotine engines that disagree
 * about what a team is.
 *
 * So the rule lives here once, it is idempotent, and it is called where the correspondence first
 * becomes knowable rather than where either row happens to be born.
 *
 * ── ⚠ THE LINK CANNOT BE SET AT `Roster` CREATION TIME, WHICH IS THE WHOLE DIFFICULTY ───────
 * A `Roster` is created when a league is created. Its `RedraftRoster` counterpart does not exist
 * until a redraft SEASON is materialized, which is later and sometimes much later. Measured on
 * 2026-09-04, the newest 45 rosters in production linked at 36% against 84% for the established
 * population — consistent with rows created after their league's season, or before it.
 *
 * That is why this is a reconciler and not an insert-time assignment: it can run at any point after
 * both sides exist and reach the same answer.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────────────
 * It will not invent a link. The only correspondence between the two models is the platform user
 * id (`Roster.platformUserId` = `RedraftRoster.ownerId`), and that is not total: 530 of 3,267
 * rosters have no resolvable counterpart, because 23 carry an app uuid rather than a platform id,
 * 6 carry neither shape, and the rest simply have no redraft roster. Those stay NULL, and NULL
 * means "no known counterpart" — never "not eliminated", never "no team".
 */

export interface ReconcileResult {
  /** Rosters that gained a link on this run. */
  linked: number
  /** Rosters still without one, after this run. */
  unlinked: number
  /** Rosters already linked before this run — reported so a no-op is distinguishable from a miss. */
  alreadyLinked: number
}

/**
 * Reconcile every roster in one league. Idempotent and safe to call on every season materialization.
 *
 * ⚠ SCOPED BY LEAGUE ON BOTH SIDES OF THE MATCH. A platform user id is unique only WITHIN a league —
 * the same manager appears in many — so matching on owner alone would wire a roster in one league to
 * that manager's roster in another. The migration's backfill carried the same guard and the
 * resulting `cross_league_links` count was 0; this keeps that true.
 */
export async function reconcileRosterRedraftLinks(leagueId: string): Promise<ReconcileResult> {
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, redraftRosterId: true },
  })
  if (rosters.length === 0) return { linked: 0, unlinked: 0, alreadyLinked: 0 }

  const alreadyLinked = rosters.filter((r) => r.redraftRosterId != null).length
  const needing = rosters.filter((r) => r.redraftRosterId == null && r.platformUserId)
  if (needing.length === 0) {
    return { linked: 0, unlinked: rosters.length - alreadyLinked, alreadyLinked }
  }

  const candidates = await prisma.redraftRoster.findMany({
    where: { leagueId, ownerId: { in: needing.map((r) => r.platformUserId) } },
    select: { id: true, ownerId: true },
  })
  const byOwner = new Map(candidates.map((c) => [c.ownerId, c.id]))

  /*
   * Already-claimed targets are excluded rather than overwritten. `redraftRosterId` is UNIQUE, so a
   * second roster claiming the same redraft roster would throw — and the right response is to leave
   * both alone and let the count show it, not to pick a winner. Nothing in production had a
   * double-claim when the constraint was added (measured: 0), so this is a guard, not a workaround.
   */
  const taken = new Set(
    (
      await prisma.roster.findMany({
        where: { leagueId, redraftRosterId: { not: null } },
        select: { redraftRosterId: true },
      })
    )
      .map((r) => r.redraftRosterId)
      .filter((x): x is string => x != null),
  )

  let linked = 0
  for (const r of needing) {
    const target = byOwner.get(r.platformUserId)
    if (!target || taken.has(target)) continue
    await prisma.roster.update({ where: { id: r.id }, data: { redraftRosterId: target } })
    taken.add(target)
    linked += 1
  }

  return { linked, unlinked: rosters.length - alreadyLinked - linked, alreadyLinked }
}

/**
 * Reconcile, then read the link for one roster — the shape a caller that needs an answer NOW wants.
 *
 * 🛑 THIS EXISTS SO THE LINK CANNOT GO STALE WHERE IT MATTERS. A one-time backfill with no
 * maintainer decays: every roster created afterwards holds NULL forever, and a consumer reading the
 * column would quietly serve fewer and fewer teams while looking correct. That is the
 * `ingestCFBDStats` failure — a surface pointed at data nothing refreshes.
 *
 * Reconciling lazily on the read path means a league that was never reconciled at materialization
 * still resolves the first time something actually needs it. Returns null when there is genuinely
 * no counterpart, which the caller must handle rather than treat as an absent elimination.
 */
export async function resolveRedraftRosterId(
  leagueId: string,
  rosterId: string,
): Promise<string | null> {
  const direct = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { redraftRosterId: true },
  })
  if (direct?.redraftRosterId) return direct.redraftRosterId

  await reconcileRosterRedraftLinks(leagueId)

  const after = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { redraftRosterId: true },
  })
  return after?.redraftRosterId ?? null
}
