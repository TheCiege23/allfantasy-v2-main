'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LeagueSection, CustomizeLeagueLink } from '@/components/league/LeagueDisplayPreferences'
import { ArrowRight, MessageSquare, PlayCircle, Shield } from 'lucide-react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { CommissionerSetupChecklist } from '@/components/league/CommissionerSetupChecklist'
import { GuillotineAutopilotCard } from '@/components/guillotine/GuillotineAutopilotCard'
import { LeagueActivityFeedCard } from '@/components/league/native/LeagueActivityFeedCard'
import { LeagueHealthPanel } from '@/components/league/native/LeagueHealthPanel'
import { LeagueSeatTracker } from '@/components/league/native/LeagueSeatTracker'
import { LeagueStakesCard, stakesFormatFor } from '@/components/league/native/LeagueStakesCard'
import { LeagueYourWeekStrip } from '@/components/league/native/LeagueYourWeekStrip'
import { LeagueRulesHomeHost } from '@/components/league/native/LeagueRulesHomeHost'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { describeEliminationSchedule } from '@/lib/survivor/survivorEliminationSchedule'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'
import { isLeagueEligibleForDispersalDraft } from '@/lib/league/dispersal-draft-eligibility'
import { sortTeamsForManagerListing, type LeagueSeasonSnapshot } from '@/lib/league/sort-teams-standings'

