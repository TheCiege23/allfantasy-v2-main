"use client"

import type { PlayoffPickView, PlayoffRoundKey, PlayoffSeriesView } from "@/lib/playoffs/types"
import { TeamLogo } from "./TeamLogo"
import type { PlayoffLogoSport } from "@/lib/playoffs/teamLogos"

type Props = {
  rounds: PlayoffRoundKey[]
  series: PlayoffSeriesView[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
  sport?: PlayoffLogoSport
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPickForSeries(picks: PlayoffPickView[], seriesId: string): PlayoffPickView | null {
  return picks.find((p) => p.seriesId === seriesId) ?? null
}

/** True when a stored name is still an unresolved placeholder */
function isPlaceholder(name: string): boolean {
  return (
    /^(EAST|WEST)\d+$/.test(name) ||
    /^Winner S\d+/.test(name) ||
    /^(East|West) (Winner|Champion)/.test(name) ||
    name === "East Champion" ||
    name === "West Champion"
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LivePip() {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
    </span>
  )
}

function TeamRow({
  teamName,
  seed,
  wins,
  selected,
  isPickCorrect,
  isPickWrong,
  isWinner,
  isLive,
  isFinal,
  locked,
  sport,
  onClick,
}: {
  teamName: string
  seed: number
  wins: number
  selected: boolean
  isPickCorrect: boolean
  isPickWrong: boolean
  isWinner: boolean
  isLive: boolean
  isFinal: boolean
  locked: boolean
  sport?: PlayoffLogoSport
  onClick: () => void
}) {
  const placeholder = isPlaceholder(teamName)
  const disabled = locked || isFinal || placeholder

  let rowCls =
    "group relative w-full rounded-lg border px-2.5 py-[7px] text-left text-xs font-semibold transition-all duration-150 "

  if (placeholder) {
    rowCls +=
      "cursor-default border-slate-700/30 bg-slate-800/30 text-slate-600"
  } else if (isPickCorrect) {
    rowCls +=
      "cursor-not-allowed border-emerald-500/70 bg-emerald-500/15 text-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.2)]"
  } else if (isPickWrong) {
    rowCls +=
      "cursor-not-allowed border-rose-500/40 bg-rose-500/10 text-rose-400 line-through opacity-70"
  } else if (selected) {
    rowCls +=
      "cursor-not-allowed border-amber-500/80 bg-amber-500/15 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.25)]"
  } else if (isWinner && !selected) {
    rowCls +=
      "cursor-not-allowed border-emerald-600/30 bg-emerald-900/15 text-slate-300"
  } else if (disabled) {
    rowCls +=
      "cursor-not-allowed border-slate-700 bg-slate-800/60 text-slate-400 opacity-60"
  } else {
    rowCls +=
      "cursor-pointer border-slate-700 bg-slate-800/60 text-slate-300 hover:border-sky-500/50 hover:bg-sky-900/20 hover:text-sky-200"
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={rowCls}>
      <span className="flex items-center gap-1.5 truncate">
        {sport && !placeholder && (
          <TeamLogo teamName={teamName} sport={sport} size={15} className="shrink-0 opacity-90" />
        )}
        {seed > 0 && !placeholder && (
          <span className="shrink-0 text-[9px] font-normal text-slate-500">#{seed}</span>
        )}
        <span className="truncate">{teamName}</span>
        {(isLive || isFinal) && wins > 0 && (
          <span
            className={`ml-auto shrink-0 font-black ${
              isWinner ? "text-emerald-400" : "text-slate-500"
            }`}
          >
            {wins}
          </span>
        )}
      </span>
    </button>
  )
}

function SeriesCard({
  item,
  pick,
  onPick,
  locked = false,
  sport,
}: {
  item: PlayoffSeriesView
  pick: PlayoffPickView | null
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
  sport?: PlayoffLogoSport
}) {
  const isFinal = item.status === "final"
  const isLive = item.status === "in_progress"
  const hasScore = item.homeWins > 0 || item.awayWins > 0

  const containerCls = [
    "rounded-xl border p-2.5 transition-all duration-200",
    isLive
      ? "border-amber-500/40 bg-amber-950/25 shadow-[0_0_14px_rgba(245,158,11,0.12)]"
      : isFinal
        ? "border-emerald-600/25 bg-emerald-950/15"
        : "border-slate-700/50 bg-slate-900/80",
  ].join(" ")

  const teams = [
    { name: item.homeTeamName, wins: item.homeWins, seed: item.homeSeed },
    { name: item.awayTeamName, wins: item.awayWins, seed: item.awaySeed },
  ]

  return (
    <div className={containerCls}>
      {/* Series header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
          S{item.seriesNumber}
        </span>
        <div className="flex items-center gap-1">
          {isLive && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-400">
              <LivePip />
              Live
            </span>
          )}
          {isFinal && item.winnerTeamName && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
              Final
            </span>
          )}
        </div>
      </div>

      {/* Series score */}
      {hasScore && (
        <div className="mb-2 text-center text-xs font-black text-slate-400">
          {item.homeWins}
          <span className="mx-1 font-normal text-slate-600">–</span>
          {item.awayWins}
        </div>
      )}

      {/* Team buttons */}
      <div className="space-y-1.5">
        {teams.map(({ name, wins, seed }) => {
          const selected = pick?.pickTeamName === name
          return (
            <TeamRow
              key={`${item.id}:${name}`}
              teamName={name}
              seed={seed}
              wins={wins}
              selected={selected}
              isPickCorrect={pick?.isCorrect === true && selected}
              isPickWrong={pick?.isCorrect === false && selected}
              isWinner={isFinal && item.winnerTeamName === name}
              isLive={isLive}
              isFinal={isFinal}
              locked={locked}
              sport={sport}
              onClick={() => onPick?.(item.id, name)}
            />
          )
        })}
      </div>

      {/* Footer */}
      {(isLive || (isFinal && item.winnerTeamName) || item.startsAt) && (
        <div className="mt-2 text-right text-[9px] text-slate-600">
          {isLive && <span className="font-semibold text-amber-500">Live now</span>}
          {isFinal && item.winnerTeamName && (
            <span className="font-semibold text-emerald-500">{item.winnerTeamName} wins</span>
          )}
          {!isLive && !isFinal && item.startsAt && (
            <span>
              {new Date(item.startsAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** A bracket column: label on top, series evenly spaced vertically */
function BracketColumn({
  label,
  series: colSeries,
  picks,
  onPick,
  locked,
  sport,
}: {
  label: string
  series: PlayoffSeriesView[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
  sport?: PlayoffLogoSport
}) {
  return (
    <div className="flex h-full flex-col">
      <p className="mb-2 text-center text-[9px] font-bold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <div className="flex flex-1 flex-col justify-around gap-2">
        {colSeries.map((item) => (
          <SeriesCard
            key={item.id}
            item={item}
            pick={getPickForSeries(picks, item.id)}
            onPick={onPick}
            locked={locked}
            sport={sport}
          />
        ))}
      </div>
    </div>
  )
}

/** Trophy + Finals card for the center column */
function TrophyColumn({
  championship,
  picks,
  onPick,
  locked,
  sport,
}: {
  championship: PlayoffSeriesView | undefined
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
  sport?: PlayoffLogoSport
}) {
  const champPick = championship ? getPickForSeries(picks, championship.id) : null
  const champWinner = championship?.winnerTeamName
  const champPickName = champPick?.pickTeamName

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      {/* Trophy glyph + champion label */}
      <div className="text-center">
        <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">
          Finals
        </p>
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-amber-500/20 to-amber-700/10 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
          <span className="text-4xl leading-none select-none" aria-label="Championship trophy">
            🏆
          </span>
        </div>
        {champWinner ? (
          <p className="mt-2 text-xs font-black text-amber-400">{champWinner}</p>
        ) : champPickName && !isPlaceholder(champPickName) ? (
          <p className="mt-2 text-xs font-semibold text-slate-400">{champPickName}</p>
        ) : (
          <p className="mt-2 text-[9px] text-slate-700">TBD</p>
        )}
      </div>

      {/* Championship series card */}
      {championship && (
        <div className="w-full">
          <SeriesCard
            item={championship}
            pick={champPick}
            onPick={onPick}
            locked={locked}
            sport={sport}
          />
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PlayoffBracketBoard({
  rounds: _rounds,
  series,
  picks,
  onPick,
  locked = false,
  sport,
}: Props) {
  // Split series into columns by conference + round
  const byConf = (conf: string, round: PlayoffRoundKey) =>
    series
      .filter((s) => s.conference === conf && s.round === round)
      .sort((a, b) => a.seriesNumber - b.seriesNumber)

  const eastR1 = byConf("east", "round_1")
  const eastSemis = byConf("east", "conference_semifinals")
  const eastFinals = byConf("east", "conference_finals")
  const championship = series.find((s) => s.round === "finals")
  const westFinals = byConf("west", "conference_finals")
  const westSemis = byConf("west", "conference_semifinals")
  const westR1 = byConf("west", "round_1")

  return (
    <div className="relative overflow-x-auto rounded-3xl border border-slate-700/40 bg-[#0d1117] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_80%_40%_at_50%_0%,rgba(99,102,241,0.07),transparent),radial-gradient(ellipse_60%_30%_at_10%_90%,rgba(245,158,11,0.05),transparent)]" />

      {/* ── DESKTOP: 7-column symmetric bracket ── */}
      <div className="relative hidden min-h-[700px] lg:grid lg:grid-cols-[1fr_1fr_1fr_160px_1fr_1fr_1fr] lg:gap-3">
        {/* East side: R1 → Semis → Finals (left to right = earlier to later) */}
        <BracketColumn
          label="East · Round 1"
          series={eastR1}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />
        <BracketColumn
          label="East · Semis"
          series={eastSemis}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />
        <BracketColumn
          label="East · Finals"
          series={eastFinals}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />

        {/* Center column: trophy + championship */}
        <TrophyColumn
          championship={championship}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />

        {/* West side: Finals → Semis → R1 (left to right = later to earlier) */}
        <BracketColumn
          label="West · Finals"
          series={westFinals}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />
        <BracketColumn
          label="West · Semis"
          series={westSemis}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />
        <BracketColumn
          label="West · Round 1"
          series={westR1}
          picks={picks}
          onPick={onPick}
          locked={locked}
          sport={sport}
        />
      </div>

      {/* ── MOBILE: stacked by conference ── */}
      <div className="relative flex flex-col gap-6 lg:hidden">
        {/* East */}
        <section>
          <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            East Conference
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "Round 1", items: eastR1 },
              { label: "Semis", items: eastSemis },
              { label: "Finals", items: eastFinals },
            ].map(({ label, items }) =>
              items.length > 0 ? (
                <div key={label}>
                  <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                    {label}
                  </p>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <SeriesCard
                        key={item.id}
                        item={item}
                        pick={getPickForSeries(picks, item.id)}
                        onPick={onPick}
                        locked={locked}
                        sport={sport}
                      />
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </section>

        {/* Finals */}
        {championship && (
          <section>
            <h3 className="mb-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
              🏆 Finals
            </h3>
            <div className="mx-auto max-w-[280px]">
              <SeriesCard
                item={championship}
                pick={getPickForSeries(picks, championship.id)}
                onPick={onPick}
                locked={locked}
                sport={sport}
              />
            </div>
          </section>
        )}

        {/* West */}
        <section>
          <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            West Conference
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: "Round 1", items: westR1 },
              { label: "Semis", items: westSemis },
              { label: "Finals", items: westFinals },
            ].map(({ label, items }) =>
              items.length > 0 ? (
                <div key={label}>
                  <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                    {label}
                  </p>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <SeriesCard
                        key={item.id}
                        item={item}
                        pick={getPickForSeries(picks, item.id)}
                        onPick={onPick}
                        locked={locked}
                        sport={sport}
                      />
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
