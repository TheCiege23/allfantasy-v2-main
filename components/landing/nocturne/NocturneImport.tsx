'use client'

/**
 * Nocturne import entry — the landing "bring your league into AllFantasy" form.
 *
 * Launch funnel (canonical): the visitor picks a platform and enters their
 * Sleeper username (or a league ID for other platforms), then we send them to
 * signup with the intent preserved. After they create an account / sign in they
 * land on the real `/import` route with the platform selected and their input
 * prefilled, ready to run the canonical discovery → preview → commit pipeline.
 *
 * There is NO anonymous import here: the landing funnel never calls
 * `/api/legacy/guest-import` and never writes `Legacy*` records. The separate
 * legacy career-history import lives only in the distinct `/af-legacy` product.
 *
 * Rendered twice on the landing page: `variant="mini"` (compact one-row form
 * under the hero) and `variant="full"` (platform chips + input). Each instance
 * is self-contained.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Lock } from 'lucide-react'
import { signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { NOCTURNE_COPY as C } from './copy'

type PlatformId = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fantrax' | 'fleaflicker'

type PlatformMeta = {
  id: PlatformId
  label: string
  initial: string
  color: string
  /** Word used in the trust line and which `/import` param prefills the value. */
  inputKind: 'username' | 'league ID'
  placeholder: string
}

const PLATFORMS: readonly PlatformMeta[] = [
  { id: 'sleeper', label: 'Sleeper', initial: 'S', color: '#1f2a4d', inputKind: 'username', placeholder: 'e.g. gridiron_gary' },
  { id: 'espn', label: 'ESPN', initial: 'E', color: '#4a1414', inputKind: 'league ID', placeholder: 'e.g. 1948204' },
  { id: 'yahoo', label: 'Yahoo', initial: 'Y', color: '#3a1d55', inputKind: 'league ID', placeholder: 'e.g. 428931' },
  { id: 'mfl', label: 'MFL', initial: 'M', color: '#143a2e', inputKind: 'league ID', placeholder: 'e.g. 60184' },
  { id: 'fantrax', label: 'Fantrax', initial: 'F', color: '#5a3a14', inputKind: 'league ID', placeholder: 'e.g. abc123xy' },
  { id: 'fleaflicker', label: 'Fleaflicker', initial: 'FL', color: '#14324a', inputKind: 'league ID', placeholder: 'e.g. 12345' },
] as const

/**
 * Build the canonical `/import` destination with the visitor's input prefilled
 * via the EXISTING search-param contract that `app/import/page.tsx` reads:
 * `provider` (→ default tab), `username` (→ Sleeper prefill), and
 * `leagueId`/`sourceId` (→ non-Sleeper source prefill). No new contract.
 */
export function buildImportIntentPath(platform: Pick<PlatformMeta, 'id' | 'inputKind'>, rawValue: string): string {
  const clean = rawValue.trim()
  const key = platform.inputKind === 'username' ? 'username' : 'leagueId'
  const params = new URLSearchParams({ provider: platform.id })
  if (clean) params.set(key, clean)
  return `/import?${params.toString()}`
}

