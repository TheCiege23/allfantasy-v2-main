'use client'

/**
 * Universal League Hub — canonical dashboard card (Part 3).
 *
 * One card, driven entirely by `LeagueHubEntry` — no per-provider branch.
 * Audit finding (this phase): the existing Dashboard cards
 * (`app/dashboard/components/LeagueHubCard.tsx`, `.../warroom/MyLeagueCard.tsx`)
 * were already provider-agnostic (keyed off a shared `UserLeague` type, not
 * duplicated per provider) — there was no actual per-provider duplication to
 * "replace." This component is the new canonical reference implementation,
 * intended to be swapped in for those once the League Hub is the home
 * screen; see `UNIVERSAL_LEAGUE_HUB_ARCHITECTURE.md` for why that swap is
 * deliberately not done in this same phase (identical reasoning to the
 * Rankings-rewrite deferral earlier in this program: a shallow swap into an
 * already-live, heavily-used surface is a real regression risk that
 * deserves its own scoped phase, not a forced fit here).
 */
import type { LeagueHubEntry, ProviderCapabilityBadge, SyncFreshnessState } from '@/lib/shared-services/league-hub/types'

// Commissioner Import Attestation UI phase — Part 7 required distinctions.
// `user_attested` reads "Commissioner Authority User-Attested," never
// "Commissioner Verified" — those are two different, non-interchangeable
// claims (see PROVIDER_CAPABILITY_MATRIX.md). This label set is driven
// entirely by `deriveProviderCapabilities`, which reads the real recorded
// `League.settings.commissionerVerification`/`commissionerAttestation`
// method — never guessed from the provider name alone.
const CAPABILITY_LABEL: Record<ProviderCapabilityBadge, string> = {
  // Deliberately not "Native AllFantasy Commissioner" here — this badge is
  // shown to every member of a native league, not just its commissioner.
  // The separate, real `isCommissioner`-gated pill (rendered below) is what
  // actually claims commissioner status; this badge only describes the
  // league's origin/import type.
  native: 'Native AllFantasy League',
  live_sync: 'Live Sync',
  read_only: 'Read-Only Synchronization',
  csv_snapshot: 'CSV Snapshot',
  manual_refresh: 'Manual Refresh',
  commissioner_verified: 'Provider-Verified Commissioner',
  membership_verified: 'Membership Verified',
  user_attested: 'Commissioner Authority User-Attested',
}

const SYNC_LABEL: Record<SyncFreshnessState, string> = {
  not_applicable: 'Native league',
  fresh: 'Synced recently',
  stale: 'Sync is stale',
  syncing: 'Syncing…',
  failed: 'Last sync failed',
  never_synced: 'Never synced',
}

const SYNC_DOT_CLASS: Record<SyncFreshnessState, string> = {
  not_applicable: 'bg-white/30',
  fresh: 'bg-emerald-400',
  stale: 'bg-amber-400',
  syncing: 'bg-sky-400 animate-pulse',
  failed: 'bg-red-400',
  never_synced: 'bg-white/30',
}

const PLATFORM_LABEL: Record<string, string> = {
  allfantasy: 'AllFantasy',
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MFL',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

function platformLabel(provider: string): string {
  return PLATFORM_LABEL[provider] ?? provider.replace(/_/g, ' ').slice(0, 16)
}

function formatRecord(entry: LeagueHubEntry): string | null {
  const record = entry.userTeam.record
  if (!record) return null
  const base = `${record.wins}-${record.losses}`
  return record.ties > 0 ? `${base}-${record.ties}` : base
}

export interface UniversalLeagueCardProps {
  entry: LeagueHubEntry
  isActive: boolean
  onSelect: (entry: LeagueHubEntry) => void
}

export function UniversalLeagueCard({ entry, isActive, onSelect }: UniversalLeagueCardProps) {
  const record = formatRecord(entry)
  const pendingCount = entry.recommendations.totalCount

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      aria-pressed={isActive}
      className={`w-full min-w-0 text-left rounded-xl border p-4 transition-colors ${
        isActive
          ? 'border-amber-400/60 bg-amber-400/10'
          : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{entry.leagueName}</p>
          <p className="mt-0.5 text-xs text-white/50">
            {platformLabel(entry.provider)} · {entry.sport}
            {entry.season != null ? ` · ${entry.season}` : ''}
          </p>
        </div>
        {entry.commissionerStatus.isCommissioner ? (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            Commissioner
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/70">
        {entry.userTeam.name ? <span className="truncate">{entry.userTeam.name}</span> : null}
        {record ? <span className="tabular-nums">{record}</span> : null}
        {entry.userTeam.standingsPosition != null ? (
          <span className="tabular-nums">#{entry.userTeam.standingsPosition}</span>
        ) : null}
        {entry.playoffProbability != null ? (
          <span className="tabular-nums">{Math.round(entry.playoffProbability * 100)}% playoffs</span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {entry.capabilities.map((badge) => (
          <span
            key={badge}
            className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60"
          >
            {CAPABILITY_LABEL[badge]}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-white/50">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${SYNC_DOT_CLASS[entry.syncFreshness.state]}`} />
          {SYNC_LABEL[entry.syncFreshness.state]}
        </span>
        {pendingCount > 0 ? (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-300">
            {pendingCount} pending
          </span>
        ) : null}
      </div>
    </button>
  )
}
