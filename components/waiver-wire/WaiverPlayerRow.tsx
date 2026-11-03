"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Plus, TrendingUp, Loader2 } from "lucide-react"
import { PlayerHeadshot } from "@/components/league/PlayerHeadshot"
import { teamLogoUrl } from "@/lib/media-url"
import { positionColor } from "@/lib/draft/positions"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

type Props = {
  player: {
    id: string
    name: string
    position: string | null
    team: string | null
    headshotUrl?: string | null
    teamLogoUrl?: string | null
    injuryStatus?: string | null
    experienceSummary?: string | null
    projectedPoints?: number | null
    adp?: number | null
    aiAdp?: number | null
    byeWeek?: number | null
    rank?: number | null
    /** NBA / NHL / MLB: "C12". Shown in place of the overall rank, which those sports do not have. */
    positionRank?: string | null
    ownershipPercent?: number | null
    projectionSourceLabel?: string | null
    adpSourceLabel?: string | null
    statsSourceLabel?: string | null
    dataQualityLabels?: string[]
    seasonStatsSummary?: string[]
  }
  sport?: string | null
  /** NHL dynasty: a Fantrax-only prospect — "Prospect" badge, "Unsigned" when he has no club. */
  prospect?: boolean
  onAddClick: () => void
  /** When set, the primary CTA performs an immediate free-agent add/drop instead of opening a claim. */
  addMode?: boolean
  onAdd?: () => void
  /** Action-scoped loading for this row's add/claim button only. */
  actionLoading?: boolean
  onRowClick?: () => void
  onToggleWatchlist?: () => void
  watchlisted?: boolean
  alreadyClaimed?: boolean
  trendScore?: number
  /** "On waivers until …" for a recently dropped player (lib/waiver-wire/dropped-player-waivers.ts). */
  waiverHoldLabel?: string | null
  /** The season phase closes every move (offseason / playoff rules); the button is disabled. */
  movesClosedReason?: string | null
}

function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return "-"
  return Number(value).toFixed(digits).replace(/\.0$/, "")
}

function TeamLogoBadge({ logo, team, sport }: { logo: string; team: string; sport?: string | null }) {
  const [failed, setFailed] = useState(false)
  const useLogo = logo && !failed && !logo.includes("default-avatar")
  if (useLogo) {
    return (
      // Provider logos are already size-constrained here; next/image cannot safely optimize every external source.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={`${team} logo`}
        data-testid={`waiver-player-team-logo-${team}`}
        width={28}
        height={28}
        className="h-7 w-7 shrink-0 rounded-md object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  const label = team && team !== "FA" ? team.slice(0, 3).toUpperCase() : String(sport ?? "AF").slice(0, 3).toUpperCase()
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line2)] bg-[var(--surface2)] text-[11px] font-black text-[var(--muted)]"
      data-testid={`waiver-player-team-logo-fallback-${team || "FA"}`}
      title={team && team !== "FA" ? `${team} badge` : "Team logo unavailable"}
    >
      {label}
    </div>
  )
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-2 py-1" data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-xs font-semibold text-[var(--muted)]">{value}</div>
    </div>
  )
}

function SourcePill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warn" | "good" }) {
  const cls =
    tone === "warn"
      ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
      : tone === "good"
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
        : "border-[var(--line2)] bg-[var(--surface2)] text-[var(--muted)]"
  return <span className={`rounded-full border px-1.5 py-0.5 text-[11px] ${cls}`}>{label}</span>
}

