import { defineMessages } from '@/lib/i18n/messages'
import type { CompletionField } from './settingsHubGuide'

/**
 * Settings hub copy (2026-11-14): the answer at the top, the plain-word state on each card, and the
 * four group names. Every value describes the reader's own account, read by `settingsHubGuide.ts`.
 */
const fixFieldEn: Record<CompletionField, string> = {
  displayName: 'Add a display name',
  bio: 'Add a bio',
  avatar: 'Add a picture',
  sports: 'Pick your sports',
  timezone: 'Set your timezone',
}
const headFieldEn: Record<CompletionField, string> = {
  displayName: 'Add a display name to finish your profile',
  bio: 'Add a bio to finish your profile',
  avatar: 'Add a picture to finish your profile',
  sports: 'Pick your sports to finish your profile',
  timezone: 'Set your timezone to finish your profile',
}
const fixFieldEs: Record<CompletionField, string> = {
  displayName: 'Añade un nombre visible',
  bio: 'Añade una biografía',
  avatar: 'Añade una foto',
  sports: 'Elige tus deportes',
  timezone: 'Fija tu zona horaria',
}
const headFieldEs: Record<CompletionField, string> = {
  displayName: 'Añade un nombre visible para completar tu perfil',
  bio: 'Añade una biografía para completar tu perfil',
  avatar: 'Añade una foto para completar tu perfil',
  sports: 'Elige tus deportes para completar tu perfil',
  timezone: 'Fija tu zona horaria para completar tu perfil',
}

/** "America/New_York" → "New York". The IANA id is what the profile stores; the city is what people read. */
const tzCity = (tz: string): string => (tz.split('/').pop() ?? tz).replace(/_/g, ' ')

export const settingsHubGuideMessages = defineMessages({
  en: {
    eyebrow: (name: string) => `Settings · ${name}`,
    headClear: 'Your account is set up',
    headMany: (n: number) => `${n} things to check`,
    headPaymentDue: "Your plan's last payment didn't go through",
    headEmailUnverified: 'Verify your email',
    headPhoneUnverified: 'Verify your phone',
    headNotificationsOff: 'Notifications are off, so nothing will reach you',
    headProfileField: (field: CompletionField): string => headFieldEn[field],
    intro: 'Change your profile, sign-in, what you see and what reaches you. Search, or pick a section below.',
    fixPaymentDue: 'Update payment',
    fixEmailUnverified: 'Verify email',
    fixPhoneUnverified: 'Verify phone',
    fixNotificationsOff: 'Turn notifications on',
    fixProfileField: (field: CompletionField): string => fixFieldEn[field],
    whyPaymentDue: 'Why it matters: if the payment is not fixed, your plan stops when the grace period ends.',
    whyEmailUnverified: 'Why it matters: a verified email is how you get back in if you lose your password.',
    whyPhoneUnverified: 'Why it matters: a verified phone can get you back in and receive alerts by text.',
    whyNotificationsOff: 'Why it matters: injury news, trade offers and draft turns will not reach you until one channel is on.',
    whyProfileField: 'Why it matters: league mates see your name, picture and bio next to your trades and chats.',
    // Groups
    groupAccount: 'You',
    groupApp: 'What you see and hear',
    groupLeagues: 'Leagues & history',
    groupPlan: 'Plan & legal',
    // Card states
    profileDone: 'All filled in',
    securityEmailUnverified: 'Email not verified',
    securityPhoneUnverified: 'Phone not verified',
    securityEmailAndPhone: 'Email and phone verified',
    securityEmailOnly: 'Email verified',
    securityPhoneOnly: 'Phone verified',
    notificationsOn: 'On',
    notificationsOff: 'Off: nothing reaches you',
    connectedNone: 'Nothing linked yet',
    planRenews: (plan: string, date: string) => `${plan} · renews ${date}`,
    planUntil: (plan: string, date: string) => `${plan} · access until ${date}`,
    planPaymentDue: (plan: string) => `${plan} · payment didn't go through`,
    planFree: 'Free plan',
    planAdmin: (plan: string) => `${plan} · admin access, not billed`,
    preferences: (language: string, tz: string | null): string => (tz ? `${language} · ${tzCity(tz)} time` : language),
    level: (level: number, tier: string | null): string => (tier ? `Level ${level} · ${tier}` : `Level ${level}`),
  },
  es: {
    eyebrow: (name: string) => `Ajustes · ${name}`,
    headClear: 'Tu cuenta está lista',
    headMany: (n: number) => `${n} cosas por revisar`,
    headPaymentDue: 'El último pago de tu plan no se completó',
    headEmailUnverified: 'Verifica tu correo',
    headPhoneUnverified: 'Verifica tu teléfono',
    headNotificationsOff: 'Las notificaciones están apagadas: no te llegará nada',
    headProfileField: (field: CompletionField): string => headFieldEs[field],
    intro: 'Cambia tu perfil, el inicio de sesión, lo que ves y lo que te llega. Busca o elige una sección abajo.',
    fixPaymentDue: 'Actualizar el pago',
    fixEmailUnverified: 'Verificar correo',
    fixPhoneUnverified: 'Verificar teléfono',
    fixNotificationsOff: 'Activar notificaciones',
    fixProfileField: (field: CompletionField): string => fixFieldEs[field],
    whyPaymentDue: 'Por qué importa: si no se arregla el pago, tu plan se detiene al terminar el periodo de gracia.',
    whyEmailUnverified: 'Por qué importa: un correo verificado es cómo vuelves a entrar si olvidas tu contraseña.',
    whyPhoneUnverified: 'Por qué importa: un teléfono verificado te deja volver a entrar y recibir alertas por SMS.',
    whyNotificationsOff: 'Por qué importa: las lesiones, ofertas de cambio y turnos de draft no te llegarán hasta que actives un canal.',
    whyProfileField: 'Por qué importa: tus compañeros de liga ven tu nombre, foto y biografía junto a tus cambios y chats.',
    groupAccount: 'Tú',
    groupApp: 'Lo que ves y recibes',
    groupLeagues: 'Ligas e historial',
    groupPlan: 'Plan y legal',
    profileDone: 'Todo completo',
    securityEmailUnverified: 'Correo sin verificar',
    securityPhoneUnverified: 'Teléfono sin verificar',
    securityEmailAndPhone: 'Correo y teléfono verificados',
    securityEmailOnly: 'Correo verificado',
    securityPhoneOnly: 'Teléfono verificado',
    notificationsOn: 'Activadas',
    notificationsOff: 'Apagadas: no te llega nada',
    connectedNone: 'Nada vinculado todavía',
    planRenews: (plan: string, date: string) => `${plan} · se renueva el ${date}`,
    planUntil: (plan: string, date: string) => `${plan} · acceso hasta el ${date}`,
    planPaymentDue: (plan: string) => `${plan} · el pago no se completó`,
    planFree: 'Plan gratuito',
    planAdmin: (plan: string) => `${plan} · acceso admin, sin cobro`,
    preferences: (language: string, tz: string | null): string => (tz ? `${language} · hora de ${tzCity(tz)}` : language),
    level: (level: number, tier: string | null): string => (tier ? `Nivel ${level} · ${tier}` : `Nivel ${level}`),
  },
})

/** A language's own name, which is how a language picker names it in every UI language. */
export function languageName(code: string | null | undefined): string {
  switch (code) {
    case 'es':
      return 'Español'
    case 'zh':
      return '中文'
    case 'fil':
      return 'Filipino'
    case 'vi':
      return 'Tiếng Việt'
    default:
      return 'English'
  }
}
