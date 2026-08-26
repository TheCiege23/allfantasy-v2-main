import Link from 'next/link'
import '@/components/core-app/af-commish-hub.css'
import type {
  CommissionerHubResult,
  CommissionerQueueItem,
  CommissionerTile,
} from '@/lib/core-app/commissionerHub'

/**
 * Screen 38a·9 — Commissioner Hub.
 *
 * ⚠ THIS TAB PREVIOUSLY RENDERED "this screen is part of the core-app redesign
 * and has not been built yet." The nav entry existed; the render branch did
 * not.
 *
 * The handoff's role switcher — Commissioner / Co-commissioner / Member — is a
 * cosmetic demonstration of a check that has to be real, and it is: the gate
 * lives in `getCommissionerHub`, runs server-side before any league figure is
 * read, and the same resolver decides whether the nav item is drawn at all.
 * There is nothing to switch here because the server already decided.
 *
 * ⚠ A SERVER COMPONENT ON PURPOSE. Every control on this screen either links
 * somewhere already gated or does nothing; there is no client state to hold. A
 * commissioner surface that shipped its data to the browser and decided what to
 * show there would be exactly the pattern this screen exists to not be.
 */

export type CommissionerHubProps = {
  data: CommissionerHubResult
  /** Where "ask for access" points. Null when the league has no chat surface. */
  messageHref?: string | null
}

