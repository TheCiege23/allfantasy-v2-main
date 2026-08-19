'use client'

/**
 * Top navigation bar, 58px.
 *
 * Adapts across all three breakpoints rather than being three components, because unlike the
 * side nav its *contents* are the same set — pieces just drop out as width shrinks:
 *   desktop  logo+wordmark · sport · league · season · search · view-as · import · bell · mail · profile
 *   tablet   logo+wordmark · sport · league ·          view-as ·           bell ·        profile
 *   mobile   hamburger · crest ·                                          bell ·        avatar
 *
 * Only one dropdown is open at a time — opening another closes the first, and a click
 * anywhere outside or an Escape keypress closes all of them.
 */

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Bell, ChevronDown, Mail, Menu, Search, Upload } from 'lucide-react'
import type { DeviceKind } from '../hooks/useDeviceKind'
import type { ViewAsRole } from '../hooks/useViewAsRole'
import { VIEW_AS_OPTIONS } from '../hooks/useViewAsRole'

export type DropdownKey = 'sport' | 'league' | 'season' | 'profile' | 'notif' | 'mail' | 'viewAs' | null

export type SelectOption = { id: string; label: string; hint?: string }

export type TopNavProps = {
  device: DeviceKind
  userName: string
  userInitials: string
  userImage?: string | null
  roleLabel: string

  sports: SelectOption[]
  selectedSport: string | null
  onSelectSport: (id: string) => void

  leagues: SelectOption[]
  selectedLeagueId: string | null
  onSelectLeague: (id: string) => void

  seasons: SelectOption[]
  selectedSeason: string | null
  onSelectSeason: (id: string) => void

  /** Null when the app has no real notification source — the bell then shows no count. */
  notifications: Array<{ id: string; text: string; href?: string }> | null
  unreadMessages: number | null

  openDropdown: DropdownKey
  setOpenDropdown: (k: DropdownKey) => void

  /** Only rendered when the dev-only View As override is available. */
  viewAs: { active: ViewAsRole; onSelect: (r: ViewAsRole) => void } | null

  onOpenDrawer: () => void
  searchValue: string
  onSearchChange: (v: string) => void
  /** Results dropdown, rendered by the owner under the search field. */
  searchResults: React.ReactNode
  selfHref: string
}

