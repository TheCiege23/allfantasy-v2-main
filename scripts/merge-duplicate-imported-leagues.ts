/**
 * Merge duplicate copies of an imported league into one League row.
 *
 * The plan comes from `lib/league-import/duplicateLeagueMerge.ts` — read its header for what is kept,
 * what moves and what is only reported. This file reads, prints and (with --apply) writes.
 *
 * Selection is always explicit, never "every duplicate in the database":
 *   --name-prefix=KBI                 leagues whose name starts with this (case-insensitive)
 *   --platform-league-id=<id>         one provider league (repeatable)
 *   --commissioner=<AppUser.id>       takes ownership of a kept copy whose owner account is deleted,
 *                                     and is added as a teamless co-commissioner where it is not
 *   --apply                           write. Without it this is a dry run and writes nothing.
 *
 * Each provider league is applied in its own transaction, in this order: move chat, move claims,
 * delete the removed copies (cascade takes their import-derived rows), then transfer ownership —
 * last, because the commissioner's own removed copy holds the (userId, platform, platformLeagueId,
 * season) unique slot until it is deleted. A group with conflicts is still merged; its conflicts are
 * printed and those claims are left unmoved. A BLOCKED group is skipped entirely.
 *
 * ⚠ It talks to whatever DATABASE_URL names. Name the target deliberately.
 */
import { prisma } from '../lib/prisma'
import { planDuplicateLeagueMerge, type LeagueMergePlan, type MergeCopy } from '../lib/league-import/duplicateLeagueMerge'
import { IMPORT_CO_COMMISSIONERS_KEY, importCoCommissionerIds, teamlessCoCommissionerIds } from '../lib/league/tournamentCoCommissioners'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const flag = (name: string) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))
const namePrefix = flag('name-prefix')[0] ?? null
const platformLeagueIds = flag('platform-league-id')
const commissioner = flag('commissioner')[0] ?? null

function sourceTeamIdOf(playerData: unknown): string | null {
  const pd = playerData && typeof playerData === 'object' ? (playerData as Record<string, unknown>) : null
  const imp = pd?.import && typeof pd.import === 'object' ? (pd.import as Record<string, unknown>) : null
  const v = imp?.sourceTeamId ?? pd?.source_team_id
  return typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null
}

