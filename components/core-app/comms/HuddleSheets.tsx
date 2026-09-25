'use client'

import { useRef, useState, type ReactNode } from 'react'
import { LogOut, Pencil, UserPlus, Users } from 'lucide-react'
import { useOverlayContainment } from '../useOverlayContainment'
import { initialsFor, safeAvatarUrl } from './chatLayout'

/**
 * The huddle header's two sheets: who is in it, and what you can do with it (add people, rename,
 * leave). Same sheet shape as the message actions, so the drawer has one way to show a menu.
 *
 * Every action here calls a route that already existed — `/members` (GET and POST), `PATCH` on the
 * thread for its title, and `/leave` — and none of them had a caller in the drawer. A failure is
 * said in the sheet, in the server's words where it gave any, and the sheet stays open; nothing
 * here reports success before the server does.
 */

export type HuddleMember = { id: string; username: string; displayName: string | null; avatarUrl?: string | null }

function MemberAvatar({ name, url }: { name: string; url: string | null | undefined }) {
  const safe = safeAvatarUrl(url)
  const [failed, setFailed] = useState(false)
  return (
    <span className="af-cm-dmrow-av" aria-hidden="true">
      {safe && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safe} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="af-cm-dmrow-initials">{initialsFor(name)}</span>
      )}
    </span>
  )
}

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useOverlayContainment({ active: true, containerRef: sheetRef, initialFocusRef: closeRef, onClose })
  return (
    <div className="af-cm-sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        className="af-cm-sheet af-cm-huddle-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <button ref={closeRef} type="button" className="af-cm-sheet-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export function HuddleMembersSheet({
  title,
  members,
  viewerId,
  loading,
  error,
  onClose,
}: {
  title: string
  members: HuddleMember[] | null
  viewerId: string | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <Sheet label={`Members of ${title}`} onClose={onClose}>
      <p className="af-cm-sheet-label">
        {members ? `${members.length} ${members.length === 1 ? 'member' : 'members'}` : 'Members'}
      </p>
      {loading && !members ? <p className="af-cm-empty-b">Loading…</p> : null}
      {error ? (
        <p className="af-cm-sheet-safety-err" role="alert">
          {error}
        </p>
      ) : null}
      {members ? (
        <ul className="af-cm-members">
          {members.map((m) => {
            const name = m.displayName || m.username || 'Manager'
            return (
              <li key={m.id} className="af-cm-member">
                <MemberAvatar name={name} url={m.avatarUrl} />
                <span className="af-cm-member-name">
                  {name}
                  {m.id === viewerId ? <span className="af-cm-member-you"> (you)</span> : null}
                </span>
                {m.displayName && m.username ? <span className="af-cm-member-handle">@{m.username}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </Sheet>
  )
}

type OptionsView = 'menu' | 'add' | 'rename' | 'leave'

export function HuddleOptionsSheet({
  title,
  onClose,
  onShowMembers,
  onAdd,
  onRename,
  onLeave,
}: {
  title: string
  onClose: () => void
  onShowMembers: () => void
  onAdd: (usernames: string[]) => Promise<void>
  onRename: (title: string) => Promise<void>
  onLeave: () => Promise<void>
}) {
  const [view, setView] = useState<OptionsView>('menu')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = (next: OptionsView, seed = '') => {
    setView(next)
    setText(seed)
    setError(null)
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : fallback)
      setBusy(false)
    }
  }

  return (
    <Sheet label={`${title} options`} onClose={onClose}>
      <p className="af-cm-sheet-preview">
        <b>{title}</b>
      </p>
      {view === 'menu' ? (
        <div className="af-cm-sheet-actions">
          <button type="button" className="af-cm-sheet-btn" onClick={onShowMembers}>
            <Users size={16} aria-hidden /> Members
          </button>
          <button type="button" className="af-cm-sheet-btn" onClick={() => go('add')}>
            <UserPlus size={16} aria-hidden /> Add people
          </button>
          <button type="button" className="af-cm-sheet-btn" onClick={() => go('rename', title)}>
            <Pencil size={16} aria-hidden /> Rename huddle
          </button>
          <button type="button" className="af-cm-sheet-btn" data-danger="true" onClick={() => go('leave')}>
            <LogOut size={16} aria-hidden /> Leave huddle
          </button>
        </div>
      ) : null}

      {view === 'add' || view === 'rename' ? (
        <form
          className="af-cm-sheet-safety"
          aria-label={view === 'add' ? 'Add people' : 'Rename huddle'}
          onSubmit={(e) => {
            e.preventDefault()
            if (view === 'add') {
              const names = text
                .split(',')
                .map((n) => n.trim().replace(/^@/, ''))
                .filter(Boolean)
              if (names.length === 0) return
              void run(() => onAdd(names), 'Could not add them. Try again.')
            } else {
              const next = text.trim()
              if (!next) return
              void run(() => onRename(next), 'Could not rename the huddle. Try again.')
            }
          }}
        >
          <label className="af-cm-sheet-safety-l">
            <span>{view === 'add' ? 'AllFantasy usernames, comma separated' : 'Huddle name'}</span>
            <input
              className="af-cm-input af-cm-sheet-input"
              value={text}
              autoFocus
              maxLength={view === 'rename' ? 100 : 400}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              placeholder={view === 'add' ? 'sam, jo_allen' : 'Waiver wire war room'}
            />
          </label>
          {error ? (
            <p className="af-cm-sheet-safety-err" role="alert">
              {error}
            </p>
          ) : null}
          <span className="af-cm-sheet-confirm">
            <button type="submit" className="af-cm-sheet-btn" data-primary="true" disabled={busy || !text.trim()}>
              {busy ? 'Saving…' : view === 'add' ? 'Add' : 'Save name'}
            </button>
            <button type="button" className="af-cm-sheet-btn" onClick={() => go('menu')} disabled={busy}>
              Back
            </button>
          </span>
        </form>
      ) : null}

      {view === 'leave' ? (
        <div className="af-cm-sheet-safety" role="group" aria-label="Leave huddle">
          <p className="af-cm-sheet-safety-t">Leave {title}?</p>
          <p className="af-cm-sheet-safety-b">You’ll stop getting its messages. Someone in it can add you back.</p>
          {error ? (
            <p className="af-cm-sheet-safety-err" role="alert">
              {error}
            </p>
          ) : null}
          <span className="af-cm-sheet-confirm">
            <button
              type="button"
              className="af-cm-sheet-btn"
              data-danger="true"
              disabled={busy}
              onClick={() => void run(onLeave, 'Could not leave the huddle. Try again.')}
            >
              {busy ? 'Leaving…' : 'Leave'}
            </button>
            <button type="button" className="af-cm-sheet-btn" onClick={() => go('menu')} disabled={busy}>
              Stay
            </button>
          </span>
        </div>
      ) : null}
    </Sheet>
  )
}
