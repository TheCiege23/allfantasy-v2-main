import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * "We could not read this just now" for a /core screen whose server read failed.
 *
 * ⚠ ELEVEN COPIES OF THIS PANEL WERE HAND-WRITTEN IN page.tsx, EACH IN ENGLISH ONLY. They are
 * server-rendered, so the client language provider never reached them; a Spanish reader got an
 * English failure message on an otherwise Spanish screen. The title and body are passed in English
 * and translated here through `coreUiCopy`, keyed by the exact English string, so a panel added
 * later only needs its sentence added there.
 *
 * Server component, no client bundle. `role="alert"` matches ScreenLoadError's.
 */
export function ScreenUnavailable({
  title,
  body,
  language,
}: {
  title: string
  body: string
  language: string
}) {
  return (
    <div className="af-frame" role="alert" style={{ padding: 24, maxWidth: 720 }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        {coreUiCopy(title, language)}
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
        {coreUiCopy(body, language)}
      </p>
    </div>
  )
}

export default ScreenUnavailable
