'use client'

import { PlayerImage } from '@/app/components/PlayerImage'
import type { PlayerMap } from '@/lib/hooks/useSleeperPlayers'
import { ProjectionDisplay } from '@/components/weather/ProjectionDisplay'

const PILL_STYLES: Record<string, string> = {
  SOLO: 'border-[color:var(--idp-tackle)]/50 bg-[color:var(--idp-tackle)]/15 text-amber-100',
  AST: 'border-white/20 bg-white/10 text-white/75',
  SACK: 'border-[color:var(--idp-sack)]/50 bg-[color:var(--idp-sack)]/15 text-red-100',
  INT: 'border-[color:var(--idp-int)]/50 bg-[color:var(--idp-int)]/15 text-emerald-100',
  PD: 'border-violet-400/40 bg-violet-500/15 text-violet-100',
  FF: 'border-orange-400/40 bg-orange-500/15 text-orange-100',
  FR: 'border-amber-800/50 bg-amber-900/30 text-amber-100',
  TD: 'border-[color:var(--idp-td)]/60 bg-[color:var(--idp-td)]/20 text-[color:var(--idp-td)]',
}

export type IdpContractChip =
  | 'ACTIVE'
  | 'EXPIRING'
  | 'TAGGED'
  | 'DEAD_CAP'

/** A defender's box-score line. Every field optional: absent means unknown, never zero. */
export type IdpStatLine = {
  soloTackles?: number | null
  assistedTackles?: number | null
  sacks?: number | null
  interceptions?: number | null
  passDeflections?: number | null
  forcedFumbles?: number | null
  fumbleRecoveries?: number | null
  defensiveTDs?: number | null
}

export type IDPPlayerCardProps = {
  playerId: string
  name: string
  position: string
  team?: string | null
  sport: string
  players: PlayerMap
  week: number
  isStarter: boolean
  onOpen: () => void
  onToggleStart?: () => void
  /** Mobile: cap visible pills */
  maxPills?: number
  salaryM?: number
  yearsRemaining?: number
  contractChip?: IdpContractChip
  /*
   * ⚠ EVERYTHING BELOW WAS INVENTED INSIDE THIS COMPONENT UNTIL NOW, AND RENDERED BESIDE THE
   * PLAYER'S REAL NAME. Points and projection came from `mockIdpPoints`, a hash of the player
   * id. Every stat pill came from `mockStatPills`, another hash. The role label came from
   * `idpRoleLabel`, which summed the id's character codes and picked one of four archetypes.
   * Snap share was `40 + (playerId.charCodeAt(0) % 55)`.
   *
   * Worst of all, injury status was `playerId.endsWith('0') ? 'OUT' : endsWith('1') ? 'QUEST'`
   * — a red OUT badge, on a tenth of all defenders, decided by the last digit of an id. That is
   * not a cosmetic bug: a manager who benches a healthy starter on it loses a real week.
   *
   * They are props now. A parent that has the data passes it; a parent that does not passes
   * nothing and the card shows an absence, which is the true answer.
   */
  points?: number | null
  projection?: number | null
  statLine?: IdpStatLine | null
  /** 0–100. */
  snapSharePct?: number | null
  /** As the provider states it — 'OUT', 'QUESTIONABLE', … Never derived from the id. */
  injuryStatus?: string | null
  onBye?: boolean
}