function DraftCountdown({ dateIso }: { dateIso: string | null }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const date = dateIso ? new Date(dateIso).getTime() : NaN
  const seconds = now != null && Number.isFinite(date) ? Math.max(0, Math.floor((date - now) / 1000)) : null
  const parts = seconds == null ? ['—', '—', '—', '—'] : [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0'))
  return <div className="nl-draft-countdown" aria-label={seconds == null ? 'Draft time not set' : 'Time until draft'}>{parts.map((value, i) => <div key={i}><strong>{value}</strong><span>{['Days', 'Hours', 'Minutes', 'Seconds'][i]}</span></div>)}</div>
}

export function NativeLeagueHome({ league, teams, userTeamId, isCommissioner, draftDateIso, snapshot, settingsOpen, onOpenSettings, onSelectTab, inviteCode = '' }: {
  league: UserLeague
  teams: UserLeagueTeam[]
  userTeamId: string | null
  isCommissioner: boolean
  draftDateIso: string | null
  snapshot: LeagueSeasonSnapshot | null
  settingsOpen: boolean
  onOpenSettings: (panel?: string | null) => void
  onSelectTab: (id: string) => void
  /** The league's invite code (settings.inviteCode, else the newest active invite token). */
  inviteCode?: string
}) {
  const phase = nativeLeaguePhase(league)
  const predraft = phase === 'Setup' || phase === 'Draft'
  const inSeason = phase === 'Regular season' || phase === 'Playoffs'
  const survivor = league.leagueVariant === 'survivor' || league.format.toLowerCase() === 'survivor'
  const plan = readSurvivorFullSeasonPlan(league.settings)
  const survivorRules = survivor ? normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null) : null
  const hostOnly = isCommissioner && (league.settings as Record<string, unknown> | null)?.commissionerParticipationMode === 'non_participating_host'
  const team = teams.find(row => row.id === userTeamId)
  const claimedSeats = teams.filter(row => row.claimedByUserId).length
  // Seats matter until the league is full or drafted; after that the card would only take space.
  const showSeats = predraft || claimedSeats < league.teamCount
  const stakesFormat = stakesFormatFor(league)
  const standings = sortTeamsForManagerListing(teams, league, snapshot).slice(0, 6)
  const date = draftDateIso ? new Date(draftDateIso) : null
  /*
   * Handoff §3: the third pre-draft tile is the Supplemental draft — late joiners and dispersal
   * pools, commissioner-run. In this repo that is the dispersal draft (specs 02–05_SUPPLEMENTAL_DRAFT_*
   * named /supplemental-draft/setup; what shipped is /league/:id/dispersal-draft/setup, gated to
   * dynasty-style leagues by isLeagueEligibleForDispersalDraft). A redraft league cannot run one, so
   * its commissioner keeps the Draft settings tile rather than a link to a page that refuses them.
   */
  const supplementalEligible = isLeagueEligibleForDispersalDraft({ isDynasty: Boolean(league.isDynasty), leagueType: league.leagueType ?? null, leagueVariant: league.leagueVariant ?? null })
  const supplementalTile = supplementalEligible
    ? isCommissioner
      ? <Link href={`/league/${encodeURIComponent(league.id)}/dispersal-draft/setup`} data-testid="native-home-supplemental"><h3>Supplemental draft</h3><p>Late joiners and dispersal pools. Commissioner-run.</p></Link>
      : <div data-testid="native-home-supplemental"><h3>Supplemental draft</h3><p>Late joiners and dispersal pools. Your commissioner runs it.</p></div>
    : isCommissioner
      ? <button type="button" onClick={() => onOpenSettings('draft')}><h3>Draft settings</h3><p>Order, clock, and manager readiness.</p></button>
      : null
  const draftLabel = date && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Schedule or start manually'
  return <div className="nl-home" data-testid="native-league-home">
    <div className="nl-home-primary">
      <CustomizeLeagueLink returnTo={`/league/${encodeURIComponent(league.id)}`} className="nl-text-link" />
      {/* League rules: the button, the first-time popup and the "What changed" card. League home only. */}
      <LeagueRulesHomeHost leagueId={league.id} blocked={settingsOpen} />
      <LeagueSection id="week">{inSeason &&<LeagueYourWeekStrip leagueId={league.id} week={typeof league.currentWeek === 'number' ? league.currentWeek : null} onSelectTab={onSelectTab} />}</LeagueSection>
      {predraft ? <section className="nl-card nl-draft-feature" data-testid="native-draft-feature">
        <div className="nl-card-label"><span>Draft board</span><span>AF Draft HQ</span></div>
        <h2>{date && Number.isFinite(date.getTime()) ? 'Your draft is scheduled' : 'Your draft is not scheduled yet'}</h2>
        <p>{date && Number.isFinite(date.getTime()) ? draftLabel : 'Get ready, set your rankings, and gather your league.'}</p>
        <DraftCountdown dateIso={draftDateIso} />
        <div className="nl-actions">
          <Link className="nl-button" href={`/mock-draft?leagueId=${encodeURIComponent(league.id)}&sport=${encodeURIComponent(league.sport)}&teams=${league.teamCount}`}>Mock drafts</Link>
          <button type="button" className="nl-button" onClick={() => onSelectTab('draft')}>Draft HQ</button>
          <Link className="nl-button" href={`/league/${encodeURIComponent(league.id)}/draft`}>Draft board</Link>
          {isCommissioner && <button type="button" className="nl-button nl-primary" onClick={() => onOpenSettings('draft')}>{date && Number.isFinite(date.getTime()) ? 'Change draft time' : 'Set draft time'}</button>}
        </div>
        <LeagueSection id="draft"><div className="nl-quick-grid"><Link href={`/league/${encodeURIComponent(league.id)}/draft`}><h3>Queue & rankings</h3><p>Prepare your picks before the draft.</p></Link>{supplementalTile}</div></LeagueSection>
      </section> :       <section className="nl-card nl-next"><div className="nl-card-label"><span>Next up</span><span>{predraft ? 'Draft HQ' : survivor ? 'Survivor' : phase}</span></div>
        <h2>{survivor ? 'Your island this week' : phase === 'Offseason' ? 'Your season archive' : `Week ${league.currentWeek ?? '—'}`}</h2>
        <p>{survivor ? 'Check the challenge, immunity, Elimination Council, and your private powers.' : phase === 'Offseason' ? 'Review final standings and prepare for the next season.' : 'Set your lineup and follow the latest matchup scores.'}</p>
        <div className="nl-actions">{predraft ? <><button type="button" className="nl-button nl-primary" onClick={() => onSelectTab('draft')}>Enter Draft HQ <ArrowRight size={16} aria-hidden /></button><Link className="nl-button" href={`/league/${encodeURIComponent(league.id)}/draft`}>Draft board</Link></> : <button type="button" className="nl-button nl-primary" onClick={() => onSelectTab(survivor ? 'survivor' : phase === 'Offseason' ? 'standings' : 'matchups')}>{survivor ? 'Open Survivor' : phase === 'Offseason' ? 'Final standings' : 'Open matchup'}<ArrowRight size={16} aria-hidden /></button>}</div>
        <LeagueSection id="draft">{predraft && <div className="nl-quick-grid"><Link href={`/mock-draft?leagueId=${encodeURIComponent(league.id)}&sport=${encodeURIComponent(league.sport)}&teams=${league.teamCount}`}><h3>Mock draft</h3><p>Practice with this league’s exact settings.</p></Link><Link href={`/league/${encodeURIComponent(league.id)}/draft`}><h3>Queue & rankings</h3><p>Rank players and build your queue before the draft.</p></Link>{supplementalTile}</div>}</LeagueSection>
      </section>
}
      <LeagueSection id="format">{stakesFormat && <LeagueStakesCard leagueId={league.id} format={stakesFormat} onSelectTab={onSelectTab} />}</LeagueSection>
      <LeagueSection id="format">{stakesFormat === 'guillotine' && <GuillotineAutopilotCard leagueId={league.id} sport={String(league.sport)} isCommissioner={isCommissioner} onOpenSettings={onOpenSettings} onSelectTab={onSelectTab} />}</LeagueSection>
      <LeagueSection id="managers">{showSeats && <LeagueSeatTracker teams={teams} teamCount={league.teamCount} userTeamId={userTeamId} leagueName={league.name} inviteCode={inviteCode} canInvite={isCommissioner} onOpenInviteSettings={() => onOpenSettings('invite')} />}</LeagueSection>
      <LeagueSection id="commissioner">{isCommissioner && predraft && <CommissionerSetupChecklist leagueId={league.id} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} />}</LeagueSection>
      <LeagueSection id="commissioner">{isCommissioner && !predraft && <LeagueHealthPanel leagueId={league.id} claimedSeats={teams.filter(row => row.claimedByUserId).length} teamCount={league.teamCount} onOpenSettings={onOpenSettings} onSelectTab={onSelectTab} />}</LeagueSection>
      <LeagueSection id="format">{survivor && <section className="nl-card"><div className="nl-card-label"><span>Survivor season</span><Shield size={16} aria-hidden /></div><h2>Outwit. Outplay. Outlast.</h2>{plan && <p>Full season · Weeks {plan.startWeek}–{plan.endWeek} · {describeEliminationSchedule(plan.eliminationWeeks)} · Final 3 in week {plan.finaleWeek}. Opening and non-elimination periods keep your season paced through the final week.</p>}<p>Your league’s saved rules govern tribes, challenges, private votes, elimination, and the finale.</p>{plan && <p>{survivorRules?.tieRule === 'rocks_immediately' ? 'A tied council goes straight to rocks: a recorded random draw among the tied managers.' : survivorRules?.tieRule === 'revote_then_season_points' ? 'A tied council opens a two-hour revote for managers outside the tie. Another tie goes to season points; an exact points tie needs a logged host decision.' : survivorRules?.tieRule === 'season_points_only' ? 'A tied council is resolved by season points under this league’s saved rule.' : 'A tied council opens a two-hour revote for managers outside the tie. Another tie goes to rocks: a recorded random draw among the tied managers.'} Chimmy announces the result at the Torch Ceremony.</p>}<div className="nl-actions"><button type="button" className="nl-button" onClick={() => onSelectTab('survivor_challenges')}>Challenges</button><button type="button" className="nl-button" onClick={() => onSelectTab('survivor_tribal')}>Elimination Council</button><button type="button" className="nl-button" onClick={() => onSelectTab('survivor_jury')}>Jury & finale</button></div></section>}</LeagueSection>
      <LeagueSection id="activity"><LeagueActivityFeedCard leagueId={league.id} onOpenChat={() => onSelectTab('league_chat')} /></LeagueSection>
      {/* The intro overlay promises "replay it from League Home"; this is the only place that could. */}
      <button type="button" className="nl-text-link" onClick={() => window.dispatchEvent(new CustomEvent('af:replay-league-intro', { detail: { leagueId: league.id } }))} data-testid="native-home-replay-intro"><PlayCircle size={15} aria-hidden /> Watch the league intro</button>
    </div>
    <aside className="nl-home-secondary" aria-label="League overview"><LeagueSection id="team"><section className="nl-card"><div className="nl-card-label">Your team</div><h2>{team?.teamName || (hostOnly ? 'Commissioner host' : 'Join a team')}</h2>{team ? <><dl className="nl-team-stats"><div><dt>Record</dt><dd>{team.wins}–{team.losses}{team.ties ? `–${team.ties}` : ''}</dd></div><div><dt>PF</dt><dd>{team.pointsFor.toFixed(1)}</dd></div><div><dt>FAAB</dt><dd>{team.faabRemaining ?? '—'}</dd></div></dl><div className="nl-actions"><button type="button" className="nl-button" onClick={() => onSelectTab('roster')}>My team</button><button type="button" className="nl-button" onClick={() => onSelectTab('players')}>Players</button></div></> : <p>{hostOnly ? 'You are hosting this season without a playing team. Manage invitations, rules, and league readiness from Commissioner.' : 'Ask your commissioner for a team invitation.'}</p>}</section></LeagueSection>
      <LeagueSection id="chat"><section className="nl-card nl-chat-preview"><div className="nl-card-label"><span>League chat</span><MessageSquare size={16} aria-hidden /></div><h2>Your league, together</h2><p>Announcements, draft discussion, and league conversation.</p><button type="button" className="nl-button" onClick={() => onSelectTab('league_chat')}>Open league chat</button></section></LeagueSection>
      <LeagueSection id="standings"><section className="nl-card"><div className="nl-card-label"><span>Standings</span><button type="button" className="nl-text-link" onClick={() => onSelectTab('standings')}>Full table</button></div><ol className="nl-standings-preview">{standings.map((row, index) => <li key={row.id} data-own-team={row.id === userTeamId}><span>{index + 1}</span><strong>{row.teamName}</strong><span>{row.wins}–{row.losses}{row.ties ? `–${row.ties}` : ''}</span></li>)}</ol>{!standings.length && <p>Standings appear when teams are ready.</p>}</section></LeagueSection>
    </aside>
  </div>
}
