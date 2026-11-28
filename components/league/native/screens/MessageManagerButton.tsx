'use client'

import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { openDirectMessage } from '@/components/core-app/comms/commsEvents'
import type { ManagerContact } from '@/lib/chat-core/leagueManagerContacts'

/**
 * "Message" beside a team on a league screen (2026-11-27). Yahoo's late-2026 redesign left managers
 * unable to message a league-mate from where they see him; here the team row and the matchup carry
 * the button, which opens a direct message with that team's manager (commsEvents.openDirectMessage).
 *
 * Who manages each team comes from /api/leagues/[id]/manager-contacts, read ONCE per league per page
 * and shared by every button on it. A team with no AllFantasy manager, your own team, and anyone
 * blocked either way are absent from that answer, so their rows show no button — never a button
 * that fails when tapped.
 */

type Contacts = Record<string, ManagerContact>

const cache = new Map<string, Promise<Contacts>>()

function loadContacts(leagueId: string): Promise<Contacts> {
  let p = cache.get(leagueId)
  if (!p) {
    p = fetch(`/api/leagues/${encodeURIComponent(leagueId)}/manager-contacts`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { contacts?: Contacts } | null) => (d?.contacts && typeof d.contacts === 'object' ? d.contacts : {}))
      .catch(() => ({}))
    cache.set(leagueId, p)
    // A failed or empty read is retried on the next screen, not pinned for the page's life.
    void p.then((c) => {
      if (Object.keys(c).length === 0) cache.delete(leagueId)
    })
  }
  return p
}

/** For tests: forget every league's contacts. */
export function resetManagerContactsCache(): void {
  cache.clear()
}

/** `contactFor(...teamIds)` — the first id with a messageable manager, else null. */
export function useLeagueManagerContacts(leagueId: string | null | undefined) {
  const [contacts, setContacts] = useState<Contacts>({})
  useEffect(() => {
    if (!leagueId) return
    let alive = true
    void loadContacts(leagueId).then((c) => {
      if (alive) setContacts(c)
    })
    return () => {
      alive = false
    }
  }, [leagueId])
  return (...teamIds: Array<string | null | undefined>): ManagerContact | null => {
    for (const id of teamIds) if (id && contacts[id]) return contacts[id]
    return null
  }
}

export function MessageManagerButton({
  contact,
  variant = 'icon',
}: {
  contact: ManagerContact | null
  /** `icon`: a compact chat glyph for a table row. `label`: "Message <name>" under a matchup. */
  variant?: 'icon' | 'label'
}) {
  if (!contact) return null
  const name = contact.displayName || contact.username
  return (
    <button
      type="button"
      className={variant === 'icon' ? 'nls-msg-btn' : 'nls-msg-btn nls-msg-btn--label'}
      onClick={(e) => {
        e.stopPropagation()
        openDirectMessage(contact.username)
      }}
      aria-label={`Message ${name}`}
      title={`Message ${name} (@${contact.username})`}
      data-testid="message-manager"
    >
      <MessageCircle aria-hidden className="nls-msg-icon" />
      {variant === 'label' ? <span>Message {name}</span> : null}
    </button>
  )
}
