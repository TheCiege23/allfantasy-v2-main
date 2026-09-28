import type { AdviceLearningSnapshot, RecordCounts } from './learningSnapshot'

/**
 * CHIMMY'S TRACK RECORD — how its start/sit calls turned out, for the user and for everyone
 * (owner's call 2026-09-24: "start on the Chimmy track record").
 *
 * The calls are graded by the Receipts card's own rules (`resolveChimmyAdviceOutcomes`): the player
 * Chimmy said to start against the one it said to start him over, in that week's real platform
 * scores. `same` is within a point — neither right nor wrong — and never enters a rate.
 *
 * 🛑 A RATE NEEDS A SAMPLE. 2–0 is not "100% right", and a record page that said so would be the
 * least trustworthy thing in the product. Below the minimums the counts are shown as counts and the
 * rate is null; a caller must never compute one itself.
 *
 * ⚠ READ FROM THE OUTCOME SNAPSHOT, NOT RECOMPUTED. The maintenance cron rebuilds it from scratch
 * at most every six hours, over the last LEARNING_WINDOW_DAYS. A record here can be a few hours
 * behind a receipt the card shows live — say "updated every few hours" rather than "live" if asked.
 *
 * Pure and dependency-free (type imports only), so a client component can render the view.
 */

/** Decided calls (right + wrong) before a user's own record carries a percentage. */
export const MIN_DECIDED_FOR_USER_RATE = 5
/** Decided calls across everyone before the platform-wide percentage is shown anywhere. */
export const MIN_DECIDED_FOR_OVERALL_RATE = 30

export type TrackRecordLine = RecordCounts & {
  /** right / (right + wrong), 0–100, or null below the minimum sample. */
  ratePct: number | null
}

export type ChimmyTrackRecordView = {
  /** This user's graded calls. Null when they have none. */
  you: TrackRecordLine | null
  /** Everyone's graded calls. Null when there are none. */
  everyone: TrackRecordLine | null
  /** When the snapshot was built, ISO. */
  computedAt: string
  windowDays: number
}

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)

function line(counts: RecordCounts | null | undefined, minDecided: number): TrackRecordLine | null {
  if (!counts) return null
  const right = count(counts.right)
  const wrong = count(counts.wrong)
  const same = count(counts.same)
  if (right + wrong + same === 0) return null
  const decided = right + wrong
  return { right, wrong, same, ratePct: decided >= minDecided ? Math.round((100 * right) / decided) : null }
}

/** The track record in a snapshot, for one user (or none). Null when nothing has been graded. */
export function chimmyTrackRecordFor(
  snapshot: AdviceLearningSnapshot | null,
  userId: string | null,
): ChimmyTrackRecordView | null {
  if (!snapshot) return null
  const mine = userId ? snapshot.userRecords?.[userId] : undefined
  const you = Array.isArray(mine)
    ? line({ right: mine[0], wrong: mine[1], same: mine[2] }, MIN_DECIDED_FOR_USER_RATE)
    : null
  const everyone = line(snapshot.record?.start_sit, MIN_DECIDED_FOR_OVERALL_RATE)
  if (!you && !everyone) return null
  return { you, everyone, computedAt: snapshot.computedAt, windowDays: snapshot.windowDays }
}

/** Only a well-formed line survives a trip through JSON; anything else renders nothing. */
export function readTrackRecordLine(value: unknown): TrackRecordLine | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0
  if (!ok(v.right) || !ok(v.wrong) || !ok(v.same)) return null
  const rate = v.ratePct
  if (rate !== null && !(typeof rate === 'number' && rate >= 0 && rate <= 100)) return null
  return { right: v.right as number, wrong: v.wrong as number, same: v.same as number, ratePct: rate as number | null }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "12 right, 5 wrong (71%) · 2 too close to call" — the numbers, in words, with the rate only when earned. */
export function describeTrackRecord(l: TrackRecordLine): string {
  const base = `${l.right} right, ${l.wrong} wrong${l.ratePct != null ? ` (${l.ratePct}%)` : ''}`
  return l.same > 0 ? `${base} · ${l.same} too close to call` : base
}

/**
 * The per-user line handed to the chat model. It says the numbers and forbids any other claim —
 * with no record at all it says THAT, because a model asked "how good are your picks?" with nothing
 * in front of it will otherwise invent a hit rate in the same voice it uses for real ones.
 */
export function renderTrackRecordPromptLine(view: ChimmyTrackRecordView | null): string {
  const lines = [
    "CHIMMY'S TRACK RECORD (start/sit calls graded against the real weekly scores, Sleeper leagues, rebuilt every few hours):",
  ]
  if (view?.you) lines.push(`- With this user: ${describeTrackRecord(view.you)}.`)
  else lines.push('- With this user: no graded calls yet.')
  if (view?.everyone) {
    const e = view.everyone
    lines.push(
      e.ratePct != null
        ? `- Across everyone: ${e.ratePct}% right over ${plural(e.right + e.wrong, 'decided call', 'decided calls')}.`
        : `- Across everyone: ${plural(e.right + e.wrong, 'decided call', 'decided calls')} so far — too few for a percentage.`,
    )
  } else {
    lines.push('- Across everyone: no graded calls yet.')
  }
  lines.push(
    'Bring it up only when the user asks how good your calls are, whether to trust you, or about your record — then quote these numbers exactly. Never state or imply any other record, hit rate or win percentage.',
  )
  return lines.join('\n')
}
