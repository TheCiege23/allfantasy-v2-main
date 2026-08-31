import { withApiUsage } from '@/lib/telemetry/usage'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import {
  listFranchises,
  loadFranchiseDetail,
  markLegObserved,
  recordCrossPlatformTrade,
  refreshTradeSettlement,
} from '@/lib/franchise/franchiseService'
import { describeCrossPlatformTrade } from '@/lib/franchise/franchiseLink'
import { loadCollegeBoardForFranchise } from '@/lib/franchise/franchiseBoard'
import { listPairableLeagues, maskEmail, collapseFantraxDuplicates } from '@/lib/franchise/pairableLeagues'
import { getFantraxLeagues } from '@/lib/league-import/fantrax/fantraxApi'
import {
  attachToFranchise,
  importFantraxLeague,
} from '@/lib/league-import/fantrax/importFantraxLeague'

/**
 * The cross-platform franchise: one team across two leagues on two platforms.
 *
 * ⚠ EVERY READ AND WRITE IS GATED ON OWNERSHIP OF THE LINK, not merely on being
 * signed in. A franchise names which teams in which leagues belong to someone,
 * so an ungated read would tell any account who owns what across the league.
 *
 * ⚠ AND NOTHING HERE EXECUTES A TRADE. Sleeper's API is read-only and Fantrax is
 * an import, so a cross-platform deal is recorded and watched, never performed.
 * The endpoint says so in its own response rather than leaving a manager to
 * assume otherwise.
 */

/** Ownership check, used by every branch below. */
async function ownedLink(linkId: string, userId: string) {
  const link = await prisma.franchiseLink.findFirst({
    where: { id: linkId, ownerUserId: userId },
    select: { id: true },
  })
  return link != null
}

/**
 * Does this user own the league they are asking to pair?
 *
 * 🛑 `attachToFranchise` DOES NOT ANSWER THIS. It checks who owns the FRANCHISE
 * and whether the league is already attached to a different one — never whether
 * the caller owns the league they named. Pairing is the first action that takes
 * an arbitrary league id from the request body, so without this check any signed
 * in account could attach a stranger's league to its own franchise and then read
 * that team's whole roster back through `loadFranchiseDetail`.
 *
 * ⚠ TWO ID SPACES, AND THE PLATFORM DECIDES WHICH. `FranchiseLeagueMember`
 * stores `League.id` for the pro side and `FantraxLeague.id` for the college
 * side, keyed by different owner columns (`userId` vs `appUserId`). Checking the
 * wrong table returns "not found" for a league the user really does own.
 */
async function ownsLeague(platform: string, leagueId: string, userId: string): Promise<boolean> {
  if (platform === 'fantrax') {
    const row = await prisma.fantraxLeague.findFirst({
      where: { id: leagueId, appUserId: userId },
      select: { id: true },
    })
    return row != null
  }
  const row = await prisma.league.findFirst({
    where: { id: leagueId, userId },
    select: { id: true },
  })
  return row != null
}

export const GET = withApiUsage({ endpoint: '/api/legacy/franchise', tool: 'Franchise' })(
  async (request: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    const linkId = new URL(request.url).searchParams.get('linkId')

    if (!linkId) {
      const franchises = await listFranchises(auth.userId)
      return NextResponse.json({ franchises })
    }

    if (!(await ownedLink(linkId, auth.userId))) {
      /* Same answer for "not yours" and "does not exist" — a distinct 403 would
         confirm the link exists to someone who cannot see it. */
      return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })
    }

    const detail = await loadFranchiseDetail(linkId)
    if (!detail) return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })

    /*
     * The college board priced for THIS franchise: a pro-side hole lifts a
     * college asset at that position, but only if he arrives before it closes.
     * Null when either half cannot be read, never a neutral board.
     */
    const collegeBoard = await loadCollegeBoardForFranchise(linkId).catch(() => null)

    return NextResponse.json({
      ...detail,
      collegeBoard,
      note: 'AllFantasy cannot execute a trade on either platform. Both halves are carried out by hand and tracked here.',
    })
  },
)

