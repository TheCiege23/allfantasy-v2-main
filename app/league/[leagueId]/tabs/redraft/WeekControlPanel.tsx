'use client'

import { useState } from 'react'
import {
  runRedraftScheduleAction,
  type RedraftScheduleClient,
} from '@/lib/redraft/client'
// Leaf module, not the '@/lib/schedule-runtime' barrel: the barrel also
// re-exports `resolveNflRedraftScheduleRuntime`, which pulls prisma and
// `server-only` into this client component and fails the production build.
import { matchupCompleted } from '@/lib/schedule-runtime/canonicalScheduleRuntime'

/**
 * Commissioner week controls for the regular season.
 *
 * 🛑 THE PRODUCT HAD NO WAY TO ADVANCE A WEEK. `advance_week` existed, guarded
 * and correct, behind a commissioner gate on `/api/redraft/schedule` — and the
 * only client call to that route was a GET. Every league in production sits at
 * week 1 partly because of this: even a commissioner who knew the week was over
 * had no button, and no cron called it either.
 *
 * The scheduled roller (`/api/cron/season-week-roll`) now does this
 * automatically once the real-world slate is finished. This panel is the manual
 * half, and automation needs its manual half from day one rather than after the
 * first bad week: a postponed game, a provider that never reports a final, or a
 * league that simply wants to move on.
 */
export function WeekControlPanel({
  seasonId,
  schedule,
  onChanged,
}: {
  seasonId: string
  schedule: RedraftScheduleClient
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [override, setOverride] = useState(false)

  const currentWeek = schedule.currentWeek
  const regularSeasonWeeks = schedule.regularSeasonWeeks
  const week = schedule.weeks.find((w) => w.week === currentWeek)
  // `matchupCompleted` is the runtime's own predicate, imported rather than
  // re-expressed — this count has to agree with the guard that will refuse the
  // advance, or the button lies about whether it will work.
  const unfinished = week ? week.matchups.filter((m) => !m.bye && !matchupCompleted(m)).length : 0
  const seasonOver = schedule.status === 'regular_season_complete' || currentWeek > regularSeasonWeeks

  async function run(action: 'advance_week' | 'complete_week' | 'open_week', targetWeek: number) {
    setBusy(action)
    setMessage(null)
    try {
      const result = await runRedraftScheduleAction({
        seasonId,
        action,
        week: targetWeek,
        commissionerOverride: override,
      })
      if (result.ok) {
        setMessage({
          tone: 'ok',
          text:
            result.status === 'regular_season_complete'
              ? 'Regular season complete. The playoff bracket has been generated.'
              : `Now on week ${result.currentWeek ?? targetWeek}.`,
        })
        setOverride(false)
        onChanged?.()
      } else {
        // Show the runtime's own reason. "All non-bye matchups must be finalized
        // before completing the week" is actionable; "something went wrong" is not.
        setMessage({
          tone: 'warn',
          text: result.message ?? result.error ?? 'That change was refused.',
        })
      }
    } catch (cause) {
      setMessage({
        tone: 'warn',
        text: cause instanceof Error ? cause.message : 'That change could not be sent.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      className="mb-4 rounded-lg border border-[color:var(--border-subtle,#2a2a2a)] bg-[color:var(--surface-1,#141414)] p-4"
      data-testid="redraft-week-controls"
      aria-label="Commissioner week controls"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide">Week controls</h3>
        <p className="text-xs text-[color:var(--text-tertiary,#8a8a8a)]">
          {seasonOver
            ? 'Regular season complete'
            : `Week ${currentWeek} of ${regularSeasonWeeks}`}
          {' · '}
          Advances automatically once the week&rsquo;s games are final
        </p>
      </div>

      {!seasonOver && unfinished > 0 ? (
        <p className="mt-2 text-xs text-[color:var(--text-secondary,#b4b4b4)]">
          {unfinished} matchup{unfinished === 1 ? '' : 's'} in week {currentWeek} not final yet.
          Advancing is blocked until scoring settles, or override below.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md border border-[color:var(--border-subtle,#2a2a2a)] px-3 text-sm font-semibold disabled:opacity-50"
          disabled={busy !== null || seasonOver}
          onClick={() => void run('advance_week', currentWeek)}
        >
          {busy === 'advance_week'
            ? 'Advancing…'
            : currentWeek >= regularSeasonWeeks
              ? 'End regular season'
              : `Advance to week ${currentWeek + 1}`}
        </button>

        <button
          type="button"
          className="min-h-11 rounded-md border border-[color:var(--border-subtle,#2a2a2a)] px-3 text-sm font-semibold disabled:opacity-50"
          disabled={busy !== null || currentWeek <= 1}
          onClick={() => void run('open_week', Math.max(1, currentWeek - 1))}
          title="Reopen the previous week — for a scoring correction after the week rolled."
        >
          {busy === 'open_week' ? 'Reopening…' : `Reopen week ${Math.max(1, currentWeek - 1)}`}
        </button>

        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="h-4 w-4"
          />
          Override incomplete matchups
        </label>
      </div>

      {message ? (
        <p
          role="status"
          className={`mt-3 text-sm ${
            message.tone === 'ok'
              ? 'text-[color:var(--text-primary,#f5f5f5)]'
              : 'text-[color:var(--warn,#e0a33c)]'
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
