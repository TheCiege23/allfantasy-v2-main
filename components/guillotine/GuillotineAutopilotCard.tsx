'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Axe, Bot, CheckCircle2, Lock, Megaphone, Sparkles, Trophy, Users } from 'lucide-react'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'

/**
 * "AF runs this league for you" — the native league home's answer to *why this app and not a
 * random chopped league*. Everything listed here is something the platform actually does without
 * the commissioner (see lib/guillotine/nativeGuillotineWeek.ts, run by the score-sync cron;
 * lib/redraft/waiverEngine.ts for the blind window; finishGuillotineSeason.ts for the crown). The
 * chop, the release, the waiver auction and the announcement used to happen invisibly; nothing in
 * the native league explained them, so a commissioner had no reason to believe they would.
 *
 * Commissioners also get "Your decisions": the handful of settings that are theirs to make, each a
 * link into League Settings, with the AF Commissioner extras marked rather than hidden.
 */

/** NFL and NBA hold guillotine waiver claims for a blind auction (lib/redraft/waiverEngine.ts). */
const BLIND_WAIVER_SPORTS = new Set(['NFL', 'NBA'])

type SummaryConfig = {
  eliminationStartWeek?: number
  teamsPerChop?: number
  scheduleLines?: string[]
  /** Commissioner viewers only: the server's AF Commissioner check for guillotine rules. */
  canEditPaidRules?: boolean | null
}