export default function WaiverPlayerRow({
  player,
  sport,
  prospect,
  onAddClick,
  addMode,
  onAdd,
  actionLoading,
  onRowClick,
  onToggleWatchlist,
  watchlisted,
  alreadyClaimed,
  trendScore,
  waiverHoldLabel,
  movesClosedReason,
}: Props) {
  const { t } = useOptionalLanguage()
  const pos = player.position || "UNK"
  const team = player.team || "FA"
  // A prospect Fantrax lists with no NHL club is "Unsigned", never "FA" (every row here is a free agent).
  const teamLabel = prospect && !player.team ? t("draftRoom.pool.prospectUnsigned") : team
  const normalizedSport = String(sport ?? "NFL").toUpperCase()
  const trend = typeof trendScore === "number" ? trendScore : 0
  const logo = player.teamLogoUrl || (player.team ? teamLogoUrl(player.team, sport ?? "NFL") : "")
  const posColor = positionColor(pos, normalizedSport)
  const detailsHref = `/player-comparison?player=${encodeURIComponent(player.name)}&sport=${encodeURIComponent(normalizedSport)}`
  const sourceLabels = useMemo(() => {
    const labels = [
      player.adpSourceLabel,
      player.projectionSourceLabel,
      player.statsSourceLabel,
      ...(player.dataQualityLabels ?? []),
    ]
      .filter((label): label is string => Boolean(label && label.trim()))
      .slice(0, 6)
    return [...new Set(labels)]
  }, [player.adpSourceLabel, player.dataQualityLabels, player.projectionSourceLabel, player.statsSourceLabel])
  const limitedData = sourceLabels.some((label) => /missing|fallback|limited|coming soon/i.test(label))

  return (
    <li
      className="group grid gap-3 rounded-xl border border-[var(--line2)] bg-[var(--surface)] px-3 py-3 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.18)] transition hover:border-[var(--line2)] hover:bg-[var(--surface2)] sm:grid-cols-[minmax(0,1fr)_auto] sm:px-4"
      data-testid={`waiver-player-row-${player.id}`}
      onClick={onRowClick}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="relative shrink-0">
          <PlayerHeadshot
            playerId={player.id}
            playerName={player.name}
            headshotUrl={player.headshotUrl}
            position={pos}
            team={team}
            sport={normalizedSport}
            size={44}
            useResolver={normalizedSport === "NFL"}
            className="ring-1 ring-white/10"
          />
          <span
            className="absolute -bottom-1 -right-1 rounded-full border border-black/70 px-1.5 py-0.5 text-[11px] font-black text-[var(--bg)]"
            style={{ backgroundColor: posColor }}
            data-testid={`waiver-player-position-chip-${player.id}`}
          >
            {pos}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--text)]">{player.name}</span>
            <TeamLogoBadge logo={logo} team={team} sport={normalizedSport} />
            <span
              className="rounded-full border border-[var(--line2)] bg-[var(--surface2)] px-2 py-0.5 text-[11px] text-[var(--muted)]"
              data-testid={prospect && !player.team ? `waiver-player-prospect-unsigned-${player.id}` : undefined}
            >
              {teamLabel}
            </span>
            {prospect ? (
              <span
                className="rounded border border-sky-300/35 bg-sky-500/12 px-1 py-px text-[11px] font-semibold uppercase tracking-[0.06em] text-sky-100"
                title={t("draftRoom.pool.prospectTooltip")}
                data-testid={`waiver-player-prospect-badge-${player.id}`}
              >
                {t("draftRoom.pool.prospectBadge")}
              </span>
            ) : null}
            {player.injuryStatus ? (
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-100">
                {player.injuryStatus}
              </span>
            ) : null}
            {waiverHoldLabel ? (
              <span data-testid={`waiver-player-hold-${player.id}`}>
                <SourcePill label={waiverHoldLabel} tone="warn" />
              </span>
            ) : null}
            {watchlisted ? <SourcePill label="Watchlist" tone="good" /> : null}
            {limitedData ? <SourcePill label={normalizedSport === "NCAAF" ? "NCAAF limited data" : "Limited data"} tone="warn" /> : null}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            <Metric label="Proj" value={formatDecimal(player.projectedPoints)} testId={`waiver-player-projection-${player.id}`} />
            <Metric label="ADP" value={formatDecimal(player.adp)} testId={`waiver-player-adp-${player.id}`} />
            <Metric label="AF ADP" value={player.aiAdp != null ? formatDecimal(player.aiAdp) : "Soon"} />
            <Metric label="Bye" value={player.byeWeek != null ? String(player.byeWeek) : "-"} />
            {player.positionRank ? (
              <Metric label="Pos rank" value={player.positionRank} testId={`waiver-player-position-rank-${player.id}`} />
            ) : (
              <Metric label="Rank" value={player.rank != null ? `#${Math.round(player.rank)}` : "-"} />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
            {player.experienceSummary ? <SourcePill label={player.experienceSummary} /> : null}
            {(player.seasonStatsSummary ?? []).map((stat) => (
              <SourcePill key={stat} label={stat} />
            ))}
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-300" />
              <span>Trend: {trend > 0 ? `+${trend}` : "neutral"}</span>
            </span>
            {player.ownershipPercent != null ? <SourcePill label={`Rostered ${formatDecimal(player.ownershipPercent, 0)}%`} /> : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {sourceLabels.map((label) => (
              <SourcePill
                key={label}
                label={label}
                tone={/missing|fallback|limited|coming soon/i.test(label) ? "warn" : "neutral"}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5 sm:flex-col sm:items-stretch">
        <Link
          href={detailsHref}
          onClick={(e) => e.stopPropagation()}
          data-testid={`waiver-player-detail-link-${player.id}`}
          className="rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-2.5 py-1.5 text-center text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          Compare
        </Link>
        {onToggleWatchlist && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleWatchlist()
            }}
            data-testid={`waiver-watchlist-toggle-${player.id}`}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
              watchlisted
                ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                : "border-[var(--line2)] bg-[var(--surface2)] text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {watchlisted ? "Watching" : "Watch"}
          </button>
        )}
        {alreadyClaimed ? (
          <span className="inline-flex items-center justify-center rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200">
            Pending
          </span>
        ) : addMode ? (
          <button
            type="button"
            disabled={actionLoading || Boolean(movesClosedReason)}
            title={movesClosedReason ?? undefined}
            onClick={(e) => {
              e.stopPropagation()
              ;(onAdd ?? onAddClick)()
            }}
            data-testid={`waiver-add-${player.id}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add
          </button>
        ) : (
          <button
            type="button"
            disabled={actionLoading || Boolean(movesClosedReason)}
            title={movesClosedReason ?? undefined}
            onClick={(e) => {
              e.stopPropagation()
              onAddClick()
            }}
            data-testid={`waiver-claim-open-${player.id}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line2)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Claim
          </button>
        )}
      </div>
    </li>
  )
}
