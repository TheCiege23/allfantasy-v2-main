'use client'

import Link from 'next/link'

import { formatLockLabel } from '@/lib/core-app/lockLabel'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import { lineupLink } from '@/lib/core-app/platformLinks'
import type { CrossLeagueFlag, MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'
import { FOREIGN_IDS_UNREADABLE_CLAUSE } from '@/lib/core-app/foreignIdSpaceCopy'
import { MyTeamLockClock } from '@/components/core-app/MyTeamLockClock'
import { LineupIntelligenceActions } from '@/components/core-app/LineupIntelligenceActions'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  RowTag,
  SectionHead,
  platformKey,
  rankTiers,
  type Sev,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * `/core/my-team` with no league held — the cross-league lineup board.
 *
 * "Your ten most urgent lineups across every league, ranked by time left before
 * lock." One ranked list, then a footer line accounting for every league it did
 * not show. (2026-09-07 handoff, `AF Core My Team.dc.html`.)
 *
 * ── What this replaced, and why each drop was a decision ────────────────────
 *
 * The previous version of this file was a two-column "needs you / quiet" board
 * that sat ABOVE the `PickALeague` queue and its grid of all 65+ leagues. All
 * three are gone from the default view and none is deleted:
 *
 *   the split columns  — collapsed into one ranked list. The quiet column was
 *                        five rows saying nothing needs you, which is what the
 *                        footer now says in one line.
 *   "Needs you first"  — the same severity signal this board ranks on. It was
 *                        being rendered twice on one screen.
 *   the league grid    — moved behind the footer's "View all N", which renders
 *                        unconditionally.
 *
 * ⚠ THAT LAST ONE IS LOAD-BEARING AND REVERSES A 2026-08-30 DECISION ON PURPOSE.
 * The board was made additive back then for one stated reason: a manager whose
 * lineups are all set would otherwise face an empty screen with no route into a
 * league. The footer link is that route, and it is why `FooterSummary` renders
 * even when the hidden count is zero. Do not make the CTA conditional.
 *
 * ⚠ EVERY COUNT ON A ROW IS A LOSS THAT HAS ALREADY HAPPENED OR IS CERTAIN TO.
 * An empty slot, a starter ruled out and a starter on bye all score zero, which
 * is why they share a tone and add into one urgency. A QUESTIONABLE designation
 * does not — he probably plays — so it is warning-toned, kept out of the total,
 * and never used to sort a league to the top.
 *
 * ⚠ AND A MISSING BYE CHECK IS SAID OUT LOUD. `bye: null` means this week's
 * schedule was too thin to tell a bye from a hole in our ingestion. A board that
 * renders that as "nothing on bye" is the exact failure the underlying gate
 * exists to prevent.
 */

/** How many rows the board draws. The handoff's "top 10". */
const BOARD_ROWS = 10

export type MyTeamBoardProps = {
  pulse: MyTeamPulse
  /** Injected in tests so the rendered countdown is deterministic. */
  now?: number
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
}

/** "Ghosts of Gridiron · 9 starters" — each clause dropped rather than faked. */
function detailOf(row: MyTeamRow, language: string): string {
  const parts: string[] = []
  if (row.teamName) parts.push(row.teamName)
  parts.push(`${row.starters} ${coreUiCopy(row.starters === 1 ? 'starter' : 'starters', language)}`)
  return parts.join(' · ')
}

/**
 * The problems, in the order a manager would fix them.
 *
 * Empty first because it is the only one with no excuse — nobody is in the slot
 * — then the two that need a replacement found, then the risk, then our own gap.
 */
function tagsOf(row: MyTeamRow, language = 'en'): Array<{ key: string; tag: string; detail: string; sev: Sev }> {
  const copy = (english: string) => coreUiCopy(english, language)
  if (row.bestBall) return [{ key: 'auto', tag: 'AUTO', detail: copy('Best Ball lineup'), sev: 'info' }]
  const out: Array<{ key: string; tag: string; detail: string; sev: Sev }> = []
  if (row.empty > 0) {
    out.push({
      key: 'empty',
      tag: String(row.empty),
      detail: copy(row.empty === 1 ? 'slot empty' : 'slots empty'),
      sev: 'bad',
    })
  }
  if (row.out > 0) out.push({ key: 'out', tag: String(row.out), detail: copy('ruled out'), sev: 'bad' })
  if (row.bye != null && row.bye > 0) {
    out.push({ key: 'bye', tag: String(row.bye), detail: copy('on bye'), sev: 'bad' })
  }
  if (row.questionable > 0) {
    out.push({ key: 'q', tag: String(row.questionable), detail: copy('questionable'), sev: 'warn' })
  }
  /*
   * Not a lineup problem and never toned as one — a starter we could not look
   * up is OUR gap. Shown so a short count is explained rather than quietly wrong.
   */
  if (row.unresolved > 0) {
    out.push({ key: 'unresolved', tag: String(row.unresolved), detail: copy('unidentified'), sev: 'info' })
  }
  return out
}

function Lock({ row, now }: { row: MyTeamRow; now: number }) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  if (row.bestBall) return <span className="af-bd-stat">{copy('Automatic')}</span>
  /*
   * ⚠ THE EM DASH NEEDS AN ACCESSIBLE NAME OR IT IS SILENCE. `title` alone is
   * not reliably announced and "—" read aloud is nothing at all, so the reason
   * travels as the label.
   */
  if (row.lockAt == null) {
    if ((row.started ?? 0) > 0) {
      return <span className="af-bd-stat" title={copy('Some games have started. Check individual locks on your platform.')}>{copy('Games started')}{row.unknownKickoffs ? ` · ${copy('schedule incomplete')}` : ''}</span>
    }
    const why = copy('Lock time unknown — no kickoff on file for any of these starters.')
    return (
      <span className="af-bd-stat" title={why} aria-label={why}>
        &mdash;
      </span>
    )
  }

  const atMs = new Date(row.lockAt).getTime()
  const label = formatLockLabel(atMs, now)
  /* Eastern, like every other kickoff on /core — UTC moved night games to the next day. Pinned, so it hydrates. */
  const kickoff = `${kickoffClock(row.lockAt)} (${kickoffDayLabel(row.lockAt) ?? ''})`

  /*
   * ⚠ A DATE, NOT A COUNTDOWN, PAST `DISTANT_LOCK_DAYS`. The next kickoff we
   * hold that far out is almost certainly not this week's, so counting down to
   * it states a deadline that does not exist — every league on a 55-league
   * portfolio read "10d 8h" before this, which is a board that told you nothing.
   * The ticking clock goes with it: it re-rendered every thirty seconds to
   * redraw a date that changes once a day.
   */
  if (label.distant) {
    const why = language === 'es'
      ? `El próximo partido registrado para estos titulares es ${kickoff}, demasiado lejano para ser el cierre de alineación; probablemente aún falta el calendario de esta semana.`
      : `The next kickoff we hold for these starters is ${kickoff}, further out than a lineup lock should be — this week’s schedule has probably not been ingested yet.`
    return (
      <span className="af-bd-stat" title={why} aria-label={why}>
        {label.text}
      </span>
    )
  }

  return (
    <span
      className="af-bd-stat"
      data-sev={label.locked ? 'bad' : label.urgent ? 'bad' : 'warn'}
      title={language === 'es'
        ? `Próximo inicio de un titular: ${kickoff}. Confirma los cierres individuales y cambios automáticos en tu plataforma.`
        : `Next starter kickoff ${kickoff}. Individual locks and AutoSubs must be checked on your platform.`}
    >
      {label.locked ? copy('Check player locks') : <MyTeamLockClock atMs={atMs} initial={label.text} elapsedLabel={copy('Check player locks')} />}
    </span>
  )
}

