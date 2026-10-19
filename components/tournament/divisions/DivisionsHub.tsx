'use client'
/**
 * The divisions & conferences hub: DivisionStandings (default + conferences),
 * DivisionWildcard, DivisionBracket, DivisionChampionship and MobileDivision.
 *
 * ⚠ DISPLAY ONLY. Every rank, seed, line and winner arrives computed in `view`
 * (lib/tournament/divisions/hubView.ts). Nothing here sorts or seeds.
 */
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { REGIONS, type Region } from '@/lib/tournament/divisions/engine'
import { crestFor, markPath, side } from '@/lib/tournament/divisions/identity'
import type { HubDivision, HubGame, HubPoolRow, HubRow, HubView } from '@/lib/tournament/divisions/hubView'
import { ConferenceIcon, DivisionBadge, DivisionCrest } from './DivisionArt'
import { RosterLabel, ScoringLabel } from '@/components/league-labels'
import { divisionsRulesLabels } from '@/lib/tournament/divisions/rules'

export type HubScreen = 'standings' | 'wildcard' | 'bracket' | 'championship'
type View = HubScreen
type StandingsTab = 'lines' | 'top16' | 'mine' | 'conferences'

const card = 'rounded-2xl border border-white/10 bg-[#0b0d14]'
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n))
const initials = (name: string) => (name.match(/[A-Z0-9]/g)?.slice(0, 2).join('') || name.slice(0, 2)).toUpperCase()
const record = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}${r.ties ? '-' + r.ties : ''}`
/** Points after record is the standings' own ordering, not a tiebreak, so it carries no label. */
const TIE_LABEL: Record<string, string | undefined> = { record: 'tie · record', best_week: 'tie · best week', review: 'tie · commissioner review' }

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} onClick={() => onChange(v)}
          className={'min-h-11 rounded-lg px-3 text-sm font-semibold ' + (v === value ? 'bg-[#1a1c26] text-[#ffd98a] shadow-[inset_0_-2px_0_#e8b84a]' : 'text-slate-300 hover:text-white')}>{text}</button>
      ))}
    </div>
  )
}

function StatusChip({ status }: { status: HubRow['status'] }) {
  const map = {
    auto: ['AUTO BID', 'bg-[#10291e] text-[#6fe0a8]'],
    wildcard: ['WILDCARD', 'bg-[#33290f] text-[#ffd98a]'],
    bubble_out: ['BUBBLE · OUT', 'bg-[#341418] text-[#ff9a9a]'],
    out: ['OUT', 'bg-[#1a1c26] text-slate-400'],
  } as const
  const [text, cls] = map[status]
  return <span className={'whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black tracking-wider ' + cls}>{text}</span>
}

function LineMarker({ text, tone }: { text: string; tone: 'green' | 'gold' }) {
  const c = tone === 'green' ? '#6fe0a8' : '#e8b84a'
  return (
    <li aria-label={text} className="relative my-2 flex items-center justify-center" role="separator">
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t-2 border-dashed" style={{ borderColor: c }} />
      <span className="relative rounded-md px-2 py-0.5 text-[11px] font-black tracking-widest text-[#0b0d14]" style={{ background: c }}>{text}</span>
    </li>
  )
}

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1d2233] text-[11px] font-black text-slate-200">{initials(name)}</span>
}

function TeamName({ row, meLabel = true }: { row: { name: string; isMe: boolean }; meLabel?: boolean }) {
  return <span className={'truncate font-semibold ' + (row.isMe ? 'text-[#ffd98a]' : 'text-white')}>{row.isMe && meLabel ? `You · ${row.name}` : row.name}</span>
}

// ── header ───────────────────────────────────────────────────────────────────

function HubHeader({ view, myDivision }: { view: HubView; myDivision: HubDivision | null }) {
  const me = view.me
  const myRow = me && myDivision ? myDivision.rows.find(r => r.id === me.teamId) : null
  const conf = view.identity.conferences[me?.conferenceIndex ?? 0] ?? view.identity.conferences[0]!
  const div = view.identity.divisions[me?.divisionIndex ?? 0]
  const total = view.divisions[0].teamCount + view.divisions[1].teamCount
  const leagues = view.identity.conferences.length * 2
  const sub = myRow
    ? `Week ${view.weeksPlayed} of ${view.calendar.regularSeason.end} · You’re #${myRow.rank} in ${myDivision!.name}${myRow.status === 'auto' ? ' — holding an automatic bid' : myRow.status === 'wildcard' ? ' — on the wildcard bubble' : myRow.status === 'bubble_out' ? ' — just outside the wildcard line' : ''}`
    : `Week ${view.weeksPlayed} of ${view.calendar.regularSeason.end}`
  const s = view.settings
  const rules = divisionsRulesLabels(view.tournament.sport, view.rules)
  return (
    <header className="relative overflow-hidden rounded-2xl border border-white/10 p-5 sm:p-6" style={{ background: `linear-gradient(100deg, ${side(div.sideId).dark}cc, #0b0d14 55%)` }}>
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <DivisionCrest art={crestFor(div, conf)} size={150} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2 text-[13px]">
            <span className="rounded-md bg-[#1a1c26] px-2 py-1 text-slate-200">{view.tournament.sport}{view.tournament.season ? ' ' + view.tournament.season : ''}</span>
            <span className="rounded-md bg-[#1a1c26] px-2 py-1 text-slate-200">Divisions &amp; conferences</span>
            <span className="rounded-md bg-[#1a1c26] px-2 py-1 text-slate-200">{total} teams · {leagues} leagues</span>
            <span className="inline-flex items-center rounded-md bg-[#1a1c26] px-2 py-1 text-slate-200" data-testid="hub-rules-chip">
              <ScoringLabel id={rules.scoringId} size="sm" />
              <span aria-hidden className="mx-2 text-slate-500">·</span>
              <RosterLabel id={rules.rosterId} size="sm" />
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">{view.identity.divisions[0].name} vs {view.identity.divisions[1].name}</h1>
          <p className="font-semibold text-[#ffd98a]">{sub}</p>
          <p className="max-w-3xl text-sm text-slate-300">Everyone in a division is ranked by record, then points. The top {s.autoBids} get automatic bids. Ranks {s.autoBids + 1}–{s.autoBids + s.wildcardSpots} and the {s.wildcardSpots} highest scorers below them fight for {s.wildcardSpots} wildcard spots on points.</p>
          {view.sample && <p className="text-sm font-semibold text-amber-300">Preview with invented sample data.</p>}
        </div>
        <div className={card + ' shrink-0 px-6 py-4 text-center'}>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffd98a]">Seeding locks after</p>
          <p className="text-4xl font-bold text-white" style={mono}>Week {view.calendar.seedingLocksAfter}</p>
          <p className="text-sm text-slate-400">Bracket starts week {view.calendar.bracketStartWeek}</p>
        </div>
      </div>
    </header>
  )
}

