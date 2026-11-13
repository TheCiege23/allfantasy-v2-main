'use client'

import Image from 'next/image'
import { ListMusic, Loader2, Play, X } from 'lucide-react'

export type PickerPlaylist = {
  id: string
  name: string
  uri: string
  imageUrl: string | null
  trackCount: number | null
  ownerName: string | null
}

export type PickerState =
  | { status: 'loading' }
  | { status: 'error'; message: string; reconnect?: boolean }
  | { status: 'ready'; playlists: PickerPlaylist[]; notice: string | null; truncated: boolean }

type Props = {
  state: PickerState
  /** The playlist a play request is in flight for. */
  pendingUri: string | null
  /** A play failure, shown above the list so the list stays usable. */
  playError: { message: string; reconnect?: boolean } | null
  onPick: (playlist: PickerPlaylist) => void
  onClose: () => void
  onRetry: () => void
}

function ReconnectLink() {
  return (
    // An OAuth redirect route needs a full navigation; <Link> would client-route to it.
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- see the line above
    <a
      href="/api/auth/spotify"
      className="shrink-0 rounded-full bg-[#1DB954] px-3 py-1 text-xs font-semibold text-black hover:bg-[#1ed760]"
    >
      Reconnect Spotify
    </a>
  )
}

function subtitle(p: PickerPlaylist): string {
  const parts: string[] = []
  // null means Spotify did not report a count; say nothing rather than "0 songs".
  if (p.trackCount !== null) parts.push(`${p.trackCount} ${p.trackCount === 1 ? 'song' : 'songs'}`)
  if (p.ownerName) parts.push(p.ownerName)
  return parts.join(' · ')
}

/**
 * The listener's own Spotify playlists, as a sheet above the mini player bar.
 * Presentational only — SpotifyMiniPlayer owns fetching and playback.
 */
export function SpotifyPlaylistPicker({ state, pendingUri, playError, onPick, onClose, onRetry }: Props) {
  return (
    <div
      role="dialog"
      aria-label="Your Spotify playlists"
      className="mx-auto w-full max-w-screen-xl px-2 sm:px-4"
    >
      <div className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#0d1626] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <ListMusic className="h-4 w-4 text-[#1DB954]" aria-hidden />
          <h2 className="text-sm font-semibold text-white">Your playlists</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close playlists"
            className="ml-auto rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {playError && (
          <div className="flex items-center gap-3 border-b border-white/10 bg-red-500/10 px-4 py-2">
            <p className="min-w-0 flex-1 text-xs text-red-200">{playError.message}</p>
            {playError.reconnect && <ReconnectLink />}
          </div>
        )}

        {state.status === 'ready' && state.notice && (
          <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2">
            <p className="min-w-0 flex-1 text-xs text-white/60">{state.notice}</p>
            <ReconnectLink />
          </div>
        )}

        <div className="max-h-[min(55vh,420px)] overflow-y-auto overscroll-contain">
          {state.status === 'loading' && (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading your playlists…
            </div>
          )}

          {state.status === 'error' && (
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <p className="text-sm text-white/70">{state.message}</p>
              {state.reconnect ? (
                <ReconnectLink />
              ) : (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          {state.status === 'ready' && state.playlists.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-white/60">
              No playlists on this Spotify account yet.
            </p>
          )}

          {state.status === 'ready' && state.playlists.length > 0 && (
            <ul className="divide-y divide-white/5">
              {state.playlists.map((p) => {
                const pending = pendingUri === p.uri
                const sub = subtitle(p)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onPick(p)}
                      disabled={pendingUri !== null}
                      aria-label={`Play ${p.name}`}
                      className="group flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-white/5 disabled:cursor-wait disabled:opacity-70"
                    >
                      {p.imageUrl ? (
                        <Image
                          src={p.imageUrl}
                          alt=""
                          width={40}
                          height={40}
                          unoptimized
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/10">
                          <ListMusic className="h-4 w-4 text-white/50" aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">{p.name}</span>
                        {sub && <span className="block truncate text-xs text-white/50">{sub}</span>}
                      </span>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1DB954] text-black opacity-80 group-hover:opacity-100">
                        {pending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Play className="h-4 w-4 translate-x-[1px]" aria-hidden />
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {state.status === 'ready' && state.truncated && (
            <p className="px-4 py-2 text-center text-[11px] text-white/40">
              Showing your first {state.playlists.length} playlists.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
