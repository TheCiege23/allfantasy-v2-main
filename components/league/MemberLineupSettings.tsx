'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Member Settings — Chimmy lineup and auto-switch for injured starters, team by team (owner's page
 * review #18; mockup "B_Members" on the design canvas).
 *
 *  - Chimmy lineup is inactive manager mode (`/api/leagues/[id]/inactive-managers`): Chimmy sets the
 *    team's best lineup before each lock, and it ends when the manager saves a lineup of their own.
 *  - Auto-switch injured starters (`/api/leagues/[id]/auto-switch-injured`): swap a starter at or past
 *    the chosen injury level for the best healthy bench player, inside the chosen window. Out only is
 *    the default; it runs while the team's owner has Pro.
 *
 * Both tell the manager when they are switched on, and the manager can switch them off.
 */
type InactiveTeam = { rosterId: string; teamName: string | null; managerName: string | null; managed: { since: string } | null; emptySeat: boolean }
type InactiveView = { native: boolean; teams: InactiveTeam[] }
type Level = 'out' | 'doubtful' | 'questionable'
type Timing = 'pregame_90' | 'night_before'
type AutoSetting = { level: Level; timing: Timing } | null
type AutoView = { available: boolean; reason?: string; teams: { rosterId: string; setting: AutoSetting; ownerHasPro: boolean }[] }

const T = {
  text: 'var(--lsk-text, var(--text, #e8ecf2))',
  muted: 'var(--lsk-muted, var(--muted, #9aa4b2))',
  line: 'var(--lsk-line, var(--line2, #2a3345))',
  surface: 'var(--lsk-surface, var(--surface, #121826))',
  surface2: 'var(--lsk-surface2, var(--surface2, #1c2333))',
  strong: 'var(--lsk-accent-strong, var(--accent, #d4a24c))',
  rgb: 'var(--lsk-rgb, 212, 162, 76)',
  blue: 'var(--af-blue, #3b82f6)',
}

const memberLineupMessages = defineMessages({
  en: {
    title: 'Member Settings',
    members: 'Members',
    chimmy: 'Chimmy lineup',
    chimmySub: "Chimmy sets this team's starters before each lineup lock, from AF projections. The manager is told, and saving a lineup of their own turns it off.",
    auto: 'Auto-switch injured starters',
    autoSub: 'Swap a starter who might not play for the best healthy bench player who fits the slot.',
    levelLabel: 'Switch a starter who is',
    levelOut: 'Out only',
    levelDoubtful: 'Doubtful or worse',
    levelQuestionable: 'Questionable or worse',
    timingLabel: 'Check',
    timingPregame: '90 min before each game (inactives)',
    timingNightBefore: 'The night before each game',
    riskNote: 'Doubtful and questionable players often play. Out only never benches someone who suits up.',
    needsPro: (name: string): string => `Runs only while ${name} has AllFantasy Pro.`,
    managedNote: 'While Chimmy sets this lineup, it already benches a starter who is out.',
    notice: 'The manager is told when you turn either one on, and can turn it off.',
    imported: 'This league is hosted on another site. AllFantasy can’t change a lineup there, so these switches work in leagues played on AllFantasy.',
    weekly: 'Auto-switch works in leagues with weekly lineups set on AllFantasy.',
    emptySeat: 'Open seat',
    you: 'Manager',
    failed: 'Could not save. Try again.',
    saved: 'Saved',
    loading: 'Loading members…',
  },
  es: {
    title: 'Ajustes de Miembros',
    members: 'Miembros',
    chimmy: 'Alineación de Chimmy',
    chimmySub: 'Chimmy pone los titulares de este equipo antes de cada cierre, con las proyecciones de AF. Se le avisa al mánager, y si guarda una alineación propia se desactiva.',
    auto: 'Cambio automático de titulares lesionados',
    autoSub: 'Cambia a un titular que quizá no juegue por el mejor suplente sano que encaje en el puesto.',
    levelLabel: 'Cambiar a un titular que',
    levelOut: 'Solo descartado',
    levelDoubtful: 'En duda o peor',
    levelQuestionable: 'Cuestionable o peor',
    timingLabel: 'Revisar',
    timingPregame: '90 min antes de cada partido (inactivos)',
    timingNightBefore: 'La noche antes de cada partido',
    riskNote: 'Los jugadores en duda o cuestionables muchas veces juegan. Solo descartado nunca sienta a alguien que se viste.',
    needsPro: (name: string): string => `Solo funciona mientras ${name} tenga AllFantasy Pro.`,
    managedNote: 'Mientras Chimmy pone esta alineación, ya sienta a un titular descartado.',
    notice: 'Se le avisa al mánager cuando activas cualquiera de los dos, y puede desactivarlo.',
    imported: 'Esta liga está en otro sitio. AllFantasy no puede cambiar una alineación allí, así que estos ajustes funcionan en ligas jugadas en AllFantasy.',
    weekly: 'El cambio automático funciona en ligas con alineaciones semanales puestas en AllFantasy.',
    emptySeat: 'Puesto libre',
    you: 'Mánager',
    failed: 'No se pudo guardar. Inténtalo de nuevo.',
    saved: 'Guardado',
    loading: 'Cargando miembros…',
  },
})

