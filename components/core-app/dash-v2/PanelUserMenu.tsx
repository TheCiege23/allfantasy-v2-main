'use client'

import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { useEffect, useId, useRef, useState } from 'react'
import { useSettingsProfile } from '@/hooks/useSettingsProfile'
import { useOptionalThemeMode } from '@/components/theme/ThemeProvider'
import { THEME_IDS, type ThemeId } from '@/lib/theme/constants'

/**
 * The identity control at the foot of the league panel, and the settings popup
 * it opens.
 *
 * ⚠ THIS IS NOW THE ONLY APPEARANCE CONTROL ON THE DASHBOARD, AND THAT IS LOAD
 * BEARING. The screen previously showed two switches for one setting: a
 * `ModeToggle` in the panel header (top-left) and the fixed `GlobalModeToggle`
 * (bottom-right). Removing the header one alone would have gone too far the
 * other way — `GlobalModeToggle` returns null on `/dashboard` by design, so
 * after the cutover the dashboard would have had NO way to change theme at all.
 * Folding it in here leaves exactly one, on both routes, where a reader expects
 * to find it: under their own name.
 *
 * ⚠ IT READS ITS OWN PROFILE RATHER THAN TAKING PROPS. The panel is rendered by
 * a server component that does not load the settings profile, so a prop-threaded
 * version would have to invent a name or show none — which is what shipped
 * before: `LeaguePanel` accepted a `user` prop that no caller ever passed, so
 * the footer rendered empty on every account. `useSettingsProfile` is the same
 * hook the universal dashboard's settings menu uses, so the two cannot disagree
 * about who is signed in.
 *
 * ⚠ MODE STATE COMES FROM THE SHARED PROVIDER, NOT LOCAL STATE. `setMode` writes
 * the `af_mode` cookie and localStorage that the root layout reads back into
 * `html[data-mode]`. A second implementation here would paint this panel one way
 * and the rest of the document another.
 */

const MODE_LABEL: Record<string, string> = {
  light: 'Light',
  dark: 'Dark',
  legacy: 'AF',
  system: 'Auto',
}

/* `system` is deliberately offered: it is a real stored value the toggle can
   produce, and hiding it here would make a user's saved choice unreachable. */
const MODE_ORDER: ThemeId[] = THEME_IDS.filter((m): m is ThemeId =>
  ['light', 'dark', 'legacy', 'system'].includes(m),
)

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

export function PanelUserMenu({ levelLabel = null }: { levelLabel?: string | null }) {
  const { profile, loading } = useSettingsProfile()
  const theme = useOptionalThemeMode()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  /*
   * Escape and outside-click both close. Without the outside-click handler the
   * popup survives a click on a league row behind it and covers the list.
   */
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  /*
   * Render nothing until there is a real identity. A skeleton chip that later
   * becomes a name is fine; a chip that says "Account" forever because the fetch
   * failed is a control that lies about being signed in.
   */
  if (loading && !profile) {
    return (
      <div className="af-d2-panel-foot">
        <div className="af-d2-user is-loading" aria-hidden>
          <span className="af-d2-user-avatar" />
          <span className="af-d2-user-text">
            <span className="af-d2-user-name">&nbsp;</span>
          </span>
        </div>
      </div>
    )
  }
  if (!profile) return null

  const name = profile.displayName || profile.username || 'Your account'
  const handle = profile.username ? `@${profile.username}` : null
  const mode = theme?.mode ?? 'light'

  return (
    <div className="af-d2-panel-foot" ref={wrapRef}>
      {open ? (
        <div className="af-d2-usermenu" id={menuId} role="menu" aria-label="Settings">
          <div className="af-d2-usermenu-head">
            <span className="af-d2-user-avatar af-d2-user-avatar--lg" aria-hidden>
              {profile.profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.profileImageUrl} alt="" />
              ) : (
                initialsOf(name)
              )}
            </span>
            <span className="af-d2-usermenu-id">
              <span className="af-d2-usermenu-name">{name}</span>
              {handle ? <span className="af-d2-usermenu-handle af-num">{handle}</span> : null}
            </span>
          </div>

          {/*
            The single appearance control. Segmented rather than a on/off switch
            because there are four stored values, and a two-state toggle cannot
            represent "AF" or "Auto" — a user on either would see the switch lie
            about their setting.
          */}
          <div className="af-d2-usermenu-modes">
            <span className="af-d2-usermenu-label af-num">APPEARANCE</span>
            <div className="af-d2-mode-seg" role="group" aria-label="Appearance">
              {MODE_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`af-d2-mode-opt af-num${mode === option ? ' is-active' : ''}`}
                  aria-pressed={mode === option}
                  onClick={() => theme?.setMode(option)}
                >
                  {MODE_LABEL[option] ?? option}
                </button>
              ))}
            </div>
          </div>

          <div className="af-d2-usermenu-items">
            <Link href="/settings" className="af-d2-usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
              Account
              <span className="af-d2-usermenu-hint af-num">email · password</span>
            </Link>
            <Link href="/settings" className="af-d2-usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
              Subscription &amp; billing
            </Link>
            <Link href="/settings" className="af-d2-usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
              Notifications
            </Link>
            <Link href="/import" className="af-d2-usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
              Connected platforms
              <span className="af-d2-usermenu-hint af-num">import</span>
            </Link>
            <Link href="/settings" className="af-d2-usermenu-item" role="menuitem" onClick={() => setOpen(false)}>
              All settings
            </Link>
            <button
              type="button"
              className="af-d2-usermenu-item af-d2-usermenu-item--danger"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/' })}
            >
              Log out
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="af-d2-user af-d2-user--button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="af-d2-user-avatar" aria-hidden>
          {/* The real profile image when there is one — plain <img>, not
              next/image: this is an arbitrary uploaded/CDN URL. */}
          {profile.profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.profileImageUrl} alt="" />
          ) : (
            initialsOf(name)
          )}
        </span>
        <span className="af-d2-user-text">
          <span className="af-d2-user-name">{name}</span>
          {levelLabel ? <span className="af-d2-user-level af-num">{levelLabel}</span> : null}
        </span>
        <span className="af-d2-user-caret af-num" aria-hidden>
          {open ? '▾' : '▴'}
        </span>
      </button>
    </div>
  )
}

export default PanelUserMenu
