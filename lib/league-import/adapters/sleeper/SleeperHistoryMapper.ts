import type { IExternalHistoryMapper } from '../../mappers/ExternalHistoryMapper'
import type { NormalizedHistory } from '../../mappers/ExternalHistoryMapper'
import type { NormalizedDraftPick, NormalizedTransaction, NormalizedStandingsEntry } from '../../types'
import type { SleeperImportPayload } from './types'

export const SleeperHistoryMapper: IExternalHistoryMapper<SleeperImportPayload> = {
  map(source) {
    const draft_picks: NormalizedDraftPick[] = (source.draftPicks ?? []).map((p) => ({
      season: p.season ? Number.parseInt(p.season, 10) || null : null,
      source_draft_id: p.draft_id ?? null,
      round: p.round,
      pick_no: p.pick_no,
      source_roster_id: String(p.roster_id),
      source_player_id: p.player_id,
      player_name: p.metadata
        ? `${p.metadata.first_name ?? ''} ${p.metadata.last_name ?? ''}`.trim() || undefined
        : undefined,
      position: p.metadata?.position,
      team: p.metadata?.team,
    }))

    const transactions: NormalizedTransaction[] = (source.transactions ?? []).map((t) => ({
      source_transaction_id: t.transaction_id,
      type: t.type === 'trade' ? 'trade' : t.type === 'waiver' ? 'waiver' : 'free_agent',
      status: t.status,
      created_at: new Date(t.created).toISOString(),
      adds: t.adds,
      drops: t.drops,
      roster_ids: (t.roster_ids ?? []).map(String),
      draft_picks: t.draft_picks,
      week: t.week,
    }))

    const rosters = source.rosters ?? []
    const standings: NormalizedStandingsEntry[] = rosters
      .map((r) => ({
        source_team_id: String(r.roster_id),
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        ties: r.settings?.ties ?? 0,
        points_for: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
        points_against: undefined,
      }))
      .sort((a, b) => b.wins - a.wins || b.points_for - a.points_for)
      .map((s, i) => ({ ...s, rank: i + 1 }))

    return { draft_picks, transactions, standings }
  },
}