// ── standings ────────────────────────────────────────────────────────────────

function StandingsRow({ row, view }: { row: HubRow; view: HubView }) {
  const conf = view.identity.conferences[row.conferenceIndex]
  return (
    <li className={'grid min-h-12 grid-cols-[2.25rem_1fr_auto] items-center gap-2 rounded-xl border px-3 py-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_3.5rem_5rem_8rem] ' + (row.isMe ? 'border-[#e8b84a]/70 bg-[#1f1a0d]' : 'border-white/5 bg-[#0e1018]')}>
      <span className="text-right text-sm text-slate-400" style={mono}>{row.rank}</span>
      <span className="flex min-w-0 items-center gap-2"><Avatar name={row.name} /><span className="min-w-0"><TeamName row={row} />{row.tiebreak && TIE_LABEL[row.tiebreak] && <span className="block text-[11px] text-slate-400">{TIE_LABEL[row.tiebreak]}</span>}</span></span>
      <span className="hidden min-w-0 items-center gap-1.5 text-sm text-slate-300 sm:flex">{conf && <ConferenceIcon image={conf.image} />}<span className="truncate">{conf?.name}</span></span>
      <span className="hidden text-sm text-slate-200 sm:block" style={mono}>{record(row)}</span>
      <span className="hidden text-right text-sm text-white sm:block" style={mono}>{fmt(row.points)}</span>
      <span className="flex flex-col items-end gap-0.5 sm:items-center"><StatusChip status={row.status} /><span className="text-[11px] text-slate-400 sm:hidden" style={mono}>{record(row)} · {fmt(row.points)}</span></span>
    </li>
  )
}

function StandingsList({ rows, view, division, markers }: { rows: HubRow[]; view: HubView; division: HubDivision; markers: boolean }) {
  const s = view.settings
  const items: ReactNode[] = []
  rows.forEach((row, i) => {
    items.push(<StandingsRow key={row.id} row={row} view={view} />)
    const next = rows[i + 1]
    if (markers && next && row.rank === s.autoBids) items.push(<LineMarker key="auto" text={`AUTOMATIC BIDS · TOP ${s.autoBids}`} tone="green" />)
    if (markers && next && row.rank === s.autoBids + s.wildcardSpots) items.push(<LineMarker key="bubble" text={`WILDCARD BUBBLE ENDS · ${s.autoBids + s.wildcardSpots}`} tone="gold" />)
  })
  return (
    <div>
      <div className="hidden grid-cols-[2.5rem_minmax(0,1fr)_9rem_3.5rem_5rem_8rem] gap-2 px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 sm:grid" aria-hidden="true">
        <span className="text-right">#</span><span>Team</span><span>Conference</span><span>W-L</span><span className="text-right">Points</span><span className="text-center">Status</span>
      </div>
      <ol className="space-y-1.5" aria-label={`${division.name} division standings`}>{items}</ol>
      {rows.length === 0 && <p className="p-6 text-center text-slate-400">No teams in this division yet. Standings fill in once the conference leagues are placed.</p>}
    </div>
  )
}

