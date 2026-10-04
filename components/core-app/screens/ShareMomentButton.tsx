'use client'

import { useState } from 'react'
import { shareCardImage } from '@/components/decide/shareCard'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Share a moment as an image (shareable moments, 2026-09-14): fetches the auth-gated card PNG and
 * hands it to the native share sheet, or downloads it. The IMAGE is shared — the card URL never
 * leaves the signed-in session. Same states and copy as the rivalry card's button.
 *
 * Spanish (2026-10-04): the states and the default label follow the reader's language. A `label` the
 * caller passes is the caller's to translate.
 */
export function ShareMomentButton({
  url,
  filename,
  title,
  label,
}: {
  url: string
  filename: string
  title: string
  label?: string
}) {
  const es = useOptionalLanguage().language === 'es'
  const [state, setState] = useState<'idle' | 'working' | 'shared' | 'downloaded' | 'failed'>('idle')
  return (
    <button
      type="button"
      className="af3a-share-btn"
      disabled={state === 'working'}
      onClick={() => {
        setState('working')
        void shareCardImage(url, filename, title).then(setState)
      }}
    >
      {state === 'working'
        ? es ? 'Creando tarjeta…' : 'Building card…'
        : state === 'downloaded'
          ? es ? 'Tarjeta guardada ✓' : 'Card saved ✓'
          : state === 'shared'
            ? es ? 'Compartida ✓' : 'Shared ✓'
            : state === 'failed'
              ? es ? 'Reintentar' : 'Retry share'
              : label ?? (es ? 'Compartir' : 'Share')}
    </button>
  )
}

export default ShareMomentButton
