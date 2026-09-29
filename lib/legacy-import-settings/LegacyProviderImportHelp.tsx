import type { LegacyProviderId } from './types'

/**
 * Popover copy for `/af-rankings` and similar surfaces. Explains what to enter and where full import lives.
 */
export function LegacyProviderImportHelp({ providerId }: { providerId: LegacyProviderId }) {
  const commonImportPage = (
    <p className="mt-2 text-[11px] leading-snug text-white/55">
      For ESPN, Yahoo, MFL, and Fantrax, use the dedicated{' '}
      <span className="font-semibold text-cyan-200/90">Import your league</span> flow — same account session, progress, and
      rankings updates as here.
    </p>
  )

  switch (providerId) {
    case 'sleeper':
      return (
        <div className="space-y-2 text-[11px] leading-snug text-white/80">
          <p>
            Enter your <span className="font-semibold text-white">Sleeper username</span> (handle), not your display name.
            In the Sleeper app: <span className="text-white/90">Profile → username</span> under your avatar.
          </p>
          <p className="text-white/55">
            We call Sleeper&apos;s public API to resolve your user id, then import league history tied to your AllFantasy
            account for rank and legacy stats.
          </p>
        </div>
      )
    case 'espn':
      return (
        <div className="space-y-2 text-[11px] leading-snug text-white/80">
          <p>
            <span className="font-semibold text-white">ESPN league id</span> — open your league in a desktop browser. The
            URL looks like{' '}
            <code className="rounded bg-white/10 px-1 py-0.5 text-[11px]">fantasy.espn.com/football/league/123456</code> —
            the numeric segment is the league id.
          </p>
          <p className="text-white/55">
            You must be able to access that league with the account you use on AllFantasy when the import tool requests it.
          </p>
          {commonImportPage}
        </div>
      )
    case 'yahoo':
      return (
        <div className="space-y-2 text-[11px] leading-snug text-white/80">
          <p>
            <span className="font-semibold text-white">Yahoo league key</span> — from the league URL or Fantasy API tools
            page, e.g. <code className="rounded bg-white/10 px-1 py-0.5 text-[11px]">414.l.123456</code> (game · l · league
            id).
          </p>
          <p className="text-white/55">Use the key for the season you want to anchor; the import tool validates access.</p>
          {commonImportPage}
        </div>
      )
    case 'mfl':
      return (
        <div className="space-y-2 text-[11px] leading-snug text-white/80">
          <p>
            <span className="font-semibold text-white">MyFantasyLeague</span> — you need your{' '}
            <span className="text-white/90">league id</span> and often an authenticated session (site cookie or API key)
            depending on the flow.
          </p>
          <p className="text-white/55">
            Find the league id in your MFL URL or league settings. The full import page connects through the supported MFL
            path.
          </p>
          {commonImportPage}
        </div>
      )
    case 'fantrax':
      return (
        <div className="space-y-2 text-[11px] leading-snug text-white/80">
          <p>
            <span className="font-semibold text-white">Fantrax</span> — use your <span className="text-white/90">username</span>{' '}
            or the identifier the import tool asks for (league slug / id varies by sport).
          </p>
          <p className="text-white/55">The unified Import page validates your input and queues the same rank pipeline.</p>
          {commonImportPage}
        </div>
      )
    case 'fleaflicker':
      return (
        <div className="space-y-2 text-[11px] leading-snug text-white/80">
          <p>
            <span className="font-semibold text-white">Fleaflicker</span> — your <span className="text-white/90">league id</span>{' '}
            appears in the league URL on fleaflicker.com.
          </p>
          <p className="text-white/55">
            Automated import for Fleaflicker is still rolling out platform-wide; use Settings → Legacy import for status,
            or the Import page when your account shows as eligible.
          </p>
        </div>
      )
    default:
      return <p className="text-[11px] text-white/70">Import instructions for this provider are not available.</p>
  }
}
