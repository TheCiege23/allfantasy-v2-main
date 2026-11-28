'use client'

/**
 * League settings → Roster, college football and basketball leagues: which schools the league drafts and
 * adds players from (lib/college/conferenceScope.ts). Every member sees the rule; the commissioner edits
 * it. Saves go to PUT /api/commissioner/leagues/[id]/college-pool, which clears the draft-pool caches;
 * this panel then tells an open draft room to reload its board.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { collegePlayerPoolMessages } from '@/lib/core-app/messages/collegePlayerPool'
import {
  collegeScopePresets,
  scopeMembership,
  shortConferenceName,
  type CollegeScopePreset,
  type CollegeScopeSport,
} from '@/lib/college/conferenceScope'
import { emitLeagueDraftRoomRevalidate } from '@/lib/draft-room/emitLeagueDraftRoomRevalidate'

type PoolView = {
  sport: CollegeScopeSport
  /** A devy / C2C league: the rule covers its college players only. */
  collegeSide?: boolean
  scope: { preset: CollegeScopePreset; conferences: string[] }
  summary: string
  conferences: Array<{ conference: string; teams: number }>
  isCommissioner: boolean
}

export type CollegePlayerPoolCopy = (typeof collegePlayerPoolMessages)['en']

export function presetText(copy: CollegePlayerPoolCopy, sport: CollegeScopeSport, preset: CollegeScopePreset) {
  const football = sport === 'NCAAF'
  switch (preset) {
    case 'all':
      return { label: copy.allLabel, desc: football ? copy.allDescFootball : copy.allDescBasketball }
    case 'fbs':
      return { label: copy.fbsLabel, desc: copy.fbsDesc }
    case 'power':
      return football
        ? { label: copy.powerLabelFootball, desc: copy.powerDescFootball }
        : { label: copy.powerLabelBasketball, desc: copy.powerDescBasketball }
    case 'group':
      return { label: copy.groupLabel, desc: copy.groupDesc }
    default:
      return { label: copy.customLabel, desc: copy.customDesc }
  }
}

/** How many schools a choice admits, from the conference team counts the API returned. */
export function schoolCount(
  sport: CollegeScopeSport,
  preset: CollegeScopePreset,
  custom: readonly string[],
  conferences: ReadonlyArray<{ conference: string; teams: number }>,
): number {
  if (preset === 'all') return conferences.reduce((n, c) => n + c.teams, 0)
  const membership = scopeMembership(sport, preset === 'custom' ? { preset, conferences: [...custom] } : { preset, conferences: [] })
  const teams = new Map(conferences.map((c) => [c.conference, c.teams]))
  return membership.conferences.reduce((n, c) => n + (teams.get(c) ?? 0), 0) + membership.schools.length
}

