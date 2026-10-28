'use client'

/**
 * components/league-settings/PlayoffBracketFormatCard.tsx
 * Bracket format for the Playoffs tab: every valid way to run a bracket for the chosen number of
 * playoff teams — the standard byes first, then commissioner-granted ones (a double bye for the top
 * seeds, a stepladder) — drawn round by round with the week the final lands in.
 *
 * Reads and saves /api/commissioner/leagues/[leagueId]/playoff-bracket. Any team count with the
 * standard byes is free; commissioner-granted byes are AF Commissioner (the server enforces it,
 * this card shows the badge and link). A play-in week for the last one or two spots
 * (lib/playoff-brackets/playIn.ts) is one of those plans, offered by name.
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useSaveScopeParticipant } from '@/components/league-settings/home/SettingsSaveScope'
import { naturalByePlan } from '@/lib/playoff-brackets/byePlan'

type PlanRound = { round: number; entering: number[]; teams: number; games: number }
type Option = { plan: number[]; natural: boolean; rounds: PlanRound[]; roundCount: number; finalWeek: number; fitsSeason: boolean }
type PlayInOption = {
  qualifiers: number
  spots: 1 | 2
  seeds: number
  plan: number[]
  games: Array<[number, number]>
  rounds: PlanRound[]
  roundCount: number
  finalWeek: number
  fitsSeason: boolean
}
type View = {
  playIn?: PlayInOption[]
  savedPlayIn?: { qualifiers: number; spots: 1 | 2 } | null
  playoffTeams: number
  savedPlayoffTeams: number
  plan: number[]
  options: Option[]
  lastWeek: number | null
  playoffStartWeek?: number
  isPremium: boolean
  locked: boolean
}

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), s)

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** "#3–#6" for a run of consecutive seeds, else "#3, #5". */
function seedList(seeds: number[]): string {
  if (seeds.length === 0) return ''
  const consecutive = seeds.every((s, i) => i === 0 || s === seeds[i - 1] + 1)
  return consecutive && seeds.length > 2 ? `#${seeds[0]}–#${seeds[seeds.length - 1]}` : seeds.map((s) => `#${s}`).join(', ')
}