export function IDPPlayerCard({
  playerId,
  name,
  position,
  team,
  sport,
  players,
  week,
  isStarter,
  onOpen,
  onToggleStart,
  maxPills = 8,
  salaryM,
  yearsRemaining,
  contractChip = 'ACTIVE',
  points = null,
  projection = null,
  statLine = null,
  snapSharePct = null,
  injuryStatus = null,
  onBye = false,
}: IDPPlayerCardProps) {
  /*
   * A pill renders only for a stat we actually hold. A defender who genuinely recorded nothing
   * shows no pills, which is the same thing the box score says — and an unknown line shows no
   * pills either, which is why the absence is never dressed up as a row of zeros.
   */
  const candidates: Array<{ label: string; val: number | null | undefined }> = [
    { label: 'SOLO', val: statLine?.soloTackles },
    { label: 'AST', val: statLine?.assistedTackles },
    { label: 'SACK', val: statLine?.sacks },
    { label: 'INT', val: statLine?.interceptions },
    { label: 'PD', val: statLine?.passDeflections },
    { label: 'FF', val: statLine?.forcedFumbles },
    { label: 'FR', val: statLine?.fumbleRecoveries },
    { label: 'TD', val: statLine?.defensiveTDs },
  ]
  const pills = candidates.filter(
    (p): p is { label: string; val: number } => typeof p.val === 'number' && p.val > 0,
  )

  const pillPoints = (p: { label: string; val: number }) => {
    const weights: Record<string, number> = { SOLO: 1.2, SACK: 3, INT: 4, FF: 2, FR: 2, TD: 6 }
    return (weights[p.label] ?? 0.5) * p.val
  }
  const displayPills = [...pills].sort((a, b) => pillPoints(b) - pillPoints(a)).slice(0, maxPills)

  // A low-snap warning needs a snap count. Without one there is nothing to warn about.
  const lowSnap = snapSharePct != null && snapSharePct < 50

  const p = players[playerId]

  const chipStyles: Record<IdpContractChip, string> = {
    ACTIVE: 'border-[color:var(--cap-contract)]/45 bg-[color:var(--cap-contract)]/15 text-blue-100',
    EXPIRING: 'border-[color:var(--cap-amber)]/45 bg-[color:var(--cap-amber)]/12 text-amber-100',
    TAGGED: 'border-amber-400/50 bg-amber-500/15 text-amber-50',
    DEAD_CAP: 'border-[color:var(--cap-dead)]/40 bg-white/[0.04] text-white/45',
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="relative rounded-lg border border-[color:var(--idp-border)] bg-[color:var(--idp-panel)] p-2 shadow-sm transition hover:border-red-500/25"
      data-testid={`idp-card-${playerId}`}
    >
      <span className="absolute right-2 top-2 rounded border border-[color:var(--idp-defense)]/45 bg-[color:var(--idp-defense)]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-100">
        IDP
      </span>
      <div className="flex gap-2 pr-12">
        <div className="relative shrink-0">
          <PlayerImage
            sleeperId={playerId}
            sport={sport}
            name={name}
            position={position}
            espnId={p?.espn_id}
            nbaId={p?.nba_id}
            size={36}
            variant="round"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-white" title={name}>
            {name.length > 16 ? `${name.slice(0, 16)}…` : name}
          </p>
          <p className="text-[10px] text-white/45">
            {team ?? '—'} · {position}
          </p>
          {/*
            The line that used to hold an archetype ("Run Stopper", "Edge Rusher") derived from
            the character codes of the player id. A real archetype needs per-snap role splits,
            which no provider we ingest carries — so this shows the snap share, which we do hold,
            and nothing at all when we do not.
          */}
          {snapSharePct != null ? (
            <p className="text-[9px] text-white/35">{Math.round(snapSharePct)}% of snaps</p>
          ) : null}
          <div className="mt-1 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            {displayPills.map((pill) => (
              <span
                key={pill.label}
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
                  PILL_STYLES[pill.label] ?? 'border-white/15 bg-white/10 text-white/70'
                }`}
              >
                {pill.label === 'TD' ? '🟡' : null}
                {pill.val} {pill.label}
              </span>
            ))}
          </div>
          {salaryM != null && yearsRemaining != null ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-white/55">
                💰 ${salaryM.toFixed(1)}M · {yearsRemaining}yr
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${chipStyles[contractChip]}`}
              >
                {contractChip === 'TAGGED'
                  ? 'TAGGED'
                  : contractChip === 'DEAD_CAP'
                    ? 'DEAD CAP'
                    : contractChip === 'EXPIRING'
                      ? 'EXPIRING'
                      : 'ACTIVE'}
              </span>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-[color:var(--idp-defense)]">
            {points != null ? points.toFixed(1) : <span className="text-white/25">—</span>}
          </p>
          <div className="text-[10px] text-white/35 inline-flex justify-end">
            <span className="mr-0.5">proj</span>
            <ProjectionDisplay
              projection={projection ?? undefined}
              suffix=""
              pointsClassName="text-[10px] text-white/35"
              afCrestProps={{
                playerId,
                playerName: name,
                sport,
                position,
                week,
                season: new Date().getFullYear(),
              }}
            />
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {injuryStatus ? (
          <span className="rounded bg-red-950/50 px-1.5 py-0.5 text-[9px] text-red-200">
            🔴 {injuryStatus}
          </span>
        ) : null}
        {onBye ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/50">⚫ BYE</span> : null}
        {lowSnap ? (
          <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[9px] text-amber-200">⚠ LOW SNAP</span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
            isStarter
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100'
              : 'border-white/15 bg-white/5 text-white/60'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleStart?.()
          }}
        >
          {isStarter ? 'Start' : 'Sit'}
        </button>
      </div>
    </div>
  )
}
