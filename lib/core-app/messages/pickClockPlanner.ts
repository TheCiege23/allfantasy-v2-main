import { defineMessages } from '@/lib/i18n/messages'

/**
 * Planning around a long pick clock — the due time under the top-bar clock and the next pick /
 * quiet hours / alerts cards above the board (components/app/draft-room/PickClockPlanner.tsx).
 * "Slow" is the commissioner's clock length, never a draft type; none of this copy says otherwise.
 * Spanish is complete: `__tests__/core-app/message-catalogs-complete.test.ts` fails on a missing key.
 */
export const pickClockPlannerMessages = defineMessages({
  en: {
    plannerAria: 'Planning your next pick',
    dueAt: (time: string): string => `due ${time}`,

    nextPickEyebrow: (label: string): string => `Your next pick · ${label}`,
    nextPickEyebrowNoLabel: 'Your next pick',
    onClockHeadline: (time: string): string => `You’re on the clock, due ${time}`,
    etaToday: (time: string): string => `Around ${time}`,
    etaTomorrow: (time: string): string => `Likely tomorrow, around ${time}`,
    etaLater: (weekday: string, time: string): string => `Likely ${weekday}, around ${time}`,
    picksToGo: (n: number): string => (n === 1 ? '1 pick to go' : `${n} picks to go`),
    overnightSuffix: ', and the clock stops overnight',
    clockStopsOvernight: 'The clock stops overnight.',
    queueTop: (name: string, position: string): string => `Top of your queue: ${name}${position ? `, ${position}` : ''}.`,

    quietEyebrow: 'Quiet hours',
    quietChip: (start: string, end: string, zone: string): string => `Quiet ${start}–${end} ${zone}`,
    quietPausesAt: (time: string, zone: string): string => `Clock pauses at ${time} ${zone}`,
    quietPausedUntil: (time: string, zone: string): string => `Clock paused until ${time} ${zone}`,
    quietBodyNoPicks: (time: string, zone: string): string =>
      `It starts again at ${time} ${zone}, and nobody can pick in between. Set by your commissioner.`,
    quietBodyPicksAllowed: (time: string, zone: string): string =>
      `It starts again at ${time} ${zone}. You can still pick in between. Set by your commissioner.`,

    alertsEyebrow: 'Alerts',
    alertsOn: (channels: string): string => `Draft alerts are on · ${channels}`,
    alertsOnInAppOnly: 'Draft alerts are on in the app only',
    alertsOnBody: 'You’ll hear when you’re 3 picks away, on the clock, and when your time is running low.',
    alertsOff: 'Draft alerts are off',
    alertsOffBody: 'Turn them on to hear when you’re up, so you don’t have to keep checking.',
    alertsAllOff: 'All your notifications are off',
    alertsUnknown: 'Choose how you hear about your picks',
    alertsTurnOn: 'Turn on',
    alertsSaving: 'Turning on…',
    alertsFailed: 'Couldn’t save that. Try again.',
    alertsManage: 'Change',
    alertsButtonOn: 'Alerts on',
    alertsButtonOff: 'Alert me',
    channelPush: 'push',
    channelEmail: 'email',
    channelSms: 'text',
  },
  es: {
    plannerAria: 'Planifica tu próxima selección',
    dueAt: (time: string): string => `hasta las ${time}`,

    nextPickEyebrow: (label: string): string => `Tu próxima selección · ${label}`,
    nextPickEyebrowNoLabel: 'Tu próxima selección',
    onClockHeadline: (time: string): string => `Te toca, tienes hasta las ${time}`,
    etaToday: (time: string): string => `Alrededor de las ${time}`,
    etaTomorrow: (time: string): string => `Probablemente mañana, alrededor de las ${time}`,
    etaLater: (weekday: string, time: string): string => `Probablemente el ${weekday}, alrededor de las ${time}`,
    picksToGo: (n: number): string => (n === 1 ? 'Falta 1 selección' : `Faltan ${n} selecciones`),
    overnightSuffix: ', y el reloj se detiene por la noche',
    clockStopsOvernight: 'El reloj se detiene por la noche.',
    queueTop: (name: string, position: string): string => `Primero en tu cola: ${name}${position ? `, ${position}` : ''}.`,

    quietEyebrow: 'Horas de silencio',
    quietChip: (start: string, end: string, zone: string): string => `Silencio ${start}–${end} ${zone}`,
    quietPausesAt: (time: string, zone: string): string => `El reloj se detiene a las ${time} ${zone}`,
    quietPausedUntil: (time: string, zone: string): string => `Reloj detenido hasta las ${time} ${zone}`,
    quietBodyNoPicks: (time: string, zone: string): string =>
      `Vuelve a correr a las ${time} ${zone} y nadie puede elegir mientras tanto. Lo fijó tu comisionado.`,
    quietBodyPicksAllowed: (time: string, zone: string): string =>
      `Vuelve a correr a las ${time} ${zone}. Aun así puedes elegir mientras tanto. Lo fijó tu comisionado.`,

    alertsEyebrow: 'Alertas',
    alertsOn: (channels: string): string => `Alertas del draft activadas · ${channels}`,
    alertsOnInAppOnly: 'Alertas del draft activadas solo en la app',
    alertsOnBody: 'Te avisaremos cuando te falten 3 selecciones, cuando te toque y cuando se te acabe el tiempo.',
    alertsOff: 'Alertas del draft desactivadas',
    alertsOffBody: 'Actívalas para saber cuándo te toca sin tener que revisar a cada rato.',
    alertsAllOff: 'Todas tus notificaciones están desactivadas',
    alertsUnknown: 'Elige cómo te avisamos de tus selecciones',
    alertsTurnOn: 'Activar',
    alertsSaving: 'Activando…',
    alertsFailed: 'No se pudo guardar. Inténtalo de nuevo.',
    alertsManage: 'Cambiar',
    alertsButtonOn: 'Alertas activas',
    alertsButtonOff: 'Avísame',
    channelPush: 'push',
    channelEmail: 'correo',
    channelSms: 'SMS',
  },
})
