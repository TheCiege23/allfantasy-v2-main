'use client'

/**
 * Connect LeagueSafe — the commissioner's walkthrough (lib/leaguesafe/league-connection.ts).
 *
 * Four steps: name the LeagueSafe league and its dues, add the AllFantasy address to it in LeagueSafe,
 * wait for the first notice, then say which team each LeagueSafe payer is. From there a payer who has
 * paid in full has their team(s) marked paid in the dues tracker. LeagueSafe keeps the money.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Team = { id: string; teamName: string | null; ownerName: string | null }
type Member = {
  id: string
  name: string
  teamId: string | null
  confirmed: boolean
  teamsCovered: string[]
  suggestedTeamId: string | null
  dueCents: number
  paidCents: number
  owedCents: number
  status: 'paid' | 'partial' | 'unpaid' | 'overdue'
}
type View = {
  botAddress: string
  connection: { lsLeagueName: string; status: string; lastEmailAt: string | null; duesAmount: number; currency: string; dueDate: string | null } | null
  members: Member[]
  teams: Team[]
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const field = 'mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-[13px] text-white'
const button = 'min-h-[40px] rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50'

export function LeagueSafeConnectCard({ leagueId, onTrackerChanged }: { leagueId: string; onTrackerChanged?: () => void }) {
  const { t } = useLanguage()
  const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/leaguesafe`
  const [view, setView] = useState<View | null>(null)
  const [name, setName] = useState('')
  const [dues, setDues] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [picks, setPicks] = useState<Record<string, string>>({})

  const adopt = useCallback((next: View) => {
    setView(next)
    if (next.connection) {
      setName(next.connection.lsLeagueName)
      setDues(String(next.connection.duesAmount))
      setDueDate(next.connection.dueDate ?? '')
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch(endpoint, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (active && data) adopt(data as View) })
      .catch(() => {})
    return () => { active = false }
  }, [endpoint, adopt])

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = (await res.json().catch(() => ({}))) as View & { error?: string }
        if (!res.ok) { setError(data.error ?? t('ls.failed')); return }
        adopt(data)
        onTrackerChanged?.()
      } catch {
        setError(t('ls.failed'))
      } finally {
        setBusy(false)
      }
    },
    [endpoint, adopt, onTrackerChanged, t],
  )

  // Commissioner-only: the route refuses everyone else, and nothing is shown until it answers.
  if (!view) return null
  const connection = view.connection
  const connected = connection?.status === 'active'
  const teamLabel = (id: string | null) => {
    const team = view.teams.find((x) => x.id === id)
    return team ? team.teamName?.trim() || team.ownerName?.trim() || '—' : '—'
  }
  const statusLabel: Record<Member['status'], string> = {
    paid: t('ls.statusPaid'), partial: t('ls.statusPartial'), unpaid: t('ls.statusUnpaid'), overdue: t('ls.statusOverdue'),
  }

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid="leaguesafe-connect">
      <div>
        <h4 className="text-sm font-semibold text-white">{t('ls.title')}</h4>
        <p className="mt-0.5 text-[12px] text-white/50">{t('ls.subtitle')}</p>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-semibold text-white/80">{t('ls.step1')}</p>
        <label className="block text-[12px] text-white/60">
          {t('ls.leagueName')}
          <input className={field} value={name} maxLength={256} onChange={(e) => setName(e.target.value)} data-testid="leaguesafe-league-name" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[12px] text-white/60">
            {t('ls.duesPerTeam')}
            <input className={field} type="number" min={0} step="0.01" inputMode="decimal" value={dues} onChange={(e) => setDues(e.target.value)} data-testid="leaguesafe-dues" />
          </label>
          <label className="block text-[12px] text-white/60">
            {t('ls.dueDate')}
            <input className={field} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className={`${button} bg-emerald-600/30`}
          disabled={busy || name.trim().length < 2 || dues === ''}
          onClick={() => void send({ action: 'connect', lsLeagueName: name, duesAmount: Number(dues), dueDate: dueDate || null })}
          data-testid="leaguesafe-save"
        >
          {busy ? t('ls.saving') : t('ls.save')}
        </button>
        {connection?.status === 'disconnected' ? <p className="text-[12px] text-amber-200/80">{t('ls.disconnected')}</p> : null}
      </div>

      {connection && connection.status !== 'disconnected' ? (
        <>
          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-white/80">{t('ls.step2')}</p>
            <p className="text-[12px] text-white/55">{t('ls.step2Help')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-[13px] text-white" data-testid="leaguesafe-bot-address">{view.botAddress}</code>
              <button
                type="button"
                className={button}
                onClick={() => { void navigator.clipboard.writeText(view.botAddress).then(() => setCopied(true)).catch(() => {}) }}
              >
                {copied ? t('ls.copied') : t('ls.copyAddress')}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-white/80">{t('ls.step3')}</p>
            <p className={`text-[12px] ${connected ? 'text-emerald-300' : 'text-white/55'}`} role="status" data-testid="leaguesafe-status">
              {connected
                ? t('ls.connected').replace('{{date}}', connection.lastEmailAt ? new Date(connection.lastEmailAt).toLocaleDateString() : '—')
                : t('ls.waiting')}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-white/80">{t('ls.step4')}</p>
            <p className="text-[12px] text-white/55">{t('ls.step4Help')}</p>
            {view.members.length === 0 ? <p className="text-[12px] text-white/45">{t('ls.noPayers')}</p> : null}
            <ul className="space-y-2">
              {view.members.map((m) => {
                const chosen = picks[m.id] ?? m.suggestedTeamId ?? ''
                return (
                  <li key={m.id} className="rounded-lg border border-white/10 px-3 py-2" data-testid="leaguesafe-member">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-white">{m.name}</span>
                      <span className={`text-[11px] ${m.status === 'paid' ? 'text-emerald-300' : m.status === 'overdue' ? 'text-red-300' : 'text-white/55'}`}>
                        {statusLabel[m.status]} · {t('ls.paidOf').replace('{{paid}}', money(m.paidCents)).replace('{{due}}', money(m.dueCents))}
                      </span>
                    </div>
                    {m.confirmed && m.teamId ? (
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[12px] text-white/70">
                        <span>
                          {teamLabel(m.teamId)}
                          {m.teamsCovered.length > 1 ? ` · ${t('ls.teamsCovered').replace('{{n}}', String(m.teamsCovered.length))}` : ''}
                        </span>
                        <button type="button" className={button} disabled={busy} onClick={() => void send({ action: 'match', memberId: m.id, teamId: null })}>
                          {t('ls.unmatch')}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <select
                          aria-label={t('ls.pickTeam')}
                          className="min-h-[40px] flex-1 rounded-lg border border-white/15 bg-black/30 px-2 text-[12px] text-white"
                          value={chosen}
                          onChange={(e) => setPicks((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        >
                          <option value="">{t('ls.pickTeam')}</option>
                          {view.teams.map((team) => (
                            <option key={team.id} value={team.id}>{teamLabel(team.id)}</option>
                          ))}
                        </select>
                        <button type="button" className={`${button} bg-emerald-600/30`} disabled={busy || !chosen} onClick={() => void send({ action: 'match', memberId: m.id, teamId: chosen })}>
                          {t('ls.confirm')}
                        </button>
                        {m.suggestedTeamId && !picks[m.id] ? (
                          <span className="w-full text-[11px] text-white/45">{t('ls.suggested').replace('{{team}}', teamLabel(m.suggestedTeamId))}</span>
                        ) : null}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          <button type="button" className={`${button} text-white/60`} disabled={busy} onClick={() => void send({ action: 'disconnect' })}>
            {t('ls.disconnect')}
          </button>
        </>
      ) : null}
      {error ? <p role="alert" className="text-[12px] text-red-300">{error}</p> : null}
    </section>
  )
}
