'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import '@/components/core-app/af-my-team.css'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'
import type { TaxiTenure } from '@/lib/core-app/taxiTenure'
import type { MatchupSide, NextMatchup } from '@/lib/core-app/nextMatchup'
import type { RosterGrade } from '@/lib/core-app/rosterGrade'
import { buildProjectionQuestion } from '@/lib/core-app/scoringNotes'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

export type MyTeamProps = {
  data: MyTeamData
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-mt-unavailable">{reason}</p>
}

/**
 * Live countdown to the lineup lock.
 *
 * ⚠ IT USED TO PRINT "2321:15:08". Hours were the largest unit, so a lock 97
 * days out rendered as a four-digit hour count that read like a stopwatch. The
 * number was accurate and completely unreadable, and it hid the real problem —
 * that it was counting down to the wrong game entirely.
 *
 * Days now lead when there are days. Past a week the countdown stops being a
 * deadline at all and the banner says what it actually knows.
 */
function LockCountdown({
  at,
  anyEmptySlot,
  platform,
  week,
  daysAway,
}: {
  at: Date
  anyEmptySlot: boolean
  platform: string
  week: number | null
  daysAway: number
}) {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    // A ticking second hand on a deadline eight days out is noise; it only
    // earns the re-render when the number is actually moving for the reader.
    const period = daysAway >= 1 ? 60_000 : 1_000
    const t = setInterval(() => setNow(Date.now()), period)
    return () => clearInterval(t)
  }, [daysAway])

  const ms = at.getTime() - now
  const locked = ms <= 0
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86_400)
  const h = Math.floor((total % 86_400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  const label = locked
    ? 'Locked'
    : d > 0
      ? `${d}d ${h}h ${m}m`
      : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  const urgent = !locked && (ms <= 3_600_000 || anyEmptySlot)

  return (
    <div className="af-mt-lock" data-urgent={urgent} data-locked={locked}>
      <span className="af-label af-mt-lock-label">
        {week != null ? `Week ${week} locks` : 'Lineup locks'}
      </span>
      <span className="af-num af-mt-lock-time">{label}</span>
      <span className="af-mt-lock-note">
        {at.toUTCString().slice(0, 22)} UTC
        {anyEmptySlot ? ' · a starting slot is still empty' : null}
      </span>
      {anyEmptySlot && !locked ? (
        <span className="af-mt-lock-fix">Fix it in {platform}</span>
      ) : null}
    </div>
  )
}

/**
 * Which colour family a slot belongs to.
 *
 * Grouped rather than one colour per slot: a manager scanning a 16-slot IDP
 * lineup is looking for "where are my defenders", not for a unique hue per
 * label. FLEX and SUPER_FLEX take the group of whoever is actually in them,
 * which the caller passes.
 */
function posGroup(label: string | null | undefined): string {
  const p = (label ?? '').trim().toUpperCase()
  if (p.startsWith('QB')) return 'qb'
  if (p.startsWith('RB')) return 'rb'
  if (p.startsWith('WR')) return 'wr'
  if (p.startsWith('TE')) return 'te'
  if (p === 'K' || p.startsWith('PK')) return 'k'
  if (['DEF', 'DST'].includes(p)) return 'def'
  if (['DL', 'DE', 'DT'].includes(p)) return 'dl'
  if (['LB', 'ILB', 'OLB', 'MLB'].includes(p)) return 'lb'
  if (['DB', 'CB', 'S', 'SS', 'FS'].includes(p)) return 'db'
  if (p.includes('FLEX') || p === 'WRT' || p === 'WRTQ') return 'flex'
  return 'other'
}

/**
 * Weather, or the venue when there is no forecast yet.
 *
 * Two different statements, and they must not look alike: "roofed, so weather
 * cannot matter" is settled, while "open-air, and we have no forecast for a
 * game twelve days out" is a gap that will fill in. The forecast cron reaches
 * about a week ahead, so most of a preseason roster shows the second.
 */
function VenueMark({
  indoors,
  weather,
}: {
  indoors: boolean | null
  weather: LineupPlayer['weather']
}) {
  if (weather?.indoors || indoors === true) {
    return (
      <span
        className="af-mt-venue"
        data-indoors="true"
        title="Indoor or roofed stadium — weather is not a factor. Retractable roofs count as roofed; we do not track whether the roof is open."
        aria-label="Indoor stadium"
      >
        ⌂
      </span>
    )
  }

  if (weather && !weather.indoors) {
    const bits = [
      weather.temperatureF != null ? `${Math.round(weather.temperatureF)}°F` : null,
      weather.windSpeedMph != null && weather.windSpeedMph >= 8
        ? `${Math.round(weather.windSpeedMph)} mph wind`
        : null,
      weather.precipChancePct != null && weather.precipChancePct >= 20
        ? `${Math.round(weather.precipChancePct)}% precip`
        : null,
      weather.conditionLabel,
    ].filter(Boolean)
    return (
      <span
        className="af-mt-venue"
        data-indoors="false"
        data-forecast="true"
        title={bits.join(' · ') || 'Open-air stadium'}
        aria-label={bits.join(', ') || 'Outdoor stadium'}
      >
        {weather.symbol}
        {weather.temperatureF != null ? (
          <span className="af-mt-temp af-num">{Math.round(weather.temperatureF)}°</span>
        ) : null}
      </span>
    )
  }

  if (indoors === false) {
    return (
      <span
        className="af-mt-venue"
        data-indoors="false"
        title="Open-air stadium — no forecast yet for this kickoff"
        aria-label="Outdoor stadium, forecast not available yet"
      >
        ☁
      </span>
    )
  }

  return null
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * The line under the roster rank.
 *
 * ⚠ NO LETTER GRADE. This repo shipped a "C" trade grade that meant "we priced
 * nothing", and nobody could tell it apart from a considered verdict. A rank
 * names its comparison; a letter invents a scale and hides its inputs. When
 * coverage is partial that is stated here rather than folded into the number.
 */
function gradeSubtitle(g: RosterGrade): string {
  const parts: string[] = []
  const vsMedian = g.value - g.median
  parts.push(
    Math.abs(vsMedian) < g.median * 0.03
      ? 'right on the league median'
      : `${Math.abs(vsMedian).toLocaleString()} ${vsMedian > 0 ? 'above' : 'below'} the median`,
  )
  if (g.strongest) parts.push(`${g.strongest.position} is your best (${ordinal(g.strongest.rank)})`)
  if (g.weakest && g.weakest.position !== g.strongest?.position) {
    parts.push(`${g.weakest.position} your thinnest (${ordinal(g.weakest.rank)})`)
  }
  if (g.pricedPlayers < g.totalPlayers) {
    parts.push(`priced ${g.pricedPlayers} of your ${g.totalPlayers}`)
  }
  return parts.join(' · ')
}

/** One side of the projected matchup. */
function MatchupSideView({ side, label }: { side: MatchupSide; label: string }) {
  return (
    <div className="af-mt-mu-side">
      <div className="af-mt-mu-who">
        {side.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-mt-mu-av" src={side.avatarUrl} alt="" width={26} height={26} />
        ) : null}
        <div>
          <div className="af-mt-mu-name">{side.teamName ?? side.managerName ?? label}</div>
          {side.managerName && side.teamName ? (
            <div className="af-mt-mu-sub">{side.managerName}</div>
          ) : null}
        </div>
      </div>
      <div className="af-mt-mu-pts af-num">
        {side.projected != null ? side.projected.toFixed(1) : '—'}
      </div>
      {/*
        Coverage sits with the number, not in a footnote. A total built from
        five of nine starters always reads LOW, and a manager comparing two
        low-in-different-ways totals is being misled by the gap between them.
      */}
      {side.projected != null && side.projectedFrom < side.starterCount ? (
        <div className="af-mt-mu-cov">
          from {side.projectedFrom} of {side.starterCount}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The one-line read on the matchup, or nothing.
 *
 * ⚠ SILENT WHEN EITHER SIDE IS PARTIALLY PRICED. A margin between two totals
 * built from different numbers of starters is not a margin, it is an artefact
 * of coverage — and "you are favoured by 12" is exactly the sentence someone
 * would act on.
 */
function edge(m: NextMatchup): string | null {
  const you = m.you
  const them = m.opponent
  if (!them || you.projected == null || them.projected == null) return null
  if (you.projectedFrom < you.starterCount || them.projectedFrom < them.starterCount) return null

  const diff = Math.round((you.projected - them.projected) * 10) / 10
  if (Math.abs(diff) < 3) return 'Projected within three points — this is a coin flip.'
  return diff > 0
    ? `You are projected ahead by ${Math.abs(diff).toFixed(1)}.`
    : `You are projected behind by ${Math.abs(diff).toFixed(1)}.`
}

function PlayerCell({ player }: { player: LineupPlayer }) {
  return (
    <div className="af-mt-player">
      {player.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-mt-avatar" src={player.imageUrl} alt="" width={34} height={34} />
      ) : (
        <div className="af-mt-avatar af-mt-avatar--none" aria-hidden>
          {player.name.charAt(0)}
        </div>
      )}
      <div className="af-mt-player-text">
        <div className="af-mt-player-name">
          {player.name}
          {/*
            ⚠ BESIDE THE NAME, NOT IN THE META LINE. A bye is the single most
            important fact about a player this week — it is the difference
            between a starter and a guaranteed zero — and buried on the second
            line next to a kickoff time it was being read last.
          */}
          {player.onBye ? (
            <span
              className="af-mt-bye"
              title="His team is not playing this week. A starter on bye is a guaranteed zero."
            >
              BYE
            </span>
          ) : null}
        </div>
        <div className="af-mt-player-meta">
          {player.gameContext ?? 'no game found for this week'}
          <VenueMark indoors={player.indoors} weather={player.weather} />
          {player.preseason ? (
            <span
              className="af-mt-pre"
              title="Preseason game. Starters usually play a series or two, so a projection here does not describe a fantasy week."
            >
              PRESEASON
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="af-mt-status" data-tone="none">
        no designation
      </span>
    )
  }
  const t = status.toLowerCase()
  const tone =
    t.includes('out') || t.includes('ir')
      ? 'bad'
      : t.includes('question') || t.includes('doubt')
        ? 'warn'
        : 'ok'
  return (
    <span className="af-mt-status" data-tone={tone}>
      {status}
    </span>
  )
}

/**
 * The two projections, side by side.
 *
 * ⚠ THE EM DASH IS NOT DECORATION AND MUST NEVER BECOME "0.0" — except in the
 * one case where zero is a fact. Null means the feed does not carry this player;
 * zero means we expect him to score nothing. A player his league has ruled OUT
 * genuinely will score nothing, and `ruledOut` is how that case arrives here.
 * Every other absence stays an em dash.
 *
 * The AF column is the league-scored number. When it is missing but the generic
 * one is present, that is not a gap in the player's data — it means the league's
 * own scoring could not be applied, and the caveat under the roster says so.
 */
function Projections({ player, shareOfLineup }: { player: LineupPlayer; shareOfLineup: number | null }) {
  const fmt = (v: number | null) =>
    v == null ? <span className="af-mt-proj--none">—</span> : v.toFixed(1)

  return (
    <div className="af-mt-projpair">
      <span className="af-mt-proj af-num" title="Standard PPR projection from the feed">
        {fmt(player.projectedPoints)}
      </span>
      <span
        className="af-mt-proj af-mt-proj--af af-num"
        title="The same projection re-scored under your league's rules"
      >
        {fmt(player.afProjectedPoints)}
      </span>
      {shareOfLineup != null ? (
        <span
          className="af-mt-share af-num"
          title="Share of your projected starting total. High numbers mean your week rests on one player."
        >
          {Math.round(shareOfLineup * 100)}%
        </span>
      ) : (
        <span className="af-mt-share af-mt-proj--none">—</span>
      )}
    </div>
  )
}

/** What AF PTS is, in one sentence a manager can act on. */
const AF_PTS_EXPLAINER =
  'AF PTS is this week’s projection re-scored under YOUR league’s settings — ' +
  'your reception value, TE premium, passing-TD value and IDP scoring. ' +
  'PTS is the vendor’s standard PPR number, which is scored for a league nobody is in.'

function ProjHeader() {
  return (
    <div className="af-mt-projhead">
      <span className="af-label" title="Standard PPR from the feed — not your league's rules">
        PTS
      </span>
      <span className="af-label af-mt-projhead--af" title={AF_PTS_EXPLAINER}>
        AF PTS
        {/*
          The question mark is the point: two numbers sitting side by side with
          no explanation reads as a bug, not a feature.
        */}
        <span className="af-mt-info" role="img" aria-label={AF_PTS_EXPLAINER}>
          ?
        </span>
      </span>
      <span className="af-label" title="Share of your projected starting total">
        SHARE
      </span>
    </div>
  )
}

function SlotRow({
  slot,
  platform,
  shareOfLineup,
}: {
  slot: LineupSlot
  platform: string
  shareOfLineup: number | null
}) {
  return (
    /*
      ⚠ A STARTER ON BYE IS TREATED LIKE AN EMPTY SLOT, because it is one — a
      guaranteed zero in a slot the manager still has time to fill. The empty
      state was already the loudest thing on the row; this is the same problem
      wearing a name.
    */
    <li className="af-mt-row" data-empty={slot.empty} data-bye={slot.player?.onBye === true}>
      <span className="af-mt-slot af-num" data-pos={posGroup(slot.slotLabel)}>
        {slot.slotLabel}
      </span>

      {slot.player ? (
        <>
          <PlayerCell player={slot.player} />
          <StatusChip status={slot.player.injuryStatus} />
          <Projections player={slot.player} shareOfLineup={shareOfLineup} />
        </>
      ) : slot.unresolvedId ? (
        <div className="af-mt-player af-mt-unresolved">
          <div>
            <div className="af-mt-player-name">Player we could not identify</div>
            <div className="af-mt-player-meta">
              This slot is filled, but id {slot.unresolvedId} does not match any player we hold.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="af-mt-player af-mt-empty-text">
            <div>
              <div className="af-mt-player-name">Empty</div>
              <div className="af-mt-player-meta">Nobody is starting in this slot</div>
            </div>
          </div>
          <Link href="/import" className="af-btn af-mt-fix">
            Fix in {platform}
          </Link>
        </>
      )}
    </li>
  )
}

/** A bench, IR or taxi row — every one priced, same as a starter. */
function BenchRow({
  player,
  slotLabel,
  trailing,
}: {
  player: LineupPlayer
  slotLabel: string
  trailing?: React.ReactNode
}) {
  return (
    <li className="af-mt-row">
      <span
        className="af-mt-slot af-num"
        data-pos={posGroup(player.position ?? slotLabel)}
      >
        {slotLabel}
      </span>
      <PlayerCell player={player} />
      <StatusChip status={player.injuryStatus} />
      {/*
        Bench players carry no lineup share on purpose — they contribute nothing
        to the projected starting total, and printing "0%" beside them would
        read as a judgement on the player rather than a fact about the lineup.
      */}
      <Projections player={player} shareOfLineup={null} />
      {trailing}
    </li>
  )
}

/** How many taxi years are left, or an honest silence. */
function TaxiYears({ tenure }: { tenure: TaxiTenure | null }) {
  if (!tenure) {
    return (
      <span
        className="af-mt-taxi-years af-mt-taxi-years--none"
        title="This needs the league's taxi-year limit and its season-end roster history. One of them is missing, so we are not going to guess."
      >
        years left unknown
      </span>
    )
  }
  return (
    <span className="af-mt-taxi-years af-num" data-last={tenure.yearsRemaining <= 1}>
      {tenure.yearsRemaining === 0
        ? 'no taxi years left'
        : `${tenure.yearsRemaining} of ${tenure.yearsAllowed} ${
            tenure.yearsRemaining === 1 ? 'year' : 'years'
          } left`}
    </span>
  )
}

export function MyTeam({ data }: MyTeamProps) {
  const platform = data.league.platform === 'manual' ? 'your platform' : data.league.platform

  const proj = data.projections.available ? data.projections.data : null

  /*
   * ⚠ NUMERATOR AND DENOMINATOR MUST BE THE SAME MEASURE, and they were not.
   * The share fell back to the generic number when the league-scored one was
   * missing, while the total it divided by summed ONLY league-scored values —
   * so a player with no AF number contributed to the top of the fraction and
   * not the bottom. On a real roster the shares summed to 116%.
   *
   * One measure is chosen for the whole lineup, and a player missing THAT
   * measure gets no share rather than a borrowed one.
   */
  const useAf = proj?.afTotal != null && proj.afTotal > 0
  const shareBase = useAf ? proj!.afTotal! : (proj?.total ?? 0)
  const shareFor = (p: LineupPlayer | null): number | null => {
    if (!p || shareBase <= 0) return null
    const v = useAf ? p.afProjectedPoints : p.projectedPoints
    return v == null ? null : v / shareBase
  }

  function askChimmy() {
    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          prefill: buildProjectionQuestion(data.league.name, proj?.week ?? null),
        },
      }),
    )
  }

  return (
    <div className="af-mt">
      {/* ── Lock banner ─────────────────────────────────────────────── */}
      {data.lock.available ? (
        data.lock.data.daysAway > 8 ? (
          /*
            ⚠ A LOCK MORE THAN A WEEK OUT IS A COVERAGE GAP, NOT A DEADLINE, and
            counting down to it is how this banner spent weeks pointing at a
            November game. Saying so is more useful than a large number.
          */
          <div className="af-mt-lock" data-urgent={false} data-locked={false}>
            <span className="af-label af-mt-lock-label">Lineup lock</span>
            <span className="af-mt-lock-note">
              The next game we hold for your starters is {data.lock.data.daysAway} days away
              {data.lock.data.week != null ? ` (week ${data.lock.data.week})` : ''}. That is further
              out than a lineup lock should be, so this week&rsquo;s schedule probably has not been
              ingested yet rather than your lineup being safe for {data.lock.data.daysAway} days.
            </span>
          </div>
        ) : (
          <LockCountdown
            at={new Date(data.lock.data.at)}
            anyEmptySlot={data.lock.data.anyEmptySlot}
            platform={platform}
            week={data.lock.data.week}
            daysAway={data.lock.data.daysAway}
          />
        )
      ) : (
        <div className="af-mt-lock" data-urgent={false} data-locked={false}>
          <span className="af-label af-mt-lock-label">Lineup lock</span>
          <span className="af-mt-lock-note">{data.lock.reason}</span>
        </div>
      )}

      {/* ── Team header ─────────────────────────────────────────────── */}
      <header className="af-frame af-mt-head">
        {data.team.available ? (
          <>
            {data.team.data.managerAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="af-mt-crest af-mt-crest--photo"
                src={data.team.data.managerAvatarUrl}
                alt=""
                width={48}
                height={48}
              />
            ) : (
              <div className="af-mt-crest" aria-hidden>
                {data.team.data.teamName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="af-mt-head-text">
              <h1 className="af-display af-mt-team-name">{data.team.data.teamName}</h1>
              <div className="af-mt-head-meta">
                {/* The manager's name was imported from day one and never shown. */}
                {data.team.data.ownerName} · {data.league.name}
                {data.team.data.rank != null
                  ? ` · ${data.team.data.rank} of ${data.team.data.teamCount}`
                  : ` · ${data.team.data.teamCount} teams`}
              </div>
            </div>

            {/* ── Both weekly totals, at the top where they belong ──── */}
            <div className="af-mt-tiles">
              <div className="af-mt-tile af-mt-tile--proj">
                <div className="af-mt-tile-value af-num">
                  {proj ? proj.total.toFixed(1) : '—'}
                </div>
                <div className="af-label">Projected · standard</div>
              </div>
              <div className="af-mt-tile af-mt-tile--proj af-mt-tile--af">
                <div className="af-mt-tile-value af-num">
                  {proj?.afTotal != null ? proj.afTotal.toFixed(1) : '—'}
                </div>
                <div className="af-label">Projected · your league</div>
              </div>
              <div className="af-mt-tile">
                <div className="af-mt-tile-value af-num">{data.team.data.record}</div>
                <div className="af-label">Record</div>
              </div>
              {data.rosterGrade.available ? (
                <div className="af-mt-tile af-mt-tile--grade">
                  <div className="af-mt-tile-value af-num">
                    {ordinal(data.rosterGrade.data.rank)}
                    <span className="af-mt-grade-of"> of {data.rosterGrade.data.outOf}</span>
                  </div>
                  <div className="af-label">Roster value in this league</div>
                  <div className="af-mt-tile-why">
                    {gradeSubtitle(data.rosterGrade.data)}
                  </div>
                </div>
              ) : (
                <div className="af-mt-tile" data-missing="true">
                  <div className="af-mt-tile-value af-num">—</div>
                  <div className="af-label">Roster value</div>
                  <div className="af-mt-tile-why">{data.rosterGrade.reason}</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <Unavailable reason={data.team.reason} />
        )}
      </header>

      {/* ── Who you play, projected ─────────────────────────────────── */}
      {/*
        ⚠ THIS IS WHERE "POINTS FOR / AGAINST" USED TO BE. Those were the
        season's running totals — 0-0 for every team in the league until a game
        is scored — so the two most prominent numbers on the screen were em
        dashes for the entire preseason. What a manager wants in that window is
        not the points they have scored; it is the points they are about to.
      */}
      {data.nextMatchup.available ? (
        <section className="af-frame af-mt-matchup">
          <div className="af-mt-mu-head">
            <span className="af-label">
              Week {data.nextMatchup.data.week} · projected matchup
            </span>
            {data.nextMatchup.data.bye ? (
              <span className="af-mt-mu-bye">no opponent recorded — bye</span>
            ) : null}
          </div>
          <div className="af-mt-mu-body">
            <MatchupSideView side={data.nextMatchup.data.you} label="You" />
            <span className="af-mt-mu-v" aria-hidden>
              v
            </span>
            {data.nextMatchup.data.opponent ? (
              <MatchupSideView side={data.nextMatchup.data.opponent} label="Them" />
            ) : (
              <div className="af-mt-mu-side af-mt-mu-side--none">
                <div className="af-mt-mu-name">Opponent not set</div>
                <div className="af-mt-mu-sub">
                  The league recorded this week without pairing teams.
                </div>
              </div>
            )}
          </div>
          {edge(data.nextMatchup.data) ? (
            <p className="af-mt-mu-edge">{edge(data.nextMatchup.data)}</p>
          ) : null}
        </section>
      ) : (
        <p className="af-mt-footnote">{data.nextMatchup.reason}</p>
      )}

      {/* ── Byes forming ────────────────────────────────────────────── */}
      {/*
        Shown ahead of time on purpose. Discovering in week 6 that four
        starters share a week 7 bye is discovering it after the waiver wire has
        been picked over.
      */}
      {data.upcomingByes.length > 0 ? (
        <section className="af-frame af-mt-byes">
          <span className="af-label">Byes coming up</span>
          <ul className="af-mt-byes-list">
            {data.upcomingByes.map((b) => (
              <li key={b.week} data-stack={b.names.length >= 3}>
                <span className="af-mt-byes-wk af-num">Week {b.week}</span>
                <span className="af-mt-byes-who">
                  {b.names.length} off · {b.names.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Why the two numbers differ ──────────────────────────────── */}
      {proj ? (
        <section className="af-frame af-mt-basis">
          <div className="af-mt-basis-text">
            {data.projectionBasis.scoringKnown ? (
              data.projectionBasis.notes.length > 0 ? (
                <>
                  <p className="af-mt-basis-lead">
                    Your league scores differently from the standard projection:
                  </p>
                  <ul className="af-mt-basis-list">
                    {data.projectionBasis.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="af-mt-basis-lead">
                  Your league uses standard PPR scoring, so both numbers should agree. Where they
                  do not, it is because we could not score a player under your rules.
                </p>
              )
            ) : (
              <p className="af-mt-basis-lead">
                We do not hold this league&rsquo;s scoring settings, so there is no league-specific
                projection to show — only the standard one.
              </p>
            )}
            {proj.afTotal != null && proj.afProjected < proj.projected ? (
              <p className="af-mt-basis-cov">
                Your league&rsquo;s total is built from {proj.afProjected} of {proj.projected}{' '}
                priced starters, so it reads low next to the standard one.
              </p>
            ) : null}
          </div>
          <button type="button" className="af-btn af-mt-ask" onClick={askChimmy}>
            Ask Chimmy why they differ
          </button>
        </section>
      ) : null}

      {/* ── Starters ────────────────────────────────────────────────── */}
      <section className="af-frame af-mt-section">
        <header className="af-mt-section-head">
          <h2 className="af-label">Starters</h2>
          <span className="af-mt-section-note">
            Read live from {platform}. To change it, open {platform} — AllFantasy only reads.
          </span>
          <ProjHeader />
        </header>

        {data.starters.available ? (
          <ul className="af-mt-list">
            {data.starters.data.map((slot, i) => (
              <SlotRow
                key={`${slot.slotLabel}-${i}`}
                slot={slot}
                platform={platform}
                shareOfLineup={shareFor(slot.player)}
              />
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.starters.reason} />
        )}
      </section>

      {/* ── Bench ───────────────────────────────────────────────────── */}
      <section className="af-frame af-mt-section">
        <header className="af-mt-section-head">
          <h2 className="af-label">Bench</h2>
          <ProjHeader />
        </header>
        {data.bench.available ? (
          <ul className="af-mt-list">
            {data.bench.data.map((p) => (
              <BenchRow key={p.sleeperId} player={p} slotLabel="BN" />
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.bench.reason} />
        )}
      </section>

      {/* ── Injured reserve ─────────────────────────────────────────── */}
      {data.ir.available ? (
        <section className="af-frame af-mt-section">
          <header className="af-mt-section-head">
            <h2 className="af-label">Injured reserve</h2>
          </header>
          <ul className="af-mt-list">
            {data.ir.data.map((p) => (
              <BenchRow key={p.sleeperId} player={p} slotLabel="IR" />
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Taxi squad ──────────────────────────────────────────────── */}
      {/*
        ⚠ SEPARATE FROM IR ON PURPOSE. These were one list and every row in it
        was labelled "IR", which says a healthy taxi rookie is injured.
      */}
      {data.taxi.available ? (
        <section className="af-frame af-mt-section">
          <header className="af-mt-section-head">
            <h2 className="af-label">Taxi squad</h2>
            <span className="af-mt-section-note">
              Not eligible to start. Years left counts season-end rosters against your
              league&rsquo;s taxi limit.
            </span>
          </header>
          <ul className="af-mt-list">
            {data.taxi.data.map((p) => (
              <BenchRow
                key={p.sleeperId}
                player={p}
                slotLabel="TAXI"
                trailing={<TaxiYears tenure={p.tenure} />}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Coverage footnote ───────────────────────────────────────── */}
      {data.projections.available ? (
        <p className="af-mt-footnote">
          {data.projections.data.unprojected === 0
            ? `All ${data.projections.data.projected} starters projected · ${data.projections.data.season} week ${data.projections.data.week}`
            : `Standard total built from ${data.projections.data.projected} of ${
                data.projections.data.projected + data.projections.data.unprojected
              } starters — ${data.projections.data.unprojected} ${
                data.projections.data.unprojected === 1 ? 'has' : 'have'
              } no projection on file, so it reads low.`}
        </p>
      ) : (
        <p className="af-mt-footnote">
          Projections are not shown because {data.projections.reason}.
        </p>
      )}
    </div>
  )
}

export default MyTeam
