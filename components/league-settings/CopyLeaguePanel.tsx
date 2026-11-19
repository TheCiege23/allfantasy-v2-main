'use client'

/**
 * Copy leagues, part 1 (docs/league-page/COPY_LEAGUES_DESIGN.md): who is which real team.
 *
 * - `mode="mine"` (Settings › My Settings): a manager takes a real team, or lets it go, until the draft.
 * - `mode="commissioner"` (Settings › AllFantasy options): turn copy league on or off, and assign or swap
 *   any team's real team at any time.
 *
 * Reads and writes `/api/leagues/[leagueId]/copy-league`; the server keeps every rule
 * (lib/league/copyLeagueService.ts) and its answer is shown as it comes back. Renders nothing where copy
 * leagues are not available (an imported league, a sport without a verified team table).
 */
import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import type { CopyLeagueView } from '@/lib/league/copyLeagueService'

const copyLeagueMessages = defineMessages({
  en: {
    title: 'Copy league',
    commishSub: (league: string): string => `Every manager takes a real ${league} team: its name and logo replace the team’s own. Managers pick until the draft; you can assign or swap teams any time.`,
    turnOn: 'Copy league',
    picked: (n: number, total: number): string => `${n} of ${total} teams have a real team.`,
    mineTitle: 'Your real team',
    mineSub: (league: string): string => `This is a copy league: take a real ${league} team and it becomes your team’s name and logo. Each team can be taken once.`,
    choose: 'Choose a team',
    none: 'No team yet',
    taken: (who: string): string => `taken by ${who}`,
    letGo: 'Let it go',
    locked: 'Teams are locked now that the draft has started. Ask your commissioner to change yours.',
    assignLabel: (team: string): string => `Real team for ${team}`,
    swapNote: 'Picking a team someone else has swaps the two.',
    saved: 'Saved.',
    failed: 'Could not save. Try again.',
  },
  es: {
    title: 'Liga copia',
    commishSub: (league: string): string => `Cada mánager toma un equipo real de la ${league}: su nombre y logo reemplazan los del equipo. Los mánagers eligen hasta el draft; tú puedes asignar o intercambiar equipos cuando quieras.`,
    turnOn: 'Liga copia',
    picked: (n: number, total: number): string => `${n} de ${total} equipos tienen un equipo real.`,
    mineTitle: 'Tu equipo real',
    mineSub: (league: string): string => `Esta es una liga copia: toma un equipo real de la ${league} y será el nombre y el logo de tu equipo. Cada equipo se puede tomar una vez.`,
    choose: 'Elige un equipo',
    none: 'Todavía sin equipo',
    taken: (who: string): string => `ya es de ${who}`,
    letGo: 'Dejarlo',
    locked: 'Los equipos quedan fijos desde que empezó el draft. Pídele a tu comisionado que cambie el tuyo.',
    assignLabel: (team: string): string => `Equipo real de ${team}`,
    swapNote: 'Si eliges un equipo que ya tiene otro, se intercambian.',
    saved: 'Guardado.',
    failed: 'No se pudo guardar. Inténtalo de nuevo.',
  },
})

const field = 'min-h-[40px] w-full rounded-lg border border-white/10 bg-[#0a1220] px-3 text-[13px] text-white disabled:opacity-60'

function Crest({ src }: { src: string | null }) {
  if (!src) return <span aria-hidden className="h-8 w-8 shrink-0 rounded-full bg-white/10" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-8 w-8 shrink-0 object-contain" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
}