export function PlayoffBracketFormatCard({ leagueId, playoffTeams, canEdit }: { leagueId: string; playoffTeams: number; canEdit: boolean }) {
  const { t } = useLanguage()
  const base = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/playoff-bracket`
  const [view, setView] = useState<View | null>(null)
  const [choice, setChoice] = useState<number[] | null>(null)
  /** Playoff seeds the choice is for: a play-in adds one or two to the qualifiers. */
  const [target, setTarget] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async (teams: number) => {
    try {
      const res = await fetch(`${base}?teams=${teams}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as View
      if (!Array.isArray(data?.options) || !Array.isArray(data?.plan)) return
      setView(data)
      setChoice(data.plan)
      setTarget(data.playoffTeams)
    } catch { /* the card stays hidden */ }
  }, [base])

  useEffect(() => { load(playoffTeams) }, [load, playoffTeams])

  const playIns = view?.playIn ?? []
  const savedPlayIn = view?.savedPlayIn ?? null
  const qualifiers = savedPlayIn?.qualifiers ?? view?.playoffTeams ?? playoffTeams
  // "No play-in": the normal bracket for the qualifiers, offered while the saved bracket is a play-in.
  const noPlayIn: Option | null = savedPlayIn
    ? { plan: naturalByePlan(qualifiers), natural: true, rounds: [], roundCount: 0, finalWeek: 0, fitsSeason: true }
    : null
  const chosenPlayIn = choice ? playIns.find((p) => p.seeds === target && same(p.plan, choice)) : undefined
  const chosenOption: Option | undefined = chosenPlayIn
    ? { ...chosenPlayIn, natural: false }
    : noPlayIn && choice && target === qualifiers && same(noPlayIn.plan, choice)
      ? noPlayIn
      : view && choice && target === view.playoffTeams ? view.options.find((o) => same(o.plan, choice)) : undefined
  const saveTeams = target ?? view?.playoffTeams ?? playoffTeams
  const unsaved = Boolean(view && choice && canEdit && !view.locked && (!same(choice, view.plan) || saveTeams !== view.savedPlayoffTeams))

  /** Resolves true when the bracket saved (or there was nothing to save). */
  const save = async (): Promise<boolean> => {
    if (!view || !choice) return true
    if (chosenOption && !chosenOption.natural && !view.isPremium) {
      setMessage({ tone: 'error', text: t('lsHub.po.br.needsSub') })
      return false
    }
    if (chosenOption && !chosenOption.fitsSeason) {
      setMessage({ tone: 'error', text: fill(t('lsHub.po.br.tooLong'), { week: chosenOption.finalWeek, last: view.lastWeek ?? '' }) })
      return false
    }
    setSaving(true); setMessage(null)
    try {
      const res = await fetch(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playoffTeams: saveTeams, byePlan: choice }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.errorCode === 'AF_COMMISSIONER_REQUIRED' ? t('lsHub.po.br.needsSub') : (data.error ?? t('lsHub.po.br.saveFailed')) })
        return false
      }
      setMessage({ tone: 'ok', text: t('lsHub.po.br.saved') })
      await load(saveTeams)
      return true
    } catch {
      setMessage({ tone: 'error', text: t('lsHub.po.br.saveFailed') })
      return false
    } finally {
      setSaving(false)
    }
  }

  // On a League Settings page the page's "Save changes" bar saves the bracket with everything else.
  const inSaveBar = useSaveScopeParticipant(unsaved, save)

  if (!view || !choice) return null

  const describe = (plan: number[]) => {
    const waits = plan.flatMap((off, i) => (off > 0 ? [fill(t(off === 1 ? 'lsHub.po.br.waitOne' : 'lsHub.po.br.waitMany'), { seed: i + 1, n: off })] : []))
    return waits.length ? waits.join(' · ') : t('lsHub.po.br.noByes')
  }
  const premiumNeeded = (o: Option) => !o.natural
  const chosen = chosenOption
  const dirty = unsaved
  const blockedBySub = chosen ? premiumNeeded(chosen) && !view.isPremium : false

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4" data-testid="playoff-bracket-format">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.br.title')}</h4>
        <span className="text-[11px] text-white/40">
          {savedPlayIn ? fill(t('lsHub.po.pi.teamsPlus'), { n: savedPlayIn.qualifiers }) : fill(t('lsHub.po.br.teams'), { n: view.playoffTeams })}
        </span>
      </div>
      {view.locked && <p className="text-[11px] text-amber-300/80">{t('lsHub.po.br.locked')}</p>}

      {!savedPlayIn && <div className="grid gap-2" role="radiogroup" aria-label={t('lsHub.po.br.title')}>
        {view.options.map((o) => {
          const checked = target === view.playoffTeams && same(o.plan, choice)
          return (
            <label key={o.plan.join('-')}
              className={`block min-w-0 cursor-pointer rounded-xl border p-3 transition ${checked ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-white/10 bg-white/[0.02]'}`}>
              <input type="radio" className="sr-only" checked={checked} disabled={!canEdit || view.locked} onChange={() => { setChoice(o.plan); setTarget(view.playoffTeams) }} />
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-white/90">{o.natural ? t('lsHub.po.br.standard') : describe(o.plan)}</span>
                {premiumNeeded(o) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
                    <Sparkles className="h-3 w-3" aria-hidden />AF Commissioner
                  </span>
                )}
              </span>
              {o.natural && <span className="mt-0.5 block text-[11px] text-white/40">{describe(o.plan)}</span>}
              <span className="mt-2 flex min-w-0 gap-1.5 overflow-x-auto pb-1">
                {o.rounds.map((r) => (
                  <span key={r.round} className="min-w-[88px] shrink-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-white/45">
                      {r.round === o.roundCount ? t('lsHub.po.br.final') : fill(t('lsHub.po.br.round'), { n: r.round })}
                    </span>
                    <span className="block text-[11px] text-white/70">{fill(t(r.games === 1 ? 'lsHub.po.br.game' : 'lsHub.po.br.games'), { n: r.games })}</span>
                    {r.entering.length > 0 && (
                      <span className="block text-[11px] text-cyan-300/80">{fill(t('lsHub.po.br.join'), { seeds: seedList(r.entering) })}</span>
                    )}
                  </span>
                ))}
              </span>
              <span className={`mt-1 block text-[11px] ${o.fitsSeason ? 'text-white/40' : 'text-red-300'}`}>
                {o.fitsSeason
                  ? fill(t('lsHub.po.br.finalWeek'), { week: o.finalWeek })
                  : fill(t('lsHub.po.br.tooLong'), { week: o.finalWeek, last: view.lastWeek ?? '' })}
              </span>
            </label>
          )
        })}
      </div>}

      {(playIns.length > 0 || noPlayIn) && (
        <div className="grid gap-2" role="radiogroup" aria-label={t('lsHub.po.pi.title')} data-testid="playoff-play-in">
          <h5 className="text-[11px] font-bold uppercase tracking-wide text-white/55">{t('lsHub.po.pi.title')}</h5>
          <p className="text-[11px] leading-snug text-white/40">{fill(t('lsHub.po.pi.hint'), { n: qualifiers })}</p>
          {noPlayIn && (() => {
            const checked = target === qualifiers && same(noPlayIn.plan, choice)
            return (
              <label className={`block min-w-0 cursor-pointer rounded-xl border p-3 transition ${checked ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-white/10 bg-white/[0.02]'}`}>
                <input type="radio" className="sr-only" checked={checked} disabled={!canEdit || view.locked}
                  onChange={() => { setChoice(noPlayIn.plan); setTarget(qualifiers) }} data-testid="playoff-play-in-none" />
                <span className="text-[13px] font-semibold text-white/90">{fill(t('lsHub.po.pi.none'), { n: qualifiers })}</span>
              </label>
            )
          })()}
          {playIns.map((p) => {
            const checked = target === p.seeds && same(p.plan, choice)
            const games = p.games.map(([a, b]) => `#${a} v #${b}`).join(' · ')
            return (
              <label key={p.spots} className={`block min-w-0 cursor-pointer rounded-xl border p-3 transition ${checked ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-white/10 bg-white/[0.02]'}`}>
                <input type="radio" className="sr-only" checked={checked} disabled={!canEdit || view.locked}
                  onChange={() => { setChoice(p.plan); setTarget(p.seeds) }} data-testid={`playoff-play-in-${p.spots}`} />
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-white/90">{t(p.spots === 1 ? 'lsHub.po.pi.one' : 'lsHub.po.pi.two')}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
                    <Sparkles className="h-3 w-3" aria-hidden />AF Commissioner
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] text-white/40">{fill(t('lsHub.po.pi.games'), { games })}</span>
                <span className={`mt-1 block text-[11px] ${p.fitsSeason ? 'text-white/40' : 'text-red-300'}`}>
                  {p.fitsSeason
                    ? fill(t('lsHub.po.pi.weeks'), { start: view.playoffStartWeek ?? '', week: p.finalWeek })
                    : fill(t('lsHub.po.br.tooLong'), { week: p.finalWeek, last: view.lastWeek ?? '' })}
                </span>
              </label>
            )
          })}
        </div>
      )}

      <div aria-live="polite">
        {message && !(inSaveBar && message.tone === 'ok') && (
          <p role={message.tone === 'error' ? 'alert' : undefined}
            className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'error' ? 'border border-red-500/20 bg-red-950/20 text-red-300' : 'border border-emerald-500/20 bg-emerald-950/20 text-emerald-300'}`}>
            {message.text}
          </p>
        )}
      </div>

      {canEdit && !view.locked && (
        blockedBySub ? (
          <a href="/upgrade?plan=commissioner"
            className="block w-full rounded-lg bg-violet-600/80 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-violet-600">
            {t('lsHub.po.br.upgrade')}
          </a>
        ) : inSaveBar ? null : (
          <button type="button" disabled={saving || !dirty || !chosen?.fitsSeason} onClick={() => void save()}
            className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:opacity-50">
            {saving ? t('lsHub.saving') : t('lsHub.po.br.save')}
          </button>
        )
      )}
    </div>
  )
}