export function AdaptiveTopNav(props: TopNavProps) {
  const {
    device, userName, userInitials, userImage, roleLabel, openDropdown, setOpenDropdown,
    notifications, unreadMessages, viewAs, onOpenDrawer, searchValue, onSearchChange, searchResults,
  } = props
  const isMobile = device === 'mobile'
  const isDesktop = device === 'desktop'
  const navRef = useRef<HTMLElement | null>(null)

  // Outside-click + Escape close. Pointerdown (not click) so the menu closes on press
  // rather than release, which is what users expect when tapping elsewhere on touch.
  useEffect(() => {
    if (!openDropdown) return
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenDropdown(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenDropdown(null) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openDropdown, setOpenDropdown])

  const toggle = (k: Exclude<DropdownKey, null>) => setOpenDropdown(openDropdown === k ? null : k)

  return (
    <header
      ref={navRef}
      style={{
        height: 'var(--af-nav-h)', flexShrink: 0, background: 'var(--af-surface)',
        borderBottom: '1px solid var(--af-border)', display: 'flex', alignItems: 'center',
        gap: 8, padding: '0 14px', position: 'relative', zIndex: 300,
      }}
    >
      {isMobile && (
        <button type="button" onClick={onOpenDrawer} aria-label="Open navigation" style={iconBtn}>
          <Menu size={16} strokeWidth={2} />
        </button>
      )}

      <Link href={props.selfHref} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} aria-label="AllFantasy dashboard">
        <Crest />
        {!isMobile && (
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
            ALLFANTASY
          </span>
        )}
      </Link>

      {/* Scope pills — hidden entirely on mobile, where the drawer carries scope instead. */}
      {!isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
          {props.sports.length > 0 && (
            <Dropdown
              // Unselected reads "All Sports", not the bare noun — the pill states the
              // current scope rather than looking like an unfilled control.
              label={props.sports.find((s) => s.id === props.selectedSport)?.label ?? 'All Sports'}
              open={openDropdown === 'sport'} onToggle={() => toggle('sport')}
              options={props.sports} onSelect={(id) => { props.onSelectSport(id); setOpenDropdown(null) }}
              menuTitle="Sport" minWidth={140}
            />
          )}
          {props.leagues.length > 0 && (
            <Dropdown
              label={props.leagues.find((l) => l.id === props.selectedLeagueId)?.label ?? 'All Leagues'}
              open={openDropdown === 'league'} onToggle={() => toggle('league')}
              options={props.leagues} onSelect={(id) => { props.onSelectLeague(id); setOpenDropdown(null) }}
              menuTitle="Your Leagues" minWidth={220} maxLabelWidth={160}
            />
          )}
          {/* Season drops out on tablet to save width (design). */}
          {isDesktop && props.seasons.length > 0 && (
            <Dropdown
              label={props.seasons.find((s) => s.id === props.selectedSeason)?.label ?? 'All Seasons'}
              open={openDropdown === 'season'} onToggle={() => toggle('season')}
              options={props.seasons} onSelect={(id) => { props.onSelectSeason(id); setOpenDropdown(null) }}
              menuTitle="Season" minWidth={150}
            />
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {isDesktop && (
        <div style={{ position: 'relative', marginRight: 4 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, background: 'var(--af-surface-2)',
            border: '1px solid rgba(139,92,246,.25)', borderRadius: 8, padding: '7px 11px', width: 260,
          }}>
            <Search size={14} strokeWidth={2} color="rgba(255,255,255,.4)" />
            <input
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search players, teams, leagues…"
              aria-label="Search players, teams and leagues"
              style={{
                background: 'none', border: 'none', outline: 'none', color: 'rgba(255,255,255,.85)',
                fontSize: 12.5, width: '100%',
              }}
            />
          </div>
          {searchResults}
        </div>
      )}

      {viewAs && (
        <div style={{ position: 'relative' }}>
          <button type="button" className="af-pill af-pill-viewas" onClick={() => toggle('viewAs')}
            aria-expanded={openDropdown === 'viewAs'} aria-haspopup="menu">
            {isDesktop && <span>View As:</span>}
            {VIEW_AS_OPTIONS.find((o) => o.id === viewAs.active)?.label ?? 'View As'}
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>
          {openDropdown === 'viewAs' && (
            <div className="af-menu" style={{ right: 0, minWidth: 210, borderColor: 'rgba(6,182,212,.35)' }} role="menu">
              <div className="af-menu-label">Preview As</div>
              {VIEW_AS_OPTIONS.map((o, i) => (
                <div key={o.id}>
                  {i === 3 && <div className="af-menu-sep" />}
                  <button type="button" role="menuitem" className="af-menu-item"
                    onClick={() => { viewAs.onSelect(o.id); setOpenDropdown(null) }}>
                    {o.label}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isDesktop && (
        <Link href="/import" className="af-btn af-btn-primary"
          style={{ padding: '7px 13px', fontSize: 12.5, borderRadius: 8, whiteSpace: 'nowrap' }}>
          <Upload size={14} strokeWidth={2} />
          Import League
        </Link>
      )}

      {/* Bell — count comes from a real source or not at all; never a decorative number. */}
      <div style={{ position: 'relative' }}>
        <button type="button" style={iconBtn} onClick={() => toggle('notif')}
          aria-label={`Notifications${notifications?.length ? `, ${notifications.length} unread` : ''}`}
          aria-expanded={openDropdown === 'notif'}>
          <Bell size={15} strokeWidth={2} color="rgba(255,255,255,.7)" />
          {notifications && notifications.length > 0 && <CountDot count={notifications.length} tone="red" />}
        </button>
        {openDropdown === 'notif' && (
          <div className="af-menu" style={{ right: 0, width: 250, padding: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, padding: '2px 4px 8px' }}>Notifications</div>
            {notifications === null ? (
              <div style={{ fontSize: 11.5, color: 'var(--af-text-faint)', padding: '4px 4px 8px', lineHeight: 1.5 }}>
                Notifications aren&apos;t wired up yet.
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--af-text-faint)', padding: '4px 4px 8px' }}>
                You&apos;re all caught up.
              </div>
            ) : (
              notifications.slice(0, 5).map((n) => (
                <div key={n.id} style={{
                  padding: 8, borderRadius: 8, background: 'var(--af-surface-2)', marginBottom: 4,
                  fontSize: 12, color: 'rgba(255,255,255,.8)',
                }}>
                  {n.text}
                </div>
              ))
            )}
            <Link href="/messages" style={{
              display: 'block', textAlign: 'center', fontSize: 11.5, color: 'var(--af-cyan)',
              fontWeight: 700, padding: '8px 0 2px',
            }}>
              View all →
            </Link>
          </div>
        )}
      </div>

      {isDesktop && (
        <div style={{ position: 'relative' }}>
          <button type="button" style={iconBtn} onClick={() => toggle('mail')}
            aria-label={`Direct messages${unreadMessages ? `, ${unreadMessages} unread` : ''}`}
            aria-expanded={openDropdown === 'mail'}>
            <Mail size={15} strokeWidth={2} color="rgba(255,255,255,.7)" />
            {unreadMessages != null && unreadMessages > 0 && <CountDot count={unreadMessages} tone="cyan" />}
          </button>
          {openDropdown === 'mail' && (
            <div className="af-menu" style={{ right: 0, width: 250, padding: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, padding: '2px 4px 8px' }}>Direct Messages</div>
              <div style={{ fontSize: 11.5, color: 'var(--af-text-faint)', padding: '4px 4px 8px', lineHeight: 1.5 }}>
                {unreadMessages == null
                  ? 'Message previews aren’t wired up yet.'
                  : unreadMessages > 0
                    ? `You have ${unreadMessages} unread message${unreadMessages === 1 ? '' : 's'}.`
                    : 'No unread messages.'}
              </div>
              <Link href="/messages" style={{
                display: 'block', textAlign: 'center', fontSize: 11.5, color: 'var(--af-cyan)',
                fontWeight: 700, padding: '8px 0 2px',
              }}>
                Open Messages →
              </Link>
            </div>
          )}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <button type="button" onClick={() => toggle('profile')} aria-expanded={openDropdown === 'profile'}
          aria-label="Account menu"
          style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '4px 9px 4px 4px',
            background: 'var(--af-surface-2)', border: '1px solid rgba(139,92,246,.25)',
            borderRadius: 9, cursor: 'pointer',
          }}>
          <Avatar initials={userInitials} src={userImage} />
          {isDesktop && (
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.2, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userName}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', lineHeight: 1.2 }}>{roleLabel}</div>
            </div>
          )}
        </button>
        {openDropdown === 'profile' && (
          <div className="af-menu" style={{ right: 0, minWidth: 180 }} role="menu">
            <Link href="/settings" className="af-menu-item" role="menuitem">Settings</Link>
            <Link href="/support" className="af-menu-item" role="menuitem">Help &amp; Support</Link>
            <div className="af-menu-sep" />
            <Link href="/logout" className="af-menu-item" role="menuitem" style={{ color: 'var(--af-red)' }}>
              Log out
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────────
function Dropdown({
  label, open, onToggle, options, onSelect, menuTitle, minWidth, maxLabelWidth,
}: {
  label: string
  open: boolean
  onToggle: () => void
  options: SelectOption[]
  onSelect: (id: string) => void
  menuTitle: string
  minWidth: number
  maxLabelWidth?: number
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="af-pill" onClick={onToggle} aria-expanded={open} aria-haspopup="menu"
        style={maxLabelWidth ? { maxWidth: maxLabelWidth, overflow: 'hidden' } : undefined}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={11} strokeWidth={2.5} style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <div className="af-menu" style={{ left: 0, minWidth, maxHeight: 320, overflowY: 'auto' }} role="menu">
          <div className="af-menu-label">{menuTitle}</div>
          {options.map((o) => (
            <button key={o.id} type="button" role="menuitem" className="af-menu-item" onClick={() => onSelect(o.id)}>
              {o.label}
              {o.hint && (
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--af-text-faint)', marginTop: 1 }}>
                  {o.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CountDot({ count, tone }: { count: number; tone: 'red' | 'cyan' }) {
  return (
    <span style={{
      position: 'absolute', top: -3, right: -3,
      background: tone === 'red' ? 'var(--af-red)' : 'var(--af-cyan)',
      color: tone === 'red' ? '#fff' : '#000',
      fontSize: 9, fontWeight: 800, minWidth: 14, height: 14, borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
    }}>
      {count > 9 ? '9+' : count}
    </span>
  )
}

function Avatar({ initials, src }: { initials: string; src?: string | null }) {
  if (src) {
    // Plain <img>: this subtree is client-only and next/image adds a loader round-trip for
    // what is a 26px avatar off an already-resolved absolute URL.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={26} height={26} style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', background: 'var(--af-grad-135)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function Crest() {
  return (
    <svg width={26} height={30} viewBox="0 0 32 36" fill="none" aria-hidden="true">
      <path d="M 8,2.5 L 24,2.5 L 30,11 L 27,26 L 16,34.5 L 5,26 L 2,11 Z"
        fill="#1c1535" stroke="#06b6d4" strokeWidth="2.5" strokeLinejoin="round" />
      <text x="16" y="21" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="900" fontSize="12" fill="#fff">
        AF
      </text>
    </svg>
  )
}

const iconBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, background: 'var(--af-surface-2)',
  border: '1px solid rgba(139,92,246,.25)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', cursor: 'pointer', position: 'relative', flexShrink: 0,
  color: 'rgba(255,255,255,.8)',
}
