import 'server-only'

import type { Prisma } from '@prisma/client'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'

export type SurvivorDraftPreparation =
  | { ok: true; alreadyStarted: boolean; draftOrder: string[] }
  | { ok: false; code: string; error: string }

/** Runs inside the setup transaction. The historical redraftRosterId field stores Roster.id here. */
export async function prepareSurvivorDraftParticipants(
  leagueId: string,
  sessionId: string,
  db: Prisma.TransactionClient,
): Promise<SurvivorDraftPreparation> {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, platform: true, settings: true, survivorMode: true, leagueVariant: true },
  })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE' || (!league.survivorMode && league.leagueVariant !== 'survivor')) {
    return { ok: false, code: 'not_native_survivor', error: 'Automatic Survivor setup requires a native AllFantasy Survivor league.' }
  }
  const session = await db.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true, status: true, sessionKind: true, sleeperDraftId: true, teamCount: true, slotOrder: true } })
  if (!session || session.id !== sessionId || session.status !== 'completed' || session.sessionKind === 'mock' || session.sleeperDraftId) {
    return { ok: false, code: 'draft_not_ready', error: 'Complete the current native league draft before starting Survivor.' }
  }
  const game = await db.survivorGameState.findUnique({ where: { leagueId } })
  if (game && (game.currentWeek > 0 || !['pre_draft', 'draft', 'pre_merge'].includes(game.phase))) {
    return { ok: true, alreadyStarted: true, draftOrder: [] }
  }

  const settings = normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
  const rosters = await db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
  const slots = Array.isArray(session.slotOrder) ? session.slotOrder : []
  const orderedRosterIds = slots
    .filter((slot): slot is Prisma.JsonObject => Boolean(slot && typeof slot === 'object' && !Array.isArray(slot)))
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .map((slot) => String(slot.rosterId ?? ''))
  if (rosters.length !== session.teamCount || rosters.length < settings.minTeamCount || rosters.length > settings.maxTeamCount ||
    orderedRosterIds.length !== rosters.length || new Set(orderedRosterIds).size !== rosters.length ||
    orderedRosterIds.some((id) => !rosters.some((r) => r.id === id))) {
    return { ok: false, code: 'cast_mismatch', error: 'The completed draft must cover every Survivor roster exactly once with the configured cast size.' }
  }
  if (new Set(rosters.map((r) => r.platformUserId)).size !== rosters.length) {
    return { ok: false, code: 'duplicate_owners', error: 'Each Survivor roster needs a different participating owner before setup can start.' }
  }
  const users = await db.appUser.findMany({
    where: { id: { in: rosters.map((r) => r.platformUserId) } },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  })
  const usersById = new Map(users.map((u) => [u.id, u]))
  if (rosters.some((r) => !usersById.has(r.platformUserId))) {
    return { ok: false, code: 'unclaimed_seats', error: 'Every drafted Survivor team needs an owner. Claim or transfer the remaining open teams, then retry setup.' }
  }
  if (settings.commissionerParticipationMode === 'non_participating_host' && rosters.some((r) => r.platformUserId === league.userId)) {
    return { ok: false, code: 'host_owns_team', error: 'The commissioner owns a drafted team but is configured as a non-participating host. Choose participating commissioner or transfer that team before starting Survivor.' }
  }
  const existing = await db.survivorPlayer.findMany({ where: { leagueId } })
  const ownerIds = new Set(rosters.map((r) => r.platformUserId))
  // Creation initially gives the commissioner a team. After an explicit transfer,
  // a non-playing host may still have an unused cast row; retain their account/league role.
  const unusedHost = settings.commissionerParticipationMode === 'non_participating_host'
    ? existing.find((p) => p.userId === league.userId && !ownerIds.has(p.userId) && p.playerState === 'active' &&
        !p.tribeId && p.idolIds.length === 0 && p.tokenBalance === 0 && p.totalTokensEarned === 0 &&
        p.eliminatedWeek == null && !p.isJuryMember && !p.isFinalist && !p.hasImmunityThisWeek)
    : undefined
  if (existing.some((p) => p.userId !== unusedHost?.userId && (p.playerState !== 'active' || (!ownerIds.has(p.userId) &&
    (!p.userId.startsWith(`open-slot-${leagueId}-`) || p.tribeId || p.idolIds.length > 0))))) {
    return { ok: false, code: 'existing_cast_requires_review', error: 'Existing Survivor player state does not match the drafted cast. Review the cast before retrying; gameplay has been preserved.' }
  }
  const tribes = await db.survivorTribe.findMany({ where: { leagueId }, select: { id: true, members: { select: { rosterId: true } } } })
  const tribeByRoster = new Map<string, string>()
  for (const tribe of tribes) {
    for (const member of tribe.members) {
      if (!rosters.some((r) => r.id === member.rosterId) || tribeByRoster.has(member.rosterId)) {
        return { ok: false, code: 'existing_tribes_require_review', error: 'Existing tribes contain missing or repeated rosters. Review tribe assignments before retrying setup.' }
      }
      tribeByRoster.set(member.rosterId, tribe.id)
    }
  }
  if (tribes.length > 0 && (tribes.length !== settings.tribeCount || tribeByRoster.size !== rosters.length)) {
    return { ok: false, code: 'existing_tribes_require_review', error: 'Existing tribes do not cover the configured cast. Complete the manual tribe assignments before retrying setup.' }
  }
  const legacyIdols = await db.survivorIdol.count({ where: { leagueId } })
  if (legacyIdols > 0 && !await db.survivorAuditEntry.findFirst({ where: { leagueId, action: 'idols_seeded' }, select: { id: true } })) {
    return { ok: false, code: 'legacy_inventory_requires_review', error: 'This league has an older hidden inventory. Review its setup before starting the canonical Survivor engine; existing powers have been preserved.' }
  }

  if (unusedHost) {
    const removed = await db.survivorPlayer.deleteMany({ where: {
      id: unusedHost.id, leagueId, userId: league.userId, playerState: 'active', tribeId: null,
      idolIds: { isEmpty: true }, tokenBalance: 0, totalTokensEarned: 0, eliminatedWeek: null,
      isJuryMember: false, isFinalist: false, hasImmunityThisWeek: false,
    } })
    if (removed.count !== 1) return { ok: false, code: 'existing_cast_requires_review', error: 'The host cast entry changed during setup. Review the cast before retrying; existing state has been preserved.' }
  }
  // Only unused creation placeholders may otherwise be removed. Never remove a participant.
  await db.survivorPlayer.deleteMany({
    where: { leagueId, userId: { startsWith: `open-slot-${leagueId}-`, notIn: [...ownerIds] }, playerState: 'active', tribeId: null, idolIds: { isEmpty: true } },
  })
  for (const roster of rosters) {
    const user = usersById.get(roster.platformUserId)!
    const tribeId = tribeByRoster.get(roster.id)
    await db.survivorPlayer.upsert({
      where: { leagueId_userId: { leagueId, userId: user.id } },
      create: { leagueId, userId: user.id, displayName: user.displayName || user.username || 'Manager', avatarUrl: user.avatarUrl ?? null, redraftRosterId: roster.id, tribeId: tribeId ?? null },
      update: { redraftRosterId: roster.id, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}), ...(tribeId ? { tribeId } : {}) },
    })
  }
  const rosterToUser = new Map(rosters.map((r) => [r.id, r.platformUserId]))
  return { ok: true, alreadyStarted: false, draftOrder: orderedRosterIds.map((id) => rosterToUser.get(id)!) }
}
