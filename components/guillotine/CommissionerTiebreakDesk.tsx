"use client"

import { useCallback, useEffect, useState } from "react"

import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

/**
 * The commissioner's "who goes?" screen for a tied Guilly chop (lib/guillotine/commissionerTiebreak.ts). Reached
 * from the urgent alert; the chop itself follows on the next score sync, within about five minutes of the pick.
 */

type Team = { rosterId: string; name: string; points: number | null; chosen: boolean }
type Tie = { key: string; week: number; state: "waiting" | "decided" | "expired"; needed: number; deadline: string; decidedAt: string | null; teams: Team[] }

const COPY = {
  en: {
    title: "Decide the chop",
    intro: "Your league's tiebreak order leaves this tie to you. Pick who goes; the chop happens within a few minutes.",
    none: "No chop ties are waiting for you. When a tie reaches \"Commissioner decides\", you'll get an alert and it will show up here.",
    loading: "Loading…",
    week: (w: number) => `Week ${w}`,
    pickOne: "Pick the team that goes.",
    pickMany: (n: number) => `Pick the ${n} teams that go.`,
    deadline: (d: string) => `Decide by ${d}. After that, your league's next tiebreak rule decides.`,
    points: (p: number) => `${p} pts`,
    confirm: "Chop this team",
    confirmMany: "Chop these teams",
    confirmAsk: "This can't be undone. Chop them?",
    decided: "You decided this tie. The chop follows on the next score update.",
    expired: "The time to decide passed, so the next tiebreak rule decided it.",
    goes: "Goes",
    error: "Could not save your pick. Try again.",
  },
  es: {
    title: "Decide la eliminación",
    intro: "El orden de desempate de tu liga te deja este empate a ti. Elige quién cae; la eliminación ocurre en unos minutos.",
    none: "No hay empates esperando tu decisión. Cuando un empate llegue a \"Decide el comisionado\", recibirás una alerta y aparecerá aquí.",
    loading: "Cargando…",
    week: (w: number) => `Semana ${w}`,
    pickOne: "Elige el equipo que cae.",
    pickMany: (n: number) => `Elige los ${n} equipos que caen.`,
    deadline: (d: string) => `Decide antes de ${d}. Después, decide la siguiente regla de desempate de tu liga.`,
    points: (p: number) => `${p} pts`,
    confirm: "Eliminar este equipo",
    confirmMany: "Eliminar estos equipos",
    confirmAsk: "Esto no se puede deshacer. ¿Eliminarlos?",
    decided: "Ya decidiste este empate. La eliminación llega con la próxima actualización de puntos.",
    expired: "Pasó el plazo, así que decidió la siguiente regla de desempate.",
    goes: "Cae",
    error: "No se pudo guardar tu elección. Inténtalo de nuevo.",
  },
}

export function CommissionerTiebreakDesk({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const c = language === "es" ? COPY.es : COPY.en
  const [ties, setTies] = useState<Tie[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary?view=tiebreak`, { cache: "no-store" })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : c.error)
      setTies([])
      return
    }
    setTies(Array.isArray(data?.ties) ? data.ties : [])
  }, [leagueId, c.error])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = (tie: Tie, rosterId: string) => {
    setConfirming(null)
    setPicked((prev) => {
      const current = prev[tie.key] ?? []
      if (current.includes(rosterId)) return { ...prev, [tie.key]: current.filter((id) => id !== rosterId) }
      const next = tie.needed === 1 ? [rosterId] : [...current, rosterId].slice(-tie.needed)
      return { ...prev, [tie.key]: next }
    })
  }

  const submit = async (tie: Tie) => {
    setSaving(tie.key)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "commissioner_tiebreak", key: tie.key, rosterIds: picked[tie.key] ?? [] }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : c.error)
        await load()
        return
      }
      setTies(Array.isArray(data?.ties) ? data.ties : [])
      setConfirming(null)
    } catch {
      setError(c.error)
    } finally {
      setSaving(null)
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(language === "es" ? "es" : "en", { weekday: "short", hour: "numeric", minute: "2-digit" })

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">{c.title}</h1>
        <p className="mt-1 text-sm text-white/65">{c.intro}</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {ties === null && <p className="text-sm text-white/60">{c.loading}</p>}
      {ties?.length === 0 && !error && <p className="text-sm text-white/60">{c.none}</p>}
      {ties?.map((tie) => {
        const chosen = picked[tie.key] ?? []
        const ready = chosen.length === tie.needed
        return (
          <article key={tie.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-base font-semibold text-white">{c.week(tie.week)}</h2>
            {tie.state === "waiting" && (
              <p className="mt-1 text-sm text-white/65">
                {tie.needed === 1 ? c.pickOne : c.pickMany(tie.needed)} {c.deadline(fmt(tie.deadline))}
              </p>
            )}
            {tie.state === "decided" && <p className="mt-1 text-sm text-emerald-200">{c.decided}</p>}
            {tie.state === "expired" && <p className="mt-1 text-sm text-white/60">{c.expired}</p>}
            <ul className="mt-3 space-y-2">
              {tie.teams.map((team) => {
                const selected = tie.state === "waiting" ? chosen.includes(team.rosterId) : team.chosen
                return (
                  <li key={team.rosterId}>
                    <button
                      type="button"
                      disabled={tie.state !== "waiting" || saving === tie.key}
                      aria-pressed={selected}
                      onClick={() => toggle(tie, team.rosterId)}
                      className={`flex min-h-[44px] w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                        selected ? "border-red-400/70 bg-red-500/15 text-white" : "border-white/10 bg-white/[0.02] text-white/85"
                      } disabled:cursor-default`}
                    >
                      <span className="font-medium">{team.name}</span>
                      <span className="flex items-center gap-2 text-white/60">
                        {team.points != null && <span>{c.points(team.points)}</span>}
                        {selected && <span className="rounded bg-red-500/30 px-1.5 py-0.5 text-xs text-red-100">{c.goes}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {tie.state === "waiting" && (
              <div className="mt-3">
                {confirming === tie.key ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-white/80">{c.confirmAsk}</span>
                    <button
                      type="button"
                      disabled={saving === tie.key}
                      onClick={() => void submit(tie)}
                      className="min-h-[44px] rounded-lg bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {tie.needed === 1 ? c.confirm : c.confirmMany}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => setConfirming(tie.key)}
                    className="min-h-[44px] rounded-lg bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {tie.needed === 1 ? c.confirm : c.confirmMany}
                  </button>
                )}
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
