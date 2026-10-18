'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MessageSquare, PlayCircle, Settings, Shield } from 'lucide-react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { CommissionerSetupChecklist } from '@/components/league/CommissionerSetupChecklist'
import { LeagueSeatTracker } from '@/components/league/native/LeagueSeatTracker'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { idolDefinition } from '@/lib/survivor/survivorIdolCatalog'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { SURVIVOR_MOOD_TAG, resolveSurvivorMood, survivorBackgroundSrc } from '@/lib/survivor/survivorMood'
import { survivorIdolArt, survivorIdolTypeIdForPower } from '@/lib/survivor/survivorIdolTypes'
import { SurvivorMoodScene } from './SurvivorMoodScene'
import type { SurvivorSummary, SurvivorSummaryTribe } from './types'
import './survivor-home.css'

const TRIBE_COLORS = ['#b8a8ff', '#7fd3de', '#f0a35e', '#8fd694']
const TRIBE_BARS = [
  'linear-gradient(90deg,#5a4aa8,#8b7be0)',
  'linear-gradient(90deg,#2f8f9e,#3fa7b5)',
  'linear-gradient(90deg,#a8592a,#e0894a)',
  'linear-gradient(90deg,#3f8a4a,#6fbf7a)',
]

type Props = {
  league: UserLeague
  teams: UserLeagueTeam[]
  userTeamId: string | null
  isCommissioner: boolean
  draftDateIso: string | null
  settingsOpen: boolean
  onOpenSettings: (panel?: string | null) => void
  onSelectTab: (id: string) => void
  inviteCode?: string
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  const last = words[words.length - 1]
  // "Open Team 12" reads as O12, the way the seat list numbers it.
  if (/^\d+$/.test(last)) return `${words[0][0]}${last}`.toUpperCase()
  return (words[0][0] + last[0]).toUpperCase()
}

