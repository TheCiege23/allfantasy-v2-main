'use client'

export type PresentViewer = {
  userId: string
  name: string
  status: 'online' | 'away' | 'offline'
  lastSeenAt: string
}

/**
 * Who has had this league's chat open recently.
 *
 * ⚠ IT LISTS PRESENCE, IT DOES NOT LIST THE LEAGUE. A member who is absent from
 * this strip is not offline — they may simply be on a client that has never sent
 * a beacon. Rendering the full roster with everybody else greyed out would state
 * something we do not know, in a room where people already argue about who is
 * paying attention.
 *
 * ⚠ RENDERS NOTHING WHEN IT KNOWS NOTHING. An empty strip that said "nobody is
 * here" would be a claim; an absent strip is silence, which is the truth.
 */
export function PresenceStrip({ viewers }: { viewers: PresentViewer[] }) {
  if (!viewers || viewers.length === 0) return null

  const here = viewers.filter((v) => v.status !== 'offline')
  if (here.length === 0) return null

  const shown = here.slice(0, 6)
  const overflow = here.length - shown.length

  return (
    <div className="af-cm-presence" aria-label="People with this chat open">
      {shown.map((v) => (
        <span key={v.userId} className="af-cm-presence-who" data-status={v.status}>
          <span className="af-cm-presence-dot" aria-hidden="true" />
          {v.name}
        </span>
      ))}
      {overflow > 0 ? <span className="af-cm-presence-more">+{overflow}</span> : null}
    </div>
  )
}

export default PresenceStrip