export function GuillotineAutopilotCard({
  leagueId,
  sport,
  isCommissioner,
  onOpenSettings,
  onSelectTab,
}: {
  leagueId: string
  sport: string
  isCommissioner: boolean
  onOpenSettings: (panel?: string | null) => void
  onSelectTab: (id: string) => void
}) {
  const profile = getGuillotineSportConfig(sport)
  const [config, setConfig] = useState<SummaryConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.config) setConfig(d.config as SummaryConfig)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const hasAfCommissioner = typeof config?.canEditPaidRules === 'boolean' ? config.canEditPaidRules : null
  const [recapState, setRecapState] = useState<{ busy: boolean; message: string | null; upgrade: string | null }>({ busy: false, message: null, upgrade: null })

  // Commissioner-requested AI recap of the latest chop, posted to league chat (lib/guillotine/weeklyRecap.ts).
  const postAiRecap = async () => {
    setRecapState({ busy: true, message: null, upgrade: null })
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/ai`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'recap', postToChat: true }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // FeatureGateService refusal: 403, code `feature_not_entitled`, with its own upgrade link.
        const locked = d?.code === 'feature_not_entitled'
        setRecapState({
          busy: false,
          message: locked ? 'Chimmy recaps are part of a paid AllFantasy plan.' : (d?.error ?? 'Could not post the recap.'),
          upgrade: locked ? (typeof d?.upgradePath === 'string' && d.upgradePath.startsWith('/') ? d.upgradePath : '/upgrade') : null,
        })
        return
      }
      setRecapState({
        busy: false,
        upgrade: null,
        message: !d.posted
          ? `Chimmy's week ${d.week} recap is already in league chat.`
          : d.aiWritten
            ? `Posted Chimmy's week ${d.week} recap to league chat.`
            : `Chimmy was unavailable, so the standard week ${d.week} recap was posted instead.`,
      })
    } catch {
      setRecapState({ busy: false, message: 'Could not reach the server. Try again.', upgrade: null })
    }
  }
  const startWeek = config?.eliminationStartWeek ?? 1
  const perChop = Math.max(1, config?.teamsPerChop ?? 1)
  const chopWhen = profile ? profile.chopLabel.replace(/^By /, 'by ') : 'after each week'
  const waiverWhen = profile?.waiverLabel ?? 'the day after the chop'
  const blind = BLIND_WAIVER_SPORTS.has(sport.toUpperCase())

  const steps: Array<{ icon: typeof Axe; title: string; body: string }> = [
    {
      icon: Axe,
      title: 'The chop happens on its own',
      body: `Starting week ${startWeek}, the lowest-scoring ${perChop === 1 ? 'team is' : `${perChop} teams are`} eliminated ${chopWhen} — only after the week's stats are final${profile ? ` and the ${profile.correctionWindowHours}-hour stat-correction window has passed` : ''}. No one has to press a button.`,
    },
    {
      icon: Users,
      title: 'Chopped rosters hit the wire',
      body: `Every player on a chopped team is released to waivers automatically, so the survivors can fight over them.`,
    },
    {
      icon: CheckCircle2,
      title: 'Waivers run themselves',
      body: blind
        ? `Claims are blind FAAB bids, settled together ${waiverWhen}. Highest bid wins, so no one can snipe a chopped star at 3 a.m.`
        : `Waiver claims process ${waiverWhen}.`,
    },
    {
      icon: Megaphone,
      title: 'The league hears it first',
      body: 'Each chop is announced in league chat with a weekly recap — who went, the closest call, the top scorer and when the next chop lands.',
    },
    {
      icon: Trophy,
      title: 'The season closes itself',
      body: 'When the last team is standing, AF crowns the champion and archives the season.',
    },
  ]

  return (
    <section className="nl-card" data-testid="guillotine-autopilot-card">
      <div className="nl-card-label">
        <span>On autopilot</span>
        <Bot size={16} aria-hidden />
      </div>
      <h2>AllFantasy runs this league for you</h2>
      <p>
        {isCommissioner
          ? 'You make the decisions once. Every week after that — chops, releases, waivers, announcements — happens without you.'
          : 'Your commissioner set the rules. AllFantasy enforces them every week, the same way for everyone.'}
      </p>
      <ol className="mt-3 space-y-3" aria-label="What happens automatically each week">
        {steps.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon size={18} aria-hidden className="mt-0.5 shrink-0 opacity-80" />
            <div className="min-w-0">
              <strong className="block text-[14px]">{title}</strong>
              <span className="block text-[13px] opacity-75">{body}</span>
            </div>
          </li>
        ))}
      </ol>

      {isCommissioner ? (
        <div className="mt-4 border-t border-white/10 pt-4" data-testid="guillotine-autopilot-decisions">
          <strong className="block text-[13px] uppercase tracking-wide opacity-70">Your decisions</strong>
          <div className="nl-actions mt-2 flex-wrap">
            <button type="button" className="nl-button" onClick={() => onOpenSettings('roster')}>
              Roster spots
            </button>
            <button type="button" className="nl-button" onClick={() => onOpenSettings('guillotine-first-chop')}>
              First chop week
            </button>
            <button type="button" className="nl-button" onClick={() => onOpenSettings('guillotine-rules')}>
              League rules
            </button>
            <button type="button" className="nl-button" onClick={() => onOpenSettings('waivers')}>
              Waivers
            </button>
            <button type="button" className="nl-button" onClick={() => onOpenSettings('guillotine-chop-rules')}>
              {hasAfCommissioner === false ? <Lock size={14} aria-hidden /> : null}
              Chop rules{hasAfCommissioner === false ? ' · AF Commissioner' : ''}
            </button>
          </div>
          <p className="mt-2 text-[12px] opacity-60">
            {hasAfCommissioner
              ? 'AF Commissioner is on: double-chop weeks, immunity, tiebreakers and the rest of the league rules are yours to set.'
              : 'Roster changes reshape the draft automatically (rounds = roster spots, IR not drafted). AF Commissioner adds double-chop weeks, immunity, custom tiebreakers and stat-correction timing.'}
          </p>
          <div className="nl-actions mt-3">
            <button type="button" className="nl-button" disabled={recapState.busy} onClick={() => void postAiRecap()} data-testid="guillotine-ai-recap">
              <Sparkles size={14} aria-hidden /> {recapState.busy ? 'Chimmy is writing…' : 'Have Chimmy recap the last chop'}
            </button>
          </div>
          {recapState.message ? (
            <p role="status" className="mt-2 text-[12px] opacity-80">
              {recapState.message}
              {recapState.upgrade ? <> <a href={recapState.upgrade} className="font-semibold underline">Upgrade</a></> : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="nl-actions mt-3">
        <button type="button" className="nl-button nl-primary" onClick={() => onSelectTab('guillotine')}>
          Open the chop line <ArrowRight size={16} aria-hidden />
        </button>
      </div>
    </section>
  )
}
