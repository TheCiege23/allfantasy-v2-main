"use client"

import { useCallback, useEffect, useState } from "react"

import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

/**
 * The commissioner's "Undo the last chop" card (lib/guillotine/chopUndo.ts). Shows the latest chop, whether it can
 * still be undone (and if not, why), and lets the commissioner bring the team back — optionally chopping a different
 * team instead, with a stat correction's suggestion marked.
 */

type Team = { rosterId: string; name: string; points: number | null }
type UndoState = {
  week: number | null
  chopped: Team[]
  alive: Team[]
  correctionSuggests: string[]
  blockers: Array<{ code: string; message: string }>
}

const COPY = {
  en: {
    title: "Undo the last chop",
    none: "No team has been chopped yet.",
    week: (w: number) => `Week ${w} chop`,
    chopped: "Chopped",
    cannot: "This chop can't be undone:",
    can: "You can bring this team back with its players, until the next waiver run processes claims.",
    insteadLabel: "Chop a different team instead (optional)",
    noInstead: "Nobody — just bring the team back",
    suggested: "a stat correction says this team should have gone",
    pts: (p: number) => `${p} pts`,
    undo: "Undo the chop",
    confirm: (names: string, instead: string | null) =>
      instead ? `Bring back ${names} and chop ${instead} instead? Everyone in the league is told.` : `Bring back ${names}? Everyone in the league is told.`,
    yes: "Yes, undo it",
    cancel: "Cancel",
    done: (names: string, instead: string | null) => (instead ? `Done. ${names} is back and ${instead} is chopped.` : `Done. ${names} is back with its players.`),
    error: "Could not undo the chop. Try again.",
    loading: "Loading…",
  },
  es: {
    title: "Deshacer la última eliminación",
    none: "Todavía no se ha eliminado a ningún equipo.",
    week: (w: number) => `Eliminación de la semana ${w}`,
    chopped: "Eliminado",
    cannot: "Esta eliminación ya no se puede deshacer:",
    can: "Puedes traer de vuelta a este equipo con sus jugadores, hasta que la próxima ronda de waivers procese solicitudes.",
    insteadLabel: "Eliminar a otro equipo en su lugar (opcional)",
    noInstead: "Ninguno — solo traer de vuelta al equipo",
    suggested: "una corrección de estadísticas dice que este equipo debió caer",
    pts: (p: number) => `${p} pts`,
    undo: "Deshacer la eliminación",
    confirm: (names: string, instead: string | null) =>
      instead ? `¿Traer de vuelta a ${names} y eliminar a ${instead}? Se avisa a toda la liga.` : `¿Traer de vuelta a ${names}? Se avisa a toda la liga.`,
    yes: "Sí, deshacer",
    cancel: "Cancelar",
    done: (names: string, instead: string | null) => (instead ? `Listo. ${names} vuelve y ${instead} queda eliminado.` : `Listo. ${names} vuelve con sus jugadores.`),
    error: "No se pudo deshacer la eliminación. Inténtalo de nuevo.",
    loading: "Cargando…",
  },
}

export function ChopUndoCard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const c = language === "es" ? COPY.es : COPY.en
  const [state, setState] = useState<UndoState | null>(null)
  const [instead, setInstead] = useState<string>("")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary?view=undo`, { cache: "no-store" })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : c.error)
      return
    }
    setState(data as UndoState)
    const suggested = Array.isArray(data?.correctionSuggests) && data.chopped?.length === 1 ? data.correctionSuggests[0] : ""
    setInstead((prev) => prev || suggested || "")
  }, [leagueId, c.error])

  useEffect(() => {
    void load()
  }, [load])

  const names = (state?.chopped ?? []).map((t) => t.name).join(", ")
  const insteadName = state?.alive.find((t) => t.rosterId === instead)?.name ?? null

  const submit = async () => {
    if (!state?.week) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo_chop", week: state.week, ...(instead ? { chopInstead: [instead] } : {}) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : c.error)
        await load()
        return
      }
      setDone(c.done(names, insteadName))
      setConfirming(false)
      setInstead("")
      if (data?.undo) setState(data.undo as UndoState)
      else await load()
    } catch {
      setError(c.error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="undo" className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-base font-semibold text-white">{c.title}</h2>
      {done && <p className="mt-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{done}</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {!state && !error && <p className="mt-2 text-sm text-white/60">{c.loading}</p>}
      {state && state.week == null && <p className="mt-2 text-sm text-white/60">{c.none}</p>}
      {state && state.week != null && (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-white/80">
            {c.week(state.week)}: <span className="font-medium text-white">{names}</span>
            {state.chopped.length === 1 && state.chopped[0]!.points != null && <span className="text-white/60"> ({c.pts(state.chopped[0]!.points!)})</span>}
          </p>
          {state.blockers.length > 0 ? (
            <div className="text-sm text-white/70">
              <p>{c.cannot}</p>
              <ul className="mt-1 list-disc pl-5">
                {state.blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <p className="text-sm text-white/65">{c.can}</p>
              {state.chopped.length === 1 && state.alive.length > 0 && (
                <label className="block text-sm text-white/80">
                  <span className="mb-1 block">{c.insteadLabel}</span>
                  <select
                    value={instead}
                    onChange={(e) => {
                      setInstead(e.target.value)
                      setConfirming(false)
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-white/15 bg-black/40 px-3 text-sm text-white"
                  >
                    <option value="">{c.noInstead}</option>
                    {state.alive.map((t) => (
                      <option key={t.rosterId} value={t.rosterId}>
                        {t.name}
                        {t.points != null ? ` — ${c.pts(t.points)}` : ""}
                        {state.correctionSuggests.includes(t.rosterId) ? ` (${c.suggested})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {confirming ? (
                <div className="space-y-2">
                  <p className="text-sm text-white/85">{c.confirm(names, insteadName)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void submit()}
                      className="min-h-[44px] rounded-lg bg-amber-500 px-4 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      {c.yes}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirming(false)}
                      className="min-h-[44px] rounded-lg border border-white/20 px-4 text-sm text-white/80"
                    >
                      {c.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="min-h-[44px] rounded-lg bg-amber-500 px-4 text-sm font-semibold text-black"
                >
                  {c.undo}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
