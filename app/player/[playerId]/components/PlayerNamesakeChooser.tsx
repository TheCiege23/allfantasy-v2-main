import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { FallbackImg } from '@/components/core-app/FallbackImg'

export type NamesakeOption = {
  id: string
  name: string
  position: string | null
  team: string | null
  sport: string
  headshotUrl: string | null
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
}

/**
 * Shown when a `/player/<name-slug>` link matches several players in one sport (e.g. `justin-jefferson`:
 * WR MIN and LB CLE). Every option links by identity `id`, which the resolver matches before any name,
 * so a choice always opens exactly that player. Server-rendered: there is nothing to interact with but links.
 */
export function PlayerNamesakeChooser({
  name,
  options,
  total,
}: {
  name: string
  options: NamesakeOption[]
  total: number
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#080c18] via-[#0a0e1a] to-[#0f0f1a]">
      <div className="border-b border-white/[0.06] bg-[#080c18]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link href="/core" className="text-white/40 hover:text-white/60">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="truncate text-sm font-semibold text-white/70">Player Profile</h1>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0c1025] to-[#0a0e1a] p-5">
          <h2 className="text-xl font-black text-white sm:text-2xl">Which player did you mean?</h2>
          <p className="mt-1 text-[13px] text-white/50">
            More than one player is named <span className="font-semibold text-white/70">{name}</span>. Pick one to
            open their profile.
          </p>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="namesake-chooser">
            {options.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/player/${encodeURIComponent(o.id)}`}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 transition hover:border-cyan-400/30 hover:bg-white/[0.06]"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#12192e]">
                    {o.headshotUrl ? (
                      <FallbackImg
                        src={o.headshotUrl}
                        alt={o.name}
                        className="h-full w-full object-cover"
                        fallback={<span className="text-sm font-black text-white/20">{initials(o.name)}</span>}
                      />
                    ) : (
                      <span className="text-sm font-black text-white/20">{initials(o.name)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-white">{o.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className="font-semibold text-cyan-300">{o.position || '—'}</span>
                      <span className="text-white/30">·</span>
                      <span className="truncate text-white/60">{o.team || 'FA'}</span>
                      <span className="text-white/30">·</span>
                      <span className="text-white/40">{o.sport}</span>
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                </Link>
              </li>
            ))}
          </ul>

          {total > options.length ? (
            <p className="mt-3 text-[12px] text-white/40">
              Showing {options.length} of {total}. Search for the player to find the rest.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
