'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Bell, RadioTower, ShieldAlert, Skull, Sparkles } from 'lucide-react'
import { CommissionerSettingsModal } from '@/app/league/[leagueId]/components/CommissionerSettingsModal'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type ZombiePendingSitOutResponse = {
  sitOutId: string | null
  week: number
}

type ZMeta = {
  league?: {
    name?: string | null
    universeId?: string | null
    currentWeek?: number
    status?: string
    counts?: {
      survivor?: number
      zombie?: number
      whisperer?: number
      alive?: number
      total?: number
      horde?: number
    }
  }
  myActiveItemCount?: number
  myPendingItemCount?: number
  viewerIsCommissioner?: boolean
  commissionerNotifications?: {
    unread?: number
    actionRequired?: number
  }
  hordeSitOuts?: {
    myPendingResponse?: ZombiePendingSitOutResponse | null
  }
}

function navActive(pathname: string, href: string, lid: string): boolean {
  if (!pathname) return false
  if (href === `/zombie/${lid}`) return pathname === href
  if (href.startsWith(`/zombie/${lid}`)) return pathname === href || pathname.startsWith(`${href}/`)
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function ZombieLeagueShell({
  leagueId,
  children,
}: {
  leagueId: string
  children: React.ReactNode
}) {
  const { t, tInterpolate } = useLanguage()
  const pathname = usePathname()
  const currentPath = pathname ?? ''
  const [meta, setMeta] = useState<ZMeta | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [submittingDecision, setSubmittingDecision] = useState<'yes' | 'no' | null>(null)
  const [notificationError, setNotificationError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ZMeta | null) => setMeta(d))
      .catch(() => setMeta(null))
  }, [leagueId])

  const title = meta?.league?.name ?? t('zombie.shell.defaultTitle')
  const universeId = meta?.league?.universeId
  const itemCount = meta?.myActiveItemCount ?? 0
  const pendingCount = meta?.myPendingItemCount ?? 0
  const showComm = meta?.viewerIsCommissioner === true
  const week = Math.max(1, meta?.league?.currentWeek ?? 1)
  const survivorCount = meta?.league?.counts?.alive ?? 0
  const hordeCount = meta?.league?.counts?.horde ?? 0
  const whispererCount = meta?.league?.counts?.whisperer ?? 0
  const unreadOps = meta?.commissionerNotifications?.unread ?? 0
  const urgentOps = meta?.commissionerNotifications?.actionRequired ?? 0
  const pendingSitOut = meta?.hordeSitOuts?.myPendingResponse ?? null
  const notificationCount = (pendingSitOut?.sitOutId ? 1 : 0) + unreadOps

  const desktopNav = useMemo(
    () =>
      [
        { key: 'home', href: `/zombie/${leagueId}`, label: t('zombie.shell.nav.home'), emoji: '🏚' as const },
        { key: 'standings', href: `/zombie/${leagueId}/standings`, label: t('zombie.shell.nav.standings'), emoji: '📊' as const },
        { key: 'matchups', href: `/zombie/${leagueId}/matchups`, label: t('zombie.shell.nav.matchups'), emoji: '🎯' as const },
        { key: 'chat', href: `/zombie/${leagueId}/chat`, label: t('zombie.shell.nav.chat'), emoji: '💬' as const },
        { key: 'items', href: `/zombie/${leagueId}/items`, label: t('zombie.shell.nav.items'), emoji: '🎒' as const },
        ...(universeId
          ? [{ key: 'universe', href: `/app/zombie-universe/${universeId}`, label: t('zombie.shell.nav.universe'), emoji: '🌍' as const }]
          : []),
        { key: 'rules', href: `/zombie/${leagueId}/rules`, label: t('zombie.shell.nav.rules'), emoji: '📜' as const },
        { key: 'history', href: `/zombie/${leagueId}/history`, label: t('zombie.shell.nav.history'), emoji: '📖' as const },
        ...(showComm
          ? [{ key: 'commissioner', href: '#ops' as const, label: t('zombie.shell.nav.commissioner'), emoji: '⚙️' as const }]
          : []),
      ] as const,
    [leagueId, universeId, showComm, t],
  )

  const bottomMain = useMemo(
    () =>
      [
        { key: 'home', href: `/zombie/${leagueId}`, label: t('zombie.shell.nav.home') },
        { key: 'standings', href: `/zombie/${leagueId}/standings`, label: t('zombie.shell.nav.standings') },
        { key: 'matchups', href: `/zombie/${leagueId}/matchups`, label: t('zombie.shell.nav.matchups') },
        { key: 'chat', href: `/zombie/${leagueId}/chat`, label: t('zombie.shell.nav.chat') },
      ] as const,
    [leagueId, t],
  )

  const drawerLinks = useMemo(
    () =>
      [
        { key: 'items', href: `/zombie/${leagueId}/items`, label: t('zombie.shell.nav.itemsInventory'), emoji: '🎒' },
        ...(universeId
          ? [{ key: 'universe', href: `/app/zombie-universe/${universeId}`, label: t('zombie.shell.nav.universe'), emoji: '🌍' }]
          : []),
        { key: 'rules', href: `/zombie/${leagueId}/rules`, label: t('zombie.shell.nav.rules'), emoji: '📜' },
        { key: 'history', href: `/zombie/${leagueId}/history`, label: t('zombie.shell.nav.history'), emoji: '📖' },
        ...(showComm ? [{ key: 'commissioner', href: '#ops' as const, label: t('zombie.shell.nav.commissioner'), emoji: '⚙️' }] : []),
      ] as const,
    [leagueId, universeId, showComm, t],
  )

  const weekLine = tInterpolate('zombie.shell.weekOutbreak', { week })
  const leagueStatusRaw = meta?.league?.status ?? 'active'
  const leagueStatusLabel =
    leagueStatusRaw === 'active' ? t('zombie.shell.active') : leagueStatusRaw.replace(/_/g, ' ')
  const opsBadgeText =
    urgentOps > 0
      ? tInterpolate('zombie.shell.urgent', { n: urgentOps })
      : unreadOps > 0
        ? tInterpolate('zombie.shell.unreadBadge', { n: unreadOps })
        : t('zombie.shell.ready')
  const dangerStateLabel = hordeCount > survivorCount ? t('zombie.shell.escalating') : t('zombie.shell.contained')

  function openOps() {
    if (showComm) setOpsOpen(true)
  }

  async function refreshMeta() {
    try {
      const response = await fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      })
      if (!response.ok) return
      const data = (await response.json()) as ZMeta
      setMeta(data)
    } catch {
      // Keep stale meta if refresh fails.
    }
  }

  async function submitSitOutDecision(decision: 'yes' | 'no') {
    if (!pendingSitOut?.sitOutId || submittingDecision) return
    setSubmittingDecision(decision)
    setNotificationError(null)
    try {
      const response = await fetch(
        `/api/leagues/${leagueId}/zombie/horde-sit-outs/${pendingSitOut.sitOutId}/respond`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      )
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setNotificationError(payload.error ?? 'Unable to submit your horde sit-out response right now.')
        return
      }
      await refreshMeta()
    } catch {
      setNotificationError('Network error while sending your horde sit-out response.')
    } finally {
      setSubmittingDecision(null)
    }
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden w-[270px] shrink-0 border-r border-[var(--zombie-border)] bg-[radial-gradient(circle_at_top,_rgba(220,38,38,0.14),_transparent_35%),linear-gradient(180deg,#0a0b10_0%,#12141c_52%,#0c0d12_100%)] p-4 md:block">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-[0_0_40px_rgba(220,38,38,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--zombie-text-dim)]">{t('zombie.shell.ops')}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/25 bg-red-950/40 text-red-200">
              <Skull className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[16px] font-bold leading-tight text-[var(--zombie-text-full)]">{title}</h1>
              <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-red-200/70">{weekLine}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/8 p-2">
              <p className="text-white/45">{t('zombie.shell.alive')}</p>
              <p className="mt-1 text-[16px] font-black text-emerald-200">{survivorCount}</p>
            </div>
            <div className="rounded-xl border border-red-500/15 bg-red-500/8 p-2">
              <p className="text-white/45">{t('zombie.shell.horde')}</p>
              <p className="mt-1 text-[16px] font-black text-red-100">{hordeCount}</p>
            </div>
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/8 p-2">
              <p className="text-white/45">{t('zombie.shell.whisperer')}</p>
              <p className="mt-1 text-[16px] font-black text-amber-200">{whispererCount}</p>
            </div>
            <div className="rounded-xl border border-sky-500/15 bg-sky-500/8 p-2">
              <p className="text-white/45">{t('zombie.shell.inventory')}</p>
              <p className="mt-1 text-[16px] font-black text-sky-100">{itemCount}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setNotificationsOpen((value) => !value)}
            className="mt-4 flex min-h-[44px] w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-[12px] font-semibold text-white/85 transition hover:bg-white/[0.08]"
          >
            <span className="inline-flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Horde alerts
            </span>
            {notificationCount > 0 ? (
              <span className="rounded-full bg-red-500/20 px-2 py-1 text-[11px] font-bold text-red-100">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            ) : (
              <span className="text-[11px] text-white/45">Clear</span>
            )}
          </button>

          {notificationsOpen ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-[11px] shadow-[0_0_30px_rgba(220,38,38,0.06)]">
              {pendingSitOut?.sitOutId ? (
                <div className="rounded-xl border border-amber-300/35 bg-amber-500/10 p-3">
                  <p className="font-semibold text-amber-100">Horde sit-out nomination pending</p>
                  <p className="mt-1 text-white/70">
                    You were nominated to sit out for week {pendingSitOut.week}. Accept to lock yourself out of horde scoring and action commands for this week.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
                      onClick={() => void submitSitOutDecision('yes')}
                      disabled={Boolean(submittingDecision)}
                    >
                      {submittingDecision === 'yes' ? 'Submitting...' : 'Yes, sit me out'}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-rose-300/40 bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100 disabled:opacity-50"
                      onClick={() => void submitSitOutDecision('no')}
                      disabled={Boolean(submittingDecision)}
                    >
                      {submittingDecision === 'no' ? 'Submitting...' : 'No, keep me active'}
                    </button>
                  </div>
                  {notificationError ? <p className="mt-2 text-rose-200">{notificationError}</p> : null}
                </div>
              ) : (
                <p className="text-white/50">No personal horde alerts right now.</p>
              )}
              {showComm && unreadOps > 0 ? (
                <p className="mt-3 text-white/55">
                  Commissioner ops still has {urgentOps > 0 ? `${urgentOps} urgent` : `${unreadOps} unread`} notification{(urgentOps > 0 ? urgentOps : unreadOps) === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
          ) : null}

          {showComm ? (
            <button
              type="button"
              onClick={openOps}
              className="mt-4 flex min-h-[44px] w-full items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left text-[12px] font-semibold text-amber-100 transition hover:bg-amber-500/15"
            >
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                {t('zombie.shell.commissionerOps')}
              </span>
              <span className="rounded-full bg-black/25 px-2 py-1 text-[11px]">
                {opsBadgeText}
              </span>
            </button>
          ) : null}
        </div>

        <p className="mt-5 text-[11px] font-bold uppercase tracking-widest text-[var(--zombie-text-dim)]">{t('zombie.shell.navigation')}</p>
        <nav className="mt-3 flex flex-col gap-1">
          {desktopNav.map((n) =>
            n.href === '#ops' ? (
              <button
                key={n.key}
                type="button"
                onClick={openOps}
                className={clsx(
                  'flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px] transition-colors',
                  opsOpen ? 'bg-amber-500/15 text-amber-100' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/90',
                )}
                data-testid={`zombie-nav-${n.key}`}
              >
                <span>
                  {n.emoji ? `${n.emoji} ` : ''}
                  {n.label}
                </span>
                {urgentOps > 0 ? (
                  <span className="rounded-full bg-amber-500/20 px-2 text-[11px] font-bold text-amber-100">{urgentOps}</span>
                ) : unreadOps > 0 ? (
                  <span className="rounded-full bg-white/10 px-2 text-[11px] font-bold text-white/75">{unreadOps}</span>
                ) : null}
              </button>
            ) : (
              <Link
                key={n.key}
                href={n.href}
                className={clsx(
                  'flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px] transition-colors',
                  navActive(currentPath, n.href, leagueId) ? 'bg-sky-500/15 text-sky-200' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/90',
                )}
                data-testid={`zombie-nav-${n.key}`}
              >
                <span>
                  {n.emoji ? `${n.emoji} ` : ''}
                  {n.label}
                </span>
                {n.key === 'items' && itemCount > 0 ? (
                  <span className="rounded-full bg-teal-500/25 px-1.5 text-[11px] font-bold text-teal-200">{itemCount}</span>
                ) : null}
              </Link>
            ),
          )}
        </nav>

        <div className="mt-6 space-y-2 rounded-2xl border border-white/8 bg-black/20 p-3 text-[11px]">
          <div className="flex items-center justify-between text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
              {t('zombie.shell.liveDanger')}
            </span>
            <span>{dangerStateLabel}</span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              {t('zombie.shell.pendingItems')}
            </span>
            <span>{pendingCount}</span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <RadioTower className="h-3.5 w-3.5 text-amber-300" />
              {t('zombie.shell.leagueState')}
            </span>
            <span className="capitalize">{leagueStatusLabel}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[var(--zombie-border)] bg-[linear-gradient(180deg,rgba(17,18,24,0.98),rgba(10,11,16,0.96))] px-4 py-3 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="truncate text-[14px] font-semibold text-white">{title}</span>
              <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-white/45">{weekLine}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNotificationsOpen((value) => !value)}
                className="relative rounded-xl border border-white/10 bg-white/5 p-2 text-white/85"
                aria-label={notificationCount > 0 ? `Zombie notifications, ${notificationCount} items` : 'Zombie notifications'}
              >
                <Bell className="h-4 w-4" />
                {notificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                ) : null}
              </button>
              {showComm ? (
                <button
                  type="button"
                  onClick={openOps}
                  className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-100"
                >
                  {t('zombie.shell.opsShort')}
                </button>
              ) : null}
            </div>
          </div>
          {notificationsOpen ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-[11px]">
              {pendingSitOut?.sitOutId ? (
                <>
                  <p className="font-semibold text-amber-100">Horde sit-out nomination pending</p>
                  <p className="mt-1 text-white/65">Week {pendingSitOut.week}. Respond here instead of calling the API manually.</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
                      onClick={() => void submitSitOutDecision('yes')}
                      disabled={Boolean(submittingDecision)}
                    >
                      {submittingDecision === 'yes' ? 'Submitting...' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-rose-300/40 bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100 disabled:opacity-50"
                      onClick={() => void submitSitOutDecision('no')}
                      disabled={Boolean(submittingDecision)}
                    >
                      {submittingDecision === 'no' ? 'Submitting...' : 'No'}
                    </button>
                  </div>
                  {notificationError ? <p className="mt-2 text-rose-200">{notificationError}</p> : null}
                </>
              ) : (
                <p className="text-white/50">No personal horde alerts right now.</p>
              )}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
            <div className="rounded-lg bg-white/5 px-2 py-2 text-white/70">
              <div className="text-white/40">{t('zombie.shell.alive')}</div>
              <div className="mt-1 font-black text-emerald-200">{survivorCount}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-2 py-2 text-white/70">
              <div className="text-white/40">{t('zombie.shell.horde')}</div>
              <div className="mt-1 font-black text-red-100">{hordeCount}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-2 py-2 text-white/70">
              <div className="text-white/40">{t('zombie.shell.nav.items')}</div>
              <div className="mt-1 font-black text-sky-100">{itemCount}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-2 py-2 text-white/70">
              <div className="text-white/40">{t('zombie.shell.opsShort')}</div>
              <div className="mt-1 font-black text-amber-100">{urgentOps || unreadOps}</div>
            </div>
          </div>
        </header>

        <nav className="grid grid-cols-5 border-b border-[var(--zombie-border)] bg-[var(--zombie-panel)] md:hidden">
          {bottomMain.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={clsx(
                'flex min-h-[48px] flex-col items-center justify-center px-1 py-2 text-[11px] font-medium',
                navActive(currentPath, n.href, leagueId) ? 'text-sky-200' : 'text-white/60',
              )}
            >
              <span className="text-[11px]">{n.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex min-h-[48px] flex-col items-center justify-center px-1 py-2 text-[11px] font-medium text-white/60"
            aria-expanded={moreOpen}
            aria-label={t('zombie.shell.moreAria')}
            data-testid="zombie-nav-more"
          >
            ···
            <span className="text-[11px]">{t('zombie.shell.moreNav')}</span>
          </button>
        </nav>

        {moreOpen ? (
          <div
            className="fixed inset-0 z-40 bg-black/70 md:hidden"
            role="presentation"
            onClick={() => setMoreOpen(false)}
          >
            <div
              className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={t('zombie.shell.moreDialogAria')}
            >
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[var(--zombie-text-dim)]">{t('zombie.shell.moreNav')}</p>
              <div className="flex flex-col gap-1">
                {drawerLinks.map((n) =>
                  n.href === '#ops' ? (
                    <button
                      key={n.key}
                      type="button"
                      onClick={() => {
                        setMoreOpen(false)
                        openOps()
                      }}
                      className="flex min-h-[44px] items-center justify-between rounded-xl px-3 py-2 text-[14px] text-white/85 hover:bg-white/[0.06]"
                    >
                      <span>
                        {n.emoji} {n.label}
                      </span>
                      {urgentOps > 0 ? (
                        <span className="rounded-full bg-amber-500/25 px-2 text-[11px] font-bold text-amber-100">{urgentOps}</span>
                      ) : unreadOps > 0 ? (
                        <span className="rounded-full bg-white/10 px-2 text-[11px] font-bold text-white/75">{unreadOps}</span>
                      ) : null}
                    </button>
                  ) : (
                    <Link
                      key={n.key}
                      href={n.href}
                      onClick={() => setMoreOpen(false)}
                      className="flex min-h-[44px] items-center justify-between rounded-xl px-3 py-2 text-[14px] text-white/85 hover:bg-white/[0.06]"
                    >
                      <span>
                        {n.emoji} {n.label}
                      </span>
                      {n.key === 'items' && itemCount > 0 ? (
                        <span className="rounded-full bg-teal-500/25 px-2 text-[11px] font-bold text-teal-200">🎒 {itemCount}</span>
                      ) : null}
                    </Link>
                  ),
                )}
              </div>
            </div>
          </div>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(9,10,14,0.9),rgba(12,14,18,1))] p-4">
          {children}
        </main>
      </div>
      {showComm ? <CommissionerSettingsModal leagueId={leagueId} isOpen={opsOpen} onClose={() => setOpsOpen(false)} /> : null}
    </div>
  )
}
