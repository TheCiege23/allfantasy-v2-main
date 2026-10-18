'use client'

import type { ReactNode } from 'react'
import { SvkEmpty } from './SurvivorKit'
import '../survivor-core.css'

/**
 * The SurvivorStates cards (survivor-core handoff §7): empty, loading and error states with fixed,
 * original copy. Screens pick a state by key so wording and art stay identical everywhere.
 *
 * The missed-vote rule is the implemented one: votes not cast by the deadline simply don't count
 * (lib/survivor/SurvivorFinaleEngine "jurors who did not vote simply do not count"; council ballots
 * the same way). No penalty is applied.
 */
export type SurvivorStateKey =
  | 'idols_before_draft'
  | 'idols_none'
  | 'exile_empty'
  | 'scroll_counting'
  | 'scroll_error'
  | 'ballot_error'
  | 'island_error'
  | 'votes_closed'
  | 'missed_vote'
  | 'spectator'
  | 'paused'
  | 'locked'
  | 'moment_private'

export type SurvivorStateTone = 'empty' | 'loading' | 'error' | 'closed' | 'missed' | 'spectator' | 'paused' | 'locked'

interface StateSpec { tone: SurvivorStateTone; icon: string; title: string; body: string; dim?: boolean }

export const SURVIVOR_STATES: Record<SurvivorStateKey, StateSpec> = {
  idols_before_draft: { tone: 'empty', icon: '/survivor/idols/immunity-icon.svg', dim: true, title: 'No idols yet', body: 'Idols are hidden on players before the draft. If you draft one, the host messages you privately when the last pick is in.' },
  idols_none: { tone: 'empty', icon: '/survivor/exile/scroll-sealed.svg', title: "You didn't find an idol", body: 'Nobody but the holders knows where they are. Watch the scroll for idols being played.' },
  exile_empty: { tone: 'empty', icon: '/survivor/exile/token-empty.svg', title: 'Exile Island is empty', body: 'The first manager voted out lands here and starts earning tokens.' },
  scroll_counting: { tone: 'loading', icon: '/survivor/exile/scroll-sealed.svg', title: 'Counting the votes…', body: 'The scroll opens once every vote is in and idols are resolved.' },
  scroll_error: { tone: 'error', icon: '/survivor/exile/wax-seal-broken.svg', title: "We couldn't open the scroll", body: 'Your connection dropped. The results are safe and nothing was revealed.' },
  ballot_error: { tone: 'error', icon: '/survivor/exile/wax-seal-broken.svg', title: "Your ballot didn't load", body: 'Nothing was sent. Check your connection and try again before votes close.' },
  island_error: { tone: 'error', icon: '/survivor/exile/wax-seal-broken.svg', title: "The island didn't load", body: 'Check your connection and try again. Nothing in your league changed.' },
  votes_closed: { tone: 'closed', icon: '/survivor/weekly/urn.svg', title: 'Votes are closed', body: "Tribal Council results are being read. You'll get a notification when the scroll opens." },
  missed_vote: { tone: 'missed', icon: '/survivor/weekly/torch-lit-icon.svg', title: "Your vote wasn't cast", body: "Votes closed before you voted, so your vote didn't count this week. Turn on reminders so it doesn't happen again." },
  spectator: { tone: 'spectator', icon: '/survivor/weekly/torch-out-icon.svg', title: "You're watching from the sidelines", body: 'Your torch is out. You can still read chat, follow the scroll and see the finale.' },
  paused: { tone: 'paused', icon: '/survivor/late/exile-boss-icon.svg', title: 'The league is paused', body: 'The commissioner paused Survivor events. Lineups and scoring still run. Deadlines move when it resumes.' },
  locked: { tone: 'locked', icon: '/survivor/exile/wax-seal.svg', title: 'This setting is locked', body: 'Tribe count and idols lock when the draft starts so nobody can change the game mid-season.' },
  moment_private: { tone: 'error', icon: '/survivor/late/champion-icon.svg', dim: true, title: 'This league is private', body: "The commissioner turned off public moment pages. Sign in if you're in this league." },
}

const PILL: Record<SurvivorStateTone, { label: string; color?: string }> = {
  empty: { label: 'Empty' },
  loading: { label: 'Loading', color: '#7fd3de' },
  error: { label: 'Error', color: '#ff8a6a' },
  closed: { label: 'Closed' },
  missed: { label: 'Missed', color: '#ff9a3c' },
  spectator: { label: 'Spectator' },
  paused: { label: 'Paused' },
  locked: { label: 'Locked' },
}

export function SurvivorStateCard({ state, children, compact, showPill = false, className }: { state: SurvivorStateKey; children?: ReactNode; compact?: boolean; showPill?: boolean; className?: string }) {
  const spec = SURVIVOR_STATES[state]
  const pill = PILL[spec.tone]
  return <div className={`svk ${className ?? ''}`} style={{ background: 'transparent', minHeight: 0 }} data-testid={`survivor-state-${state}`} role={spec.tone === 'error' ? 'alert' : spec.tone === 'loading' ? 'status' : undefined}>
    {showPill && <span className="svk-pill" style={pill.color ? { color: pill.color, borderColor: pill.color } : undefined}>{pill.label}</span>}
    <div style={compact ? { marginTop: -10, marginBottom: -10 } : undefined}>
      <SvkEmpty icon={spec.icon} title={spec.title} body={spec.body} iconStyle={spec.dim ? { filter: 'grayscale(1) brightness(.75)' } : undefined}>{children}</SvkEmpty>
    </div>
  </div>
}
