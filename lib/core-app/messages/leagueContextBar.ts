import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { SURFACE_LABEL_ES } from '@/lib/core-app/shellCopy'
import { defineMessages } from '@/lib/i18n/messages'
import { LEAGUE_TYPE_DECIDES_GRADES } from '@/lib/league/leagueTypeGrading'

/**
 * The in-league context bar (components/core-app/CoreLeagueContextBar.tsx). Every string is the one
 * the bar printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. Interpolated values (league-type label, surface label, sync age) arrive already in the
 * reader's language: the component passes them through `leagueConceptText` / `ageText` /
 * `surfaceLabel`, each of which returns English unchanged.
 *
 * `surfaceLabel` is handed a surface's English label (`CORE_SURFACE_LABELS`) and returns it unchanged
 * in English; Spanish takes shellCopy's surface table, then `coreUiCopy`.
 */
export const leagueContextBarMessages = defineMessages({
  en: {
    checking: 'checking',
    ready: 'ready',
    building: 'building',
    leagueInsights: 'League insights',
    askChimmyPrefill: (leagueName: string, surfaceLabel: string) =>
      `Review ${leagueName}'s ${surfaceLabel} and tell me the most important action to take next.`,
    askChimmy: 'Ask Chimmy',
    systemStatus: (leagueName: string) => `${leagueName} system status`,
    importTitle: 'What’s on file from this import',
    importChip: (platformUpper: string) => `${platformUpper} import · what’s on file`,
    gameDay: 'Game day',
    updatesDelayed: 'Updates delayed',
    connected: 'Connected',
    leagueDetails: 'League details',
    leagueType: 'League type',
    loading: 'Loading…',
    rostersCarryOver: 'Rosters carry over?',
    choose: 'Choose',
    confirm: 'Confirm',
    saving: 'Saving…',
    saved: (typeLabel: string) => `Saved — trades here are graded as ${typeLabel}`,
    loadSaveError: 'Could not load or save',
    pickPirateBase: 'Pick dynasty or redraft to save',
    notConfirmed: `Not confirmed — ${LEAGUE_TYPE_DECIDES_GRADES.charAt(0).toLowerCase()}${LEAGUE_TYPE_DECIDES_GRADES.slice(1)}`,
    surfaceLabel: (english: string): string => english,
  },
  es: {
    checking: 'comprobando',
    ready: 'listo',
    building: 'en preparación',
    leagueInsights: 'Análisis de la liga',
    askChimmyPrefill: (leagueName, surfaceLabel) =>
      `Revisa ${surfaceLabel} de ${leagueName} y dime la acción más importante que debo tomar ahora.`,
    askChimmy: 'Preguntar a Chimmy',
    systemStatus: (leagueName) => `Estado del sistema de ${leagueName}`,
    importTitle: 'Qué hay registrado de esta importación',
    importChip: (platformUpper) => `Importación de ${platformUpper} · qué hay registrado`,
    gameDay: 'Día de partido',
    updatesDelayed: 'Actualizaciones retrasadas',
    connected: 'Conectado',
    leagueDetails: 'Detalles de la liga',
    leagueType: 'Tipo de liga',
    loading: 'Cargando…',
    rostersCarryOver: '¿Las plantillas se mantienen?',
    choose: 'Elige',
    confirm: 'Confirmar',
    saving: 'Guardando…',
    saved: (typeLabel) => `Guardado: los intercambios de esta liga se califican como ${typeLabel}`,
    loadSaveError: 'No se pudo cargar ni guardar',
    pickPirateBase: 'Elige dynasty o redraft para guardar',
    notConfirmed: 'Sin confirmar: tu tipo de liga decide cómo se califica cada intercambio de esta liga.',
    surfaceLabel: (english) => SURFACE_LABEL_ES[english] ?? coreUiCopy(english, 'es'),
  },
})