/**
 * `rankTiers` output, written the way a standings table writes a tie.
 *
 * ⚠ THE BULLET READ AS A MISSING NUMBER. A tier's first row carried a numeral
 * and the rows tied with it carried `•`, so a live board read "01, 02, •, 04,
 * •, •, •…" — which looks like a list that lost its numbering, not one that
 * says "same as above". Every row in a shared tier now carries the tier's rank
 * with a T ("T4, T4, T4"); a row alone in its tier keeps its plain numeral.
 * The all-null case (nothing separated anything) passes through untouched, so
 * the board still drops the gutter entirely.
 */
function tiedRankLabels(ranks: Array<string | null>): Array<string | null> {
  if (ranks.every((r) => r === null)) return ranks
  const out: Array<string | null> = []
  let tierStart = 0
  for (let i = 0; i < ranks.length; i += 1) {
    if (ranks[i] !== null) tierStart = i
    const tied = ranks[i] === null || ranks[i + 1] === null
    out.push(tied ? `T${tierStart + 1}` : ranks[i])
  }
  return out
}

function Row({
  row,
  rank,
  showRank,
  now,
}: {
  row: MyTeamRow
  rank: string | null
  /** False when NOTHING on the board is ordered — then there is no gutter at all. */
  showRank: boolean
  now: number
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const tags = tagsOf(row, language)
  /*
   * ⚠ THE LABEL CARRIES ITS OWN VALUE. "Next player deadline" used to stand
   * alone on this line, with the countdown it referred to a row above and a
   * column away — so every row read as a label with its value missing.
   * Eastern and pinned, like every kickoff on /core, so it hydrates.
   */
  const nextDeadline = row.lockAt && Date.parse(row.lockAt) > now ? kickoffClock(row.lockAt) || null : null
  /*
   * ⚠ THE CTA GOES TO THE PLATFORM, NOT INTO AllFantasy. AllFantasy is
   * read-only; the lineup is changed on Sleeper. `lineupLink` falls back to the
   * in-app screen for a native league and for any provider whose deep-link
   * format is not yet verified, so this is never a dead destination.
   */
  const fix = lineupLink({
    id: row.leagueId,
    platform: row.platform,
    platformLeagueId: row.platformLeagueId,
    season: row.leagueSeason,
    name: row.leagueName,
    teamId: row.teamId,
  })

  return (
    <li>
      <div className="af-bd-row">
        {/*
          🛑 NO GUTTER AT ALL WHEN NOTHING IS ORDERED. This drew a column of ten
          identical marks, which is 20px of indent spent saying nothing — and it
          survived two corrections because each looked at the MARK (contrast,
          then weight) rather than asking whether the column had earned its
          place. It has not: the section label already says the rows are in no
          particular order, and that sentence carries the whole meaning.

          ⚠ A TIE MARK, NOT A BLANK, IN THE MIXED CASE. There the column is real,
          so a row that ties another needs to say so. An empty cell between
          numerals reads as data that failed to load, and a bullet read as a
          missing number — see `tiedRankLabels`.
        */}
        {showRank ? (
          <span className="af-bd-rank" data-tied={rank?.startsWith('T') ? '' : undefined} aria-hidden>
            {rank}
          </span>
        ) : null}
        <LeagueCrest
          imageUrl={row.logoUrl}
          mark={row.leagueBadge}
          name={row.leagueName}
          platform={row.platform}
        />
        <Link className="af-bd-league" href={row.href}>
          <span className="af-bd-name">{row.leagueName}</span>
          <span className="af-bd-sub">
            {/*
              ⚠ LOWER-CASED THROUGH `platformKey`. The tint selectors match
              `sleeper`, not `Sleeper`; the raw column let a capitalised value
              render the platform word untinted. LeagueIdentity already did this.
            */}
            <span className="af-bd-plat" data-platform={platformKey(row.platform)}>
              {row.platform.toUpperCase()}
            </span>
            {' · '}
            {detailOf(row, language)}
          </span>
        </Link>
        <span className="af-bd-mid">
          {tags.length > 0 ? (
            tags.map((t) => (
              <RowTag key={t.key} tag={t.tag} detail={t.detail} sev={t.sev} />
            ))
          ) : (
            /*
             * A clean lineup still says so. An empty gap here reads as "we did
             * not check", which is a much weaker claim than "we checked and
             * there is nothing wrong".
             */
            <RowTag tag="SET" detail={copy('nothing missing')} sev="good" />
          )}
        </span>
        <Lock row={row} now={now} />
        {fix ? (
          <a
            className="af-bd-cta"
            href={fix.href}
            {...(fix.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {language === 'es' ? fix.label.replace(/^Open in /, 'Abrir en ') : fix.label} {fix.external ? '↗' : '→'}
          </a>
        ) : (
          <span className="af-bd-cta" />
        )}
      </div>
      <div className="af-mt-board-actions">
        <span>{row.bestBall ? copy('Provider selects the scoring lineup · review roster depth') : <>{row.started ? language === 'es' ? `${row.started} ${copy(row.started === 1 ? 'starter' : 'starters')} con partido iniciado · ` : `${row.started} ${row.started === 1 ? 'starter' : 'starters'} past kickoff · ` : ''}{nextDeadline ? `${copy('Next player deadline')} ${nextDeadline}` : copy(row.lockAt ? 'Next player deadline' : 'Check individual locks')}{row.unknownKickoffs ? language === 'es' ? ` · ${row.unknownKickoffs} sin hora de inicio` : ` · ${row.unknownKickoffs} without a kickoff` : ''}</>}</span>
        <LineupIntelligenceActions leagueId={row.leagueId} leagueName={row.leagueName} bestBall={row.bestBall} />
      </div>
    </li>
  )
}

/**
 * One player hurting several of your lineups at once — the fact no single row can show.
 *
 * The rows already carry "1 ruled out" each; what they cannot say is that it is the SAME player in
 * three leagues, which is one piece of news with three places to act. Each league links straight
 * to his row on that league's page. Built from the same status the rows counted (myTeamPulse.ts),
 * so a player here is always also counted on his rows.
 */
function CrossLeagueStrip({ flags }: { flags: CrossLeagueFlag[] }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <div className="af-bd-xl" role="region" aria-label={es ? 'Jugadores en varias alineaciones' : 'Players in more than one lineup'}>
      <span className="af-bd-xl-label">{es ? 'Afecta a más de una alineación' : 'Hurting more than one lineup'}</span>
      <ul className="af-bd-xl-list">
        {flags.map((f) => (
          <li key={f.id} data-status={f.status}>
            <RowTag tag={f.status === 'out' ? 'OUT' : 'Q'} sev={f.status === 'out' ? 'bad' : 'warn'} />
            <span className="af-bd-xl-name">{f.name}</span>
            <span className="af-bd-xl-count">
              {es ? `en ${f.leagues.length} alineaciones:` : `in ${f.leagues.length} lineups:`}
            </span>
            <span className="af-bd-xl-leagues">
              {f.leagues.map((l, i) => (
                <span key={l.leagueId}>
                  {i > 0 ? ', ' : ''}
                  <Link href={l.href} prefetch={false}>{l.leagueName}</Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MyTeamBoard({ pulse, now, allHref }: MyTeamBoardProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const nowMs = now ?? Date.now()
  /*
   * 🛑 BOTH COLUMNS, NOT JUST THE BROKEN ONE. This read `pulse.needs` alone and
   * shipped that way — on a 94-league account where every readable lineup was
   * fine it rendered ZERO rows under a heading promising ten, because
   * "nothing is broken" and "nothing to show" had become the same thing.
   * Caught by a production screenshot, not by any test here.
   *
   * ⚠ URGENCY IS SEVERITY THEN CLOCK, WHICH IS WHY THIS IS A CONCATENATION AND
   * NOT A RE-SORT. The loader has already ordered `needs` by certain lost points
   * and `set` by soonest lock; those two orderings are not comparable to each
   * other, so merging them by any single key would be inventing a ranking
   * neither column carries. A lineup with a hole outranks a clean one because a
   * hole is a loss you can still prevent — that is the rule, and it falls out of
   * the order rather than being computed here.
   */
  const rows = [...pulse.needs, ...pulse.set].slice(0, BOARD_ROWS)
  const total = pulse.considered
  const activeTotal = Math.max(0, total - (pulse.paused ?? 0) - (pulse.notChecked.inactive ?? 0))

  /*
   * ⚠ THE TIER KEY MIRRORS THE LOADER'S COMPARATORS, FIELD FOR FIELD, AND NOT
   * THE RENDERED LOCK. `needs` sorts on (locked, severity, lockAt, questionable)
   * and `set` on (questionable, lockAt), so each key returns "tied" exactly when
   * its column's comparator would have returned 0. The N/S prefix keeps the two
   * columns apart: the last `needs` row and the first `set` row are ordered by
   * the concatenation itself, so they never tie. Reading the DISPLAYED time
   * instead would merge rows an hour apart, because `formatLockLabel` rounds to
   * the hour past a day.
   */
  const needsShown = Math.min(pulse.needs.length, BOARD_ROWS)
  const ranks = tiedRankLabels(rankTiers(rows.map((r, i) => {
    const sev = r.actionableSeverity ?? r.severity
    return i < needsShown
      ? `N|${sev === 0 ? 1 : 0}|${sev}|${r.lockAt ?? ''}|${r.questionable}`
      : `S|${r.questionable}|${r.lockAt ?? ''}`
  })))
  const questionableFirst = pulse.needs.length === 0 && rows.some((r) => r.questionable > 0)
  /* Nothing separated any row from any other, so the board is a set, not a ranking. */
  const unordered = ranks.length > 0 && ranks.every((r) => r === null)

  /*
   * ⚠ THREE DIFFERENT SILENCES, THREE DIFFERENT SENTENCES. "Nothing needs you",
   * "we could not read some of these" and "you hold no claimed teams" are
   * distinct facts, and collapsing them is how a board tells a manager their
   * lineups are fine when in truth it never read them.
   */
  if (total === 0) {
    return (
      <div className="af-bd">
        <BoardHead
          eyebrow={`Core · ${copy('My team')}`}
          title={copy('My team')}
          blurb={copy('Your most urgent lineups across every league, ranked by time left before lock.')}
        />
        <p className="af-bd-note">
          {copy('No team in any league is claimed to this account yet, so there is no lineup to check.')}{' '}
          <Link href="/import">{copy('Connect a platform')}</Link> {copy('and this board fills in.')}
        </p>
      </div>
    )
  }

  const idsUnreadable = pulse.notChecked.idsUnreadable ?? 0
  const unreadable = pulse.notChecked.noRoster + pulse.notChecked.noLineup + idsUnreadable
  const hidden = Math.max(0, activeTotal - rows.length)
  const hiddenNeeds = Math.max(0, pulse.needsTotal - Math.min(pulse.needs.length, BOARD_ROWS))

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow={`Core · ${copy('My team')}`}
        title={copy('My team')}
        blurb={copy('Review remaining lineup problems across your leagues, as of your last sync — opening a league checks its live lineup. Deadlines follow individual players; confirm locks and AutoSubs on your platform.')}
      />

      <section className="af-bd-sec" aria-labelledby="af-mt-board">
        <SectionHead
          id="af-mt-board"
          /*
            ⚠ "TOP 0" IS NOT A HEADING. An empty board headed "Top 0 · ranked by
            urgency" reads as a list that failed to load; the ranking rule only
            belongs on a list that has something in it.
          */
          /*
            ⚠ THE LABEL NAMES WHICH RULE IS ACTUALLY IN FORCE. With something
            broken the list leads on severity; with nothing broken it is purely
            the clock. Printing "ranked by urgency" over ten clean lineups would
            state a rule the list is not following — the same defect the trades
            board's "ranked by deadline" had over rows with no deadline.
          */
          /*
            ⚠ "TOP N" IS ITSELF A RANKING CLAIM, so it goes too when nothing
            separated the rows. On a normal week most leagues lock at the same
            first kickoff, which makes this the COMMON branch rather than an
            edge case — see `rankTiers`.
          */
          label={
            rows.length === 0
              ? copy('Needs you first')
              : unordered
                ? language === 'es' ? `${rows.length} visibles · cierran a la vez, sin orden particular` : `${rows.length} shown · all lock together, so in no particular order`
                : pulse.needs.length > 0
                  ? language === 'es' ? `Primeros ${rows.length} · por urgencia` : `Top ${rows.length} · ranked by urgency`
                  : questionableFirst
                    ? language === 'es' ? `Primeros ${rows.length} · dudosos primero, luego por hora de cierre` : `Top ${rows.length} · questionable starters first, then lock time`
                    : language === 'es' ? `Primeros ${rows.length} · sin problemas, ordenados por hora de cierre` : `Top ${rows.length} · nothing is broken, so ranked by lock time`
          }
          count={language === 'es'
            ? `${pulse.checked.toLocaleString()} de ${activeTotal.toLocaleString()} equipos ${pulse.paused ? 'activos ' : ''}revisados`
            : `${pulse.checked.toLocaleString()} of ${activeTotal.toLocaleString()} ${pulse.paused ? 'active ' : ''}teams read`}
        />
        {pulse.crossLeague && pulse.crossLeague.length > 0 ? <CrossLeagueStrip flags={pulse.crossLeague} /> : null}
        {rows.length > 0 ? (
          <>
            {/*
              The aggregate fact, which the per-row SET tags cannot carry. Before
              the fallback existed this was the whole body of the section; it is
              still worth saying, because "ten clean lineups" and "every lineup
              you have is clean" are different claims and only the second one
              lets a manager stop looking.
            */}
            {pulse.needs.length === 0 ? (
              <p className="af-bd-note af-bd-note--plain">
                {pulse.automatic
                  ? copy('No manual lineup problems found in the available data. Best Ball scoring lineups are selected automatically; review those leagues for roster injuries and depth.')
                  : language === 'es'
                    ? `Las ${pulse.checked.toLocaleString()} alineaciones que pudimos leer están listas: sin posiciones vacías ni jugadores descartados${pulse.byeChecked ? ', y nadie descansa' : ''}. ${questionableFirst ? 'Primero las que tienen titulares dudosos, luego las que cierran antes.' : 'Estas son las que cierran primero.'}`
                    : <>Every one of the {pulse.checked.toLocaleString()} lineups we could read is set —
                      no empty slots, nobody ruled out
                      {pulse.byeChecked ? ', nobody on a bye' : ''}. {questionableFirst
                        ? 'Lineups with questionable starters come first, then the ones locking soonest.'
                        : 'These are the ones locking soonest.'}</>}
              </p>
            ) : null}
            <ul className="af-bd-rows">
              {rows.map((r, i) => (
                <Row
                  key={r.leagueId}
                  row={r}
                  rank={ranks[i]}
                  showRank={!unordered}
                  now={nowMs}
                />
              ))}
            </ul>
          </>
        ) : pulse.checked === 0 && unreadable === 0 ? (
          /*
            ⚠ NOTHING TO READ IS NOT A FAILURE TO READ. Every team here is
            pre-draft, finished, archived or paused — the off-season, for every
            user, from January to the draft. The branch below used to catch this
            too and print "We could not read a single lineup", a data-gap warning
            over an account with no gap. The counts that say which teams sit out
            are the notes under this section; this line only says there is
            nothing to set. It still makes no claim that any lineup is fine.
          */
          <p className="af-bd-note af-bd-note--plain">
            {language === 'es'
              ? 'No hay alineaciones que ajustar ahora: cada equipo está antes del draft, terminado o en pausa. Las líneas de abajo dicen cuáles.'
              : 'No lineups to set right now — every team is pre-draft, finished or paused. The lines below say which.'}
          </p>
        ) : pulse.checked === 0 ? (
          /*
            🛑 THE MOST IMPORTANT BRANCH ON THIS SCREEN, AND THE FIRST VERSION GOT
            IT WRONG — caught by rendering it, not by a test. With `checked` at 0
            nothing was read at all, and "every lineup we could read is set" is
            then vacuously true and reads as "your lineups are fine". That is the
            single most damaging sentence this board could print: it tells a
            manager with four unfilled lineups that there is nothing to do.
          */
          <p className="af-bd-note">
            <strong>{copy('We could not read a single lineup.')}</strong>{' '}
            {copy('Nothing below is a verdict on your teams — it is a gap in what we hold. The line under this says which.')}
          </p>
        ) : (
          <p className="af-bd-note">
            {language === 'es'
              ? `Las ${pulse.checked.toLocaleString()} alineaciones que pudimos leer están listas: sin posiciones vacías ni jugadores descartados${pulse.byeChecked ? ', y nadie descansa' : ''}.`
              : <>Every one of the {pulse.checked.toLocaleString()} lineups we could read is set — no
                empty slots, nobody ruled out
                {pulse.byeChecked ? ', nobody on a bye' : ''}.</>}
          </p>
        )}
      </section>
      {pulse.paused ? <p className="af-bd-note">{language === 'es'
        ? `${pulse.paused} ${pulse.paused === 1 ? 'liga está pausada' : 'ligas están pausadas'} en esta cuenta y no se incluyen en las prioridades de alineación. `
        : `${pulse.paused} ${pulse.paused === 1 ? 'league is' : 'leagues are'} paused on this account and excluded from lineup urgency. `}<Link href={allHref}>{copy('View all leagues')}</Link> {copy('to review them.')}</p> : null}

      {/*
        ⚠ THE UNREADABLE COUNT IS ITS OWN LINE, NOT FOLDED INTO THE FOOTER. A
        team whose roster was never imported has not been checked and found
        clean; putting it in the same sentence as "nothing needs you there" is
        the claim this whole loader refuses to make.
      */}
      {(pulse.automatic ?? 0) > 0 || (pulse.notChecked.inactive ?? 0) > 0 ? (
        <p className="af-bd-note">
          {(pulse.automatic ?? 0) > 0 ? language === 'es' ? `${pulse.automatic} equipos Best Ball usan alineaciones automáticas. ` : `${pulse.automatic} Best Ball teams use automatic lineups. ` : null}
          {(pulse.notChecked.inactive ?? 0) > 0 ? language === 'es' ? `${pulse.notChecked.inactive} equipos previos al draft, finalizados o inactivos quedan fuera de las tareas manuales de alineación.` : `${pulse.notChecked.inactive} pre-draft, completed, or inactive teams are excluded from manual lineup tasks.` : null}
        </p>
      ) : null}
      {unreadable > 0 ? (
        <p className="af-bd-note">
          <strong>
            {language === 'es'
              ? `${unreadable} de tus ${activeTotal.toLocaleString()} equipos asignados${pulse.paused ? ' activos' : ''} no se pudieron revisar.`
              : <>{unreadable} of your {activeTotal.toLocaleString()} {pulse.paused ? 'active ' : ''}claimed{' '}
                  {activeTotal === 1 ? 'team' : 'teams'} could not be checked.</>}
          </strong>{' '}
          {/* Singular counts read as broken copy on a screen full of real numbers. */}
          {pulse.notChecked.noRoster > 0
            ? language === 'es' ? `${pulse.notChecked.noRoster} sin plantilla importada` : `${pulse.notChecked.noRoster} ${pulse.notChecked.noRoster === 1 ? 'has' : 'have'} no roster imported`
            : ''}
          {pulse.notChecked.noRoster > 0 && pulse.notChecked.noLineup > 0 ? language === 'es' ? ' y ' : ' and ' : ''}
          {pulse.notChecked.noLineup > 0
            ? language === 'es' ? `${pulse.notChecked.noLineup} con plantilla pero sin alineación titular registrada` : `${pulse.notChecked.noLineup} ${pulse.notChecked.noLineup === 1 ? 'has' : 'have'} a roster but no starting lineup on file`
            : ''}
          {/* A foreign-id league's lineup is unread, not absent — its own words, never "no lineup". */}
          {idsUnreadable > 0 && (pulse.notChecked.noRoster > 0 || pulse.notChecked.noLineup > 0) ? language === 'es' ? ' y ' : ' and ' : ''}
          {idsUnreadable > 0
            ? language === 'es' ? `${idsUnreadable} con plantilla registrada cuyos identificadores no podemos vincular al calendario` : `${idsUnreadable} ${idsUnreadable === 1 ? 'has' : 'have'} a roster on file, but ${idsUnreadable === 1 ? '' : 'for each league, '}${FOREIGN_IDS_UNREADABLE_CLAUSE}`
            : ''}
          . {copy('This is a gap in available data, not a verdict on those lineups.')} {' '}
          {/* A re-sync cannot make a foreign league's ids matchable, so it is offered only for the gaps it can close. */}
          {pulse.notChecked.noRoster + pulse.notChecked.noLineup > 0 ? (
            <>
              <Link href={allHref}>{copy('Review league setup')}</Link> {copy('or')} <Link href="/core/sync">{copy('re-sync imported leagues')}</Link>.
            </>
          ) : null}
        </p>
      ) : null}

      {!pulse.byeChecked ? (
        /*
          Plain, not boxed (handoff 2026-09-13): it qualifies the rows rather than
          warning about them. The two notes that ARE warnings — nothing could be
          read, some teams could not be checked — stay boxed on purpose.
        */
        <p className="af-bd-note af-bd-note--plain">
          {copy('The bye check did not run this week — the ingested schedule was too incomplete to tell a bye from a gap in our own data, so no row claims to be bye-clear.')}
        </p>
      ) : null}

      <FooterSummary
        hidden={hidden}
        total={total}
        href={allHref}
        emptyText={pulse.paused ? copy('Every active league is on this board.') : undefined}
        quiet={
          language === 'es'
            ? hiddenNeeds > 0
              ? `${hidden === 1 ? 'incluye' : 'incluyen'} ${hiddenNeeds} equipos más que necesitan revisar su alineación; abre la lista completa.`
              : unreadable > 0
                ? `no se muestran: ${Math.max(0, hidden - unreadable)} ${Math.max(0, hidden - unreadable) === 1 ? 'lista' : 'listas'} y ${unreadable} sin poder leer (arriba se explica por qué).`
                : (pulse.automatic ?? 0) > 0 || (pulse.notChecked.inactive ?? 0) > 0
                  ? hidden === 1 ? 'no tiene tareas manuales de alineación pendientes.' : 'no tienen tareas manuales de alineación pendientes.'
                  : hidden === 1 ? 'está lista; no requiere atención.' : 'están listas; no requieren atención.'
            : hiddenNeeds > 0
              ? `include ${hiddenNeeds} more teams needing lineup review — open the full league list.`
              : unreadable > 0
                /*
                 * ⚠ SAY THE SPLIT, NOT "EITHER/OR". "45 more leagues are either set or could not be read
                 * — the line above says which" made the reader do the subtraction (live, 2026-10-02: it
                 * meant 44 set and 1 unreadable). Every unreadable league is hidden — it never becomes a
                 * row — so the rest of the hidden ones are the set ones.
                 */
                ? `are not shown: ${Math.max(0, hidden - unreadable)} set, ${unreadable} could not be read (the line above says why).`
                : (pulse.automatic ?? 0) > 0 || (pulse.notChecked.inactive ?? 0) > 0
                  ? 'have no remaining manual lineup task.'
                  : 'are set — nothing needs you there.'
        }
        language={language}
      />
    </div>
  )
}

export default MyTeamBoard
