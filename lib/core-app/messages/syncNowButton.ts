import { defineMessages } from '@/lib/i18n/messages'

/**
 * "Sync now" (components/core-app/SyncNowButton.tsx). Every string is the one the button printed
 * before the move, byte for byte, in both languages — this is a relocation, not a rewrite. The sync
 * loop's own progress messages still go through `syncMessageText`; ages through `ageText`.
 */
export const syncNowButtonMessages = defineMessages({
  en: {
    syncing: 'Syncing…',
    syncThisLeague: 'Sync this league',
    syncNow: 'Sync now',
    hintNothingToSync: 'Import a league first — there is nothing to sync yet',
    hintThisLeague: 'Refresh rosters, scores and activity for this league',
    hintAll: 'Pick up new activity in your connected leagues',
    rereading: 'Re-reading your leagues…',
    notSyncedYet: 'Not synced yet',
    updated: (age: string) => `Updated ${age}`,
    panelLabel: 'Sync your leagues',
    noLeaguesYet: 'No leagues yet',
    yourLeagues: 'Your leagues',
    yourCount: (n: number) => `Your ${n} league${n === 1 ? '' : 's'}`,
    nothingRightNow: 'Nothing to sync right now.',
    importALeague: 'Import a league',
    toGetStarted: ' to get started.',
    // The auth guard's error codes as sentences (lib/core-app/syncMessageText.ts) — keyed by code.
    UNAUTHENTICATED: 'Sign in again to sync your leagues.',
    INTERNAL_ERROR: 'Sync did not run. Try again shortly.',
    AGE_REQUIRED: 'Confirm your age in Settings to sync your leagues.',
    VERIFICATION_REQUIRED: 'Verify your email to sync your leagues.',
  },
  es: {
    syncing: 'Sincronizando…',
    syncThisLeague: 'Sincronizar esta liga',
    syncNow: 'Sincronizar',
    hintNothingToSync: 'Importa una liga primero: aún no hay nada que sincronizar',
    hintThisLeague: 'Actualiza plantillas, marcadores y actividad de esta liga',
    hintAll: 'Trae la actividad nueva de tus ligas conectadas',
    rereading: 'Releyendo tus ligas…',
    notSyncedYet: 'Aún no se ha sincronizado',
    updated: (age) => `Actualizado ${age}`,
    panelLabel: 'Sincroniza tus ligas',
    noLeaguesYet: 'Aún no hay ligas',
    yourLeagues: 'Tus ligas',
    yourCount: (n) => `Tus ${n} liga${n === 1 ? '' : 's'}`,
    nothingRightNow: 'Nada que sincronizar por ahora.',
    importALeague: 'Importa una liga',
    toGetStarted: ' para empezar.',
    UNAUTHENTICATED: 'Vuelve a iniciar sesión para sincronizar tus ligas.',
    INTERNAL_ERROR: 'La sincronización no se ejecutó. Inténtalo de nuevo en un momento.',
    AGE_REQUIRED: 'Confirma tu edad en Configuración para sincronizar tus ligas.',
    VERIFICATION_REQUIRED: 'Verifica tu correo para sincronizar tus ligas.',
  },
})
