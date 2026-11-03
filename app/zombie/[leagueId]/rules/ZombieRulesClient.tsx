'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'
import type { ZombieRulesResolved } from '@/lib/zombie/zombieRules'
import { getScheduleSummary, getZombieSeasonSchedule } from '@/lib/zombie/zombieSeasonSchedule'

type Tab = 'rules' | 'thresholds' | 'items' | 'schedule'

export function ZombieRulesClient({
  leagueId,
  sport,
  isPaid,
  leagueName,
  currentWeek,
  season,
  rulesHtml,
  rules,
  experienceMode,
  serumAwardHighScore,
  serumAwardOnBashMaul,
  infectionLossToWhisperer,
  infectionLossToZombie,
}: {
  leagueId: string
  sport: string
  isPaid: boolean
  leagueName: string
  currentWeek: number
  season: number
  rulesHtml: string
  rules: ZombieRulesResolved
  experienceMode: string | null
  serumAwardHighScore: boolean
  serumAwardOnBashMaul: boolean
  infectionLossToWhisperer: boolean
  infectionLossToZombie: boolean
}) {
  const [tab, setTab] = useState<Tab>('rules')
  const cfg = getZombieSportConfig(sport)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'rules', label: 'Full Rules' },
    { id: 'thresholds', label: 'Thresholds' },
    { id: 'items', label: 'Items & Serums' },
    { id: 'schedule', label: 'Schedule' },
  ]

  return (
    <div className="mx-auto max-w-3xl px-1 py-4">
      {/* Header */}
      <div className="mb-6 rounded-2xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--zombie-text-dim)]">
              Zombie Rules
            </p>
            <h1 className="mt-1 text-xl font-black text-[var(--zombie-text-full)]">{leagueName}</h1>
            <p className="mt-1 text-[12px] text-[var(--zombie-text-mid)]">
              {cfg.label} · Season {season} · Week {currentWeek}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={clsx(
                'rounded-lg px-2.5 py-1 text-[11px] font-bold',
                isPaid
                  ? 'bg-amber-500/15 text-amber-200'
                  : 'bg-sky-500/15 text-sky-200',
              )}
            >
              {isPaid ? 'PAID LEAGUE' : 'FREE LEAGUE'}
            </span>
            <span className="text-[11px] text-[var(--zombie-text-dim)]">
              {cfg.lineupFrequency === 'daily' ? 'Daily lineups' : 'Weekly lineups'}
            </span>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              'min-h-[44px] rounded-lg px-4 py-2 text-[12px] font-semibold whitespace-nowrap transition-colors',
              tab === t.id
                ? 'bg-[var(--zombie-crimson)]/15 text-[var(--zombie-crimson)]'
                : 'text-[var(--zombie-text-dim)] hover:text-[var(--zombie-text-mid)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'rules' && (
        <div>
          <div
            className="prose prose-invert max-w-none prose-headings:text-[var(--zombie-text-full)] prose-p:text-[var(--zombie-text-mid)] prose-li:text-[var(--zombie-text-mid)] prose-pre:bg-black/30 prose-pre:border prose-pre:border-[var(--zombie-border)] prose-pre:rounded-xl"
            dangerouslySetInnerHTML={{ __html: rulesHtml }}
          />
          <p className="mt-6 text-[11px] text-[var(--zombie-text-dim)]">
            Last generated: {new Date().toISOString().slice(0, 10)}
          </p>
        </div>
      )}

      {tab === 'thresholds' && (
        <ThresholdsTab cfg={cfg} rules={rules} isPaid={isPaid} infectionLossToWhisperer={infectionLossToWhisperer} infectionLossToZombie={infectionLossToZombie} />
      )}

      {tab === 'items' && (
        <ItemsTab cfg={cfg} rules={rules} experienceMode={experienceMode} serumAwardHighScore={serumAwardHighScore} serumAwardOnBashMaul={serumAwardOnBashMaul} />
      )}

      {tab === 'schedule' && (
        <ScheduleTab cfg={cfg} sport={sport} />
      )}
    </div>
  )
}