const LEVEL_KEY = { out: 'levelOut', doubtful: 'levelDoubtful', questionable: 'levelQuestionable' } as const
const TIMING_KEY = { pregame_90: 'timingPregame', night_before: 'timingNightBefore' } as const

function Switch({ on, disabled, labelledBy, onToggle, testId }: { on: boolean; disabled?: boolean; labelledBy: string; onToggle: () => void; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={onToggle}
      data-testid={testId}
      className="relative h-[30px] w-[52px] shrink-0 rounded-full border-0 p-0 disabled:opacity-50"
      style={{ background: on ? T.blue : T.line }}
    >
      <span className="absolute top-[3px] h-6 w-6 rounded-full bg-white transition-[left]" style={{ left: on ? 25 : 3 }} />
    </button>
  )
}

const initials = (name: string) => name.replace(/^@/, '').slice(0, 2).toUpperCase()

export function MemberLineupSettings({ leagueId }: { leagueId: string }) {
  const c = useMessages(memberLineupMessages)
  const [inactive, setInactive] = useState<InactiveView | null>(null)
  const [auto, setAuto] = useState<AutoView | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const base = `/api/leagues/${encodeURIComponent(leagueId)}`

  const load = useCallback(async () => {
    const [i, a] = await Promise.all([
      fetch(`${base}/inactive-managers`, { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${base}/auto-switch-injured?scope=league`, { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    setInactive(i ?? { native: false, teams: [] })
    setAuto(a ?? { available: false, teams: [] })
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  const teams = inactive?.teams ?? []
  const current = useMemo(() => teams.find((t) => t.rosterId === selected) ?? teams[0] ?? null, [teams, selected])
  const autoFor = (rosterId: string) => auto?.teams.find((t) => t.rosterId === rosterId) ?? null

  async function post(url: string, body: unknown, key: string) {
    setBusy(key)
    setMessage(null)
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = (await res?.json().catch(() => null)) as { error?: string } | null
    setBusy(null)
    if (res?.ok) {
      setMessage({ kind: 'ok', text: c.saved })
      await load()
    } else {
      setMessage({ kind: 'error', text: json?.error ?? c.failed })
    }
  }

  if (!inactive || !auto) {
    return <p className="m-0 text-[13px]" style={{ color: T.muted }}>{c.loading}</p>
  }

  if (!inactive.native) {
    return (
      <section className="flex flex-col gap-2" data-testid="member-lineup-settings">
        <h3 className="m-0 text-[20px] font-bold" style={{ color: T.text }}>{c.title}</h3>
        <p className="m-0 text-[13px] leading-relaxed" style={{ color: T.muted }} data-testid="member-lineup-imported">{c.imported}</p>
      </section>
    )
  }

  const a = current ? autoFor(current.rosterId) : null
  const autoOn = Boolean(a?.setting)
  const level: Level = a?.setting?.level ?? 'out'
  const timing: Timing = a?.setting?.timing ?? 'pregame_90'
  const name = (t: InactiveTeam) => t.managerName ?? t.teamName ?? c.you
  const saveAuto = (next: { on: boolean; level?: Level; timing?: Timing }) =>
    current && post(`${base}/auto-switch-injured`, { rosterId: current.rosterId, on: next.on, level: next.level ?? level, timing: next.timing ?? timing }, 'auto')

  return (
    <section className="flex flex-col gap-3" data-testid="member-lineup-settings">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[20px] font-bold" style={{ color: T.text }}>{c.title}</h3>
        {current ? <span className="text-[14px]" style={{ color: T.muted }}>{name(current)}</span> : null}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <nav aria-label={c.members} className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 pr-3" style={{ borderRight: `1px solid ${T.line}` }}>
          {teams.map((t) => {
            const on = t.rosterId === current?.rosterId
            const tags = [t.managed ? c.chimmy : null, autoFor(t.rosterId)?.setting ? c.auto : null].filter(Boolean)
            return (
              <button
                key={t.rosterId}
                type="button"
                onClick={() => setSelected(t.rosterId)}
                aria-current={on ? 'true' : undefined}
                className="flex min-h-[48px] items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left"
                style={{ color: T.text, background: on ? `rgba(${T.rgb}, .14)` : 'transparent', border: `1px solid ${on ? T.strong : 'transparent'}` }}
                data-testid="member-lineup-member"
              >
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-extrabold" style={{ background: T.surface2, color: T.muted }}>{initials(name(t))}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-bold">{name(t)}</span>
                  <span className="truncate text-[12px]" style={{ color: T.muted }}>{t.emptySeat ? c.emptySeat : tags.join(' · ') || t.teamName}</span>
                </span>
              </button>
            )
          })}
        </nav>

        {current ? (
          <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-3 rounded-xl p-4" style={{ border: '1px solid rgba(59,130,246,.45)', background: 'rgba(59,130,246,.06)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col gap-0.5">
                <span id="member-chimmy-lineup" className="text-[15px] font-bold" style={{ color: T.text }}>{c.chimmy}</span>
                <span className="text-[13px]" style={{ color: T.muted }}>{c.chimmySub}</span>
              </span>
              <Switch
                on={Boolean(current.managed)}
                disabled={busy !== null}
                labelledBy="member-chimmy-lineup"
                testId="member-chimmy-switch"
                onToggle={() => void post(`${base}/inactive-managers`, { rosterId: current.rosterId, on: !current.managed }, 'chimmy')}
              />
            </div>

            <div className="h-px" style={{ background: T.line }} />

            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col gap-0.5">
                <span id="member-auto-switch" className="text-[15px] font-bold" style={{ color: T.text }}>{c.auto}</span>
                <span className="text-[13px]" style={{ color: T.muted }}>{c.autoSub}</span>
              </span>
              <Switch
                on={autoOn}
                disabled={busy !== null || !auto.available || current.emptySeat}
                labelledBy="member-auto-switch"
                testId="member-auto-switch"
                onToggle={() => void saveAuto({ on: !autoOn })}
              />
            </div>

            {!auto.available ? <p className="m-0 text-[12px]" style={{ color: T.muted }}>{c.weekly}</p> : null}

            {autoOn ? (
              <div className="flex flex-col gap-2.5 rounded-[10px] p-3" style={{ background: T.surface2 }} data-testid="member-auto-options">
                <div className="flex flex-wrap gap-2.5">
                <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 text-[13px] font-bold" style={{ color: T.text }}>
                  {c.levelLabel}
                  <select
                    value={level}
                    disabled={busy !== null}
                    onChange={(e) => void saveAuto({ on: true, level: e.target.value as Level })}
                    className="min-h-[40px] rounded-[10px] px-2.5 text-[14px]"
                    style={{ border: `1px solid ${T.line}`, background: T.surface, color: T.text }}
                    data-testid="member-auto-level"
                  >
                    {(Object.keys(LEVEL_KEY) as Level[]).map((k) => <option key={k} value={k}>{c[LEVEL_KEY[k]]}</option>)}
                  </select>
                </label>
                <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 text-[13px] font-bold" style={{ color: T.text }}>
                  {c.timingLabel}
                  <select
                    value={timing}
                    disabled={busy !== null}
                    onChange={(e) => void saveAuto({ on: true, timing: e.target.value as Timing })}
                    className="min-h-[40px] rounded-[10px] px-2.5 text-[14px]"
                    style={{ border: `1px solid ${T.line}`, background: T.surface, color: T.text }}
                    data-testid="member-auto-timing"
                  >
                    {(Object.keys(TIMING_KEY) as Timing[]).map((k) => <option key={k} value={k}>{c[TIMING_KEY[k]]}</option>)}
                  </select>
                </label>
                </div>
                {level !== 'out' ? <p className="m-0 text-[12px] leading-relaxed" style={{ color: T.muted }} data-testid="member-auto-risk">{c.riskNote}</p> : null}
                {a && !a.ownerHasPro ? <p className="m-0 text-[12px] font-semibold" style={{ color: T.text }} data-testid="member-auto-needs-pro">{c.needsPro(name(current))}</p> : null}
                {current.managed ? <p className="m-0 text-[12px]" style={{ color: T.muted }}>{c.managedNote}</p> : null}
              </div>
            ) : null}

            <p className="m-0 text-[12px] leading-relaxed" style={{ color: T.muted }}>{c.notice}</p>
            {message ? (
              <p role={message.kind === 'error' ? 'alert' : 'status'} className="m-0 text-[13px] font-semibold" style={{ color: message.kind === 'error' ? '#ff6b81' : T.text }}>
                {message.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
