import { letterVerdict } from './engineRecord'
import { MIN_GRADED_FOR_OVERALL_RATE, MIN_TRADES_PER_LETTER, type LedgerRecordView } from './ledgerRecord'

/**
 * THE TRACK RECORD, SAID IN PUBLIC (owner's call, 2026-11-22: "a public accuracy figure").
 *
 * The same graded record the app shows beside its own calls (`engineRecord.ts`), across everyone, as a page anyone
 * can read at /track-record. Three rules, and they are the point of publishing it at all:
 *
 *   1. EVERY graded call is shown, the ones that did not hold up included — a record that prints only its wins is an
 *      advert. A trade letter whose deals have gone the other way says so in the same size type.
 *   2. NO NUMBER BELOW THE LEDGER'S OWN SAMPLE RULE. Under 30 graded calls there is a count and no rate; a trade letter
 *      under 20 graded deals is not listed. Nothing here lowers either.
 *   3. IT SAYS WHAT WAS MEASURED. Standard PPR, NFL, players only; trade letters on redraft deals only. A reader who
 *      plays another format is told this number is not about their league.
 *
 * Counts only — no user, league or player appears. PURE.
 */

export type PublicRecordTone = 'held' | 'not_held' | 'even' | 'pending'
export type PublicRecordLine = {
  key: string
  title: string
  /** The number, as a sentence. */
  headline: string
  /** What it rests on, and what "right" means here. */
  detail: string
  tone: PublicRecordTone
}
export type PublicTrackRecord = { season: number | null; lines: PublicRecordLine[]; measured: string }

const abs1 = (n: number) => Math.abs(n).toFixed(1)

export function publicTrackRecord(view: LedgerRecordView | null | undefined): PublicTrackRecord {
  const lines: PublicRecordLine[] = []
  const bench = view?.bench?.everyone
  if (bench) {
    const graded = bench.right + bench.wrong + bench.same
    lines.push(
      bench.ratePct == null
        ? { key: 'bench', title: 'Start / sit swaps', headline: `${graded} graded so far`, detail: `A rate is shown from ${MIN_GRADED_FOR_OVERALL_RATE} decided calls.`, tone: 'pending' }
        : {
            key: 'bench',
            title: 'Start / sit swaps',
            headline: `Right ${bench.ratePct}% of the time`,
            detail: `${bench.right.toLocaleString('en-US')} right, ${bench.wrong.toLocaleString('en-US')} wrong, ${bench.same.toLocaleString('en-US')} tied. Right means the player we said to start outscored the one we said to bench.`,
            tone: bench.ratePct > 50 ? 'held' : bench.ratePct < 50 ? 'not_held' : 'even',
          },
    )
  }
  const pickups = view?.pickups?.everyone
  if (pickups) {
    lines.push(
      pickups.ratePct == null
        ? { key: 'pickups', title: 'Top pickup of the week', headline: `${pickups.graded} graded so far`, detail: `A rate is shown from ${MIN_GRADED_FOR_OVERALL_RATE} graded pickups.`, tone: 'pending' }
        : {
            key: 'pickups',
            title: 'Top pickup of the week',
            headline: `${pickups.ratePct}% became startable`,
            detail: `${pickups.startable.toLocaleString('en-US')} of ${pickups.graded.toLocaleString('en-US')} averaged 10 or more points a week over the next three weeks.`,
            // A share of pickups, not a right/wrong call: stated, never coloured as a pass or a fail.
            tone: 'even',
          },
    )
  }
  for (const t of view?.trades ?? []) {
    if (!(t.n >= MIN_TRADES_PER_LETTER)) continue
    const verdict = letterVerdict(t.letter, t.netPerWeek)
    lines.push({
      key: `trade-${t.letter}`,
      title: `Trades graded ${t.letter}`,
      headline: `${abs1(t.netPerWeek)} points a week ${t.netPerWeek >= 0 ? 'more' : 'less'} than they gave up`,
      detail:
        `Across ${t.n.toLocaleString('en-US')} graded trades${t.aheadPct != null ? `, the graded side came out ahead in ${t.aheadPct}%` : ''}. ` +
        (verdict === 'held_up' ? 'This letter has held up.' : verdict === 'not_held_up' ? 'This letter has not held up so far.' : 'A C promises no direction either way.'),
      tone: verdict === 'held_up' ? 'held' : verdict === 'not_held_up' ? 'not_held' : 'even',
    })
  }
  // Every other sport and league type, graded on its own measure (2026-11-22) — the misses included, same rules.
  for (const [key, b] of Object.entries(view?.tradeOutcomes ?? {})) {
    const where = b.kind === 'value' ? 'dynasty-style leagues' : `${b.sport} leagues`
    for (const t of b.letters) {
      if (!(t.n >= MIN_TRADES_PER_LETTER)) continue
      const verdict = letterVerdict(t.letter, t.net)
      lines.push({
        key: `trade-${key}-${t.letter}`,
        title: `Trades graded ${t.letter} in ${where}`,
        headline: b.kind === 'value'
          ? `${abs1(t.net)} points ${t.net >= 0 ? 'more' : 'less'} of the deal's value a month on`
          : `${abs1(t.net)} points a week ${t.net >= 0 ? 'more' : 'less'} than they gave up`,
        detail:
          `Across ${t.n.toLocaleString('en-US')} graded trades${t.aheadPct != null ? `, the graded side came out ahead in ${t.aheadPct}%` : ''}. ` +
          (b.kind === 'value' ? 'Measured on the dynasty market, in the league’s own QB format. ' : 'Measured under each league’s own scoring. ') +
          (verdict === 'held_up' ? 'This letter has held up.' : verdict === 'not_held_up' ? 'This letter has not held up so far.' : 'A C promises no direction either way.'),
        tone: verdict === 'held_up' ? 'held' : verdict === 'not_held_up' ? 'not_held' : 'even',
      })
    }
  }
  return {
    season: view?.season ?? null,
    lines,
    measured: 'Start/sit, pickups and NFL redraft trade letters are measured in standard PPR points on NFL games, players only (draft picks and budget score nothing). Other sports and formats are graded under each league’s own scoring, and dynasty-style leagues on the dynasty market a month or more after the trade; dynasty trades that moved draft picks are not graded yet.',
  }
}