function ThresholdsTab({ cfg, rules, isPaid, infectionLossToWhisperer, infectionLossToZombie }: {
  cfg: ReturnType<typeof getZombieSportConfig>
  rules: ZombieRulesResolved
  isPaid: boolean
  infectionLossToWhisperer: boolean
  infectionLossToZombie: boolean
}) {
  return (
    <div className="space-y-5">
      {/* Bashing & Mauling */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Bashing & Mauling Thresholds</h2>
        <p className="mt-1 text-[12px] text-[var(--zombie-text-mid)]">
          Effective {cfg.label} scoring rules for this league.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-orange-500/20 bg-orange-500/[0.04] p-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔥</span>
              <div>
                <p className="text-[13px] font-bold text-orange-300">Bashing</p>
                <p className="text-[24px] font-black text-orange-200">{rules.bashingThreshold}+ pts</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--zombie-text-mid)]">
              Win by {rules.bashingThreshold}+ points to Bash your opponent.
              {isPaid ? ' Loser forfeits additional pot share.' : ' Loser receives "Bashed" marker.'}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--zombie-red)]/20 bg-[var(--zombie-red)]/[0.04] p-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">💀</span>
              <div>
                <p className="text-[13px] font-bold text-red-300">Mauling</p>
                <p className="text-[24px] font-black text-red-200">{rules.maulingThreshold}+ pts</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--zombie-text-mid)]">
              Win by {rules.maulingThreshold}+ points for a Mauling.
              {isPaid ? ' Double winnings transfer.' : ' Double currency transfer + mauling animation.'}
            </p>
          </div>
        </div>
      </section>

      {/* Infection rules */}
      <section className="rounded-xl border border-[var(--zombie-purple)]/20 bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Infection Mechanics</h2>
        <div className="mt-3 space-y-2 text-[12px] text-[var(--zombie-text-mid)]">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--zombie-purple)]">●</span>
            <p>Lose to the Whisperer: {infectionLossToWhisperer ? 'infection when the week settles' : 'automatic infection disabled'}</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--zombie-purple)]">●</span>
            <p>Lose to a Zombie: {infectionLossToZombie ? 'infection when the week settles' : 'automatic infection disabled'}</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--zombie-green)]">●</span>
            <p>Beat a Zombie = safe (you stay Survivor)</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-teal-400">●</span>
            <p>Collect serums = a Zombie can return as a Survivor</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-teal-400">●</span>
            <p>Register a serum before kickoff = you stay human if you lose that week</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-[var(--zombie-text-dim)]">
          The week settles after final counted scores and the correction window.
        </p>
      </section>

      {/* Sport-specific edge cases */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">
          {cfg.label} — Edge Cases
        </h2>
        <ul className="mt-3 space-y-2">
          {cfg.edgeCases.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-[var(--zombie-text-mid)]">
              <span className="mt-0.5 text-amber-400">⚠</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ItemsTab({ cfg, rules, experienceMode, serumAwardHighScore, serumAwardOnBashMaul }: {
  cfg: ReturnType<typeof getZombieSportConfig>
  rules: ZombieRulesResolved
  experienceMode: string | null
  serumAwardHighScore: boolean
  serumAwardOnBashMaul: boolean
}) {
  const weapons = [
    { type: 'knife', icon: '🔪', earn: `Score ${rules.weaponShieldThreshold.toLocaleString()}+ in a week` },
    { type: 'bow', icon: '🏹', earn: `Score ${rules.weaponAmbushThreshold.toLocaleString()}+ in a week` },
    { type: 'axe', icon: '🪓', earn: `Win a matchup by ${rules.weaponAxeMargin.toLocaleString()}+` },
    { type: 'gun', icon: '🔫', earn: 'Survive 3 Zombie attacks' },
    { type: 'bomb', icon: '💣', earn: 'Win 5 straight as a Survivor' },
  ]
  const simple = experienceMode === 'simple'
  const serumAwards = [
    ...(serumAwardHighScore ? [{ label: 'Weekly top score', description: 'Highest final matchup score' }] : []),
    ...(serumAwardOnBashMaul ? [{ label: 'Bashing or Mauling', description: 'Win by the effective Bashing or Mauling margin' }] : []),
  ]

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Weapons — {cfg.label}</h2>
        <p className="mt-1 text-[12px] text-[var(--zombie-text-mid)]">
          {simple
            ? 'Weapons are off in Simple Zombie.'
            : 'Earn weapons automatically. Before kickoff, arm one held Knife, Bow, Axe, or Gun with @Chimmy to block an eligible infection. It is spent only if it blocks one. Bomb effects are inactive.'}
        </p>
        {!simple && (
          <ul className="mt-4 space-y-2">
            {weapons.map((weapon) => (
              <li key={weapon.type} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
                <span className="text-xl" aria-hidden="true">{weapon.icon}</span>
                <div>
                  <p className="text-[13px] font-semibold capitalize text-[var(--zombie-text-full)]">{weapon.type}</p>
                  <p className="text-[11px] text-[var(--zombie-text-mid)]">{weapon.earn}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-teal-500/20 bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Serums — Award Triggers</h2>
        <p className="mt-1 text-[12px] text-[var(--zombie-text-mid)]">
          {serumAwards.length ? 'This league awards serums for:' : 'Automatic serum awards are disabled for this league.'}
        </p>
        {serumAwards.length > 0 && (
          <ul className="mt-4 space-y-2">
            {serumAwards.map((award) => (
              <li key={award.label} className="flex items-center gap-3 rounded-xl border border-teal-500/15 bg-teal-500/[0.04] px-4 py-3">
                <span className="text-xl" aria-hidden="true">🧪</span>
                <div>
                  <p className="text-[13px] font-semibold text-teal-200">{award.label}</p>
                  <p className="text-[11px] text-[var(--zombie-text-mid)]">{award.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-[var(--zombie-text-mid)]">
          Register a held serum with @Chimmy before kickoff to block an eligible infection, or collect {rules.reviveThreshold} to revive a Zombie.
        </p>
      </section>
    </div>
  )
}

function ScheduleTab({ cfg, sport }: { cfg: ReturnType<typeof getZombieSportConfig>; sport: string }) {
  const schedule = getScheduleSummary(sport)
  const fullSchedule = getZombieSeasonSchedule(sport)

  const PHASE_COLORS: Record<string, string> = {
    Outbreak: 'border-l-[var(--zombie-green)]',
    Spread: 'border-l-[var(--zombie-purple)]',
    Siege: 'border-l-orange-500',
    'Final Stand': 'border-l-[var(--zombie-red)]',
    'March Madness': 'border-l-[var(--zombie-red)]',
    Apocalypse: 'border-l-[var(--zombie-crimson)]',
    'Final Four': 'border-l-[var(--zombie-crimson)]',
  }

  return (
    <div className="space-y-5">
      {/* Season overview */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">
          {cfg.label} Season — {schedule.totalWeeks} Weeks
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[20px] font-black text-white">{schedule.totalWeeks}</p>
            <p className="text-[11px] text-[var(--zombie-text-dim)]">Total Weeks</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[20px] font-black text-[var(--zombie-red)]">{fullSchedule.endgameStartWeek}</p>
            <p className="text-[11px] text-[var(--zombie-text-dim)]">Endgame Start</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[20px] font-black text-teal-300">{fullSchedule.serumExpiryWeek}</p>
            <p className="text-[11px] text-[var(--zombie-text-dim)]">Serums Expire</p>
          </div>
        </div>
      </section>

      {/* Season phases */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Season Phases</h2>
        <div className="mt-3 space-y-2">
          {schedule.phases.map((phase) => (
            <div
              key={phase.label}
              className={clsx(
                'rounded-lg border border-[var(--zombie-border)] bg-black/20 py-3 pl-4 pr-4 border-l-4',
                PHASE_COLORS[phase.label] ?? 'border-l-white/15',
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-bold text-[var(--zombie-text-full)]">{phase.label}</p>
                <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[11px] font-mono text-[var(--zombie-text-dim)]">
                  {phase.weeks}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">{phase.description}</p>
            </div>
          ))}
        </div>
        {schedule.breakWeeks.length > 0 && (
          <p className="mt-3 text-[11px] text-amber-300/80">
            Break weeks (scoring paused): {schedule.breakWeeks.map((w) => `Wk ${w}`).join(', ')}
          </p>
        )}
      </section>

      {/* Weekly timeline */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">
          Weekly Timeline — {cfg.label}
        </h2>
        <div className="mt-4 space-y-3">
          <TimelineStep
            icon="📋"
            label="Scoring window"
            detail={cfg.scoringWindow}
          />
          <TimelineStep
            icon="🔒"
            label="Lineup lock"
            detail={cfg.lockRule}
          />
          <TimelineStep
            icon="⚡"
            label="Resolution day"
            detail={`${cfg.resolutionDay} — infections, bashings, maulings all resolve`}
          />
          <TimelineStep
            icon="🎭"
            label="Ambush deadline"
            detail={cfg.ambushDeadline}
          />
          <TimelineStep
            icon="📊"
            label="Weekly update"
            detail="Auto-posted after resolution (configurable by commissioner)"
          />
        </div>
      </section>

      {/* Scoring type */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Scoring Format</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div
            className={clsx(
              'rounded-xl border p-4',
              cfg.scoringType === 'weekly'
                ? 'border-sky-400/30 bg-sky-400/[0.06]'
                : 'border-white/[0.06] opacity-50',
            )}
          >
            <p className="text-[13px] font-bold text-white">Weekly Scoring</p>
            <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
              One scoring period per week. Lineup set once.
            </p>
          </div>
          <div
            className={clsx(
              'rounded-xl border p-4',
              cfg.scoringType === 'period'
                ? 'border-sky-400/30 bg-sky-400/[0.06]'
                : 'border-white/[0.06] opacity-50',
            )}
          >
            <p className="text-[13px] font-bold text-white">Period Scoring</p>
            <p className="mt-1 text-[11px] text-[var(--zombie-text-mid)]">
              Daily slates aggregate into weekly totals. Daily lineup management.
            </p>
          </div>
        </div>
      </section>

      {/* Roster format */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">
          Roster Format — {cfg.label}
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[20px] font-black text-white">{cfg.starterCount}</p>
            <p className="text-[11px] text-[var(--zombie-text-dim)]">Starters</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[20px] font-black text-white">{cfg.benchCount}</p>
            <p className="text-[11px] text-[var(--zombie-text-dim)]">Bench</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <p className="text-[20px] font-black text-white">{cfg.irSlots}</p>
            <p className="text-[11px] text-[var(--zombie-text-dim)]">IR Slots</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {cfg.positions.map((pos, i) => (
            <span
              key={`${pos}-${i}`}
              className="rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-white/70"
            >
              {pos}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-[var(--zombie-text-dim)]">
          Total roster: {cfg.rosterSize} players · Season length: ~{cfg.seasonLength} weeks
        </p>
      </section>

      {/* Challenge frequency */}
      <section className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">Mini-Games & Challenges</h2>
        <p className="mt-2 text-[12px] text-[var(--zombie-text-mid)]">
          Challenge frequency: {cfg.challengeFrequency}
        </p>
        <p className="mt-1 text-[11px] text-[var(--zombie-text-dim)]">
          Challenges are filtered by sport and scheduled around the {cfg.label} game calendar.
        </p>
      </section>

      {/* Sport-specific notes */}
      {schedule.notes.length > 0 && (
        <section className="rounded-xl border border-amber-500/15 bg-[var(--zombie-panel)] p-5">
          <h2 className="text-[14px] font-bold text-[var(--zombie-text-full)]">
            {cfg.label} — Commissioner Notes
          </h2>
          <ul className="mt-3 space-y-2">
            {schedule.notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-[var(--zombie-text-mid)]">
                <span className="mt-0.5 text-amber-400">📌</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TimelineStep({ icon, label, detail }: { icon: string; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-lg">{icon}</span>
      <div>
        <p className="text-[13px] font-semibold text-[var(--zombie-text-full)]">{label}</p>
        <p className="text-[11px] text-[var(--zombie-text-mid)]">{detail}</p>
      </div>
    </div>
  )
}
