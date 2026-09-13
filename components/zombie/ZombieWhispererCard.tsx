'use client'

import { UserCircle } from 'lucide-react'

export interface ZombieWhispererCardProps {
  whispererRosterId: string | null
  displayNames: Record<string, string>
  /** A Whisperer exists but this viewer may not know who. */
  hidden?: boolean
}

export function ZombieWhispererCard({ whispererRosterId, displayNames, hidden = false }: ZombieWhispererCardProps) {
  const name = hidden
    ? 'Identity classified'
    : whispererRosterId
      ? (displayNames[whispererRosterId] ?? whispererRosterId)
      : '—'
  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-4 sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-amber-200">
        <UserCircle className="h-5 w-5" />
        The Whisperer
      </h2>
      <p className="text-sm text-white/80">
        One team holds the Whisperer role; losses to the Whisperer can infect Survivors.
      </p>
      <div className="mt-3 rounded-xl border border-amber-500/20 bg-black/20 px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-amber-400/80">Current Whisperer</p>
        <p className="mt-1 font-medium text-white">{name}</p>
      </div>
    </section>
  )
}