export function CommissionerHub({ data, messageHref = null }: CommissionerHubProps) {
  if (!data.allowed) {
    return (
      <div className="af-ch">
        <header className="af-ch-head">
          <p className="af-label af-ch-eyebrow">Core · Commissioner</p>
          <h1 className="af-display af-ch-title">Commissioner</h1>
        </header>

        <div className="af-ch-blocked">
          <span className="af-ch-blocked-mark" aria-hidden>
            ⚑
          </span>
          <h2 className="af-ch-blocked-title">Commissioners and co-commissioners only</h2>
          <p className="af-ch-blocked-body">{data.reason}</p>
          {/*
            States what the viewer IS, not just what they are not. "You are a
            member of this league" is a different situation from "you are not in
            this league at all", and someone who hit this screen deserves to
            know which one they are looking at.
          */}
          <p className="af-ch-blocked-role">
            {data.role === 'member'
              ? `You are a member of ${data.leagueName}. Ask its commissioner to add you as a co-commissioner if you need this.`
              : data.role === 'viewer'
                ? `You have view-only access to ${data.leagueName}.`
                : `You are not a member of ${data.leagueName}.`}
          </p>
        </div>
      </div>
    )
  }

  const { league, role, tiles, queue, queueEmptyReason, settings, access, unread, disputes, publicStandings } =
    data

  return (
    <div className="af-ch">
      <header className="af-ch-head">
        <p className="af-label af-ch-eyebrow">{league.name}</p>
        <div className="af-ch-title-row">
          <h1 className="af-display af-ch-title">Commissioner</h1>
          <span className="af-ch-role af-label" data-role={role}>
            {role === 'commissioner' ? 'Commissioner' : 'Co-commissioner'}
          </span>
        </div>
        <p className="af-ch-lede">
          League health, what needs a ruling, and the settings this league actually runs on.
          AllFantasy reads {league.platform === 'manual' ? 'this league' : league.platform} — every
          change is still made there.
        </p>
      </header>

      {/*
        ⚠ THE BANNER IS THE POINT, NOT DECORATION. Without it a league nobody has
        ever synced renders four calm tiles — "0 unclaimed", "0 waiting on you",
        a healthy-looking screen assembled entirely out of the absence of data.
      */}
      {unread ? (
        <div className="af-ch-unread">
          <span className="af-label">Not measured yet</span>
          <p>
            This league has never synced, so nothing below has been checked. An empty attention
            queue here means we have not looked — not that the league is quiet.
          </p>
        </div>
      ) : null}

      <div className="af-ch-tiles">
        {tiles.map((t) => (
          <Tile key={t.key} tile={t} />
        ))}
      </div>

      {/* ── Attention queue ─────────────────────────────────────────── */}
      <section className="af-card af-ch-section">
        <header className="af-ch-section-head">
          <h2 className="af-label">Needs a ruling</h2>
          <span className="af-ch-section-note">
            {queue.length > 0 ? 'Most urgent first' : 'Nothing outstanding'}
          </span>
        </header>

        {queue.length > 0 ? (
          <ul className="af-ch-queue">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <div className="af-ch-empty">
            <span className="af-ch-empty-mark af-num" aria-hidden>
              —
            </span>
            <p>{queueEmptyReason}</p>
          </div>
        )}
      </section>

      <div className="af-ch-split">
        {/* ── Settings ──────────────────────────────────────────────── */}
        <section className="af-card af-ch-section">
          <header className="af-ch-section-head">
            <h2 className="af-label">How this league runs</h2>
            {league.season != null ? (
              <span className="af-ch-section-note af-num">{league.season}</span>
            ) : null}
          </header>

          <ul className="af-ch-settings">
            {settings.map((row) => (
              <li key={row.key}>
                <span className="af-ch-setting-key">{row.key}</span>
                {row.state.available ? (
                  <span className="af-ch-setting-value">{row.state.data}</span>
                ) : (
                  <span className="af-ch-setting-why">{row.state.reason}</span>
                )}
              </li>
            ))}
          </ul>

          {/*
            Disputes state their absence rather than being quietly left off the
            screen. The design gives them a tile; the engines behind them only
            read AF-native tables, so on an imported league the scan cannot find
            anything and "0 disputes" would be a claim with no scan behind it.
          */}
          <div className="af-ch-disputes">
            <span className="af-label">Disputes</span>
            <p>{disputes.reason}</p>
          </div>
        </section>

        {/* ── Access ────────────────────────────────────────────────── */}
        <section className="af-card af-ch-section">
          <header className="af-ch-section-head">
            <h2 className="af-label">Who can run this league</h2>
            <span className="af-ch-section-note">
              {access.length} {access.length === 1 ? 'person' : 'people'}
            </span>
          </header>

          {access.length > 0 ? (
            <ul className="af-ch-access">
              {access.map((a) => (
                <li key={`${a.role}-${a.handle}`}>
                  <span className="af-ch-access-mark af-num" aria-hidden>
                    {a.initials}
                  </span>
                  <span className="af-ch-access-name">
                    {a.handle}
                    {a.isYou ? <span className="af-ch-access-you"> · you</span> : null}
                  </span>
                  <span className="af-ch-access-role af-label" data-role={a.role}>
                    {a.role === 'commissioner' ? 'Commissioner' : 'Co-commissioner'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="af-ch-empty">
              <span className="af-ch-empty-mark af-num" aria-hidden>
                —
              </span>
              <p>
                No commissioner is recorded on this league&apos;s ingested teams. That is a gap in
                what the platform published, not a league without one.
              </p>
            </div>
          )}

          {/*
            The boundary the handoff asks to be stated. Worth saying plainly to a
            co-commissioner rather than discovering it at a 403.
          */}
          {role === 'co_commissioner' ? (
            <p className="af-ch-boundary">
              As a co-commissioner you can act on everything above. You cannot transfer
              commissionership or remove the primary commissioner.
            </p>
          ) : null}
        </section>
      </div>

      {/* ── Public standings ────────────────────────────────────────── */}
      <section className="af-card af-ch-section af-ch-publish" data-on={publicStandings.enabled}>
        <header className="af-ch-section-head">
          <h2 className="af-label">Public standings</h2>
          <span className="af-ch-section-note" data-on={publicStandings.enabled}>
            {publicStandings.enabled ? 'Published' : 'Private'}
          </span>
        </header>

        {publicStandings.enabled ? (
          <>
            <p className="af-ch-publish-body">
              This league&apos;s standings are readable by anyone with the link, without an
              account, and search engines are allowed to index them. Team names are published;
              manager names are not.
            </p>
            <a
              className="af-ch-publish-link"
              href={publicStandings.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {publicStandings.url} ↗
            </a>
          </>
        ) : (
          <p className="af-ch-publish-body">
            {/*
              ⚠ THE COPY STATES WHAT PUBLISHING ACTUALLY DOES, NOT THAT IT IS A
              FEATURE. League and team names are user-authored and often
              personal; a commissioner turning this on is publishing twelve
              people's writing, and should be told that in the same sentence as
              the offer.
            */}
            Off. Turning this on gives this league a public page at{' '}
            <code>{publicStandings.url}</code> — readable without an account and indexable by
            search engines. It publishes the league name, team names, records and points. It does
            not publish manager names.
          </p>
        )}
      </section>

      <p className="af-ch-footnote">
        AllFantasy only reads this league. Settings and rulings are applied on{' '}
        {league.platform === 'manual' ? 'your platform' : league.platform}.
        {messageHref ? (
          <>
            {' '}
            <Link href={messageHref}>Open league chat</Link>
          </>
        ) : null}
      </p>
    </div>
  )
}

function Tile({ tile }: { tile: CommissionerTile }) {
  if (!tile.state.available) {
    return (
      <div className="af-ch-tile" data-missing="true">
        <div className="af-ch-tile-value af-num">—</div>
        <div className="af-label">{tile.label}</div>
        <div className="af-ch-tile-why">{tile.state.reason}</div>
      </div>
    )
  }
  return (
    <div className="af-ch-tile" data-tone={tile.tone}>
      <div className="af-ch-tile-value af-num">{tile.state.data.value}</div>
      <div className="af-label">{tile.label}</div>
      {tile.state.data.sub ? <div className="af-ch-tile-sub">{tile.state.data.sub}</div> : null}
    </div>
  )
}

function QueueRow({ item }: { item: CommissionerQueueItem }) {
  return (
    <li className="af-ch-queue-row" data-severity={item.severity}>
      <span className="af-ch-queue-mark" aria-hidden>
        {item.glyph}
      </span>
      <span className="af-ch-queue-text">
        <span className="af-ch-queue-title">{item.title}</span>
        <span className="af-ch-queue-detail">{item.detail}</span>
      </span>
      {item.action ? (
        item.action.external ? (
          /*
            An off-platform action is marked as one. Every ruling is ultimately
            applied on the platform, and a button that looks in-app but throws
            you to Sleeper is the single most confusing control this screen
            could carry.
          */
          <a
            className="af-btn af-ch-queue-action"
            href={item.action.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.action.label} ↗
          </a>
        ) : (
          <Link className="af-btn af-ch-queue-action" href={item.action.href}>
            {item.action.label}
          </Link>
        )
      ) : null}
    </li>
  )
}

export default CommissionerHub