async function loadGroups() {
  if (!namePrefix && platformLeagueIds.length === 0) {
    throw new Error('Refusing to run without --name-prefix or --platform-league-id')
  }
  const leagues = await prisma.league.findMany({
    where: {
      ...(namePrefix ? { name: { startsWith: namePrefix, mode: 'insensitive' as const } } : {}),
      ...(platformLeagueIds.length ? { platformLeagueId: { in: platformLeagueIds } } : {}),
    },
    select: { id: true, name: true, userId: true, platform: true, platformLeagueId: true, season: true, createdAt: true, settings: true },
    orderBy: { createdAt: 'asc' },
  })
  const groups = new Map<string, typeof leagues>()
  for (const l of leagues) {
    if (!l.platformLeagueId) continue
    const key = `${l.platform}:${l.platformLeagueId}:${l.season}`
    groups.set(key, [...(groups.get(key) ?? []), l])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

async function toCopy(l: { id: string; userId: string; createdAt: Date; settings: unknown }): Promise<MergeCopy> {
  const [owner, mirrored, teams, rosters, chat, blocking] = await Promise.all([
    prisma.appUser.findUnique({ where: { id: l.userId }, select: { username: true } }),
    prisma.draftSession.count({ where: { leagueId: l.id, sleeperDraftId: { not: null } } }),
    prisma.leagueTeam.findMany({ where: { leagueId: l.id }, select: { id: true, externalId: true, claimedByUserId: true } }),
    prisma.roster.findMany({ where: { leagueId: l.id }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueChatMessage.count({ where: { leagueId: l.id } }),
    prisma.leagueSafeConnection.count({ where: { afLeagueId: l.id } }),
  ])
  return {
    id: l.id,
    userId: l.userId,
    ownerDeleted: !owner || owner.username.startsWith('deleted_'),
    createdAt: l.createdAt,
    hasMirroredDraft: mirrored > 0,
    teams,
    rosters: rosters.map((r) => ({ id: r.id, platformUserId: r.platformUserId, sourceTeamId: sourceTeamIdOf(r.playerData) })),
    chatMessageCount: chat,
    blockingRowCount: blocking,
    teamlessCoCommissionerIds: teamlessCoCommissionerIds(l.settings),
  }
}

async function apply(plan: LeagueMergePlan) {
  await prisma.$transaction(
    async (tx) => {
      await tx.leagueChatMessage.updateMany({ where: { leagueId: { in: plan.removeIds } }, data: { leagueId: plan.keepId } })
      for (const m of plan.claimMoves) {
        await tx.leagueTeam.update({ where: { id: m.keepTeamId }, data: { claimedByUserId: m.userId, isOrphan: false } })
        if (m.keepRosterId) await tx.roster.update({ where: { id: m.keepRosterId }, data: { platformUserId: m.userId } })
        const claim = await tx.leagueManagerClaim.findFirst({ where: { leagueId: plan.keepId, afUserId: m.userId } })
        if (!claim) {
          await tx.leagueManagerClaim.create({
            data: { leagueId: plan.keepId, afUserId: m.userId, teamExternalId: m.externalId, isConfirmed: true },
          })
        }
      }
      // Restrict-on-delete: these must go before their league can.
      await tx.leagueManagerClaim.deleteMany({ where: { leagueId: { in: plan.removeIds } } })
      await tx.league.deleteMany({ where: { id: { in: plan.removeIds } } })
      if (plan.transferOwnerTo) {
        await tx.league.update({ where: { id: plan.keepId }, data: { userId: plan.transferOwnerTo } })
      }
      if (plan.addCoCommissioner) {
        const row = await tx.league.findUnique({ where: { id: plan.keepId }, select: { settings: true } })
        const settings = row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : {}
        const ids = [...new Set([...importCoCommissionerIds(settings), plan.addCoCommissioner])].sort()
        await tx.league.update({ where: { id: plan.keepId }, data: { settings: { ...settings, [IMPORT_CO_COMMISSIONERS_KEY]: ids } } })
      }
    },
    { timeout: 180_000, maxWait: 30_000 },
  )
}

async function main() {
  console.log(APPLY ? '=== APPLY: writing ===' : '=== DRY RUN: nothing will be written ===')
  const groups = await loadGroups()
  const users = new Map<string, string>()
  const nameOf = async (id: string | null) => {
    if (!id) return '-'
    if (!users.has(id)) users.set(id, (await prisma.appUser.findUnique({ where: { id }, select: { username: true } }))?.username ?? id)
    return users.get(id) as string
  }
  const totals = { groups: 0, removed: 0, claims: 0, conflicts: 0, chat: 0, transfers: 0, coComm: 0, losesAccess: 0, blocked: 0 }
  for (const g of groups) {
    const copies = await Promise.all(g.map(toCopy))
    const plan = planDuplicateLeagueMerge(copies, { commissionerUserId: commissioner })
    const keep = g.find((l) => l.id === plan.keepId)!
    totals.groups++
    console.log(`\n${keep.name}  [${keep.platform} ${keep.platformLeagueId} ${keep.season}]`)
    console.log(`  keep    ${keep.id}  owner ${await nameOf(keep.userId)}`)
    for (const id of plan.removeIds) {
      const l = g.find((x) => x.id === id)!
      console.log(`  remove  ${id}  owner ${await nameOf(l.userId)}`)
    }
    if (plan.blocked) {
      totals.blocked++
      console.log(`  BLOCKED: ${plan.blocked} — skipped`)
      continue
    }
    for (const m of plan.claimMoves) console.log(`  move claim: ${await nameOf(m.userId)} -> team ${m.externalId}`)
    for (const c of plan.conflicts) console.log(`  CONFLICT: ${await nameOf(c.userId)} team ${c.externalId ?? '?'}: ${c.reason} (not moved)`)
    if (plan.chatMessagesToMove) console.log(`  move ${plan.chatMessagesToMove} chat message(s)`)
    if (plan.transferOwnerTo) console.log(`  owner: ${await nameOf(keep.userId)} -> ${await nameOf(plan.transferOwnerTo)}`)
    if (plan.addCoCommissioner) console.log(`  add co-commissioner: ${await nameOf(plan.addCoCommissioner)}`)
    for (const u of plan.losesAccess) console.log(`  LOSES ACCESS: ${await nameOf(u)} (owned a removed copy, no team or role in the kept one)`)
    totals.removed += plan.removeIds.length
    totals.claims += plan.claimMoves.length
    totals.conflicts += plan.conflicts.length
    totals.chat += plan.chatMessagesToMove
    totals.transfers += plan.transferOwnerTo ? 1 : 0
    totals.coComm += plan.addCoCommissioner ? 1 : 0
    totals.losesAccess += plan.losesAccess.length
    if (APPLY) {
      await apply(plan)
      console.log('  applied')
    }
  }
  console.log('\nTOTALS', JSON.stringify(totals))
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
