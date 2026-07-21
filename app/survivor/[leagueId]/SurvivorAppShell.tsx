'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import type { SurvivorUiPlayerState } from '@/lib/survivor/survivorUiTypes'
import { SurvivorUiProvider, useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { NotificationBell } from '@/app/survivor/components/NotificationBell'
import { SurvivorStatusBadge, type SurvivorStatusBadgeVariant } from '@/app/survivor/components/SurvivorStatusBadge'
import { LeagueIntroVideoModal } from '@/components/league/LeagueIntroVideoModal'
import { LeagueSettingsShell } from '@/components/league/LeagueSettingsShell'
import { LeagueSettingsTab } from '@/components/league/LeagueSettingsTab'
import { CommissionerToolsTab } from '@/components/league/CommissionerToolsTab'
import { SurvivorFormatTab } from '@/components/league/SurvivorFormatTab'
import { getLeagueTypeMedia } from '@/lib/league-media/leagueTypeMedia'
import { SpecialtyLeagueAtmosphere } from '@/components/league-atmosphere/SpecialtyLeagueAtmosphere'

function pathActive(pathname: string, href: string, isHome?: boolean) {
  if (isHome) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function badgeForPlayerState(p: SurvivorUiPlayerState): SurvivorStatusBadgeVariant {
  switch (p) {
    case 'immune':
      return 'immune'
    case 'exile':
      return 'exiled'
    case 'jury':
      return 'jury'
    case 'finalist':
      return 'finalist'
    case 'eliminated':
      return 'eliminated'
    default:
      return 'safe'
  }
}

function SurvivorAppShellInner({
  leagueId,
  children,
}: {
  leagueId: string
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const ctx = useSurvivorUi()
  const [expanded, setExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const base = `/survivor/${leagueId}`
  const tribalHot = ctx.season?.activeCouncil?.status === 'voting_open'
  const exileHot = Boolean(ctx.season?.exileStatus?.isActive && ctx.playerState === 'exile')
  const challengeHot = ctx.season?.currentChallenge?.status === 'open'

  const showExileTab =
    ctx.playerState === 'exile' || ctx.isCommissioner || ctx.leaguePhase === 'merge'
  const showJuryTab =
    ctx.leaguePhase === 'jury' ||
    ctx.leaguePhase === 'finale' ||
    ctx.playerState === 'jury' ||
    ctx.playerState === 'finalist'
  const hasAfCommissionerSub = Boolean(
    (ctx.season as { hasAfCommissionerSub?: unknown } | null)?.hasAfCommissionerSub,
  )

  type NavItem = {
    href: string
    label: string
    icon: string
    show: boolean
    dot: boolean
    home?: boolean
    onClick?: () => void
    actionOnly?: boolean
  }

  const desktopItems: NavItem[] = [
    { href: base, label: 'Island Home', icon: '🏝', show: true, dot: false, home: true },
    {
      href: `${base}/commissioner`,
      label: 'Command',
      icon: '🎛',
      show: ctx.isCommissioner,
      dot: false,
      home: false,
    },
    {
      href: `${base}/tribe`,
      label: 'Tribe',
      icon: '🔥',
      show: ctx.playerState !== 'exile',
      dot: false,
      home: false,
    },
    { href: `${base}/challenges`, label: 'Challenges', icon: '⚡', show: true, dot: challengeHot, home: false },
    { href: `${base}/chat`, label: 'Chat', icon: '💬', show: true, dot: false, home: false },
    { href: `${base}/chimmy`, label: '@Chimmy', icon: '🤖', show: true, dot: false, home: false },
    { href: `${base}/tribal`, label: 'Tribal', icon: '🗳', show: true, dot: tribalHot, home: false },
    { href: `${base}/exile`, label: 'Exile', icon: '🏚', show: showExileTab, dot: exileHot, home: false },
    { href: `${base}/jury`, label: 'Jury', icon: '⚖️', show: showJuryTab, dot: false, home: false },
    { href: `${base}/episodes`, label: 'Episodes', icon: '📜', show: true, dot: false, home: false },
    {
      href: '#settings',
      label: 'Settings',
      icon: '⚙️',
      show: ctx.isCommissioner,
      dot: ctx.isCommissioner && ctx.canEditLeagueSettings,
      onClick: () => setSettingsOpen(true),
      actionOnly: true,
      home: false,
    },
  ].filter((x) => x.show)

  const mobileMain = [
    { href: base, label: 'Home', icon: '🏝' },
    { href: `${base}/tribe`, label: 'Tribe', icon: '🔥', hide: ctx.playerState === 'exile' },
    { href: `${base}/chat`, label: 'Chat', icon: '💬' },
    { href: `${base}/tribal`, label: 'Tribal', icon: '🗳', pulse: tribalHot },
    { href: `${base}/exile`, label: 'Exile', icon: '🏚', hide: !showExileTab, pulse: exileHot },
  ].filter((x) => !x.hide)

  const displayName = ctx.season?.userState?.displayName ?? 'Player'

  const atmosphereMood = useMemo(() => {
    if (pathname.includes('/tribal')) return 'tribal'
    if (pathname.includes('/exile')) return 'exile'
    if (pathname.includes('/jury')) return 'jury'
    if (pathname.includes('/tribe')) return 'merge'
    return 'default'
  }, [pathname])

  return (
    <>
      <SpecialtyLeagueAtmosphere variant="survivor" mood={atmosphereMood} />
      <div
        className="relative z-[1] flex min-h-screen flex-col text-[var(--survivor-text-bright)]"
        style={{ background: 'transparent' }}
      >
      {/* Top bar — mobile + desktop */}
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-[var(--survivor-border)] bg-black/45 px-3 py-2 backdrop-blur-xl md:pl-[72px]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold uppercase tracking-wider text-white/55">
            {ctx.leagueName}
          </p>
          <p className="truncate text-[13px] font-semibold text-white">Survivor · Season</p>
        </div>
        <NotificationBell leagueId={leagueId} season={ctx.season} />
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5"
          title="Your status"
        >
          <span
            className={clsx(
              'h-2.5 w-2.5 rounded-full',
              ctx.playerState === 'exile' && 'bg-violet-400',
              ctx.playerState === 'jury' && 'bg-amber-400',
              tribalHot && 'tribal-dot-pulse bg-red-500',
              !tribalHot && ctx.playerState === 'active' && 'bg-emerald-400',
            )}
          />
        </div>
      </header>

      {ctx.survivorFairPlayActive ? (
        <div
          role="status"
          data-testid="survivor-fair-play-banner"
          className="border-b border-amber-500/25 bg-amber-950/35 px-3 py-2.5 text-[11px] leading-snug text-amber-100/90 md:pl-[72px]"
        >
          <span className="font-semibold text-amber-50">Fair play mode.</span>{' '}
          As a playing commissioner, cross-tribe roster intel and elimination history are limited for you in APIs. Your
          tribe view is unchanged. Use a non-playing co-commissioner account for full host visibility.
        </div>
      ) : null}

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside
          className={clsx(
            'hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:flex-col md:border-r md:border-[var(--survivor-border)] md:bg-[#05070c]/78 md:backdrop-blur-xl',
            expanded ? 'md:w-[220px]' : 'md:w-16',
          )}
        >
          <button
            type="button"
            className="mx-auto mt-3 flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-lg"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          >
            {expanded ? '«' : '»'}
          </button>
          <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-2 pb-24">
            {desktopItems.map((item) => (
              item.actionOnly ? (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => item.onClick?.()}
                  className={clsx(
                    'relative flex items-center gap-3 rounded-lg px-2 py-2.5 text-[13px] transition-colors',
                    settingsOpen
                      ? 'bg-sky-500/15 text-sky-100'
                      : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90',
                  )}
                >
                  <span className="flex w-8 justify-center text-lg">{item.icon}</span>
                  {expanded ? <span className="truncate">{item.label}</span> : null}
                  {item.dot ? (
                    <span
                      className={clsx(
                        'absolute right-2 top-2 h-2 w-2 rounded-full',
                        item.label === 'Tribal' && 'bg-red-500 tribal-dot-pulse',
                        item.label === 'Exile' && 'bg-violet-400',
                        item.label === 'Challenges' && 'bg-[var(--survivor-torch)]',
                        item.label === 'Commissioner' && 'bg-amber-400',
                      )}
                    />
                  ) : null}
                </button>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'relative flex items-center gap-3 rounded-lg px-2 py-2.5 text-[13px] transition-colors',
                    pathActive(pathname, item.href, Boolean(item.home))
                      ? 'bg-sky-500/15 text-sky-100'
                      : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90',
                  )}
                >
                  <span className="flex w-8 justify-center text-lg">{item.icon}</span>
                  {expanded ? <span className="truncate">{item.label}</span> : null}
                  {item.dot ? (
                    <span
                      className={clsx(
                        'absolute right-2 top-2 h-2 w-2 rounded-full',
                        item.label === 'Tribal' && 'bg-red-500 tribal-dot-pulse',
                        item.label === 'Exile' && 'bg-violet-400',
                        item.label === 'Challenges' && 'bg-[var(--survivor-torch)]',
                        item.label === 'Commissioner' && 'bg-amber-400',
                      )}
                    />
                  ) : null}
                </Link>
              )
            ))}
          </nav>
        </aside>

        <main
          className={clsx(
            'flex-1 pb-24 transition-[padding] duration-200 md:pb-8',
            expanded ? 'md:pl-[220px]' : 'md:pl-16',
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-[var(--survivor-border)] bg-[#05070c]/88 px-1 py-1 backdrop-blur-xl md:hidden">
        {mobileMain.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'flex min-h-[52px] flex-1 flex-col items-center justify-center rounded-lg text-[10px] text-white/70',
              pathActive(pathname, item.href, item.href === base) && 'bg-white/[0.06] text-sky-200',
            )}
          >
            <span className="relative text-lg">
              {item.icon}
              {item.pulse ? (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 tribal-dot-pulse" />
              ) : null}
            </span>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          className="flex min-h-[52px] flex-1 flex-col items-center justify-center rounded-lg text-[10px] text-white/70"
          onClick={() => setMoreOpen(true)}
        >
          <span className="text-lg">⋯</span>
          More
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 md:hidden"
          role="dialog"
          aria-label="More navigation"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-[var(--survivor-panel)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">More</p>
            <div className="mt-3 grid gap-2">
              <Link
                href={`${base}/challenges`}
                className="rounded-xl border border-white/10 px-4 py-3 text-[14px]"
                onClick={() => setMoreOpen(false)}
              >
                ⚡ Challenges
              </Link>
              <Link
                href={`${base}/chimmy`}
                className="rounded-xl border border-white/10 px-4 py-3 text-[14px]"
                onClick={() => setMoreOpen(false)}
              >
                🤖 @Chimmy
              </Link>
              {showJuryTab ? (
                <Link
                  href={`${base}/jury`}
                  className="rounded-xl border border-white/10 px-4 py-3 text-[14px]"
                  onClick={() => setMoreOpen(false)}
                >
                  ⚖️ Jury
                </Link>
              ) : null}
              <Link
                href={`${base}/episodes`}
                className="rounded-xl border border-white/10 px-4 py-3 text-[14px]"
                onClick={() => setMoreOpen(false)}
              >
                📜 Episodes
              </Link>
              <Link
                href={`${base}/finale`}
                className="rounded-xl border border-white/10 px-4 py-3 text-[14px]"
                onClick={() => setMoreOpen(false)}
              >
                🏆 Finale
              </Link>
              {ctx.isCommissioner ? (
                <Link
                  href={`/league/${leagueId}`}
                  className="rounded-xl border border-amber-500/25 px-4 py-3 text-[14px] text-amber-100"
                  onClick={() => setMoreOpen(false)}
                >
                  ⚙️ Commissioner
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Player status — desktop bottom of sidebar area */}
      <div
        className={clsx(
          'pointer-events-none fixed bottom-0 left-0 z-20 hidden flex-col border-t border-[var(--survivor-border)] bg-[#05070c]/95 p-2 md:flex',
          expanded ? 'w-[220px]' : 'w-16',
        )}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/[0.04] p-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/80">
            {displayName.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden lg:block">
            <p className="truncate text-[11px] font-semibold text-white lg:text-[12px]">{displayName}</p>
            <div className="hidden lg:block">
              <SurvivorStatusBadge variant={badgeForPlayerState(ctx.playerState)} className="mt-1 scale-90" />
            </div>
          </div>
          {ctx.isCommissioner ? (
            <span className="hidden text-[9px] font-bold uppercase text-amber-300 lg:inline">ADM</span>
          ) : null}
        </div>
      </div>

      {ctx.error ? (
        <div className="mx-auto max-w-lg px-4 py-3 text-center text-[12px] text-amber-200/90">{ctx.error}</div>
      ) : null}

      {/* 3-Tab Settings Modal */}
      <LeagueSettingsShell
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isCommissioner={ctx.isCommissioner}
        isCoCommissioner={false}
        formatLabel="Survivor"
        hasAfCommissionerSub={hasAfCommissionerSub}
        leagueTabContent={
          <LeagueSettingsTab leagueId={leagueId} canEdit={ctx.isCommissioner} />
        }
        commissionerTabContent={
          <CommissionerToolsTab leagueId={leagueId} hasAfCommissionerSub={hasAfCommissionerSub} />
        }
        formatTabContent={
          <SurvivorFormatTab leagueId={leagueId} hasAfCommissionerSub={hasAfCommissionerSub} />
        }
      />
      </div>
    </>
  )
}

export function SurvivorAppShell({
  leagueId,
  children,
}: {
  leagueId: string
  children: React.ReactNode
}) {
  const media = getLeagueTypeMedia('survivor')

  return (
    <SurvivorUiProvider leagueId={leagueId}>
      <SurvivorAppShellInner leagueId={leagueId}>{children}</SurvivorAppShellInner>
      <LeagueIntroVideoModal
        leagueId={leagueId}
        leagueType="survivor"
        leagueName="Survivor League"
        videoSrc={media.introVideo}
        posterSrc={media.thumbnail}
        onDismiss={() => {}}
      />
    </SurvivorUiProvider>
  )
}