function useCountdown(targetIso: string | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  const target = targetIso ? new Date(targetIso).getTime() : NaN
  useEffect(() => {
    if (!Number.isFinite(target)) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [target])
  if (!Number.isFinite(target)) return null
  const left = Math.max(0, Math.floor((target - now) / 1000))
  const days = Math.floor(left / 86400)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(Math.floor((left % 86400) / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

/** Re-reads the clock once a minute so the island mood turns over on its own (dusk → day, night → day). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function easternLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return `${date.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

/** The Survivor league home inside the native league workspace (survivor-core handoff, SurvivorHome). */
export function SurvivorNativeHome({ league, teams, userTeamId, isCommissioner, draftDateIso, settingsOpen, onOpenSettings, onSelectTab, inviteCode = '' }: Props) {
  const [summary, setSummary] = useState<SurvivorSummary | null>(null)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/survivor/summary`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setSummary(await res.json())
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [league.id])

  useEffect(() => { void load() }, [load])

  const plan = readSurvivorFullSeasonPlan(league.settings)
  const names = summary?.rosterDisplayNames ?? {}
  const tribes = useMemo(() => (summary?.tribes ?? []).filter(tribe => tribe.members.length > 0), [summary?.tribes])
  const tribesFormed = tribes.length > 0
  const claimedSeats = teams.filter(row => row.claimedByUserId).length
  const votedOut = new Set((summary?.votedOutHistory ?? []).map(row => row.rosterId).filter(Boolean))
  const castLeft = tribesFormed ? tribes.reduce((sum, tribe) => sum + tribe.members.length, 0) : null

  const council = summary?.council && !summary.council.closedAt && !summary.council.isRevealed ? summary.council : null
  const attending = council ? tribes.find(tribe => tribe.id === council.attendingTribeId) ?? null : null
  const canVote = Boolean(council && summary?.myRosterId && (summary.merged || !attending || summary.myTribeId === attending.id))
  const draftPending = !tribesFormed
  const countdownTarget = council?.voteDeadlineAt ?? (draftPending ? draftDateIso : null)
  const clock = useCountdown(countdownTarget)

  const scores = summary?.tribeScores ?? {}
  const memberScores = summary?.memberScores ?? {}
  const immune = new Set(summary?.immunityRosterIds ?? [])
  const raced = tribes.filter(tribe => !summary?.merged && tribe.id !== 'merged')
  const hasScores = raced.some(tribe => (scores[tribe.id] ?? 0) > 0)
  const sortedRace = [...raced].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))
  const leader = hasScores ? sortedRace[0] : null
  // An open council names the tribe going; until then the lowest total is the one headed there.
  const trailer = attending ?? (hasScores && sortedRace.length > 1 ? sortedRace[sortedRace.length - 1] : null)
  const raceTotal = raced.reduce((sum, tribe) => sum + Math.max(0, scores[tribe.id] ?? 0), 0)

  // The mood follows league state (survivor-theme handoff): dusk on vote-deadline day, night while
  // the votes are read, day otherwise. Exile screens set their own.
  const minute = useMinuteClock()
  const mood = resolveSurvivorMood({
    now: minute,
    voteDeadlineAt: council?.voteDeadlineAt,
    revealStartsAt: summary?.council?.isRevealed ? summary.council.revealStartsAt : null,
  })
  const scene = survivorBackgroundSrc(mood, league.sport)
  const tribeColor = (tribe: SurvivorSummaryTribe, index: number) => tribe.colorHex || TRIBE_COLORS[(tribe.slotIndex ?? index) % TRIBE_COLORS.length]
  const tribeName = (tribe: SurvivorSummaryTribe) => stripLeadingTribeIcon(tribe.name) || tribe.name

  const week = summary?.currentWeek ?? (typeof league.currentWeek === 'number' ? league.currentWeek : 0)
  const draftLabel = easternLabel(draftDateIso)
  const headline = draftPending
    ? draftLabel
      ? `The draft opens ${draftLabel}. ${claimedSeats} of ${league.teamCount} castaways are in. Tribes are drawn the moment the draft ends.`
      : `${claimedSeats} of ${league.teamCount} castaways are in. Set a draft time; tribes are drawn the moment the draft ends.`
    : council && attending
      ? `Week ${week} · Tribe ${tribeName(attending)} goes to Tribal Council.${leader && leader.id !== attending.id ? ` ${tribeName(leader)} won the tribe race.` : ''}`
      : council
        ? `Week ${week} · Tribal Council is open.`
        : summary?.merged
          ? `Week ${week} · The tribes have merged. Individual immunity is everything now.`
          : leader
            ? `Week ${week} · ${tribeName(leader)} leads the tribe race.${trailer ? ` ${tribeName(trailer)} is headed for Tribal Council.` : ''}`
            : `Week ${week || 1} · ${tribes.length} tribes are on the island. Points start counting with the first game.`

  const primary: { label: string; href: string } | { label: string; onClick: () => void } = draftPending
    ? { label: 'Enter the draft room', href: `/league/${encodeURIComponent(league.id)}/draft` }
    : canVote
      ? { label: 'Cast your vote', href: `/survivor/${encodeURIComponent(league.id)}/tribal` }
      : { label: 'Open the island', onClick: () => onSelectTab('survivor') }

  const feed = buildFeed(summary, names)

  return <div className="svh" data-testid="survivor-native-home">
    <section className="svh-hero" data-testid="survivor-home-hero" data-mood={mood}>
      <SurvivorMoodScene className="svh-hero-bg" src={scene} />
      <div className="svh-hero-veil" aria-hidden />
      <div className="svh-hero-in">
        <div className="svh-hero-copy">
          <div className="svh-chips">
            <span>{league.sport}</span>
            <span>{league.season ?? new Date().getFullYear()}</span>
            <span>Survivor</span>
            <span>{castLeft == null ? `${claimedSeats} of ${league.teamCount} seats claimed` : `${league.teamCount} managers · ${castLeft} left`}</span>
          </div>
          <span className="svh-kicker" data-testid="survivor-mood-tag">{SURVIVOR_MOOD_TAG[mood]}</span>
          <h1 className="svh-title">{league.name}</h1>
          <p className="svh-headline">{headline}</p>
          <div className="svh-actions">
            {'href' in primary
              ? <Link className="svh-btn svh-btn-gold" href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden /></Link>
              : <button type="button" className="svh-btn svh-btn-gold" onClick={primary.onClick}>{primary.label}<ArrowRight size={16} aria-hidden /></button>}
            {!draftPending && <button type="button" className="svh-btn" onClick={() => onSelectTab('survivor')}>Island</button>}
            {isCommissioner && <Link className="svh-btn" href={`/survivor/${encodeURIComponent(league.id)}/commissioner`} data-testid="survivor-home-commissioner-hub"><Shield size={16} aria-hidden />Commissioner hub</Link>}
            <button type="button" className="svh-btn" onClick={() => onOpenSettings(isCommissioner ? 'survivor_setup' : null)}><Settings size={16} aria-hidden />Settings</button>
          </div>
        </div>
        {clock && <div className="svh-clock" role="timer" aria-live="off">
          <span className="svh-lbl svh-ember">{council ? 'Votes close in' : 'Draft starts in'}</span>
          <span className="svh-clock-num">{clock}</span>
          <span className="svh-faint">{council ? easternLabel(council.voteDeadlineAt) : draftLabel}</span>
        </div>}
      </div>
    </section>

    <div className="svh-body">
      <section className="svh-main">
        {draftPending ? <>
          <LeagueSeatTracker teams={teams} teamCount={league.teamCount} userTeamId={userTeamId} leagueName={league.name} inviteCode={inviteCode} canInvite={isCommissioner} onOpenInviteSettings={() => onOpenSettings('invite')} />
          <div className="svh-card svh-pad">
            <div className="svh-row"><span className="svh-lbl svh-grow">The season</span><span className="svh-faint svh-sm">{plan ? `Weeks ${plan.startWeek}–${plan.endWeek}` : 'Full NBA season'}</span></div>
            <ol className="svh-steps">
              <li><strong>Draft</strong><span>{league.teamCount}-team snake draft. Build your queue; autopick uses it when your clock runs out.</span></li>
              <li><strong>Tribes</strong><span>{summary?.config?.tribeCount ?? 4} tribes are drawn at random when the draft ends, each with a private chat.</span></li>
              <li><strong>Idols</strong><span>{summary?.config?.idolCount ?? 6} idols hide on drafted NBA players. Chimmy tells holders privately.</span></li>
              <li><strong>Tribal Council</strong><span>{plan ? `${plan.eliminationWeeks.length} votes, the first in week ${plan.eliminationWeeks[0]}.` : 'The lowest-scoring tribe votes someone out.'} Vote privately with @Chimmy.</span></li>
              <li><strong>Exile, merge, jury</strong><span>{plan ? `One exile returns in week ${plan.exileReturnWeek}. The jury crowns a winner from the final ${plan.finalistCount} in week ${plan.finaleWeek}.` : 'Voted-out managers fight on from Exile Island; the jury picks the winner.'}</span></li>
            </ol>
          </div>
          {isCommissioner && <CommissionerSetupChecklist leagueId={league.id} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} />}
        </> : <>
          {raced.length > 1 && <div className="svh-card svh-pad svh-race-card" data-testid="survivor-tribe-race">
            <div className="svh-row"><span className="svh-lbl svh-grow">Tribe race · week {week}</span><span className="svh-faint svh-sm">Lowest tribe total goes to Tribal Council</span></div>
            <div className="svh-race-legend">{raced.map((tribe, index) => <span key={tribe.id} style={{ color: tribeColor(tribe, index) }}><b className="svh-tribe-name">{tribeName(tribe)}</b> <span className="svh-num">{(scores[tribe.id] ?? 0).toFixed(1)}</span></span>)}</div>
            <div className="svh-race" aria-hidden>{raced.map((tribe, index) => <span key={tribe.id} style={{ flexGrow: raceTotal > 0 ? Math.max(0.02, (scores[tribe.id] ?? 0) / raceTotal) : 1, background: TRIBE_BARS[(tribe.slotIndex ?? index) % TRIBE_BARS.length] }} />)}</div>
            <span className="svh-sub svh-sm">{leader && trailer && leader.id !== trailer.id
              ? `${tribeName(leader)} leads by ${((scores[leader.id] ?? 0) - (scores[sortedRace[1]?.id ?? leader.id] ?? 0)).toFixed(1)}. ${tribeName(trailer)} ${summary?.scoresFinalized ? 'heads' : 'is headed'} to Tribal Council.${[...immune].map(id => names[id]).filter(Boolean).length ? ` ${[...immune].map(id => names[id]).filter(Boolean).join(', ')} has immunity.` : ''}`
              : 'Scores appear once this week’s games tip off.'}</span>
          </div>}
          <div className="svh-tribes" data-count={tribes.length % 3 === 0 && tribes.length > 1 ? 3 : 2}>
            {tribes.map((tribe, index) => {
              const color = tribeColor(tribe, index)
              const going = council?.attendingTribeId === tribe.id || (!council && trailer?.id === tribe.id)
              const members = [...tribe.members].sort((a, b) => (memberScores[b.rosterId] ?? -1) - (memberScores[a.rosterId] ?? -1))
              return <div key={tribe.id} className="svh-card svh-tribe" style={{ borderColor: going ? 'rgba(255,154,60,.4)' : `${color}59` }} data-testid="survivor-tribe-column">
                <div className="svh-row">
                  {tribe.logoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="svh-crest" src={tribe.logoUrl} alt="" />
                    : <span className="svh-crest svh-crest-emoji" aria-hidden>{tribe.emoji ?? '🔥'}</span>}
                  <div className="svh-grow"><span className="svh-tribe-title" style={{ color }}>{tribeName(tribe)}</span><span className="svh-faint svh-sm">{summary?.merged ? 'Merged tribe' : going ? (council ? 'Going to Tribal Council' : 'Last in the race') : leader?.id === tribe.id ? 'Leading the race' : 'Safe this week'}</span></div>
                  {!summary?.merged && hasScores && <span className="svh-num svh-sub">{(scores[tribe.id] ?? 0).toFixed(1)}</span>}
                </div>
                {members.map(member => {
                  const name = names[member.rosterId] ?? 'Castaway'
                  const isImmune = immune.has(member.rosterId)
                  const out = votedOut.has(member.rosterId)
                  const score = memberScores[member.rosterId]
                  return <div key={member.rosterId} className="svh-mem" data-immune={isImmune} data-out={out} data-you={member.rosterId === summary?.myRosterId}>
                    <span className="svh-av" style={{ ['--ring' as string]: isImmune ? '#f2c94c' : out ? '#4a4f5c' : color }}>{initials(name)}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {isImmune && <img className="svh-av-badge" src="/survivor/weekly/immunity-necklace-icon.svg" alt="Immunity" />}
                    </span>
                    <span className="svh-grow svh-mem-name"><span className="svh-mem-text">{name}</span>{member.rosterId === summary?.myRosterId && <span className="svh-you">You</span>}</span>
                    <span className="svh-num svh-sub svh-sm">{typeof score === 'number' ? score.toFixed(1) : '—'}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="svh-torch" src={out ? '/survivor/weekly/torch-out-icon.svg' : '/survivor/weekly/torch-lit-icon.svg'} alt={out ? 'Torch out' : 'Torch lit'} />
                  </div>
                })}
              </div>
            })}
          </div>
        </>}
        {loadError && !summary && <div className="svh-card svh-pad"><p className="svh-sub">The island didn’t load. <button type="button" className="svh-link" onClick={() => void load()}>Try again</button></p></div>}
      </section>

      <aside className="svh-rail" aria-label="Your Survivor status">
        <div className="svh-card2 svh-pad svh-idols" data-testid="survivor-home-idols">
          {summary?.myIdols?.length
            ? summary.myIdols.slice(0, 2).map(idol => <div key={idol.id} className="svh-row svh-idol">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={survivorIdolArt(survivorIdolTypeIdForPower(idol.powerType) ?? 'immunity') ?? '/survivor/idols/immunity.svg'} alt="" />
              <div className="svh-grow"><span className="svh-lbl svh-gold">Your idols · private</span><strong className="svh-idol-name" style={{ color: idolDefinition(idol.powerType).glow }}>{idolDefinition(idol.powerType).name}</strong><span className="svh-sub svh-sm">{idol.playerName ? `Hidden on ${idol.playerName}. It moves with him if he changes teams.` : 'Only you can see this.'}</span></div>
            </div>)
            : <div className="svh-row svh-idol">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/survivor/idols/immunity.svg" alt="" style={{ opacity: draftPending ? 0.55 : 0.35 }} />
              <div className="svh-grow"><span className="svh-lbl svh-gold">Your idols · private</span><strong>{draftPending ? 'Idols hide after the draft' : 'No idols on your roster'}</strong><span className="svh-sub svh-sm">{draftPending ? `${summary?.config?.idolCount ?? 6} idols are attached to drafted NBA players. If one lands on your roster, Chimmy tells you privately.` : 'Idols travel with their player. A trade could bring one to you.'}</span></div>
            </div>}
          {!draftPending && <button type="button" className="svh-btn svh-btn-sm" onClick={() => onSelectTab('survivor')}>Vault</button>}
        </div>

        <div className="svh-card svh-pad">
          <div className="svh-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/survivor/exile/token-icon.svg" alt="" width={24} height={24} />
            <span className="svh-lbl svh-grow">Exile Island{summary?.exileTokens?.length ? ` · ${summary.exileTokens.length} ${summary.exileTokens.length === 1 ? 'manager' : 'managers'}` : ''}</span>
            {!draftPending && <button type="button" className="svh-link" onClick={() => onSelectTab('survivor_exile')}>Open ›</button>}
          </div>
          {summary?.exileTokens?.length
            ? summary.exileTokens.map(token => {
              const need = summary.config.exileReturnTokens || 1
              return <div key={token.rosterId} className="svh-row svh-sm">
                <span className="svh-grow svh-sub">{token.displayName}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <span className="svh-coins">{Array.from({ length: Math.min(token.tokens, 5) }, (_, i) => <img key={i} src="/survivor/exile/token-icon.svg" alt="" />)}</span>
                <span className="svh-num svh-faint">{token.tokens}/{need}</span>
              </div>
            })
            : <p className="svh-sub svh-sm">{draftPending ? 'Voted-out managers keep playing here for tokens. The top exile returns' + (plan ? ` in week ${plan.exileReturnWeek}.` : '.') : 'Nobody is on Exile yet.'}</p>}
        </div>

        <div className="svh-card svh-pad svh-feed-card">
          <span className="svh-lbl">Latest</span>
          {feed.length
            ? feed.map((item, index) => <div key={index} className="svh-feed">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.icon} alt="" />
              <div className="svh-grow"><strong>{item.title}</strong><span className="svh-faint svh-sm">{item.sub}</span></div>
            </div>)
            : <p className="svh-sub svh-sm">Immunity wins, torches snuffed and Exile tokens show up here as the season plays out.</p>}
          <div className="svh-actions svh-actions-tight">
            <button type="button" className="svh-btn svh-btn-sm" onClick={() => onSelectTab('league_chat')}><MessageSquare size={15} aria-hidden />League chat</button>
            <button type="button" className="svh-link" onClick={() => window.dispatchEvent(new CustomEvent('af:replay-league-intro', { detail: { leagueId: league.id } }))}><PlayCircle size={15} aria-hidden /> Watch the intro</button>
          </div>
        </div>
      </aside>
    </div>
  </div>
}

function buildFeed(summary: SurvivorSummary | null, names: Record<string, string>) {
  if (!summary) return []
  const items: { icon: string; title: string; sub: string; week: number }[] = []
  for (const id of summary.immunityRosterIds ?? []) {
    if (names[id]) items.push({ icon: '/survivor/weekly/immunity-necklace-icon.svg', title: `${names[id]} won immunity`, sub: `Week ${summary.currentWeek}`, week: summary.currentWeek + 0.5 })
  }
  for (const challenge of summary.challenges ?? []) {
    if (challenge.resultSummary) items.push({ icon: '/survivor/weekly/immunity-necklace-icon.svg', title: challenge.title || 'Challenge result', sub: `Week ${challenge.week} · ${challenge.resultSummary}`, week: challenge.week })
  }
  for (const token of summary.exileTokens ?? []) {
    if (token.tokens > 0 && token.lastAwardedWeek) items.push({ icon: '/survivor/exile/token-icon.svg', title: `${token.displayName} earned a token`, sub: `Exile Island · week ${token.lastAwardedWeek}`, week: token.lastAwardedWeek })
  }
  for (const row of summary.votedOutHistory ?? []) {
    if (row.rosterId && names[row.rosterId]) items.push({ icon: '/survivor/weekly/torch-out-icon.svg', title: `${names[row.rosterId]}’s torch is out`, sub: `Week ${row.week ?? '—'}`, week: row.week ?? 0 })
  }
  return items.sort((a, b) => b.week - a.week).slice(0, 4)
}
