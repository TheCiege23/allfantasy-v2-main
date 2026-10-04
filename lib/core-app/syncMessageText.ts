/**
 * The Sync button's status line in the reader's language (2026-10-04).
 *
 * The progress and result lines are built in English by `syncRunLoop.ts` and `clientSyncJob.ts`,
 * plus whatever error the `/api/core/sync` round returns, and the Sync button printed them raw — so
 * every press showed English to a Spanish reader. The button translates at render, where the language
 * is known. Fixed lines map exactly, counted ones by pattern; unknown text passes through unchanged.
 *
 * ⚠ THE AUTH GUARD'S ERRORS ARE CODES, NOT SENTENCES, AND THEY WERE PRINTED RAW IN ENGLISH TOO.
 * `requireVerifiedUser` (lib/auth-guard.ts) answers a signed-out or unverified press with
 * `{ error: "UNAUTHENTICATED" }` and friends, which `syncRunLoop` relays as the message, so the
 * button read "UNAUTHENTICATED". Those become a sentence in either language.
 *
 * `__tests__/core-app/sync-message-text.test.ts` scans the producing modules, so a new English line
 * without a Spanish one fails there. PURE and client-safe: no imports.
 */

const CODE_TEXT: Record<string, { en: string; es: string }> = {
  UNAUTHENTICATED: { en: 'Sign in again to sync your leagues.', es: 'Vuelve a iniciar sesión para sincronizar tus ligas.' },
  INTERNAL_ERROR: { en: 'Sync did not run. Try again shortly.', es: 'La sincronización no se ejecutó. Inténtalo de nuevo en un momento.' },
  AGE_REQUIRED: { en: 'Confirm your age in Settings to sync your leagues.', es: 'Confirma tu edad en Configuración para sincronizar tus ligas.' },
  VERIFICATION_REQUIRED: { en: 'Verify your email to sync your leagues.', es: 'Verifica tu correo para sincronizar tus ligas.' },
}

const EXACT_ES: Record<string, string> = {
  // lib/core-app/clientSyncJob.ts
  'Continuing your unfinished league sync…': 'Continuando tu sincronización pendiente…',
  'Refreshing this league…': 'Actualizando esta liga…',
  'Refreshing your connected leagues…': 'Actualizando tus ligas conectadas…',
  'Sync stopped unexpectedly. Check league status before retrying.':
    'La sincronización se detuvo inesperadamente. Revisa el estado de la liga antes de reintentar.',
  'Could not confirm the sync result. Check your league’s Sync status before retrying.':
    'No se pudo confirmar el resultado. Revisa el estado de sincronización de tu liga antes de reintentar.',
  // lib/core-app/syncRunLoop.ts
  'Sync did not run. Try again shortly.': 'La sincronización no se ejecutó. Inténtalo de nuevo en un momento.',
  'The sync result could not be verified. Check league status before retrying.':
    'No se pudo verificar el resultado de la sincronización. Revisa el estado de la liga antes de reintentar.',
  'No connected leagues to sync': 'No hay ligas conectadas para sincronizar',
  // app/api/core/sync/route.ts — the round's top-level error
  'We could not read your leagues just now.': 'No pudimos leer tus ligas en este momento.',
}

const leagues = (n: string) => (n === '1' ? '1 liga sincronizada' : `${n} ligas sincronizadas`)

const PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Stopped after (\d+) of (\d+)$/, (m) => `Se detuvo tras ${m[1]} de ${m[2]}`],
  [
    /^Stopped after (\d+) of (\d+) — the next sync result could not be verified$/,
    (m) => `Se detuvo tras ${m[1]} de ${m[2]}: no se pudo verificar el siguiente resultado`,
  ],
  [/^Checked (\d+) of (\d+) · synced (\d+)…$/, (m) => `Revisadas ${m[1]} de ${m[2]} · sincronizadas ${m[3]}…`],
  [
    /^Checked (\d+) of (\d+) — completion could not be verified\. Check league status before retrying\.$/,
    (m) => `Revisadas ${m[1]} de ${m[2]}: no se pudo verificar que terminara. Revisa el estado de la liga antes de reintentar.`,
  ],
  [/^Synced (\d+) of (\d+) — press again to finish$/, (m) => `Sincronizadas ${m[1]} de ${m[2]}: pulsa de nuevo para terminar`],
  [
    /^Synced (\d+) of (\d+) · (\d+) failed · (\d+) already syncing$/,
    (m) => `Sincronizadas ${m[1]} de ${m[2]} · ${m[3]} con error · ${m[4]} ya en curso`,
  ],
  [/^Synced (\d+)$/, (m) => leagues(m[1]!)],
]

/** The status line in the reader's language. Auth codes become sentences in English too. */
export function syncMessageText(message: string | null | undefined, language: string): string {
  if (!message) return ''
  const code = CODE_TEXT[message.trim()]
  if (code) return language === 'es' ? code.es : code.en
  if (language !== 'es') return message
  const exact = EXACT_ES[message]
  if (exact) return exact
  for (const [pattern, render] of PATTERNS_ES) {
    const m = message.match(pattern)
    if (m) return render(m)
  }
  return message
}
