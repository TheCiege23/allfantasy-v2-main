"use client"

import { Fragment } from "react"
import Image from "next/image"
import type { PlayoffPickView, PlayoffRoundKey, PlayoffSport, PlayoffSeriesView } from "@/lib/playoffs/types"

export type PlayoffBracketBoardSeries = PlayoffSeriesView & {
  displayHomeTeamName?: string
  displayAwayTeamName?: string
  homeSelectable?: boolean
  awaySelectable?: boolean
}

type Props = {
  rounds: PlayoffRoundKey[]
  series: PlayoffBracketBoardSeries[]
  picks: PlayoffPickView[]
  sport?: PlayoffSport | string | null
  onPick?: (seriesId: string, teamName: string) => void
  locked?: boolean
  /** When true for a series, both sides disable (in-flight optimistic save only for that matchup). */
  isSeriesSaving?: (seriesId: string) => boolean
}

const ROUND_LABELS: Record<PlayoffRoundKey, string> = {
  round_1: "Round 1",
  conference_semifinals: "Conference Semis",
  conference_finals: "Conference Finals",
  finals: "Finals",
}

/** NBA bracket column copy (First Round → Conference Finals). */
const NBA_ROUND_LABELS: Record<Exclude<PlayoffRoundKey, "finals">, string> = {
  round_1: "First Round",
  conference_semifinals: "Conference Semifinals",
  conference_finals: "Conference Finals",
}

const EAST_WEST_ROUND_FLOW: PlayoffRoundKey[] = ["round_1", "conference_semifinals", "conference_finals"]

/** Paths under `public/` — required brand assets for NBA center stack. */
const NBA_BRAND_WORDMARK_SRC = "/images/brand/allfantasy-wordmark.png"
const NBA_ROBOT_KING_SRC = "/images/mascots/af-robot-king-trophy.png"

function getPickForSeries(picks: PlayoffPickView[], seriesId: string): PlayoffPickView | null {
  return picks.find((pick) => pick.seriesId === seriesId) ?? null
}

function seriesFooterBadge(item: PlayoffBracketBoardSeries, sportKey: string): string {
  if (item.conference === "finals") {
    return sportKey === "nba" ? "NBA Finals" : "Cup Finals"
  }
  return `${item.conference === "east" ? "East" : "West"} · ${item.conference.toUpperCase()}`
}

function formatNbaChampionLine(label: string): string {
  const p = parseSeedSuffixLabel(label)
  if (p) return `${p.seedNum} ${p.team}`
  return label
}

/** Canonical pick id remains e.g. `Thunder (W1)`; UI shows `1 Thunder`. */
function parseSeedSuffixLabel(label: string): { seedNum: number; team: string } | null {
  const m = label.trim().match(/^(.+?)\s+\(([EW])(\d+)\)$/)
  if (!m) return null
  return { seedNum: Number(m[3]), team: m[1].trim() }
}

function formatNbaPickDisplay(label: string, slot: "home" | "away", item: PlayoffBracketBoardSeries): string {
  const parsed = parseSeedSuffixLabel(label)
  if (parsed) return `${parsed.seedNum} ${parsed.team}`
  const seed = slot === "home" ? item.homeSeed : item.awaySeed
  if (typeof seed === "number" && seed > 0) return `${seed} ${label}`
  return label
}

function nbaSeriesRecordDisplay(item: PlayoffBracketBoardSeries): string {
  const hw = item.homeGamesWon
  const aw = item.awayGamesWon
  if (typeof hw === "number" && typeof aw === "number" && Number.isFinite(hw) && Number.isFinite(aw)) {
    return `${hw}-${aw}`
  }
  return "0-0"
}

function nbaNextGamePlaceholder(item: PlayoffBracketBoardSeries): string {
  if (item.status === "final" || Boolean(item.winnerTeamName)) return ""
  return "Next: TBD"
}

function nbaLiveStatusPlaceholder(item: PlayoffBracketBoardSeries): string {
  if (item.status === "final" || Boolean(item.winnerTeamName)) return ""
  if (item.status === "scheduled") return "Not started"
  return "—"
}