function ConferencesGrid({ division, view }: { division: HubDivision; view: HubView }) {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {division.conferences.map(c => (
          <li key={c.conferenceIndex} className="flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-[#0e1018] p-3 text-center">
            <DivisionCrest art={c.crest} size={130} label={c.leagueName} />
            <p className="font-extrabold text-white">{c.leagueName}</p>
            <p className="text-sm text-slate-300" style={mono}>{fmt(c.points)} pts</p>
            <span className="rounded-full bg-[#33290f] px-2.5 py-1 text-[11px] font-black tracking-wider text-[#ffd98a]">{c.inBracket} OF {c.teams || view.settings.teamsPerConference} IN</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-slate-400">Conference points add up every team’s season points. They’re for bragging rights and the conference trophy; they don’t change seeding.</p>
    </div>
  )
}

function WildcardCard({ view, division, onOpen }: { view: HubView; division: HubDivision; onOpen: () => void }) {
  const me = view.me
  const row = me ? division.rows.find(r => r.id === me.teamId) : null
  const pool = me ? division.pool.rows.find(r => r.id === me.teamId) : null
  if (!row) return null
  const headline = row.status === 'auto' ? 'Automatic bid' : pool ? `${pool.in ? 'In' : 'Out'} · #${pool.poolRank} of ${division.pool.rows.length}` : 'Outside the pool'
  const body = row.status === 'auto'
    ? `You’re ${record(row)} with ${fmt(row.points)} points, inside the top ${view.settings.autoBids}.`
    : pool
      ? `You’re ${record(row)} with ${fmt(row.points)} points. In the wildcard pool only points count, and you’re ${pool.in ? `inside the top ${division.pool.spots}` : `${fmt(Math.abs(pool.toLine))} behind the line`}.`
      : `You’re ${record(row)} with ${fmt(row.points)} points. Climb the standings or the scoring list to reach the wildcard pool.`
  return (
    <section className={card + ' border-[#e8b84a]/50 p-4'}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffd98a]">Your wildcard spot</p>
          <p className="text-3xl font-black text-white">{headline}</p>
        </div>
        <div className="text-right"><p className="text-2xl font-black text-white" style={mono}>#{row.rank}</p><p className="text-xs text-slate-400">of {division.teamCount}</p></div>
      </div>
      <p className="mt-2 text-sm text-slate-300">{body}</p>
      <button type="button" onClick={onOpen} className="mt-3 min-h-11 w-full rounded-xl border border-white/15 bg-[#141724] font-bold text-white">See the wildcard bubble</button>
    </section>
  )
}

function HowSeeding({ view }: { view: HubView }) {
  const s = view.settings
  const size = view.divisions[0].teamCount || s.conferencesPerDivision * s.teamsPerConference
  const lines = (s.autoBids + s.wildcardSpots) / 4
  return (
    <section className={card + ' p-4'}>
      <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">How seeding works</h3>
      <ol className="mt-2 space-y-2 text-sm text-slate-200">
        {[`Rank all ${size} teams in a division by wins, then points.`, `Ranks 1–${s.autoBids} get automatic bids: seeds 1–${s.autoBids / 4}, four per seed line.`, `Wildcard pool: ranks ${s.autoBids + 1}–${s.autoBids + s.wildcardSpots} plus the ${s.wildcardSpots} top scorers from ${s.autoBids + s.wildcardSpots + 1}–${size}.`, `The pool is ranked by points only. The top ${s.wildcardSpots} take seeds ${s.autoBids / 4 + 1}–${lines}.`, 'Seed lines snake across North, East, South and West.'].map((t, i) => (
          <li key={i} className="flex gap-3"><span className="font-bold text-[#e8b84a]">{i + 1}</span><span>{t}</span></li>
        ))}
      </ol>
    </section>
  )
}

function StandingsView({ view, divisionIndex, setDivision, openWildcard }: { view: HubView; divisionIndex: 0 | 1; setDivision: (d: 0 | 1) => void; openWildcard: () => void }) {
  const [tab, setTab] = useState<StandingsTab>('lines')
  const division = view.divisions[divisionIndex]
  const s = view.settings
  const myConf = view.me?.divisionIndex === divisionIndex ? view.me.conferenceIndex : 0
  const lo = Math.max(1, s.autoBids - 6), hi = s.autoBids + s.wildcardSpots + 6
  const rows = tab === 'lines' ? division.rows.filter(r => r.rank >= lo && r.rank <= hi)
    : tab === 'top16' ? division.rows.slice(0, 16)
    : division.rows.filter(r => r.conferenceIndex === myConf)
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className={card + ' min-w-0 p-3 sm:p-4'}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Seg label="Division" value={String(divisionIndex) as '0' | '1'} onChange={v => setDivision(Number(v) as 0 | 1)} options={[['0', `${view.divisions[0].name} division`], ['1', `${view.divisions[1].name} division`]]} />
          <Seg label="Standings view" value={tab} onChange={setTab} options={[['lines', 'Around the lines'], ['top16', 'Top 16'], ['mine', 'My conference'], ['conferences', 'Conferences']]} />
        </div>
        {tab === 'conferences' ? <ConferencesGrid division={division} view={view} /> : <StandingsList rows={rows} view={view} division={division} markers={tab !== 'mine'} />}
      </section>
      <aside className="space-y-4">
        <WildcardCard view={view} division={view.divisions[view.me?.divisionIndex ?? divisionIndex]} onOpen={openWildcard} />
        <HowSeeding view={view} />
      </aside>
    </div>
  )
}