export function NocturneImport({ variant }: { variant: 'mini' | 'full' }) {
  const router = useRouter()
  const [platformId, setPlatformId] = useState<PlatformId>('sleeper')
  const [value, setValue] = useState('')

  // Always defined: platformId is a valid PlatformId and PLATFORMS is non-empty.
  const platform = PLATFORMS.find((p) => p.id === platformId) ?? PLATFORMS[0]!
  // Availability comes from the SAME authoritative provider-ui-config the
  // canonical import UI uses — never hardcoded here.
  const platformAvailable = isImportProviderAvailable(platform.id)
  const submitLabel = variant === 'mini' ? C.importFlow.submitMini : C.importFlow.submitFull

  function selectPlatform(id: PlatformId) {
    if (id === platformId) return
    setPlatformId(id)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const clean = value.trim()
    if (!clean) return
    // A provider that isn't available end-to-end must NOT create a signup/import
    // intent — no dead-end into a blocked import flow.
    if (!isImportProviderAvailable(platform.id)) return

    // Preserve the entered username/leagueId through signup intent → canonical
    // /import. Unauthenticated landing visitors create an account first; there
    // is NO anonymous import and NO legacy guest-import call from this funnel.
    const dest = signupUrlWithIntent(buildImportIntentPath(platform, clean))
    trackLandingCtaClick({
      cta_label: submitLabel,
      cta_destination: dest,
      cta_type: 'primary',
      source: `nocturne-import-${variant}-${platform.id}`,
    })
    router.push(dest)
  }

  // ── Mini variant: compact one-row form (platform <select> + input + button) ──
  if (variant === 'mini') {
    return (
      <form className="n-import-mini" onSubmit={handleSubmit} aria-label={C.importFlow.miniLabel}>
        <label className="n-visually-hidden" htmlFor="n-import-mini-platform">Platform</label>
        <select
          id="n-import-mini-platform"
          className="n-select"
          value={platformId}
          onChange={(e) => selectPlatform(e.target.value as PlatformId)}
        >
          {PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {isImportProviderAvailable(p.id) ? p.label : `${p.label} — Coming soon`}
            </option>
          ))}
        </select>
        <input
          className="n-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={platform.placeholder}
          aria-label={`${platform.label} ${platform.inputKind}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="nocturne-import-mini-input"
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{ minHeight: 46, padding: '0 20px', fontSize: 14, flex: 'none' }}
          disabled={!value.trim() || !platformAvailable}
          data-testid="nocturne-import-mini-submit"
        >
          {submitLabel}
        </button>
        <TrustLine platform={platform} available={platformAvailable} compact />
      </form>
    )
  }

  // ── Full variant: platform chips + input + trust line ──
  return (
    <form onSubmit={handleSubmit} aria-label={C.importFlow.miniLabel}>
      <div className="n-plat-chips">
        {PLATFORMS.map((p) => {
          const selected = p.id === platformId
          const soon = !isImportProviderAvailable(p.id)
          return (
            <button
              key={p.id}
              type="button"
              className={`n-plat-chip${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => selectPlatform(p.id)}
              data-testid={`nocturne-plat-chip-${p.id}`}
            >
              <span className="n-plat-sq" style={{ background: p.color }}>{p.initial}</span>
              {p.label}
              {soon ? <span className="n-plat-soon"> · Coming soon</span> : null}
            </button>
          )
        })}
      </div>
      <div className="n-import-row">
        <input
          className="n-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={platform.placeholder}
          aria-label={`${platform.label} ${platform.inputKind}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="nocturne-import-full-input"
          style={{ flex: 1, minWidth: 220, minHeight: 48, fontSize: 15 }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{ minHeight: 48, padding: '0 24px', fontSize: 15, flex: 'none' }}
          disabled={!value.trim() || !platformAvailable}
          data-testid="nocturne-import-full-submit"
        >
          {submitLabel} <ArrowRight size={16} style={{ marginLeft: 2 }} />
        </button>
      </div>
      <TrustLine platform={platform} available={platformAvailable} />
    </form>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function TrustLine({
  platform,
  available,
  compact = false,
}: {
  platform: PlatformMeta
  available: boolean
  compact?: boolean
}) {
  const base: React.CSSProperties = {
    fontSize: 12.5,
    margin: compact ? '4px 0 0' : '12px 0 0',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: 'var(--color-neutral-600)',
  }
  const text = available
    ? C.importFlow.trustNote.replace('{label}', platform.label)
    : `${platform.label} isn't available yet — coming soon.`
  return (
    <p className="n-import-status" style={base}>
      <Lock size={13} style={{ flex: 'none' }} />
      {text}
    </p>
  )
}