export function CopyLeaguePanel({ leagueId, mode }: { leagueId: string; mode: 'mine' | 'commissioner' }) {
  const c = useMessages(copyLeagueMessages)
  const [view, setView] = useState<CopyLeagueView | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/copy-league`

  useEffect(() => {
    let live = true
    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CopyLeagueView | null) => { if (live) setView(d) })
      .catch(() => undefined)
    return () => { live = false }
  }, [url])

  const send = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as { error?: string; view?: CopyLeagueView }
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? c.failed })
        return
      }
      if (data.view) setView(data.view)
      setNote({ ok: true, text: c.saved })
    } catch {
      setNote({ ok: false, text: c.failed })
    } finally {
      setBusy(false)
    }
  }, [url, c])

  if (!view?.available) return null
  if (mode === 'commissioner' && !view.canManage) return null
  if (mode === 'mine' && (!view.enabled || !view.myLeagueTeamId)) return null

  const holderOf = new Map(view.teams.filter((t) => t.code).map((t) => [t.code as string, t]))
  const status = note ? (
    <p role={note.ok ? 'status' : 'alert'} className={`m-0 text-[12px] font-semibold ${note.ok ? 'text-emerald-300' : 'text-red-300'}`}>{note.text}</p>
  ) : null

  if (mode === 'mine') {
    const me = view.teams.find((t) => t.leagueTeamId === view.myLeagueTeamId)!
    const real = view.catalog.find((t) => t.code === me.code) ?? null
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-blue-500/40 bg-blue-500/[0.06] px-4 py-3" data-testid="copy-league-mine">
        <h3 className="m-0 text-[15px] font-bold text-white">{c.mineTitle}</h3>
        <p className="m-0 text-[13px] leading-relaxed text-white/60">{c.mineSub(view.sport)}</p>
        <div className="flex items-center gap-3">
          <Crest src={real?.logo ?? null} />
          <select
            aria-label={c.choose}
            className={field}
            value={me.code ?? ''}
            disabled={busy || view.locked}
            onChange={(e) => void send({ action: 'pick', code: e.target.value || null })}
            data-testid="copy-league-pick"
          >
            <option value="">{c.none}</option>
            {view.catalog.map((t) => {
              const holder = holderOf.get(t.code)
              const takenByOther = holder && holder.leagueTeamId !== me.leagueTeamId
              return (
                <option key={t.code} value={t.code} disabled={Boolean(takenByOther)}>
                  {takenByOther ? `${t.name} (${c.taken(holder!.ownerName ?? holder!.teamName)})` : t.name}
                </option>
              )
            })}
          </select>
          {me.code && !view.locked ? (
            <button type="button" disabled={busy} onClick={() => void send({ action: 'pick', code: null })} className="min-h-[40px] shrink-0 rounded-full border border-white/15 px-4 text-[13px] font-bold text-white/80" data-testid="copy-league-let-go">
              {c.letGo}
            </button>
          ) : null}
        </div>
        {view.locked ? <p className="m-0 text-[12px] text-amber-300" data-testid="copy-league-locked">{c.locked}</p> : null}
        {status}
      </section>
    )
  }

  const pickedCount = view.teams.filter((t) => t.code).length
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-blue-500/40 bg-blue-500/[0.06] px-4 py-3" data-testid="copy-league-commissioner">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <h3 id="copy-league-title" className="m-0 text-[15px] font-bold text-white">{c.title}</h3>
          <span className="text-[13px] leading-relaxed text-white/60">{c.commishSub(view.sport)}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={view.enabled}
          aria-labelledby="copy-league-title"
          disabled={busy}
          onClick={() => void send({ action: view.enabled ? 'disable' : 'enable' })}
          className={`relative h-[30px] w-[52px] shrink-0 rounded-full ${view.enabled ? 'bg-blue-500' : 'bg-white/15'}`}
          data-testid="copy-league-switch"
        >
          <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white transition-all ${view.enabled ? 'left-[25px]' : 'left-[3px]'}`} />
        </button>
      </div>
      {view.enabled ? (
        <>
          <p className="m-0 text-[12px] font-semibold text-white/75" data-testid="copy-league-count">{c.picked(pickedCount, view.teams.length)}</p>
          <div className="flex flex-col gap-2">
            {view.teams.map((t) => {
              const real = view.catalog.find((x) => x.code === t.code) ?? null
              return (
                <div key={t.leagueTeamId} className="flex items-center gap-3" data-testid="copy-league-row">
                  <Crest src={real?.logo ?? null} />
                  <span className="w-[38%] min-w-0 truncate text-[13px] font-semibold text-white">{t.ownerName ?? t.teamName}</span>
                  <select
                    aria-label={c.assignLabel(t.ownerName ?? t.teamName)}
                    className={field}
                    value={t.code ?? ''}
                    disabled={busy}
                    onChange={(e) => void send({ action: 'assign', leagueTeamId: t.leagueTeamId, code: e.target.value || null })}
                  >
                    <option value="">{c.none}</option>
                    {view.catalog.map((x) => {
                      const holder = holderOf.get(x.code)
                      const other = holder && holder.leagueTeamId !== t.leagueTeamId
                      return <option key={x.code} value={x.code}>{other ? `${x.name} (${c.taken(holder!.ownerName ?? holder!.teamName)})` : x.name}</option>
                    })}
                  </select>
                </div>
              )
            })}
          </div>
          <p className="m-0 text-[12px] text-white/45">{c.swapNote}</p>
        </>
      ) : null}
      {status}
    </section>
  )
}

export default CopyLeaguePanel
