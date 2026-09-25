import type { DiscordBridgeScreen } from '@/lib/core-app/discordBridgeScreen'

/**
 * `/core/discord` when there is no bridge to render: no league picked, a league this user does not
 * run, or a read that failed. Each says what is actually true — see `loadDiscordBridgeScreen`.
 */
export function DiscordBridgeNotice({
  screen,
}: {
  screen: Exclude<DiscordBridgeScreen, { state: 'ready' }>
}) {
  return (
    <div className="af-frame" style={{ padding: 24, maxWidth: 720 }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        Discord bridge
      </h1>
      {screen.state === 'unavailable' ? (
        <>
          <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
            Couldn&apos;t load your Discord setup. Try again.
          </p>
          {/*
            A plain link, not next/link: a soft navigation to the same URL can be served from the
            router cache, which would show this same failure again without asking the server.
          */}
          <a
            className="af-btn"
            href={`/core/discord?league=${encodeURIComponent(screen.league.id)}`}
            style={{ display: 'inline-flex', marginTop: 12 }}
          >
            Try again
          </a>
        </>
      ) : screen.state === 'not-commissioner' ? (
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          Only the commissioner who runs {screen.league.name} on AllFantasy can set up its Discord.
          Once they connect it, the invite shows up in the Discord tab of your chat.
        </p>
      ) : (
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          Pick a league you commission from the rail. The bridge is configured per league —
          which channel a league posts to, and in which direction, only means something inside
          one league.
        </p>
      )}
    </div>
  )
}