function SeriesMatchupCard(props: {
  item: PlayoffBracketBoardSeries
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked: boolean
  sportKey: string
  isSavingSeries?: boolean
}) {
  const { item, picks, onPick, locked, sportKey, isSavingSeries } = props
  const pick = getPickForSeries(picks, item.id)
  const homeLabel = item.displayHomeTeamName ?? item.homeTeamName
  const awayLabel = item.displayAwayTeamName ?? item.awayTeamName
  const homeSelectable = item.homeSelectable ?? true
  const awaySelectable = item.awaySelectable ?? true
  const slots: Array<{ key: string; label: string; selectable: boolean }> = [
    { key: `${item.id}:home`, label: homeLabel, selectable: homeSelectable },
    { key: `${item.id}:away`, label: awayLabel, selectable: awaySelectable },
  ]

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>S{item.seriesNumber}</span>
        <span>{item.bestOf === 7 ? "Best of 7" : `Best of ${item.bestOf}`}</span>
      </div>
      <div className="space-y-2">
        {slots.map(({ key, label, selectable }) => {
          const disabled = locked || !selectable || isSavingSeries
          const selected = pick?.pickTeamName === label
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onPick?.(item.id, label)}
              aria-disabled={disabled}
              aria-label={label}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                selected
                  ? "border-amber-500 bg-amber-100 text-amber-900"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-400 hover:bg-sky-50"
              } ${disabled ? "cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-slate-50" : "cursor-pointer"}`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-xs text-slate-500">{seriesFooterBadge(item, sportKey)}</div>
    </article>
  )
}

function BracketColumnRail() {
  return (
    <div className="relative hidden w-5 shrink-0 sm:block" aria-hidden>
      <div className="absolute inset-y-[10%] left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-cyan-400/[0.22] to-transparent shadow-[0_0_18px_rgba(34,211,238,0.12)]" />
    </div>
  )
}

function NbaConferenceRegionHeader(props: { title: string; subtitle?: string }) {
  return (
    <header className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_40px_rgba(99,102,241,0.06)] backdrop-blur-md">
      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/92">{props.title}</p>
      {props.subtitle ? <p className="mt-1 text-[10px] font-medium leading-snug text-slate-400">{props.subtitle}</p> : null}
    </header>
  )
}

function NbaRoundColumnHeader(props: { conference: "east" | "west"; roundKey: PlayoffRoundKey }) {
  const { conference, roundKey } = props
  const label = NBA_ROUND_LABELS[roundKey as Exclude<PlayoffRoundKey, "finals">]
  return (
    <header className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.07] to-violet-500/[0.04] px-2 py-2 text-center backdrop-blur-sm">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/42">{conference === "east" ? "East" : "West"}</p>
      <p className="mt-0.5 text-[11px] font-bold leading-tight text-white/[0.93]">{label}</p>
    </header>
  )
}

function NbaTeamPickRow(props: {
  item: PlayoffBracketBoardSeries
  slot: "home" | "away"
  pickLabel: string
  selectable: boolean
  selected: boolean
  locked: boolean
  isSavingThisSeries?: boolean
  onPick?: (seriesId: string, teamName: string) => void
}) {
  const { item, slot, pickLabel, selectable, selected, locked, isSavingThisSeries, onPick } = props
  const disabled = locked || !selectable || isSavingThisSeries
  const display = formatNbaPickDisplay(pickLabel, slot, item)
  const livePh = nbaLiveStatusPlaceholder(item)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick?.(item.id, pickLabel)}
      aria-busy={Boolean(isSavingThisSeries)}
      aria-disabled={disabled}
      aria-label={pickLabel}
      data-nba-visible-team={display}
      className={`group flex min-h-[52px] w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left outline-none ring-1 ring-inset transition duration-150 sm:items-center ${
        selected
          ? "bg-gradient-to-r from-cyan-500/18 to-violet-500/14 text-white shadow-[0_0_28px_-6px_rgba(34,211,238,0.35)] ring-cyan-400/35"
          : "bg-white/[0.055] text-slate-50 ring-white/[0.07] backdrop-blur-md hover:bg-white/[0.09] hover:ring-cyan-400/22"
      } ${
        disabled
          ? "cursor-not-allowed opacity-[0.48] hover:bg-white/[0.055] hover:ring-white/[0.07]"
          : "cursor-pointer active:scale-[0.995]"
      }`}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold leading-snug">{display}</span>
      <span
        className="mt-0.5 shrink-0 self-center rounded-lg bg-black/40 px-2 py-1 text-center text-[11px] font-bold tabular-nums text-slate-200/95 ring-1 ring-white/10 sm:mt-0"
        aria-label={livePh ? `Live status: ${livePh}` : "Live score placeholder"}
      >
        {livePh || "—"}
      </span>
    </button>
  )
}

function NbaSeriesMatchupCard(props: {
  item: PlayoffBracketBoardSeries
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked: boolean
  isSavingThisSeries?: boolean
}) {
  const { item, picks, onPick, locked, isSavingThisSeries } = props
  const pick = getPickForSeries(picks, item.id)
  const homeLabel = item.displayHomeTeamName ?? item.homeTeamName
  const awayLabel = item.displayAwayTeamName ?? item.awayTeamName
  const homeSelectable = item.homeSelectable ?? true
  const awaySelectable = item.awaySelectable ?? true
  const record = nbaSeriesRecordDisplay(item)
  const nextLine = nbaNextGamePlaceholder(item)

  return (
    <article
      className="rounded-[1.35rem] bg-white/[0.055] p-3.5 shadow-[0_12px_48px_rgba(0,0,0,0.28)] ring-1 ring-white/[0.06] backdrop-blur-xl"
      data-series-number={item.seriesNumber}
      aria-label={`Series ${item.seriesNumber}`}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-b border-white/[0.07] pb-2.5">
        <p className="font-mono text-base font-black tabular-nums tracking-wide text-cyan-50" data-testid="nba-series-record">
          {record}
        </p>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.bestOf === 7 ? "Best of 7" : `Bo${item.bestOf}`}</span>
      </div>
      {nextLine ? (
        <p className="mb-3 text-[11px] font-medium leading-snug text-slate-400" data-testid="nba-series-next">
          {nextLine}
        </p>
      ) : null}
      <div className="space-y-2.5">
        <NbaTeamPickRow
          item={item}
          slot="home"
          pickLabel={homeLabel}
          selectable={homeSelectable}
          selected={pick?.pickTeamName === homeLabel}
          locked={locked}
          isSavingThisSeries={isSavingThisSeries}
          onPick={onPick}
        />
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-300/22 to-transparent" aria-hidden />
          <span>vs</span>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-400/22 to-transparent" aria-hidden />
        </div>
        <NbaTeamPickRow
          item={item}
          slot="away"
          pickLabel={awayLabel}
          selectable={awaySelectable}
          selected={pick?.pickTeamName === awayLabel}
          locked={locked}
          isSavingThisSeries={isSavingThisSeries}
          onPick={onPick}
        />
      </div>
      <div className="mt-3 border-t border-white/[0.06] pt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {item.conference === "finals" ? "Championship matchup" : `${item.conference === "east" ? "East" : "West"} bracket`}
      </div>
    </article>
  )
}

function NbaRoundColumn(props: {
  conference: "east" | "west"
  roundKey: PlayoffRoundKey
  items: PlayoffBracketBoardSeries[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked: boolean
  isSeriesSaving?: (seriesId: string) => boolean
}) {
  const { conference, roundKey, items, picks, onPick, locked, isSeriesSaving } = props
  const justifyClass = roundKey === "round_1" ? "justify-between gap-5" : "justify-center gap-6"
  return (
    <div className="flex min-w-[176px] max-w-[min(100%,320px)] flex-1 flex-col gap-2.5" data-testid={`nba-${conference}-${roundKey}`}>
      <NbaRoundColumnHeader conference={conference} roundKey={roundKey} />
      <div className={`flex flex-1 flex-col ${justifyClass} py-1`}>
        {items.map((item) => (
          <NbaSeriesMatchupCard
            key={item.id}
            item={item}
            picks={picks}
            onPick={onPick}
            locked={locked}
            isSavingThisSeries={isSeriesSaving?.(item.id)}
          />
        ))}
      </div>
    </div>
  )
}

function NbaRobotKingMark() {
  return (
    <div className="pointer-events-none mt-4 flex justify-center px-2 pb-0.5" data-testid="nba-bracket-robot-king" aria-hidden>
      <div className="relative h-[118px] w-[150px] sm:h-[132px] sm:w-[168px]">
        <Image
          src={NBA_ROBOT_KING_SRC}
          alt=""
          fill
          sizes="(max-width: 640px) 150px, 168px"
          className="object-contain object-bottom drop-shadow-[0_0_40px_rgba(34,211,238,0.22)]"
          priority={false}
        />
      </div>
    </div>
  )
}

function NbaBracketWordmark() {
  return (
    <div className="pointer-events-none flex justify-center pb-3 pt-1" data-testid="nba-bracket-af-wordmark" aria-hidden>
      <div className="relative h-11 w-[220px] sm:h-12 sm:w-[248px]">
        <Image
          src={NBA_BRAND_WORDMARK_SRC}
          alt=""
          fill
          sizes="248px"
          className="object-contain object-center opacity-95"
          priority={false}
        />
      </div>
    </div>
  )
}

function NbaConferenceSplitBoard(props: {
  rounds: PlayoffRoundKey[]
  series: PlayoffBracketBoardSeries[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked: boolean
  isSeriesSaving?: (seriesId: string) => boolean
}) {
  const { rounds, series, picks, onPick, locked, isSeriesSaving } = props
  const finalsRound = rounds.find((r) => r === "finals")
  const finalsItems = finalsRound
    ? series.filter((s) => s.round === finalsRound).sort((a, b) => a.seriesNumber - b.seriesNumber)
    : []

  const finalsSeries = finalsItems[0]
  const championPickRaw = finalsSeries ? getPickForSeries(picks, finalsSeries.id)?.pickTeamName : undefined
  const championPickDisplay = championPickRaw ? formatNbaChampionLine(championPickRaw) : undefined

  const eastConferenceBody = EAST_WEST_ROUND_FLOW.map((roundKey, idx) => {
    const roundSeries = series
      .filter((item) => item.round === roundKey && item.conference === "east")
      .sort((a, b) => a.seriesNumber - b.seriesNumber)
    return (
      <Fragment key={`east-${roundKey}`}>
        {idx > 0 ? <BracketColumnRail /> : null}
        <NbaRoundColumn
          conference="east"
          roundKey={roundKey}
          items={roundSeries}
          picks={picks}
          onPick={onPick}
          locked={locked}
          isSeriesSaving={isSeriesSaving}
        />
      </Fragment>
    )
  })

  const westConferenceBody = EAST_WEST_ROUND_FLOW.map((roundKey, idx) => {
    const roundSeries = series
      .filter((item) => item.round === roundKey && item.conference === "west")
      .sort((a, b) => a.seriesNumber - b.seriesNumber)
    return (
      <Fragment key={`west-${roundKey}`}>
        {idx > 0 ? <BracketColumnRail /> : null}
        <NbaRoundColumn
          conference="west"
          roundKey={roundKey}
          items={roundSeries}
          picks={picks}
          onPick={onPick}
          locked={locked}
          isSeriesSaving={isSeriesSaving}
        />
      </Fragment>
    )
  })

  return (
    <div
      className="relative overflow-x-auto rounded-[1.35rem] border border-white/[0.07] bg-[linear-gradient(168deg,#030711_0%,#08122c_46%,#040a14_100%)] p-[1px] shadow-[0_0_60px_-12px_rgba(99,102,241,0.35),0_0_50px_-20px_rgba(34,211,238,0.22)]"
      data-testid="nba-bracket-frame"
    >
      <div className="relative overflow-hidden rounded-[1.3rem] px-4 py-5">
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(ellipse_72%_55%_at_50%_-8%,rgba(34,211,238,0.09),transparent_58%),radial-gradient(ellipse_70%_50%_at_12%_100%,rgba(99,102,241,0.08),transparent_52%),radial-gradient(ellipse_55%_40%_at_88%_96%,rgba(251,191,36,0.04),transparent_48%)]" />
        <div className="pointer-events-none absolute inset-px rounded-[1.28rem] border border-white/[0.045] shadow-inner shadow-black/50" aria-hidden />

        <div className="relative flex min-w-[720px] flex-col gap-8 xl:min-w-0 xl:flex-row xl:items-stretch xl:justify-between xl:gap-5">
          <div className="flex min-h-0 flex-1 flex-col gap-3 xl:min-w-0" data-testid="nba-bracket-west">
            <NbaConferenceRegionHeader title="Western Conference" subtitle="Advances toward center · First round on the left" />
            <div className="flex flex-1 flex-row items-stretch overflow-x-auto pb-1">{westConferenceBody}</div>
          </div>

          <div
            className="flex w-full min-w-[260px] max-w-[360px] shrink-0 flex-col gap-3 self-center xl:w-[min(100%,340px)] xl:self-stretch"
            data-testid="nba-bracket-center-finals"
          >
            <NbaBracketWordmark />
            <div className="rounded-[1.65rem] bg-white/[0.055] p-4 shadow-[0_16px_56px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.07] backdrop-blur-xl">
              <div className="pointer-events-none text-center">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/92">NBA Finals</p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100/75">Championship series</p>
                <p className="mt-1 text-[10px] font-medium text-slate-500">West champion vs East champion</p>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {finalsItems.length === 0 ? (
                  <p className="text-center text-sm text-slate-500">Finals not loaded.</p>
                ) : (
                  finalsItems.map((item) => (
                    <NbaSeriesMatchupCard
                      key={item.id}
                      item={item}
                      picks={picks}
                      onPick={onPick}
                      locked={locked}
                      isSavingThisSeries={isSeriesSaving?.(item.id)}
                    />
                  ))
                )}
              </div>

              <div className="pointer-events-none my-5 h-px bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent" aria-hidden />

              <div
                className="rounded-2xl bg-black/25 px-4 py-3.5 text-center ring-1 ring-white/[0.08]"
                data-testid="nba-bracket-champion"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/88">Champion</p>
                <p className="mt-2 text-lg font-black leading-snug text-white">{championPickDisplay ?? "TBD"}</p>
                <p className="mt-2 text-[11px] font-medium leading-snug text-slate-400">
                  {championPickRaw ? "Projected from your Finals pick" : "Choose the Finals winner to crown a champion"}
                </p>
              </div>

              <NbaRobotKingMark />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 xl:min-w-0" data-testid="nba-bracket-east">
            <NbaConferenceRegionHeader title="Eastern Conference" subtitle="Advances toward center · First round on the right" />
            <div className="flex flex-1 flex-row-reverse items-stretch overflow-x-auto pb-1">{eastConferenceBody}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClassicRoundColumnBoard(props: {
  rounds: PlayoffRoundKey[]
  series: PlayoffBracketBoardSeries[]
  picks: PlayoffPickView[]
  onPick?: (seriesId: string, teamName: string) => void
  locked: boolean
  sportKey: string
  isSeriesSaving?: (seriesId: string) => boolean
}) {
  const { rounds, series, picks, onPick, locked, sportKey, isSeriesSaving } = props

  return (
    <div className="relative overflow-x-auto rounded-3xl border border-slate-300/80 bg-[linear-gradient(180deg,#fdfcf8_0%,#f4f7ff_100%)] p-4 shadow-[0_18px_48px_rgba(15,23,42,0.12)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(251,191,36,0.18),transparent_40%),radial-gradient(circle_at_90%_15%,rgba(14,165,233,0.2),transparent_35%)]" />
      <div className="relative grid min-w-[980px] grid-cols-4 gap-4">
        {rounds.map((roundKey) => {
          const roundSeries = series.filter((item) => item.round === roundKey)
          return (
            <section key={roundKey} className="rounded-2xl border border-slate-300/70 bg-white/80 p-3 backdrop-blur-sm">
              <header className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <h3 className="font-semibold tracking-wide text-slate-800">{ROUND_LABELS[roundKey]}</h3>
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
                  {roundSeries.length} series
                </span>
              </header>
              <div className="space-y-3">
                {roundSeries.map((item) => (
                  <SeriesMatchupCard
                    key={item.id}
                    item={item}
                    picks={picks}
                    onPick={onPick}
                    locked={locked}
                    sportKey={sportKey}
                    isSavingSeries={isSeriesSaving?.(item.id)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export default function PlayoffBracketBoard({
  rounds,
  series,
  picks,
  sport,
  onPick,
  locked = false,
  isSeriesSaving,
}: Props) {
  const sportKey = String(sport ?? "").toLowerCase()
  const savingPredicate = isSeriesSaving ?? (() => false)

  if (sportKey === "nba") {
    return (
      <NbaConferenceSplitBoard
        rounds={rounds}
        series={series}
        picks={picks}
        onPick={onPick}
        locked={locked}
        isSeriesSaving={savingPredicate}
      />
    )
  }

  return (
    <ClassicRoundColumnBoard
      rounds={rounds}
      series={series}
      picks={picks}
      onPick={onPick}
      locked={locked}
      sportKey={sportKey}
      isSeriesSaving={savingPredicate}
    />
  )
}
