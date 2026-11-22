'use client'

/**
 * The Best Ball section of the live create wizard (Draft step) and its rules summary (Review step).
 * Choices are pure functions in lib/create-league-v2/bestBallWizard.ts; this file only draws them.
 *
 * Styled with the wizard's own surface tokens (`--surface-card-soft`, `--border-subtle`, `--text-*`),
 * which html[data-mode="light"] redefines, so the panel reads in both modes without a light-mode
 * override of its own.
 */
import { Check } from 'lucide-react'
import { getDefaultBestBallSetup, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import {
  bestBallCompetitionOf,
  bestBallDailyAvailable,
  bestBallHasPlayoffs,
  bestBallPlayoffTeamChoices,
  bestBallRulesSummary,
  bestBallTournamentAvailable,
  withBestBallCompetition,
  withBestBallPlayoffTeams,
  withBestBallScoringPeriod,
  withBestBallWaivers,
  type BestBallCompetition,
} from '@/lib/create-league-v2/bestBallWizard'

type Props = {
  state: CreateLeagueV2State
  onChange: (patch: Partial<CreateLeagueV2State>) => void
}

type Choice<T> = { value: T; label: string; hint?: string; disabled?: boolean; testId: string }

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function ChoiceRow<T extends string | number | boolean>({ label, choices, value, onPick, columns, testId }: {
  label: string
  choices: Choice<T>[]
  value: T
  onPick: (value: T) => void
  columns: string
  testId: string
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">{label}</p>
      <div className={cx('grid gap-2', columns)} role="group" aria-label={label}>
        {choices.map((choice) => {
          const selected = choice.value === value
          return (
            <button
              key={String(choice.value)}
              type="button"
              disabled={choice.disabled}
              aria-pressed={selected}
              onClick={() => onPick(choice.value)}
              className={cx(
                'flex min-h-12 min-w-0 touch-manipulation flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2.5 text-left transition',
                selected
                  ? 'border-violet-500 bg-violet-600/12 text-violet-700 dark:text-violet-200'
                  : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-primary)] [@media(hover:hover)]:hover:border-violet-400',
                choice.disabled && 'cursor-not-allowed opacity-50',
              )}
              data-testid={choice.testId}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-bold">
                <span className="min-w-0 [overflow-wrap:normal]">{choice.label}</span>
                {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={3} /> : null}
              </span>
              {choice.hint ? (
                <span className="text-xs font-semibold leading-5 text-[color:var(--text-secondary)]">{choice.hint}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BestBallSetupPanel({ state, onChange }: Props) {
  const bb = state.bestBall
  const defaults = getDefaultBestBallSetup(state.sport, bb.mode, state.draftType)
  const competition = bestBallCompetitionOf(bb)
  const tournamentOk = bestBallTournamentAvailable(state.sport)
  const dailyOk = bestBallDailyAvailable(state.sport)
  const set = (bestBall: CreateLeagueV2State['bestBall']) => onChange({ bestBall })

  const competitionChoices: Choice<BestBallCompetition>[] = [
    { value: 'season_total', label: 'Season-long points', hint: 'Every point counts toward one season total.', testId: 'g30-bb-competition-season_total' },
    { value: 'h2h', label: 'Head-to-head', hint: 'Your best lineup plays one opponent each week.', testId: 'g30-bb-competition-h2h' },
    {
      value: 'tournament',
      label: 'Tournament',
      hint: tournamentOk ? 'Pods play for total points; each pod winner reaches the final.' : 'Football only for now.',
      disabled: !tournamentOk,
      testId: 'g30-bb-competition-tournament',
    },
  ]

  return (
    <section
      className="space-y-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-4"
      data-testid="g30-best-ball-panel"
      aria-labelledby="g30-bb-title"
    >
      <div>
        <h3 id="g30-bb-title" className="text-base font-black text-[color:var(--text-primary)]">Best Ball rules</h3>
        <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
          Lineups set themselves. Choose how the league competes and whether managers can add players after the draft.
        </p>
      </div>

      <ChoiceRow
        label="Competition"
        testId="g30-bb-competition"
        columns="grid-cols-1 sm:grid-cols-3"
        value={competition}
        choices={competitionChoices}
        onPick={(value) => set(withBestBallCompetition(bb, value, { sport: state.sport, teamCount: state.teamCount, defaults }))}
      />

      {competition === 'tournament' ? null : (
        <ChoiceRow
          label="Playoff teams"
          testId="g30-bb-playoffs"
          columns="grid-cols-3 sm:grid-cols-5"
          value={bestBallHasPlayoffs(bb) ? bb.playoffTeams : 0}
          choices={bestBallPlayoffTeamChoices(state.teamCount).map((n) => ({
            value: n,
            label: n === 0 ? 'No playoffs' : `${n} teams`,
            testId: `g30-bb-playoffs-${n}`,
          }))}
          onPick={(value) => set(withBestBallPlayoffTeams(bb, value, { sport: state.sport, defaults }))}
        />
      )}

      <ChoiceRow
        label="Lineups are scored"
        testId="g30-bb-period"
        columns="grid-cols-2"
        value={bb.scoringPeriod}
        choices={[
          { value: 'weekly', label: 'Weekly', hint: 'Best lineup for the whole week.', testId: 'g30-bb-period-weekly' },
          ...(dailyOk
            ? [{
                value: 'daily' as const,
                label: 'Daily',
                hint: competition === 'tournament' ? 'Not available for tournaments.' : 'Best lineup each day, added up.',
                disabled: competition === 'tournament',
                testId: 'g30-bb-period-daily',
              }]
            : []),
        ]}
        onPick={(value) => set(withBestBallScoringPeriod(bb, value, state.sport))}
      />

      <ChoiceRow
        label="After the draft"
        testId="g30-bb-waivers"
        columns="grid-cols-1 sm:grid-cols-2"
        value={bb.waiversEnabled}
        choices={[
          { value: false, label: 'Draft only', hint: 'No waivers or free agency. Your draft is your season.', testId: 'g30-bb-waivers-off' },
          { value: true, label: 'Managed Best Ball', hint: 'Waivers and free agency stay open all season.', testId: 'g30-bb-waivers-on' },
        ]}
        onPick={(value) => set(withBestBallWaivers(bb, value))}
      />
    </section>
  )
}

/** The Best Ball rules in plain words, on the Review step. */
export function BestBallRulesSummary({ state }: { state: CreateLeagueV2State }) {
  const lines = bestBallRulesSummary(state.bestBall, state.sport, state.teamCount)
  return (
    <div
      className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] p-4"
      data-testid="g30-review-best-ball-rules"
    >
      <p className="text-sm font-black text-[color:var(--text-primary)]">Best Ball rules</p>
      <dl className="mt-2 space-y-2">
        {lines.map((line) => (
          <div key={line.id} className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3" data-testid={`g30-review-bb-${line.id}`}>
            <dt className="text-xs font-black uppercase tracking-wide text-[color:var(--text-tertiary)]">{line.label}</dt>
            <dd className="min-w-0 break-words text-sm leading-6 text-[color:var(--text-secondary)]">{line.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