// ── wildcard ─────────────────────────────────────────────────────────────────

function PoolRow({ row, view }: { row: HubPoolRow; view: HubView }) {
  const conf = view.identity.conferences[row.conferenceIndex]
  return (
    <li className={'grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_9.5rem_3.5rem_5rem_4.5rem] ' + (row.isMe ? 'border-[#e8b84a]/70 bg-[#1f1a0d]' : 'border-white/5 bg-[#0e1018]')}>
      <span className="text-right text-sm text-slate-400" style={mono}>{row.poolRank}</span>
      <span className="min-w-0"><span className="block truncate"><TeamName row={row} /><span className="text-slate-300"> · {conf?.name}</span></span>{row.poolTiebreak && TIE_LABEL[row.poolTiebreak] && <span className="block text-[11px] text-slate-400">{TIE_LABEL[row.poolTiebreak]}</span>}</span>
      <span className={'hidden w-fit whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-black tracking-wider sm:inline ' + (row.via === 'bubble' ? 'bg-[#33290f] text-[#ffd98a]' : 'bg-[#13243a] text-[#9cc8ff]')}>{row.via === 'bubble' ? 'BUBBLE' : 'TOP SCORER'} · #{row.divisionRank}</span>
      <span className="hidden text-sm text-slate-200 sm:block" style={mono}>{record(row)}</span>
      <span className="hidden text-right text-sm text-white sm:block" style={mono}>{fmt(row.points)}</span>
      <span className={'text-right text-sm font-bold ' + (row.toLine >= 0 ? 'text-[#6fe0a8]' : 'text-[#ff8a8a]')} style={mono}>{signed(row.toLine)}</span>
    </li>
  )
}

