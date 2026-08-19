import type { IExternalRosterMapper } from '../../mappers/ExternalRosterMapper'
import type { NormalizedRoster } from '../../types'
import type { SleeperImportPayload } from './types'

export const SleeperRosterMapper: IExternalRosterMapper<SleeperImportPayload> = {
  map(source) {
    const rosters = source.rosters ?? []
    const users = source.users ?? []
    const commissionerId = source.league?.commissioner_id ?? null
    const coCommissionerIds = new Set(
      Array.isArray(source.league?.metadata?.co_commissioners)
        ? source.league.metadata.co_commissioners.filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : [],
    )
    // Tier 0 (Finding #9) — the league-level FAAB budget IS available in the same
    // payload the mapper receives, so compute `faab_remaining = budget - used`
    // instead of dropping the field.
    const leagueSettingsForMapper = (source.league?.settings ?? {}) as Record<string, unknown>
    const leagueWaiverBudgetRaw = leagueSettingsForMapper.waiver_budget
    const leagueWaiverBudget =
      typeof leagueWaiverBudgetRaw === 'number' && Number.isFinite(leagueWaiverBudgetRaw)
        ? leagueWaiverBudgetRaw
        : typeof leagueWaiverBudgetRaw === 'string'
          ? Number.parseInt(leagueWaiverBudgetRaw, 10)
          : null
    return rosters.map((roster) => {
      const ownerId = typeof roster.owner_id === 'string' ? roster.owner_id.trim() : ''
      const user = users.find((u) => u.user_id === ownerId)
      const displayName = user?.display_name || user?.username || 'Unknown'
      const platformTeamName = user?.metadata?.team_name?.trim() || ''
      const avatarUrl = user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null
      const fpts = (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100
      const settings = (roster.settings ?? {}) as Record<string, unknown>
      const waiverBudgetUsedRaw = settings.waiver_budget_used
      const waiverPositionRaw = settings.waiver_position
      const waiverBudgetUsed =
        typeof waiverBudgetUsedRaw === 'number' && Number.isFinite(waiverBudgetUsedRaw)
          ? waiverBudgetUsedRaw
          : typeof waiverBudgetUsedRaw === 'string'
            ? Number.parseInt(waiverBudgetUsedRaw, 10)
            : null
      const waiverPosition =
        typeof waiverPositionRaw === 'number'
          ? waiverPositionRaw
          : typeof waiverPositionRaw === 'string'
            ? Number.parseInt(waiverPositionRaw, 10)
            : null
      const isOwnerFlag = user?.is_owner === true
      const isMetaCommissioner = String(user?.metadata?.is_commissioner ?? '').toLowerCase() === 'true'
      const isMetaCoOwner = String(user?.metadata?.co_owner ?? '').toLowerCase() === 'true'
      const isCommissioner =
        Boolean(ownerId) &&
        (ownerId === commissionerId || isOwnerFlag || isMetaCommissioner)
      const isCoCommissioner =
        Boolean(ownerId) && !isCommissioner && (coCommissionerIds.has(ownerId) || isMetaCoOwner)
      const isOrphan = !ownerId
      return {
        source_team_id: String(roster.roster_id),
        source_manager_id: ownerId,
        owner_name: displayName,
        team_name: platformTeamName || displayName,
        avatar_url: avatarUrl,
        is_commissioner: isCommissioner,
        is_co_commissioner: isCoCommissioner,
        is_orphan: isOrphan,
        wins: roster.settings?.wins ?? 0,
        losses: roster.settings?.losses ?? 0,
        ties: roster.settings?.ties ?? 0,
        points_for: fpts,
        points_against: undefined,
        player_ids: roster.players ?? [],
        starter_ids: roster.starters?.filter((s) => s && s !== '0') ?? [],
        reserve_ids: roster.reserve,
        taxi_ids: roster.taxi,
        // Tier 0 (Finding #9) — `faab_remaining = league.settings.waiver_budget -
        // roster.settings.waiver_budget_used`. Falls back to null when either half
        // of the subtraction is unavailable (older leagues, incomplete payloads).
        faab_remaining:
          leagueWaiverBudget != null && waiverBudgetUsed != null
            ? Math.max(0, leagueWaiverBudget - waiverBudgetUsed)
            : null,
        waiver_priority:
          waiverPosition != null && Number.isFinite(waiverPosition) ? waiverPosition : null,
      } satisfies NormalizedRoster
    })
  },
}
