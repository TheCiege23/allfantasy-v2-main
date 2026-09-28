import '@/components/core-app/af-discord.css'
import type { DiscordBridgeScreen } from '@/lib/core-app/discordBridgeScreen'

/**
 * `/core/discord` when there is no bridge to render: no league picked, a league this user plays in
 * but does not run, or a read that failed. Each says what is actually true — see
 * `loadDiscordBridgeScreen`.
 *
 * ⚠ A MEMBER GETS A JOIN BUTTON AND NOTHING ELSE. Once the commissioner (or a co-commissioner) has
 * stored the league's invite, `not-commissioner` carries it and this renders one link out to
 * Discord. No switch, no field, no setup step — those live on the screen only the people who run the
 * league reach, and the routes behind them refuse everyone else anyway.
 */
export function DiscordBridgeNotice({
  screen,
}: {
  screen: Exclude<DiscordBridgeScreen, { state: 'ready' }>
}) {
  const member = screen.state === 'not-commissioner' ? screen : null
  return (
    <div className="af-frame af-dc" style={{ padding: 24, maxWidth: 720 }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        {member ? 'Your league’s Discord' : 'Discord bridge'}
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
      ) : member?.inviteUrl ? (
        <div className="af-dc-join">
          <p className="af-dc-join-lede">
            {member.league.name} has its own Discord server — trash talk, draft nights, voice chat. Get in
            there before the group chat moves on without you.
          </p>
          <a className="af-btn af-dc-btn af-dc-join-btn" href={member.inviteUrl} target="_blank" rel="noopener noreferrer">
            Join the league Discord ↗
          </a>
          <p className="af-dc-hint">
            Opens Discord. Your commissioner runs the server, and AllFantasy doesn&apos;t read what&apos;s said
            there.
          </p>
        </div>
      ) : member ? (
        <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          {member.league.name} doesn&apos;t have a Discord link yet. Your commissioner or a co-commissioner
          sets it up — once they do, a Join button shows up here and in the Discord tab of your chat.
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