function WildcardView({ view, divisionIndex, setDivision, back }: { view: HubView; divisionIndex: 0 | 1; setDivision: (d: 0 | 1) => void; back: () => void }) {
  const division = view.divisions[divisionIndex]
  const s = view.settings
  const items: ReactNode[] = []
  division.pool.rows.forEach((row, i) => {
    items.push(<PoolRow key={row.id} row={row} view={view} />)
    if (row.poolRank === division.pool.spots && division.pool.rows[i + 1]) items.push(<LineMarker key="line" tone="gold" text={`WILDCARD LINE · TOP ${s.wildcardSpots} GET SEEDS ${s.autoBids / 4 + 1}–${(s.autoBids + s.wildcardSpots) / 4}`} />)
  })
  return (
    <div className="space-y-5">
      <SubHeader back={back} division={division} title={`Wildcard bubble · ${division.name} division`} sub={`${division.pool.rows.length} teams, ${division.pool.spots} spots, ranked on season points only · locks after week ${view.calendar.seedingLocksAfter}`}
        right={<Seg label="Division" value={String(divisionIndex) as '0' | '1'} onChange={v => setDivision(Number(v) as 0 | 1)} options={[['0', view.divisions[0].name], ['1', view.divisions[1].name]]} />} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className={card + ' min-w-0 p-3 sm:p-4'}>
          <div className="hidden grid-cols-[2.5rem_minmax(0,1fr)_9.5rem_3.5rem_5rem_4.5rem] gap-2 px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 sm:grid" aria-hidden="true">
            <span className="text-right">WC</span><span>Team</span><span>How they got here</span><span>W-L</span><span className="text-right">Points</span><span className="text-right">To line</span>
          </div>
          <ol className="space-y-1.5" aria-label={`${division.name} wildcard pool`}>{items}</ol>
          {division.pool.rows.length === 0 && <p className="p-6 text-center text-slate-400">The wildcard pool forms once standings have teams in it.</p>}
        </section>
        <aside className="space-y-4">
          <section className={card + ' border-[#e8b84a]/50 p-5'}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffd98a]">Line to beat</p>
            <p className="text-5xl font-bold text-white" style={mono}>{division.pool.lineToBeat === null ? '—' : fmt(division.pool.lineToBeat)}</p>
            <p className="mt-2 text-sm text-slate-300">The {ordinal(division.pool.spots)}-best score in the pool right now.</p>
          </section>
          <section className={card + ' p-4'}>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Who’s in the pool</h3>
            <ol className="mt-2 space-y-2 text-sm text-slate-200">
              {[`Ranks ${s.autoBids + 1}–${s.autoBids + s.wildcardSpots} by record (the bubble).`, `Plus the ${s.wildcardSpots} highest scorers from ranks ${s.autoBids + s.wildcardSpots + 1}–${division.teamCount} — a bad record can still sneak in.`, 'Everyone in the pool is re-ranked by points only.', 'Ties on points: better record, then best single week, then commissioner review.'].map((t, i) => (
                <li key={i} className="flex gap-3"><span className="font-bold text-[#e8b84a]">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
            <p className="mt-3 inline-block rounded-md border border-dashed border-[#e8b84a]/60 px-2 py-1 text-sm text-[#ffd98a]">Pool sizes are set by the commissioner</p>
          </section>
        </aside>
      </div>
    </div>
  )
}

const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th')

function SubHeader({ back, division, title, sub, right }: { back: () => void; division: HubDivision; title: string; sub: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-4">
      <button type="button" onClick={back} aria-label="Back to standings" className="grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-[#0e1018] text-xl text-white">‹</button>
      <DivisionBadge division={division} size={60} />
      <div className="min-w-0 flex-1"><h2 className="text-2xl font-bold text-white sm:text-4xl">{title}</h2><p className="text-slate-300">{sub}</p></div>
      {right}
    </header>
  )
}

// ── bracket ──────────────────────────────────────────────────────────────────

function GameCard({ game, label, view }: { game: HubGame | undefined; label: string; view: HubView }) {
  const final = Boolean(game?.winnerId)
  const live = !final && game?.scoreA != null
  const hasMe = game?.a?.isMe || game?.b?.isMe
  const entrantRow = (e: HubGame['a'], score: number | null) => {
    if (!e) return <div className="flex min-h-10 items-center justify-center text-sm text-slate-500">TBD</div>
    const lost = final && game!.winnerId !== e.id
    const conf = view.identity.conferences[e.conferenceIndex]
    return (
      <div className={'flex min-h-10 items-center gap-2 px-3 ' + (lost ? 'opacity-55' : '')}>
        <span className="w-5 text-right text-sm text-slate-400" style={mono}>{e.seedLine}</span>
        {conf && <ConferenceIcon image={conf.image} size={18} />}
        <span className={'min-w-0 flex-1 truncate text-sm font-semibold ' + (e.isMe ? 'text-[#ffd98a]' : 'text-white')}>{e.isMe ? `You · ${e.name}` : e.name}</span>
        <span className={'text-sm ' + (live ? 'text-[#6fe0a8]' : lost ? 'text-slate-400' : 'text-[#ffd98a]')} style={mono}>{score === null ? '' : fmt(score)}</span>
      </div>
    )
  }
  return (
    <div className={'w-56 overflow-hidden rounded-xl border bg-[#0e1018] ' + (hasMe ? 'border-[#e8b84a]' : live ? 'border-[#6fe0a8]/50' : 'border-white/10')}>
      <div className="flex justify-between px-3 pt-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500"><span>{label}</span><span className={live ? 'text-[#6fe0a8]' : ''}>{final ? (game!.decidedBy && game!.decidedBy !== 'score' ? `final · ${game!.decidedBy.replace('_', ' ')}` : 'final') : live ? 'live' : ''}</span></div>
      {entrantRow(game?.a ?? null, game?.scoreA ?? null)}
      <div className="border-t border-white/5" />
      {entrantRow(game?.b ?? null, game?.scoreB ?? null)}
    </div>
  )
}

function BracketView({ view, divisionIndex, setDivision, back, openChampionship }: { view: HubView; divisionIndex: 0 | 1; setDivision: (d: 0 | 1) => void; back: () => void; openChampionship: () => void }) {
  const division = view.divisions[divisionIndex]
  const myRegion = (() => {
    if (view.me?.divisionIndex !== divisionIndex) return 'North' as Region
    for (const r of REGIONS) if (division.regions[r]?.[0]?.some(g => g.a?.isMe || g.b?.isMe)) return r
    return 'North' as Region
  })()
  const [region, setRegion] = useState<Region>(myRegion)
  const rounds = division.regions[region] ?? []
  const weeks = view.calendar.weeks
  const bracketSize = view.settings.autoBids + view.settings.wildcardSpots
  return (
    <div className="space-y-5">
      <SubHeader back={back} division={division} title={`${division.name} bracket · ${region} region`} sub={`${bracketSize} teams · ${bracketSize / 4} per region${division.seeded ? '' : ' · projected once standings fill the field'}`}
        right={<div className="flex flex-wrap gap-2">
          <Seg label="Division" value={String(divisionIndex) as '0' | '1'} onChange={v => setDivision(Number(v) as 0 | 1)} options={[['0', view.divisions[0].name], ['1', view.divisions[1].name]]} />
          <Seg label="Region" value={region} onChange={setRegion} options={REGIONS.map(r => [r, r] as [Region, string])} />
        </div>} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 overflow-x-auto pb-2" aria-label={`${region} region bracket`}>
          {!division.seeded ? <p className={card + ' p-6 text-slate-300'}>The bracket appears once every division has enough teams to fill {bracketSize} seeds. Seeding locks after week {view.calendar.seedingLocksAfter}.</p> : (
            <div className="flex gap-4">
              {rounds.map((games, ri) => (
                <div key={ri} className="flex shrink-0 flex-col">
                  <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{weeks[ri]?.label} · wk {weeks[ri]?.week}</p>
                  <ol className="flex flex-1 flex-col justify-around gap-3">
                    {games.map(g => <li key={g.index}><GameCard game={g} view={view} label={`${weeks[ri]?.label} · wk ${weeks[ri]?.week}`} /></li>)}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="space-y-4">
          <section className={card + ' p-4'}>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Road to the title</h3>
            <ol className="mt-2 space-y-2">
              <li className="flex gap-4"><span className="w-20 shrink-0 whitespace-nowrap text-[#ffd98a]" style={mono}>Wk {view.calendar.regularSeason.start}-{view.calendar.regularSeason.end}</span><span className="text-white">Regular season · conference leagues</span></li>
              {weeks.map(w => <li key={w.week} className="flex gap-4"><span className="w-20 shrink-0 whitespace-nowrap text-[#ffd98a]" style={mono}>Wk {w.week}</span><span className="text-white">{w.kind === 'championship' ? `Championship · ${view.divisions[0].name} vs ${view.divisions[1].name}` : w.field <= 4 ? `${division.name} ${w.label.replace('Division ', '').toLowerCase()}` : w.label}</span></li>)}
            </ol>
          </section>
          <section className={card + ' p-4'}>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Region winners</h3>
            <p className="mt-2 text-sm text-slate-200">The four region champions play the {division.name} final four in week {weeks.at(-3)?.week} and the division final in week {weeks.at(-2)?.week}. The two division champions meet in week {weeks.at(-1)?.week}.</p>
            {division.finals.length > 0 && (
              <ol className="mt-3 space-y-2">
                {division.finals.flat().map(g => <li key={`${g.round}-${g.index}`}><GameCard game={g} view={view} label={g.round === Math.max(...division.finals.flat().map(x => x.round)) ? 'Division final' : 'Final four'} /></li>)}
              </ol>
            )}
            <button type="button" onClick={openChampionship} className="mt-3 min-h-12 w-full rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">See the championship</button>
          </section>
        </aside>
      </div>
    </div>
  )
}

// ── championship ─────────────────────────────────────────────────────────────

function Trophy() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
      <defs><linearGradient id="dv-cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#b8862b" /></linearGradient></defs>
      <path d="M32 18h56v18c0 18-12 32-28 32S32 54 32 36z" fill="url(#dv-cup)" stroke="#5a4210" strokeWidth="3" />
      <path d="M32 26H18c0 14 6 22 16 24M88 26h14c0 14-6 22-16 24" fill="none" stroke="#c99a3a" strokeWidth="5" />
      <path d="M60 30l4.5 9 10 1.5-7.2 7 1.7 10-9-4.7-9 4.7 1.7-10-7.2-7 10-1.5z" fill="#fff6d8" stroke="#5a4210" strokeWidth="2" />
      <rect x="54" y="68" width="12" height="14" fill="#c99a3a" /><rect x="40" y="82" width="40" height="10" rx="2" fill="url(#dv-cup)" stroke="#5a4210" strokeWidth="2" /><rect x="34" y="92" width="52" height="8" rx="2" fill="#2a2010" />
    </svg>
  )
}

function ChampionshipView({ view, back }: { view: HubView; back: () => void }) {
  const game = view.championship
  const week = view.calendar.lastWeek
  const [dA, dB] = view.identity.divisions
  const totals = view.divisions.map(d => d.rows.reduce((s, r) => s + r.points, 0))
  const sideBlock = (e: HubGame['a'], score: number | null, idx: 0 | 1) => {
    const d = view.identity.divisions[idx]
    const conf = e ? view.identity.conferences[e.conferenceIndex]! : view.identity.conferences[0]!
    const lost = game?.winnerId && e && game.winnerId !== e.id
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <DivisionCrest art={crestFor(d, conf)} size={220} />
        <p className="text-2xl font-black text-white">{e ? e.name : `${d.name} champion`}</p>
        <p className="text-sm text-slate-300">{e ? `${conf.name} ${d.name} · #${e.seedLine} seed · ${e.region}` : 'Decided in the division final'}</p>
        <p className={'text-6xl font-bold ' + (lost ? 'text-slate-400' : 'text-white')} style={mono}>{score === null ? '—' : fmt(score)}</p>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <button type="button" onClick={back} aria-label="Back to standings" className="grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-[#0e1018] text-xl text-white">‹</button>
      <section className="rounded-3xl border border-white/10 p-6 sm:p-10" style={{ background: `radial-gradient(ellipse at 20% 40%, ${side(dA.sideId).dark}88, transparent 55%), radial-gradient(ellipse at 80% 40%, ${side(dB.sideId).dark}88, transparent 55%), #0b0d14` }}>
        <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-[#ffd98a]">Week {week} · Championship{game?.scoreA != null && !game.winnerId ? ' · live' : game?.winnerId ? ' · final' : ''}</p>
        <h2 className="mt-2 text-center text-4xl font-black tracking-tight text-white sm:text-6xl">{dA.name} vs {dB.name}</h2>
        <div className="mt-8 grid items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
          {sideBlock(game?.a ?? null, game?.scoreA ?? null, 0)}
          <div className="flex flex-col items-center gap-2" aria-hidden="true">
            {/* The pack's championship mark has "BLACK" and "GOLD" baked in, so it is used only for that pair. */}
            {dA.sideId === 'black' && dB.sideId === 'gold' && dA.name === 'Black' && dB.name === 'Gold'
              ? <img src={markPath('championship')} alt="" width={160} height={90} className="w-40" />
              : <Trophy />}
            <span className="text-3xl font-black text-slate-500">VS</span>
          </div>
          {sideBlock(game?.b ?? null, game?.scoreB ?? null, 1)}
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {([0, 1] as const).map(i => {
            const other = 1 - i
            const lead = Math.round(totals[i]! - totals[other]!)
            return (
              <div key={i} className={card + ' flex items-center gap-4 p-4'}>
                <DivisionBadge division={view.identity.divisions[i]} size={56} />
                <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Division pride</p>
                  <p className="text-white">{lead > 0 ? `${view.identity.divisions[i].name} leads total division points by ${lead.toLocaleString('en-US')}.` : `${view.identity.divisions[i].name} has ${Math.round(totals[i]!).toLocaleString('en-US')} total division points.`}</p></div>
              </div>
            )
          })}
        </div>
        <p className="mt-6 text-center text-sm text-slate-400">Both champions keep the rosters they drafted in week 1. Their division and conference crests appear on the trophy page.</p>
      </section>
    </div>
  )
}

// ── phone ────────────────────────────────────────────────────────────────────

function MobileDivision({ view, openBracket }: { view: HubView; openBracket: () => void }) {
  const me = view.me
  if (!me) return null
  const division = view.divisions[me.divisionIndex]
  const row = division.rows.find(r => r.id === me.teamId)
  if (!row) return null
  const pool = division.pool.rows.find(r => r.id === me.teamId)
  const conf = view.identity.conferences[me.conferenceIndex]!
  const d = view.identity.divisions[me.divisionIndex]
  const near = division.pool.rows.filter(r => r.poolRank >= division.pool.spots - 2 && r.poolRank <= division.pool.spots + 3)
  const showMine = pool && !near.some(r => r.id === pool.id)
  const pill = row.status === 'auto' ? 'AUTO BID' : pool ? `WILDCARD ${pool.in ? 'IN' : 'OUT'} · #${pool.poolRank}` : 'OUTSIDE THE POOL'
  const line = (r: HubPoolRow) => (
    <li key={r.id} className={'flex min-h-12 items-center gap-3 rounded-xl border px-4 ' + (r.isMe ? 'border-[#e8b84a]/70 bg-[#1f1a0d]' : 'border-white/5 bg-[#0e1018]')}>
      <span className="w-6 text-slate-400" style={mono}>{r.poolRank}</span><TeamName row={r} /><span className="ml-auto text-slate-200" style={mono}>{fmt(r.points)}</span>
    </li>
  )
  return (
    <section className="space-y-4 md:hidden" aria-label="Your division at a glance">
      <div className="flex items-center gap-3">
        <DivisionCrest art={crestFor(d, conf)} size={96} label={`${conf.name} ${d.name}`} />
        <div className="min-w-0"><p className="truncate text-2xl font-black text-white">{conf.name} {d.name}</p><p className="text-slate-400">{view.identity.divisions[0].name} vs {view.identity.divisions[1].name} · week {view.weeksPlayed} of {view.calendar.regularSeason.end}</p></div>
      </div>
      <div className="rounded-2xl border border-[#e8b84a]/50 bg-[#0b0d14] p-4">
        <div className="flex flex-wrap items-center gap-2"><span className="text-5xl font-black text-white">#{row.rank}</span><span className="text-slate-400">in {d.name}</span><span className="ml-auto rounded-full bg-[#33290f] px-3 py-1 text-[13px] font-black tracking-wider text-[#ffd98a]">{pill}</span></div>
        <p className="mt-2 text-slate-300">{record(row)} · {fmt(row.points)} pts. Top {view.settings.autoBids} get in automatically.{pool ? ' You’re in the wildcard pool, where only points count.' : ''}</p>
      </div>
      {division.pool.rows.length > 0 && <>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Wildcard line</p>
        <ol className="space-y-2">
          {showMine && <>{line(pool!)}<li aria-hidden="true" className="text-center tracking-[0.5em] text-slate-500">···</li></>}
          {near.map((r, i) => [line(r), r.poolRank === division.pool.spots && near[i + 1] ? <LineMarker key="m" tone="gold" text={`TOP ${division.pool.spots} IN`} /> : null])}
        </ol>
      </>}
      <div className="grid gap-3">
        {me.leagueId && <Link href={`/league/${me.leagueId}`} className="grid min-h-12 place-items-center rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">Set lineup</Link>}
        <button type="button" onClick={openBracket} className="min-h-12 rounded-xl border border-white/15 bg-[#0e1018] font-bold text-white">Bracket preview</button>
      </div>
    </section>
  )
}

// ── shell ────────────────────────────────────────────────────────────────────

export function DivisionsHub({ view, initialScreen = 'standings', canManage = false }: { view: HubView; initialScreen?: View; canManage?: boolean }) {
  const [screen, setScreen] = useState<View>(initialScreen)
  const [divisionIndex, setDivisionIndex] = useState<0 | 1>(view.me?.divisionIndex ?? 0)
  const myDivision = view.me ? view.divisions[view.me.divisionIndex] : null
  const back = () => setScreen('standings')
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] space-y-5 bg-[#07080d] px-4 py-5 text-white sm:px-6">
      <nav aria-label="Tournament screens" className="flex flex-wrap items-center gap-3">
        <Seg label="Tournament screens" value={screen} onChange={setScreen} options={[['standings', 'Standings'], ['wildcard', 'Wildcard'], ['bracket', 'Bracket'], ['championship', 'Championship']]} />
        {!view.sample && <span className="flex flex-wrap gap-2">
          {canManage && <Link href={`/tournament-hub/${view.tournament.id}/control`} className="grid min-h-11 place-items-center rounded-xl border border-white/15 px-4 text-sm font-semibold">Seeding and round control</Link>}
          {['registering', 'blueprint'].includes(view.tournament.status) && <Link href={`/tournament-hub/${view.tournament.id}/join`} className="grid min-h-11 place-items-center rounded-xl border border-white/15 px-4 text-sm font-semibold">Invite page</Link>}
          {view.me && view.divisions.every(d => d.seedingCommitted) && <Link href={`/tournament-trophy/${view.tournament.id}?entry=${encodeURIComponent(view.me.teamId)}`} className="grid min-h-11 place-items-center rounded-xl border border-white/15 px-4 text-sm font-semibold">My share card</Link>}
        </span>}
      </nav>
      {screen === 'standings' && <>
        <MobileDivision view={view} openBracket={() => setScreen('bracket')} />
        <HubHeader view={view} myDivision={myDivision} />
        <StandingsView view={view} divisionIndex={divisionIndex} setDivision={setDivisionIndex} openWildcard={() => setScreen('wildcard')} />
      </>}
      {screen === 'wildcard' && <WildcardView view={view} divisionIndex={divisionIndex} setDivision={setDivisionIndex} back={back} />}
      {screen === 'bracket' && <BracketView view={view} divisionIndex={divisionIndex} setDivision={setDivisionIndex} back={back} openChampionship={() => setScreen('championship')} />}
      {screen === 'championship' && <ChampionshipView view={view} back={back} />}
    </main>
  )
}