export const POST = withApiUsage({ endpoint: '/api/legacy/franchise', tool: 'Franchise' })(
  async (request: NextRequest) => {
    const auth = await requireVerifiedUser()
    if (!auth.ok) return auth.response

    let body: {
      action?: string
      linkId?: string
      /**
       * Explicit confirmation that the caller has SEEN whose franchise a league
       * is leaving. Never defaulted true: the first attempt must 409 so the UI
       * can name the other franchise, because moving the membership empties it.
       */
      reclaim?: boolean
      tradeId?: string
      summary?: string
      legs?: Array<{ role: 'pro' | 'college'; platform: string; sends: string[]; receives: string[] }>
      role?: 'pro' | 'college'
      status?: 'observed' | 'contradicted'
      basis?: string
      userSecretId?: string
      leagueId?: string
      teamName?: string
      franchiseName?: string
      /** The league the user clicked "connect" on, so its half arrives chosen. */
      from?: string
      pro?: { platform?: string; leagueId?: string; teamExternalId?: string }
      college?: { platform?: string; leagueId?: string; teamExternalId?: string }
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    /*
     * Which already-imported leagues could be paired, and which half each would
     * be. Read only — this proposes, a human confirms.
     *
     * ⚠ DISTINCT FROM `discover-leagues` BELOW, WHICH IS A DIFFERENT QUESTION.
     * That one takes a Fantrax Secret ID and lists what exists on Fantrax so it
     * can be IMPORTED. This one lists what is already in AllFantasy and needs no
     * credential at all — which is the ordinary case: both leagues imported
     * separately, and no way to say they are one franchise.
     */
    if (body.action === 'discover-pairable') {
      const pairable = await listPairableLeagues(auth.userId)
      /* Collapse the League row a Fantrax import also creates — see
         `collapseFantraxDuplicates` for why offering both is worse than useless. */
      const leagueRows = await prisma.league.findMany({
        where: { userId: auth.userId },
        select: { id: true, platform: true, platformLeagueId: true },
      })
      const collapsed = collapseFantraxDuplicates(pairable, leagueRows)

      /*
       * 🛑 THE HALF THE USER ARRIVED FROM, RESOLVED HERE RATHER THAN GUESSED IN
       * THE BROWSER. They clicked "connect" on one specific league, so it is
       * already chosen — making them find it again in its own list is friction
       * that stops the flow being used.
       *
       * ⚠ AND THE ID THEY ARRIVE WITH IS OFTEN NOT THE ID IN THE LIST. A Fantrax
       * import writes both a `FantraxLeague` snapshot and a mirror `League`;
       * every screen links by the `League.id`, while `collapseFantraxDuplicates`
       * keeps the SNAPSHOT. Matching on the raw id alone silently preselects
       * nothing for exactly the leagues this feature is for.
       */
      const fromRaw = typeof body.from === 'string' ? body.from.trim() : ''
      let from: { id: string; role: 'pro' | 'college' } | null = null
      if (fromRaw) {
        const mirror = leagueRows.find((l) => l.id === fromRaw)
        const candidates = [fromRaw, mirror?.platformLeagueId ?? null].filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        )
        for (const id of candidates) {
          const pro = collapsed.pro.find((l) => l.id === id)
          if (pro) {
            from = { id: pro.id, role: 'pro' }
            break
          }
          const college = collapsed.college.find((l) => l.id === id)
          if (college) {
            from = { id: college.id, role: 'college' }
            break
          }
        }
      }

      return NextResponse.json({
        ...collapsed,
        from,
        note: 'Pairing is a label, not a sync. Neither league is modified.',
      })
    }

    /*
     * Pair two already-imported leagues as one franchise.
     *
     * 🛑 THIS IS THE ACTION THAT DID NOT EXIST. `connect-league` below hardcodes
     * `role: 'college'` and `platform: 'fantrax'` and IMPORTS from a Secret ID,
     * so a franchise could only ever gain a college half and only by importing
     * again. Nothing could attach the pro side, which meant the paired view
     * `loadFranchiseDetail` already knows how to render could never have two
     * halves to render.
     *
     * ⚠ BOTH SIDES ARE ATTACHED OR NEITHER IS. A franchise holding one half is
     * indistinguishable from a pairing that half-failed, and the UI would show a
     * "combined" team that is one league — so a failure on the second attach
     * rolls the first back rather than leaving that state behind.
     */
    if (body.action === 'pair-leagues') {
      const pro = body.pro
      const college = body.college
      if (!pro?.platform || !pro?.leagueId || !college?.platform || !college?.leagueId) {
        return NextResponse.json(
          { error: 'pro and college each need a platform and a leagueId.' },
          { status: 400 },
        )
      }
      const proPlatform = String(pro.platform).toLowerCase()
      const collegePlatform = String(college.platform).toLowerCase()

      /* ⚠ A LEAGUE CANNOT BE ITS OWN OTHER HALF. Both uniqueness constraints in
         the schema are satisfied by (platform, leagueId) pairs that differ only
         by role, so nothing below would reject this. */
      if (proPlatform === collegePlatform && pro.leagueId === college.leagueId) {
        return NextResponse.json(
          { error: 'A league cannot be paired with itself.' },
          { status: 400 },
        )
      }

      const [ownsPro, ownsCollege] = await Promise.all([
        ownsLeague(proPlatform, pro.leagueId, auth.userId),
        ownsLeague(collegePlatform, college.leagueId, auth.userId),
      ])
      /* Same answer for "not yours" and "does not exist", matching the link
         check above — a distinct 403 confirms a league exists to someone who
         cannot see it. */
      if (!ownsPro || !ownsCollege) {
        return NextResponse.json({ error: 'League not found' }, { status: 404 })
      }
      if (body.linkId && !(await ownedLink(body.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })
      }

      /*
       * 🛑 EITHER HALF MAY ALREADY BE IN A FRANCHISE OF THIS USER'S, and building
       * a second one around it is what produced "that league is already part of
       * another franchise" on a franchise the user owns. The half-built case is
       * the ordinary one — LeagueHome's own "Add the other half" link lands here
       * — so pairing MERGES into that link rather than competing with it.
       *
       * ⚠ OWNER-GATED, not merely "a link exists". A membership under someone
       * else's link is still refused, one layer down in `attachToFranchise`.
       */
      const ownMemberships = await prisma.franchiseLeagueMember.findMany({
        where: {
          link: { ownerUserId: auth.userId },
          OR: [
            { platform: proPlatform, leagueId: pro.leagueId },
            { platform: collegePlatform, leagueId: college.leagueId },
          ],
        },
        select: { id: true, linkId: true },
      })
      const targetLinkId = body.linkId ?? ownMemberships[0]?.linkId ?? null

      /*
       * 🛑 A CLAIM BY ANOTHER ACCOUNT — REFUSED ONCE, THEN RECLAIMABLE ON A
       * DELIBERATE CONFIRM.
       *
       * `ownsLeague` above already proved the caller owns BOTH League rows, so a
       * franchise on another account holding one of them is a stale or
       * cross-account claim over the caller's own property. Refusing forever left
       * the league permanently unpairable with no way out — that is the bug this
       * replaces. Reclaiming silently is the opposite mistake: the other
       * franchise loses a half without its owner ever being told.
       *
       * So: the first attempt returns 409 naming the franchise and a MASKED
       * owner, the UI shows it, and only a second request carrying
       * `reclaim: true` moves the membership. Destructive, therefore confirmed.
       *
       * ⚠ THE MASK IS NOT DECORATION. The caller is entitled to know the league
       * is spoken for; they are not entitled to another account's address.
       */
      const foreignClaims = await prisma.franchiseLeagueMember.findMany({
        where: {
          OR: [
            { platform: proPlatform, leagueId: pro.leagueId },
            { platform: collegePlatform, leagueId: college.leagueId },
          ],
          NOT: { link: { ownerUserId: auth.userId } },
        },
        select: {
          id: true,
          platform: true,
          leagueId: true,
          linkId: true,
          link: { select: { id: true, name: true, ownerUserId: true } },
        },
      })

      if (foreignClaims.length > 0) {
        if (body.reclaim !== true) {
          const ownerIds = Array.from(
            new Set(foreignClaims.map((c) => c.link?.ownerUserId).filter((x): x is string => !!x)),
          )
          const owners = ownerIds.length
            ? await prisma.appUser.findMany({
                where: { id: { in: ownerIds } },
                select: { id: true, email: true },
              })
            : []
          const labelById = new Map(owners.map((o) => [o.id, maskEmail(o.email)]))
          return NextResponse.json(
            {
              error: 'That league is already part of a franchise on another account.',
              /* Structured so the UI can offer "connect anyway" instead of a dead end. */
              claims: foreignClaims.map((c) => ({
                platform: c.platform,
                leagueId: c.leagueId,
                franchiseName: c.link?.name ?? 'a franchise',
                ownerLabel:
                  (c.link?.ownerUserId ? labelById.get(c.link.ownerUserId) : null) ?? 'another account',
              })),
              canReclaim: true,
            },
            { status: 409 },
          )
        }

        /*
         * Confirmed. Release the foreign memberships, and delete a link only if
         * this emptied it — an otherwise-populated franchise must survive losing
         * one half, and nothing should be left named after a franchise with no
         * leagues in it.
         */
        for (const c of foreignClaims) {
          await prisma.franchiseLeagueMember.delete({ where: { id: c.id } }).catch(() => {})
          await prisma.franchiseLink
            .deleteMany({ where: { id: c.linkId, members: { none: {} } } })
            .catch(() => {})
        }
      }

      /*
       * 🛑 AND THE OTHER HALF MAY BE IN A DIFFERENT FRANCHISE OF THEIRS AGAIN.
       * `attachToFranchise` reuses a user's own claiming link only when no link
       * was named — with one named it falls through to a create that the unique
       * `(platform, leagueId)` rejects. So the membership is moved here, before
       * either attach, and the franchise it came from is deleted only if this
       * empties it: nothing is left named after a franchise with no leagues.
       *
       * ⚠ SCOPED TO LINKS THIS USER OWNS, by the query above. A league held by
       * somebody else's franchise is still refused inside `attachToFranchise`,
       * which is the check that stops one account emptying another's.
       */
      for (const m of ownMemberships) {
        if (targetLinkId == null || m.linkId === targetLinkId) continue
        await prisma.franchiseLeagueMember.delete({ where: { id: m.id } }).catch(() => {})
        await prisma.franchiseLink
          .deleteMany({ where: { id: m.linkId, ownerUserId: auth.userId, members: { none: {} } } })
          .catch(() => {})
      }

      /* Whether the pro half was ALREADY in the target link, so a failure below
         rolls back what this request did and not what it found. */
      const proWasMember =
        targetLinkId != null &&
        (await prisma.franchiseLeagueMember.findFirst({
          where: { linkId: targetLinkId, platform: proPlatform, leagueId: pro.leagueId },
          select: { id: true },
        })) != null

      const attachedPro = await attachToFranchise({
        ownerUserId: auth.userId,
        franchiseName: body.franchiseName?.trim() || 'My franchise',
        linkId: targetLinkId,
        role: 'pro',
        platform: proPlatform,
        leagueId: pro.leagueId,
        teamExternalId: pro.teamExternalId ?? '',
      })
      if (!attachedPro.ok) {
        return NextResponse.json({ error: attachedPro.error }, { status: 400 })
      }

      const attachedCollege = await attachToFranchise({
        ownerUserId: auth.userId,
        franchiseName: body.franchiseName?.trim() || 'My franchise',
        linkId: attachedPro.linkId,
        role: 'college',
        platform: collegePlatform,
        leagueId: college.leagueId,
        teamExternalId: college.teamExternalId ?? '',
      })
      if (!attachedCollege.ok) {
        /*
         * ⚠ ROLL THE PRO HALF BACK. Leaving it attached produces a franchise with
         * one half, which renders as a "combined" view of a single league and is
         * indistinguishable from a correct pairing of a league with no college
         * side. Scoped to the member row, and the LINK is only removed if this
         * request created it — an existing franchise must survive a failed
         * attempt to add a half to it.
         */
        if (!proWasMember) {
          await prisma.franchiseLeagueMember
            .deleteMany({ where: { linkId: attachedPro.linkId, role: 'pro', platform: proPlatform, leagueId: pro.leagueId } })
            .catch(() => {})
        }
        if (!targetLinkId) {
          await prisma.franchiseLink
            .deleteMany({ where: { id: attachedPro.linkId, ownerUserId: auth.userId, members: { none: {} } } })
            .catch(() => {})
        }
        return NextResponse.json({ error: attachedCollege.error }, { status: 400 })
      }

      return NextResponse.json({
        linkId: attachedCollege.linkId,
        note: 'Paired. Neither league was modified — this records that they are one franchise.',
      })
    }

    /*
     * Step 1 of connecting a league: list what the user owns on Fantrax.
     *
     * ⚠ THE SECRET ID IS USED FOR THIS ONE REQUEST AND DISCARDED. It is never
     * stored, never logged, and never echoed back — not in the response and not
     * in a failure message. Only the league ids travel onward, and a league id
     * is not a credential.
     */
    if (body.action === 'discover-leagues') {
      if (!body.userSecretId) {
        return NextResponse.json({ error: 'userSecretId is required' }, { status: 400 })
      }
      const found = await getFantraxLeagues(body.userSecretId)
      if (!found.ok) {
        /*
         * ⚠ A BAD SECRET ID AND AN EMPTY ACCOUNT ARE INDISTINGUISHABLE — Fantrax
         * answers HTTP 200 {} for both — so the message says so rather than
         * telling someone with a typo that they own no leagues.
         */
        return NextResponse.json({ error: found.failure.message }, { status: 400 })
      }
      return NextResponse.json({
        leagues: found.data,
        note: 'Pick the league and your team in it. We never store your Secret ID.',
      })
    }

    /*
     * Step 2: import the chosen league and attach it to a franchise.
     */
    if (body.action === 'connect-league') {
      if (!body.leagueId || !body.teamName) {
        return NextResponse.json({ error: 'leagueId and teamName are required' }, { status: 400 })
      }
      if (body.linkId && !(await ownedLink(body.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })
      }

      const imported = await importFantraxLeague({
        leagueId: body.leagueId,
        teamName: body.teamName,
        appUserId: auth.userId,
      })
      if (!imported.ok) {
        /* Returning the team list lets the caller re-prompt instead of failing. */
        return NextResponse.json({ error: imported.error, teams: imported.teams }, { status: 400 })
      }

      const attached = await attachToFranchise({
        ownerUserId: auth.userId,
        franchiseName: body.franchiseName ?? imported.leagueName,
        linkId: body.linkId ?? null,
        role: 'college',
        platform: 'fantrax',
        leagueId: imported.fantraxLeagueId,
        teamExternalId: imported.teamName,
      })
      if (!attached.ok) return NextResponse.json({ error: attached.error }, { status: 400 })

      return NextResponse.json({
        linkId: attached.linkId,
        imported,
        note: 'This is a snapshot, not a live sync. Re-run the connect to refresh it.',
      })
    }

    if (body.action === 'record-trade') {
      if (!body.linkId) return NextResponse.json({ error: 'linkId is required' }, { status: 400 })
      if (!(await ownedLink(body.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Franchise not found' }, { status: 404 })
      }
      const legs = body.legs ?? []
      if (legs.length === 0) {
        return NextResponse.json({ error: 'at least one leg is required' }, { status: 400 })
      }
      /* One leg per role — the unique constraint enforces it, but answering 400
         beats surfacing a database error to the caller. */
      if (new Set(legs.map((l) => l.role)).size !== legs.length) {
        return NextResponse.json({ error: 'each role may appear once' }, { status: 400 })
      }

      const recorded = await recordCrossPlatformTrade({
        linkId: body.linkId,
        summary: body.summary ?? null,
        legs,
      })
      return NextResponse.json({
        ...recorded,
        description: describeCrossPlatformTrade(
          legs.map((l) => ({ ...l, status: 'pending' as const })),
        ),
      })
    }

    if (body.action === 'mark-leg') {
      if (!body.tradeId || !body.role || !body.status) {
        return NextResponse.json({ error: 'tradeId, role and status are required' }, { status: 400 })
      }
      const trade = await prisma.crossPlatformTrade.findUnique({
        where: { id: body.tradeId },
        select: { linkId: true },
      })
      if (!trade || !(await ownedLink(trade.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
      }

      const settlement = await markLegObserved({
        tradeId: body.tradeId,
        role: body.role,
        status: body.status,
        /* Always recorded, so a manager can tell an observation from an
           assumption later. */
        basis: body.basis ?? `marked ${body.status} by the franchise owner`,
      })
      return NextResponse.json({ settlement })
    }

    if (body.action === 'refresh-settlement') {
      if (!body.tradeId) return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
      const trade = await prisma.crossPlatformTrade.findUnique({
        where: { id: body.tradeId },
        select: { linkId: true },
      })
      if (!trade || !(await ownedLink(trade.linkId, auth.userId))) {
        return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
      }
      return NextResponse.json({ settlement: await refreshTradeSettlement(body.tradeId) })
    }

    return NextResponse.json(
      { error: 'Unknown action. Use discover-leagues, connect-league, record-trade, mark-leg or refresh-settlement.' },
      { status: 400 },
    )
  },
)
