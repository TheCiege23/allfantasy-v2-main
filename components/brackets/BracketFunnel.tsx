import Link from "next/link"
import { Trophy } from "lucide-react"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { buildBracketGraph } from "@/lib/playoffs/playoffBracketGraph"
import "./bracket-funnel.css"

export type FunnelTeam = { seed?: number | string | null; name: string }
export type FunnelGame = { id: string; teams: [FunnelTeam, FunnelTeam] }
export type FunnelColumn = { title: string; points?: number | null; games: FunnelGame[] }
/**
 * Two halves that narrow toward a championship in the middle. `left` and
 * `right` are each listed OUTER round first, so both halves are described the
 * same way; the component mirrors the right half when it draws it.
 */
export type FunnelModel = {
  leftLabel: string
  rightLabel: string
  left: FunnelColumn[]
  right: FunnelColumn[]
  final: { title: string; points?: number | null; game: FunnelGame }
}

type Props = {
  model: FunnelModel
  /** Where a tap on any matchup goes (create a league, open the league…). Null renders static cards. */
  href: string | null
  pointsLabel: string
  matchupLabel: string
  championLabel: string
}

function Game({ game, side, href, matchupLabel, index }: { game: FunnelGame; side: "left" | "right" | "final"; href: string | null; matchupLabel: string; index: number }) {
  const body = (
    <>
      <span className="af-fn-game-head">{matchupLabel} {index + 1}</span>
      {game.teams.map((team, i) => (
        <span className="af-fn-team" key={i}>
          <span className="af-fn-seed">{team.seed ?? "·"}</span>
          <span className="af-fn-name">{team.name}</span>
        </span>
      ))}
    </>
  )
  const label = `${matchupLabel} ${index + 1}: ${game.teams[0].name} / ${game.teams[1].name}`
  return href
    ? <Link className="af-fn-game" data-side={side} href={href} aria-label={label}>{body}</Link>
    : <div className="af-fn-game" data-side={side} role="group" aria-label={label}>{body}</div>
}

/**
 * The bracket as two triangles that meet at the championship — the March
 * Madness shape. Every column is the same height and spaces its games evenly,
 * so each round sits centred between the games that feed it and the halves
 * narrow toward the middle. Scrolls sideways on a phone, like the live board.
 */
export default function BracketFunnel({ model, href, pointsLabel, matchupLabel, championLabel }: Props) {
  const tallest = Math.max(1, ...model.left.map((c) => c.games.length), ...model.right.map((c) => c.games.length))
  const column = (col: FunnelColumn, side: "left" | "right", depth: number) => (
    <section className="af-fn-col" data-side={side} data-depth={depth} key={`${side}-${col.title}`} aria-label={col.title}>
      <h3 className="af-fn-col-head">
        <span>{col.title}</span>
        {col.points != null ? <span className="af-fn-pts">+{col.points} {pointsLabel}</span> : null}
      </h3>
      <div className="af-fn-col-games">
        {col.games.map((game, i) => <Game key={game.id} game={game} side={side} href={href} matchupLabel={matchupLabel} index={i} />)}
      </div>
    </section>
  )
  const cols = model.left.length + model.right.length
  /*
   * Three rounds a side (NFL, CFP) is seven columns; at the 150px a two-round half uses, that
   * overflows the hub's bracket panel at 1440px and hides the right half behind a scroll.
   * Narrower columns keep the whole funnel on screen; a phone still scrolls.
   */
  const colMin = cols >= 6 ? 118 : 150
  const finalMin = cols >= 6 ? 158 : 190
  return (
    <div className="af-fn" data-testid="bracket-funnel">
      <div className="af-fn-sides" aria-hidden="true"><span>{model.leftLabel}</span><span>{model.rightLabel}</span></div>
      <div className="af-fn-tree" data-dense={cols >= 6 ? "true" : undefined} style={{ ["--fn-rows" as string]: tallest, gridTemplateColumns: `repeat(${model.left.length}, minmax(${colMin}px, 1fr)) minmax(${finalMin}px, 1.1fr) repeat(${model.right.length}, minmax(${colMin}px, 1fr))`, minWidth: `${cols * (colMin + 12) + finalMin + 20}px` }}>
        {model.left.map((col, i) => column(col, "left", i))}
        <section className="af-fn-final" aria-label={model.final.title}>
          <Trophy className="af-fn-trophy" aria-hidden />
          <h3 className="af-fn-col-head af-fn-final-head">
            <span>{model.final.title}</span>
            {model.final.points != null ? <span className="af-fn-pts">+{model.final.points} {pointsLabel}</span> : null}
          </h3>
          <Game game={model.final.game} side="final" href={href} matchupLabel={championLabel} index={0} />
        </section>
        {[...model.right].reverse().map((col, i) => column(col, "right", model.right.length - 1 - i))}
      </div>
    </div>
  )
}

/**
 * Build the funnel from a tournament's own template rows. The halves come
 * from `buildBracketGraph`, which already derives them from the rows'
 * conferences (upper/lower for the CFP, East/West for the NBA Cup), so the
 * preview cannot disagree with the board a league actually plays on.
 */
export function funnelFromSeries(
  rows: PlayoffSeriesView[],
  opts: {
    name: (raw: string) => string
    roundTitle: (round: PlayoffSeriesView["round"]) => string
    points: (round: PlayoffSeriesView["round"]) => number | null
    sideLabel: (conference: string | null) => string
  },
): FunnelModel | null {
  const graph = buildBracketGraph(rows)
  if (!graph.final) return null
  const toGame = (s: PlayoffSeriesView): FunnelGame => ({
    id: String(s.seriesNumber),
    teams: [
      { seed: s.homeSeed || null, name: opts.name(s.homeTeamName) },
      { seed: s.awaySeed || null, name: opts.name(s.awayTeamName) },
    ],
  })
  const toColumn = (c: (typeof graph.columns)[number]): FunnelColumn => ({
    title: opts.roundTitle(c.round), points: opts.points(c.round), games: c.nodes.map((n) => toGame(n.series)),
  })
  const left = graph.columns.filter((c) => c.side === "left").map(toColumn)
  // The graph lists the right half inward-out; the model wants outer first.
  const right = graph.columns.filter((c) => c.side === "right").map(toColumn).reverse()
  const final = graph.final.series
  return {
    leftLabel: opts.sideLabel(graph.sides.left),
    rightLabel: opts.sideLabel(graph.sides.right),
    left,
    right,
    final: { title: opts.roundTitle(final.round), points: opts.points(final.round), game: toGame(final) },
  }
}