export function CollegePlayerPoolView({
  view,
  copy,
  saving = false,
  message = null,
  onSave,
}: {
  view: PoolView
  copy: CollegePlayerPoolCopy
  saving?: boolean
  message?: { tone: 'ok' | 'error'; text: string } | null
  onSave?: (choice: { preset: CollegeScopePreset; conferences: string[] }) => void
}) {
  const [preset, setPreset] = useState<CollegeScopePreset>(view.scope.preset)
  const [custom, setCustom] = useState<string[]>(view.scope.conferences)
  const groupName = useId()
  useEffect(() => {
    setPreset(view.scope.preset)
    setCustom(view.scope.conferences)
  }, [view.scope.preset, view.scope.conferences])

  const editable = view.isCommissioner && Boolean(onSave)
  const presets = collegeScopePresets(view.sport).map((p) => p.preset)
  const dirty = preset !== view.scope.preset || (preset === 'custom' && [...custom].sort().join('|') !== [...view.scope.conferences].sort().join('|'))
  const customEmpty = preset === 'custom' && custom.length === 0
  const toggle = (conference: string) =>
    setCustom((list) => (list.includes(conference) ? list.filter((c) => c !== conference) : [...list, conference]))

  return (
    <section className="af-ls-card space-y-3" data-testid="college-player-pool">
      <div className="min-w-0">
        <p className="af-ls-eyebrow">{copy.title}</p>
        <p className="mt-0.5 text-[11px] text-white/45">{view.collegeSide ? copy.subtitleCollegeSide : copy.subtitle}</p>
        <p className="mt-1 text-[13px] font-semibold text-white/90" data-testid="college-player-pool-summary">
          {copy.current(view.summary)}
        </p>
      </div>

      <div role="radiogroup" aria-label={copy.title} className="space-y-1.5">
        {presets.map((p) => {
          const text = presetText(copy, view.sport, p)
          const checked = preset === p
          return (
            <label
              key={p}
              className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
                checked ? 'border-cyan-300/60 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03]'
              } ${editable ? '' : 'cursor-default opacity-80'}`}
            >
              <input
                type="radio"
                name={groupName}
                className="mt-1"
                checked={checked}
                disabled={!editable || saving}
                onChange={() => setPreset(p)}
                data-testid={`college-player-pool-preset-${p}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-white/90">{text.label}</span>
                  {p !== 'custom' ? (
                    <span className="text-[11px] tabular-nums text-white/50">{copy.schools(schoolCount(view.sport, p, [], view.conferences))}</span>
                  ) : null}
                </span>
                <span className="block text-[11px] leading-snug text-white/45">{text.desc}</span>
              </span>
            </label>
          )
        })}
      </div>

      {preset === 'custom' ? (
        <div className="space-y-1.5" data-testid="college-player-pool-conferences">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {view.conferences.map(({ conference, teams }) => (
              <label key={conference} className="flex min-h-[40px] items-center gap-2 rounded-md bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-white/85">
                <input
                  type="checkbox"
                  checked={custom.includes(conference)}
                  disabled={!editable || saving}
                  onChange={() => toggle(conference)}
                  data-testid={`college-player-pool-conference-${conference}`}
                />
                <span className="min-w-0 flex-1 truncate" title={conference}>{shortConferenceName(conference)}</span>
                <span className="text-[11px] tabular-nums text-white/45">{teams}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-white/55" data-testid="college-player-pool-custom-count">
            {customEmpty ? copy.pickAtLeastOne : copy.schools(schoolCount(view.sport, 'custom', custom, view.conferences))}
          </p>
        </div>
      ) : null}

      <p className="text-[11px] leading-snug text-white/40">{copy.rosteredNote}</p>

      {editable ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSave?.({ preset, conferences: preset === 'custom' ? custom : [] })}
            disabled={!dirty || customEmpty || saving}
            className="min-h-[40px] rounded-lg bg-cyan-400 px-4 text-[13px] font-bold text-[#06121f] disabled:opacity-40"
            data-testid="college-player-pool-save"
          >
            {saving ? copy.saving : copy.save}
          </button>
          {message ? (
            <span
              role="status"
              className={`text-[12px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}
              data-testid="college-player-pool-message"
            >
              {message.text}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-white/45">{copy.readOnly}</p>
      )}
    </section>
  )
}

export function isPoolView(v: unknown): v is PoolView {
  if (!v || typeof v !== 'object') return false
  const r = v as Partial<PoolView>
  return (r.sport === 'NCAAF' || r.sport === 'NCAAB') &&
    Boolean(r.scope && typeof r.scope.preset === 'string' && Array.isArray(r.scope.conferences)) &&
    Array.isArray(r.conferences) && typeof r.summary === 'string'
}

export function CollegePlayerPoolPanel({ leagueId }: { leagueId: string }) {
  const copy = useMessages(collegePlayerPoolMessages)
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/college-pool`
  const [view, setView] = useState<PoolView | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as PoolView & { applies?: boolean }
      // Only a well-formed answer: anything else (an error page, another route's body) shows no card
      // rather than crashing the Roster section around it.
      if (data.applies !== false && isPoolView(data)) setView(data)
    } catch {
      // A settings card: the page renders without it.
    }
  }, [url])
  useEffect(() => {
    void load()
  }, [load])

  const save = useMemo(
    () => async (choice: { preset: CollegeScopePreset; conferences: string[] }) => {
      setSaving(true)
      setMessage(null)
      try {
        const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice) })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          setMessage({ tone: 'error', text: data.error || copy.failed })
          return
        }
        setMessage({ tone: 'ok', text: copy.saved })
        emitLeagueDraftRoomRevalidate(leagueId)
        await load()
      } catch {
        setMessage({ tone: 'error', text: copy.failed })
      } finally {
        setSaving(false)
      }
    },
    [url, copy, leagueId, load],
  )

  if (!view) return null
  return <CollegePlayerPoolView view={view} copy={copy} saving={saving} message={message} onSave={save} />
}
