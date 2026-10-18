'use client'
/**
 * Plan a tournament · step 1 of 4 — choose between the points race (the existing
 * planner) and divisions & conferences. TournamentFormat.png / --points.png.
 */
import { useId, type ReactNode } from 'react'
import { SETTING_OPTIONS, divisionsCalendar, validateFormatSettings, DEFAULT_SEASON_LENGTH, type FormatSettings } from '@/lib/tournament/divisions/engine'
import { DivisionBadge } from './DivisionArt'

export type TournamentFormatId = 'points_race' | 'divisions'
export type PointsRaceChoice = { sport: 'NFL' | 'NBA'; participants: number }
export const POINTS_FIELD_SIZES = [64, 96, 128, 160] as const

const card = 'rounded-2xl border border-white/10 bg-[#0b0d14]'

function Seg<T extends string | number>({ label, value, options, onChange, format }: { label: string; value: T; options: readonly T[]; onChange?: (v: T) => void; format?: (v: T) => string }) {
  const id = useId()
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-[#0e1018] p-4">
      <p className="mb-2 text-sm text-slate-400" id={id}>{label}</p>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
        {options.map(o => (
          <button key={String(o)} type="button" role="radio" aria-checked={o === value} disabled={!onChange}
            onClick={() => onChange?.(o)}
            className={'min-h-11 min-w-11 rounded-lg px-3 text-sm font-bold transition-colors ' + (o === value ? 'bg-[#1a1c26] text-[#ffd98a] shadow-[inset_0_-2px_0_#e8b84a]' : 'text-slate-300 hover:text-white')}>
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Flow({ steps, gold }: { steps: string[]; gold: number[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Format flow">
      {steps.map((s, i) => (
        <li key={s + i} className="flex items-center gap-1">
          <span className={'rounded-lg px-3 py-2 text-sm font-bold ' + (gold.includes(i) ? 'bg-[#4a3b1a] text-[#ffe2a0]' : 'bg-[#141724] text-slate-100')}>{s}</span>
          {i < steps.length - 1 && <span aria-hidden="true" className="text-slate-500">›</span>}
        </li>
      ))}
    </ol>
  )
}

function FormatCard({ selected, onSelect, icon, title, subtitle, children }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className={card + ' flex min-w-0 flex-col gap-4 p-5 sm:p-6 ' + (selected ? 'border-[#e8b84a] bg-gradient-to-b from-[#1a160c] to-[#0b0d14] shadow-[0_0_0_3px_rgba(232,184,74,0.12)]' : '')}>
      <div className="flex items-start gap-4">
        {icon}
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h2>
          <p className="text-slate-300">{subtitle}</p>
        </div>
        <button type="button" onClick={onSelect} aria-pressed={selected}
          className={'min-h-11 shrink-0 rounded-full px-4 text-xs font-black uppercase tracking-widest ' + (selected ? 'bg-[#3a2f12] text-[#ffd98a]' : 'bg-[#141724] text-slate-300 hover:text-white')}>
          {selected ? 'Selected' : 'Choose'}
        </button>
      </div>
      {children}
    </section>
  )
}

function PointsIcon() {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="60" height="52" rx="10" fill="#141724" />
      <rect x="10" y="12" width="36" height="5" rx="2.5" fill="#6fe0a8" /><rect x="10" y="22" width="30" height="5" rx="2.5" fill="#6fe0a8" />
      <rect x="10" y="32" width="22" height="4" rx="2" fill="#5a6078" /><rect x="10" y="40" width="18" height="4" rx="2" fill="#5a6078" />
      <path d="M50 26l7 4-7 4z" fill="#e8b84a" />
    </svg>
  )
}

const Rules = ({ items }: { items: string[] }) => (
  <ol className="space-y-2 text-[15px] text-slate-200">
    {items.map((t, i) => <li key={i} className="flex gap-3"><span className="font-bold text-[#e8b84a]">{i + 1}</span><span>{t}</span></li>)}
  </ol>
)

export function TournamentFormatPicker({ format, onFormat, settings, onSettings, points, onPoints, onContinue }: {
  format: TournamentFormatId
  onFormat: (f: TournamentFormatId) => void
  settings: FormatSettings
  onSettings: (s: FormatSettings) => void
  points: PointsRaceChoice
  onPoints: (p: PointsRaceChoice) => void
  onContinue: () => void
}) {
  const report = validateFormatSettings(settings)
  const calendar = divisionsCalendar(settings)
  const set = <K extends keyof FormatSettings>(k: K, v: FormatSettings[K]) => onSettings({ ...settings, [k]: v })
  const pointsLeagues = Math.ceil(points.participants / 32) * 4
  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-2">
        <FormatCard selected={format === 'points_race'} onSelect={() => onFormat('points_race')} icon={<PointsIcon />} title="Points race" subtitle="Global points, mass cuts and redrafts">
          <Flow steps={[`Stage 1 · ${points.participants}`, 'Cut', `Redraft · ${points.participants / 2}`, 'Cut', `Redraft · ${points.participants / 4}`, 'Bracket']} gold={[1, 3, 5]} />
          <Rules items={['Every entrant is in one points race across all leagues.', 'Top half advances at each cut. Pools don’t reserve spots.', 'Advancers redraft into new leagues. Scores reset.', 'One cross-league bracket at the end.']} />
          <p className="text-sm text-slate-400">Best for: open or public tournaments, mixed-skill fields, 64–192 entrants</p>
        </FormatCard>
        <FormatCard selected={format === 'divisions'} onSelect={() => onFormat('divisions')} icon={<DivisionBadge division={{ name: 'Divisions', sideId: 'angelic', emblem: 'angel' }} size={72} label="" />} title="Divisions & conferences" subtitle="Two named divisions, conference leagues, regional brackets">
          <Flow steps={['2 divisions', `${settings.conferencesPerDivision} conferences each`, 'Record standings', 'Auto bids + wildcard', '4 regions', 'Division A vs B']} gold={[3, 5]} />
          <Rules items={['Two divisions you name, each split into conference leagues of 8–14.', 'One draft per league. No redrafts. Rosters carry into the bracket.', 'Standings rank everyone in a division by record, then points.', 'Automatic bids plus a wildcard bubble decided on points.', 'Four regions per division, then the two division champions meet.']} />
          <p className="text-sm text-slate-400">Best for: established communities with rivalries, 96–336 entrants</p>
        </FormatCard>
      </div>

      {format === 'divisions' ? (
        <section className={card + ' space-y-4 p-5 sm:p-6'} aria-labelledby="div-settings">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="div-settings" className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Divisions &amp; conferences · settings</h2>
            <span className="rounded-lg border border-white/15 px-3 py-1 text-sm text-slate-200">{report.totalTeams} entrants · {report.leagues} leagues</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Seg label="Sport" value={settings.sport} options={['NFL', 'NBA'] as const} onChange={v => onSettings({ ...settings, sport: v, seasonLength: DEFAULT_SEASON_LENGTH[v] })} />
            <Seg label="Conferences per division" value={settings.conferencesPerDivision} options={SETTING_OPTIONS.conferencesPerDivision} onChange={v => set('conferencesPerDivision', v)} />
            <Seg label="Teams per conference" value={settings.teamsPerConference} options={SETTING_OPTIONS.teamsPerConference} onChange={v => set('teamsPerConference', v)} />
            <Seg label="Automatic bids per division" value={settings.autoBids} options={SETTING_OPTIONS.autoBids} onChange={v => set('autoBids', v)} />
            <Seg label="Wildcard spots per division" value={settings.wildcardSpots} options={SETTING_OPTIONS.wildcardSpots} onChange={v => set('wildcardSpots', v)} />
            <Seg label="Regions per division" value={4} options={[4]} />
            <Seg label="Championship week" value="Season − 1" options={['Season − 1']} />
            <Seg label="Tiebreakers" value="Seed › record › best week › commish" options={['Seed › record › best week › commish']} />
          </div>
          {(report.errors.length > 0 || report.warnings.length > 0) && (
            <ul role="alert" className="space-y-1 rounded-xl border border-amber-400/40 bg-amber-950/20 p-3 text-sm">
              {report.errors.map(e => <li key={e} className="text-amber-200">{e}</li>)}
              {report.warnings.map(w => <li key={w} className="text-slate-300">{w}</li>)}
            </ul>
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-slate-200">
              {report.errors.length === 0
                ? `Each division sends ${report.bracketSize} teams to a ${report.bracketSize}-team bracket (${report.bracketSize / 4} per region). ${report.missOut} per division miss out. Championship is one week before the season ends (${settings.sport} week ${calendar.lastWeek}).`
                : 'Fix the settings above to continue.'}
            </p>
            <button type="button" onClick={onContinue} disabled={report.errors.length > 0}
              className="min-h-12 shrink-0 rounded-xl bg-[#e8b84a] px-8 font-bold text-[#1a1204] disabled:opacity-40">Continue</button>
          </div>
        </section>
      ) : (
        <section className={card + ' space-y-4 p-5 sm:p-6'} aria-labelledby="pr-settings">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="pr-settings" className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Points race · settings</h2>
            <span className="rounded-lg border border-white/15 px-3 py-1 text-sm text-slate-200">{points.participants} entrants · {pointsLeagues} leagues</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Seg label="Sport" value={points.sport} options={['NFL', 'NBA'] as const} onChange={v => onPoints({ ...points, sport: v })} />
            <Seg label="Field size" value={points.participants} options={POINTS_FIELD_SIZES} onChange={v => onPoints({ ...points, participants: v })} />
            <Seg label="Mass cuts" value={2} options={[2]} />
            <Seg label="Tiebreakers" value="Seed › record › best week › commish" options={['Seed › record › best week › commish']} />
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-slate-200">Cuts at half, a buffer for each redraft, and one bracket that ends one week before the season does. The full points-race planner opens next.</p>
            <button type="button" onClick={onContinue} className="min-h-12 shrink-0 rounded-xl bg-[#e8b84a] px-8 font-bold text-[#1a1204]">Continue</button>
          </div>
        </section>
      )}
    </div>
  )
}
