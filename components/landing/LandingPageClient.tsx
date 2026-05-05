'use client'

import type { ReactNode } from 'react'
import type { Session } from 'next-auth'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { ArrowRight, Shield } from 'lucide-react'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { loginUrlWithIntent, signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'

const LANDING_COPY = {
  en: {
    nav: {
      brand: 'AllFantasy',
      signIn: 'Sign In',
      signUp: 'Get Started →',
      dashboard: 'Dashboard',
      admin: 'Admin',
      forCommissioners: '★ For Commissioners',
    },
    badge: '✦ Now Live — Commissioners Get Early Access',
    hero: {
      titleTop: 'Run Your League.',
      titleBottom: 'Win Your League.',
      subtitle:
        'The only platform built for both the commissioner and the competitor. Manage any league format, arm every manager with AI, and keep every season running on autopilot.',
      primary: 'Get Started Free →',
      commissionerPrimary: 'Start a League',
      secondary: 'Sign In',
      alreadyHaveAccount: 'Already have an account? Sign in',
      primaryAuthed: 'Go to Dashboard →',
      reassurance: 'Free for players · Commissioners from $4.99/mo',
    },
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAA Football', 'NCAA Basketball', 'Soccer'],
    whatIs: {
      eyebrow: 'What is AllFantasy.ai?',
      titleTop: 'One Platform.',
      titleBottom: 'Built for Commissioners and Competitors Alike.',
      subtitle:
        'AllFantasy.ai gives commissioners the tools to run a tight ship and gives every manager in the league an AI edge. Import from Sleeper, Yahoo, or ESPN — your whole league migrates in minutes.',
      pillars: [
        {
          icon: '🏆',
          title: 'Every League Format',
          body: 'Dynasty, Devy, C2C, Salary Cap, Guillotine, Big Brother, Best Ball, and more.',
        },
        {
          icon: '⚡',
          title: 'Commissioner Control',
          body: 'Dispersal Drafts, integrity monitoring, weighted lottery, and broadcast tools.',
        },
        {
          icon: '🤖',
          title: 'AI for Every Manager',
          body: 'Chimmy gives every player in your league trade grades, waiver picks, and start/sit help.',
        },
        {
          icon: '📡',
          title: 'Sync Any Platform',
          body: 'Import your existing Sleeper, Yahoo, or ESPN leagues. No manual setup.',
        },
      ],
    },
    commissioner: {
      eyebrow: 'For Commissioners',
      title: 'The Control Room\nYour League Deserves.',
      subtitle:
        'Run every corner of your league — from dispersal drafts to integrity monitoring — without lifting a finger.',
      badge: 'AF Commissioner',
      badgeBody: 'One subscription covers every league you run. Cancel anytime.',
      features: [
        {
          icon: '🏈',
          title: 'Dispersal Draft',
          body: 'Managers leave? Pool their assets and run a live draft — automatically.',
        },
        {
          icon: '🔍',
          title: 'Integrity Monitoring',
          body: 'AI watches every trade for collusion. Opt-in anti-tanking keeps competition real.',
        },
        {
          icon: '🎱',
          title: 'Weighted Lottery',
          body: 'NBA-style draft order for dynasty year 2+. Kills tanking without killing excitement.',
        },
        {
          icon: '📡',
          title: 'Global Broadcast',
          body: 'Send announcements, polls, and events to all your leagues at once.',
        },
        {
          icon: '🤖',
          title: 'AI Manager',
          body: 'Orphaned team? AI steps in and manages it until a human takes over.',
        },
        {
          icon: '🛡️',
          title: 'League Advertising',
          body: 'Hard-to-fill spots? Post to Find-a-League and reach managers actively looking.',
        },
      ],
      cta: 'Start as Commissioner',
      ctaHref: '/signup?role=commissioner',
      secondaryCta: 'View Commissioner Plans',
      secondaryCtaHref: '/commissioner-upgrade?highlight=dispersal_draft',
    },
    tools: {
      eyebrow: 'AI Tools — For Every Manager',
      titleTop: 'Every Player Gets',
      titleBottom: 'An Unfair Advantage.',
      subtitle:
        "Six AI tools that work with your league's scoring, roster, and matchup context — not generic advice.",
      cards: [
        {
          icon: '⚖️',
          title: 'Trade Analyzer',
          body: 'AI fairness scores, value deltas, and lineup impact analysis before you accept or reject a deal.',
          previewTitle: 'Example output',
          previewLines: ['Fairness score: 92/100', 'Lineup swing: +11.8 pts', 'Verdict: accept if WR depth matters'],
        },
        {
          icon: '📋',
          title: 'Waiver Wire AI',
          body: 'Prioritized pickups with roster-fit confidence, FAAB guidance, and streaming fallbacks.',
          previewTitle: 'Example output',
          previewLines: ['Top claim: Jaxon Smith-Njigba', 'Suggested FAAB: 12-15%', 'Fallback: stream Chargers D/ST'],
        },
        {
          icon: '🎯',
          title: 'Draft Assistant',
          body: 'Live draft help with tier awareness, ADP tracking, and need-based pivot suggestions.',
          previewTitle: 'Live draft cue',
          previewLines: ['Tier break in 2 picks', 'Best value: DeVonta Smith', 'Pivot if RB run continues'],
        },
        {
          icon: '🔬',
          title: 'Player Comparison Lab',
          body: 'Compare players with projections, injury context, and usage trends in one view.',
          previewTitle: 'Comparison snapshot',
          previewLines: ['Projection: 18.4 vs 15.9', 'Target share edge: +6.2%', 'Injury risk: low vs medium'],
        },
        {
          icon: '🎮',
          title: 'Matchup Simulator',
          body: 'Simulate weekly matchups and playoff scenarios with lineup optimization built in.',
          previewTitle: 'Simulation snapshot',
          previewLines: ['Win odds: 63%', 'Median score: 128.4', 'Best flex swap adds 4.7 pts'],
        },
        {
          icon: '🧠',
          title: 'Chimmy AI Coach',
          body: 'Ask anything. Chimmy knows your roster, your opponents, and the scoring context that matters.',
          previewTitle: 'Example response',
          previewLines: ['Start Nico Collins over Pittman.', 'You need ceiling this week.', 'Opponent is weak against outside WRs.'],
        },
      ],
      previewLabel: 'See how it works',
    },
    stats: [
      { value: '13+', label: 'League formats supported' },
      { value: '7', label: 'Sports covered' },
      { value: '1M+', label: 'AI analyses run' },
    ],
    geoRestrictions: {
      eyebrow: 'Availability',
      title: 'State Availability',
      subtitle: 'AllFantasy.ai complies with all applicable U.S. state laws regarding fantasy sports.',
      fullBlockTitle: 'Not Available',
      fullBlockDesc: 'Due to state law, AllFantasy.ai cannot be accessed from these states:',
      fullBlockStates: [
        {
          code: 'WA',
          name: 'Washington',
          reason:
            'All fantasy sports are classified as illegal sports wagering under state law (RCW 9.46.240), including free contests.',
          badge: 'No Access',
          badgeColor: 'red',
        },
      ],
      paidBlockTitle: 'Free Access Only',
      paidBlockDesc:
        'Residents of these states may create free accounts and participate in free leagues, but cannot join paid leagues or purchase subscriptions:',
      paidBlockStates: [
        { code: 'HI', name: 'Hawaii', reason: 'Paid fantasy sports classified as illegal gambling (AG Opinion 16-1, 2016).' },
        { code: 'ID', name: 'Idaho', reason: 'Paid fantasy sports constitute illegal gambling under Idaho Code §18-3802.' },
        { code: 'MT', name: 'Montana', reason: 'Paid DFS contests classified as illegal under Montana Code §23-5-802.' },
        { code: 'NV', name: 'Nevada', reason: 'Paid DFS requires a sports betting license under Nevada Gaming Control Board rules.' },
      ],
      disclaimer:
        'State laws regarding fantasy sports are subject to change. This information reflects our legal review as of 2025. We are not providing legal advice. Contact support@allfantasy.ai with questions.',
    },
    cta: {
      title: 'Your League. Your Rules. Your AI.',
      body:
        'Commissioners get a dedicated control panel. Players get AI that knows their roster. Everyone wins.',
      primary: 'Create Free Account',
      commissionerPrimary: 'Start a League',
      secondary: 'Sign In',
      primaryAuthed: 'Open App',
      secondaryAuthed: 'Dashboard',
      commissionerNote: 'Commissioners run up to unlimited leagues under one subscription.',
    },
    footer: {
      privacy: 'Privacy',
      terms: 'Terms',
      dataDeletion: 'Data Deletion',
      openApp: 'Open App',
      signIn: 'Sign In',
      admin: 'Admin',
    },
  },
  es: {
    nav: {
      brand: 'AllFantasy',
      signIn: 'Iniciar sesión',
      signUp: 'Comenzar →',
      dashboard: 'Panel',
      admin: 'Admin',
      forCommissioners: '★ Para comisionados',
    },
    badge: '✦ Ya disponible — Acceso anticipado para Comisionados',
    hero: {
      titleTop: 'Dirige tu liga.',
      titleBottom: 'Gana tu liga.',
      subtitle:
        'La única plataforma construida tanto para el comisionado como para el competidor. Gestiona cualquier formato, equipa a cada manager con IA y mantén cada temporada en piloto automático.',
      primary: 'Empezar gratis →',
      commissionerPrimary: 'Crear una liga',
      secondary: 'Iniciar sesión',
      alreadyHaveAccount: '¿Ya tienes cuenta? Inicia sesión',
      primaryAuthed: 'Ir al panel →',
      reassurance: 'Gratis para jugadores · Comisionados desde $4.99/mes',
    },
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'Fútbol NCAA', 'Baloncesto NCAA', 'Soccer'],
    whatIs: {
      eyebrow: '¿Qué es AllFantasy.ai?',
      titleTop: 'Una plataforma.',
      titleBottom: 'Para comisionados y competidores por igual.',
      subtitle:
        'AllFantasy.ai da a los comisionados las herramientas para gestionar su liga y a cada manager una ventaja de IA. Importa desde Sleeper, Yahoo o ESPN — tu liga completa migra en minutos.',
      pillars: [
        {
          icon: '🏆',
          title: 'Todo formato de liga',
          body: 'Dynasty, Devy, C2C, tope salarial, Guillotine, Big Brother, Best Ball y más.',
        },
        {
          icon: '⚡',
          title: 'Control del comisionado',
          body: 'Dispersal drafts, monitoreo de integridad, lotería ponderada y herramientas de broadcast.',
        },
        {
          icon: '🤖',
          title: 'IA para cada manager',
          body: 'Chimmy da a cada jugador de tu liga grades de trades, waivers y ayuda start/sit.',
        },
        {
          icon: '📡',
          title: 'Sincroniza cualquier plataforma',
          body: 'Importa tus ligas de Sleeper, Yahoo o ESPN. Sin configuración manual.',
        },
      ],
    },
    commissioner: {
      eyebrow: 'Para comisionados',
      title: 'La sala de control\nque tu liga merece.',
      subtitle:
        'Controla cada rincón de tu liga — desde dispersal drafts hasta monitoreo de integridad — casi sin esfuerzo.',
      badge: 'AF Commissioner',
      badgeBody: 'Una suscripción cubre todas las ligas que diriges. Cancela cuando quieras.',
      features: [
        {
          icon: '🏈',
          title: 'Dispersal draft',
          body: '¿Se van managers? Reúne sus activos y corre un draft en vivo — automático.',
        },
        {
          icon: '🔍',
          title: 'Monitoreo de integridad',
          body: 'La IA revisa cada trade en busca de colusión. Anti-tanking opcional mantiene la competencia real.',
        },
        {
          icon: '🎱',
          title: 'Lotería ponderada',
          body: 'Orden de draft estilo NBA para dynasty año 2+. Acaba con el tank sin matar la emoción.',
        },
        {
          icon: '📡',
          title: 'Broadcast global',
          body: 'Anuncios, encuestas y eventos a todas tus ligas a la vez.',
        },
        {
          icon: '🤖',
          title: 'Manager IA',
          body: '¿Equipo huérfano? La IA lo gestiona hasta que llegue un humano.',
        },
        {
          icon: '🛡️',
          title: 'Anuncio de ligas',
          body: '¿Plazas vacías? Publica en Find-a-League y llega a managers que buscan liga.',
        },
      ],
      cta: 'Empezar como comisionado',
      ctaHref: '/signup?role=commissioner',
      secondaryCta: 'Ver planes Commissioner',
      secondaryCtaHref: '/commissioner-upgrade?highlight=dispersal_draft',
    },
    tools: {
      eyebrow: 'Herramientas IA — Para cada manager',
      titleTop: 'Cada jugador obtiene',
      titleBottom: 'Una ventaja injusta.',
      subtitle:
        'Seis herramientas de IA que trabajan con la puntuación, roster y contexto de tu liga — no consejos genéricos.',
      cards: [
        {
          icon: '⚖️',
          title: 'Trade Analyzer',
          body: 'Puntajes de equidad, valor y efecto en tu lineup antes de aceptar o rechazar un trade.',
          previewTitle: 'Ejemplo',
          previewLines: ['Puntaje de equidad: 92/100', 'Impacto en lineup: +11.8 pts', 'Veredicto: aceptar si necesitas profundidad WR'],
        },
        {
          icon: '📋',
          title: 'Waiver Wire AI',
          body: 'Prioridades de pickups con ajuste a tu roster, sugerencia FAAB y opciones de streaming.',
          previewTitle: 'Ejemplo',
          previewLines: ['Mejor claim: Jaxon Smith-Njigba', 'FAAB sugerido: 12-15%', 'Plan B: stream Chargers D/ST'],
        },
        {
          icon: '🎯',
          title: 'Draft Assistant',
          body: 'Ayuda en vivo para el draft con tiers, ADP y pivotes según necesidad.',
          previewTitle: 'Señal en draft',
          previewLines: ['Quedan 2 picks antes del tier break', 'Mejor valor: DeVonta Smith', 'Pivota si sigue la corrida de RB'],
        },
        {
          icon: '🔬',
          title: 'Player Comparison Lab',
          body: 'Compara jugadores con proyecciones, contexto de lesiones y tendencias de uso.',
          previewTitle: 'Comparativa',
          previewLines: ['Proyección: 18.4 vs 15.9', 'Ventaja target share: +6.2%', 'Riesgo de lesión: bajo vs medio'],
        },
        {
          icon: '🎮',
          title: 'Matchup Simulator',
          body: 'Simula enfrentamientos semanales y escenarios de playoffs con optimización de lineup.',
          previewTitle: 'Simulación',
          previewLines: ['Probabilidad de ganar: 63%', 'Puntaje medio: 128.4', 'Mejor cambio en flex suma 4.7 pts'],
        },
        {
          icon: '🧠',
          title: 'Chimmy AI Coach',
          body: 'Pregunta lo que quieras. Chimmy conoce tu roster, tus rivales y tu sistema de puntuación.',
          previewTitle: 'Respuesta ejemplo',
          previewLines: ['Inicia a Nico Collins sobre Pittman.', 'Esta semana necesitas techo.', 'Tu rival sufre contra WR abiertos.'],
        },
      ],
      previewLabel: 'Mira como funciona',
    },
    stats: [
      { value: '13+', label: 'Formatos de liga' },
      { value: '7', label: 'Deportes cubiertos' },
      { value: '1M+', label: 'Análisis IA ejecutados' },
    ],
    geoRestrictions: {
      eyebrow: 'Disponibilidad',
      title: 'Disponibilidad por estado',
      subtitle: 'AllFantasy.ai cumple las leyes estatales de EE. UU. aplicables al fantasy deportivo.',
      fullBlockTitle: 'No disponible',
      fullBlockDesc: 'Por ley estatal, AllFantasy.ai no puede ofrecerse desde estos estados:',
      fullBlockStates: [
        {
          code: 'WA',
          name: 'Washington',
          reason:
            'Todas las ligas fantasy se consideran apuestas deportivas ilegales según la ley estatal (RCW 9.46.240), incluidos torneos gratuitos.',
          badge: 'Sin acceso',
          badgeColor: 'red',
        },
      ],
      paidBlockTitle: 'Solo acceso gratuito',
      paidBlockDesc:
        'Los residentes de estos estados pueden crear cuentas gratuitas y ligas gratuitas, pero no ligas de pago ni suscripciones:',
      paidBlockStates: [
        { code: 'HI', name: 'Hawaii', reason: 'Fantasy de pago ilegal según opinión del fiscal general (2016).' },
        { code: 'ID', name: 'Idaho', reason: 'Fantasy de pago constituye juego ilegal según Idaho Code §18-3802.' },
        { code: 'MT', name: 'Montana', reason: 'DFS de pago ilegal según Montana Code §23-5-802.' },
        { code: 'NV', name: 'Nevada', reason: 'DFS de pago requiere licencia de apuestas según la junta de Nevada.' },
      ],
      disclaimer:
        'Las leyes pueden cambiar. Esta información refleja nuestra revisión legal de 2025 y no es asesoría legal. Consultas: support@allfantasy.ai.',
    },
    cta: {
      title: 'Tu liga. Tus reglas. Tu IA.',
      body:
        'Los comisionados obtienen un panel de control. Los jugadores obtienen IA que conoce su roster. Todos ganan.',
      primary: 'Crear cuenta gratis',
      commissionerPrimary: 'Crear una liga',
      secondary: 'Iniciar sesión',
      primaryAuthed: 'Abrir app',
      secondaryAuthed: 'Panel',
      commissionerNote:
        'Los comisionados pueden dirigir ligas ilimitadas bajo una sola suscripción.',
    },
    footer: {
      privacy: 'Privacidad',
      terms: 'Términos',
      dataDeletion: 'Eliminar datos',
      openApp: 'Abrir app',
      signIn: 'Iniciar sesión',
      admin: 'Admin',
    },
  },
} as const

function GradientWord({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
    >
      {children}
    </span>
  )
}

type LandingPageClientProps = {
  /** From getServerSession() so nav/hero match auth before client session hydrates */
  initialSession?: Session | null
}

export default function LandingPageClient({
  initialSession = null,
}: LandingPageClientProps) {
  const { language } = useLanguage()
  const { status } = useSession()
  const copy = LANDING_COPY[language === 'es' ? 'es' : 'en']
  /** Unauth nav + hero only when definitely not signed in; use server session while client status is loading. */
  const isAuthenticated =
    status === 'unauthenticated'
      ? false
      : status === 'authenticated'
        ? true
        : Boolean(initialSession?.user)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    fetch('/api/user/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.isAdmin) setIsAdmin(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const signupHref = signupUrlWithIntent('/dashboard')
  const loginHref = loginUrlWithIntent('/dashboard')
  const dashboardHref = '/dashboard'
  const commissionerSignupHref = `/signup?role=commissioner&next=${encodeURIComponent('/dashboard')}`

  return (
    <main className="mode-readable min-h-screen overflow-x-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header
        className="fixed inset-x-0 top-0 z-50 border-b"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 86%, transparent)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 px-2 py-1.5 transition-opacity hover:opacity-80"
            aria-label="AllFantasy home"
          >
            <Image
              src="/af-logo-text.png"
              alt="AllFantasy - AI-powered fantasy sports"
              width={1024}
              height={512}
              priority
              className="nav-logo-img h-[36px] w-auto object-contain sm:h-[44px]"
            />
          </Link>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex">
              <LanguageToggle />
            </div>
            <Link
              href="#landing-commissioner"
              className="hidden text-sm font-medium transition hover:opacity-100 sm:inline-flex"
              style={{ color: '#f59e0b', opacity: 0.85 }}
            >
              {copy.nav.forCommissioners}
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="hidden rounded-lg border px-3 py-1.5 text-xs font-medium transition sm:inline-flex"
                style={{
                  borderColor: 'color-mix(in srgb, var(--border) 75%, transparent)',
                  color: 'var(--muted)',
                  background: 'transparent',
                }}
              >
                <Shield className="mr-1 h-3.5 w-3.5" />
                {copy.nav.admin}
              </Link>
            )}
            <div className="flex items-center gap-2 sm:gap-3">
              {!isAuthenticated ? (
                <>
                  <Link
                    href={loginHref}
                    className="inline-flex rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
                      color: 'var(--muted)',
                      background: 'color-mix(in srgb, var(--panel2) 40%, transparent)',
                    }}
                    data-testid="landing-nav-sign-in"
                    onClick={() =>
                      trackLandingCtaClick({
                        cta_label: copy.nav.signIn,
                        cta_destination: loginHref,
                        cta_type: 'secondary',
                        source: 'nav',
                      })
                    }
                  >
                    {copy.nav.signIn}
                  </Link>
                  <Link
                    href={signupHref}
                    className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90"
                    style={{
                      backgroundImage:
                        'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
                      color: 'var(--on-accent-bg)',
                    }}
                    data-testid="landing-nav-sign-up"
                    onClick={() =>
                      trackLandingCtaClick({
                        cta_label: copy.nav.signUp,
                        cta_destination: signupHref,
                        cta_type: 'primary',
                        source: 'nav',
                      })
                    }
                  >
                    {copy.nav.signUp}
                  </Link>
                </>
              ) : (
                <Link
                  href={dashboardHref}
                  className="inline-flex rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
                    color: 'var(--muted)',
                    background: 'transparent',
                  }}
                  data-testid="landing-nav-dashboard"
                  onClick={() =>
                    trackLandingCtaClick({
                      cta_label: copy.nav.dashboard,
                      cta_destination: dashboardHref,
                      cta_type: 'secondary',
                      source: 'nav',
                    })
                  }
                >
                  {copy.nav.dashboard}
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-20 pt-28 text-center sm:px-8 md:pb-24">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 55% 50% at 50% 38%, color-mix(in srgb, var(--accent-cyan) 18%, transparent) 0%, transparent 65%),
              radial-gradient(ellipse 40% 35% at 60% 30%, rgba(59,130,246,0.08) 0%, transparent 65%),
              radial-gradient(ellipse 65% 55% at 50% 48%, color-mix(in srgb, var(--accent-purple) 10%, transparent) 0%, transparent 70%)
            `,
          }}
          aria-hidden="true"
        />
        <div className="landing-grid pointer-events-none absolute inset-0" aria-hidden="true" />

        <div className="relative z-10 mb-8">
          <div className="landing-crest-glow absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-[520px] sm:w-[520px]" aria-hidden="true" />
          <div
            className="landing-float hero-logo-wrap relative flex flex-col items-center justify-center gap-4 px-4 py-2 sm:gap-5 sm:px-6 sm:py-4"
            style={{
              filter: 'drop-shadow(0 28px 90px rgba(4,9,21,0.42))',
            }}
          >
            <div
              className="pointer-events-none absolute left-1/2 top-[42%] h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-[340px] sm:w-[340px]"
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent-cyan) 22%, transparent) 0%, transparent 62%), radial-gradient(circle at 50% 68%, color-mix(in srgb, var(--accent-purple) 12%, transparent) 0%, transparent 74%)',
              }}
            />
            <Image
              src="/branding/allfantasy-crest-chatgpt.png"
              alt="AllFantasy crest"
              className="mode-logo-safe relative h-[120px] w-auto object-contain drop-shadow-lg sm:h-[160px] lg:h-[200px]"
              priority
              width={400}
              height={400}
            />
          </div>
        </div>

        <div
          className="relative z-10 mb-6 inline-flex max-w-[min(92vw,34rem)] items-center justify-center gap-2 rounded-2xl border px-4 py-2 text-center text-[11px] font-semibold tracking-[0.06em] sm:text-xs"
          style={{
            background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--accent-amber) 28%, transparent)',
            color: 'var(--accent-amber-strong)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--accent-amber-strong)', animation: 'landingPulse 2s ease-in-out infinite' }}
          />
          {copy.badge}
        </div>

        <h1
          className="relative z-10 mb-5 max-w-5xl text-[58px] font-black leading-[0.93] tracking-[0.025em] sm:text-[74px] md:text-[92px]"
          style={{ color: 'var(--text)' }}
        >
          <span className="block">{copy.hero.titleTop}</span>
          <span className="block">
            <GradientWord>{copy.hero.titleBottom}</GradientWord>
          </span>
        </h1>

        <p className="relative z-10 mb-10 max-w-2xl text-base leading-7 sm:text-lg" style={{ color: 'var(--muted)' }}>
          {copy.hero.subtitle}
        </p>

        <div className="relative z-10 mb-10">
          {isAuthenticated ? (
            <div className="flex w-full flex-col items-center gap-3 px-6 sm:w-auto sm:flex-row sm:px-0">
              <Link
                href={dashboardHref}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90 sm:w-auto"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
                  color: 'var(--on-accent-bg)',
                }}
                data-testid="landing-hero-dashboard"
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: copy.hero.primaryAuthed,
                    cta_destination: dashboardHref,
                    cta_type: 'primary',
                    source: 'hero',
                  })
                }
              >
                {copy.hero.primaryAuthed}
              </Link>
            </div>
          ) : (
            <div className="flex w-full flex-col items-center px-6 sm:w-auto sm:px-0">
              <Link
                href={signupHref}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90 sm:w-auto"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
                  color: 'var(--on-accent-bg)',
                }}
                data-testid="landing-hero-sign-up"
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: copy.hero.primary,
                    cta_destination: signupHref,
                    cta_type: 'primary',
                    source: 'hero',
                  })
                }
              >
                {copy.hero.primary}
              </Link>
              <Link
                href={loginHref}
                className="mt-4 text-center text-sm font-medium underline underline-offset-4 transition hover:opacity-90"
                style={{ color: 'var(--accent-cyan)' }}
                data-testid="landing-hero-sign-in"
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: copy.hero.alreadyHaveAccount,
                    cta_destination: loginHref,
                    cta_type: 'secondary',
                    source: 'hero',
                  })
                }
              >
                {copy.hero.alreadyHaveAccount}
              </Link>
              <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--muted)' }}>
                {copy.hero.reassurance}
              </p>
            </div>
          )}
        </div>

        <div className="relative z-10 mx-auto flex max-w-sm flex-wrap items-center justify-center gap-2 px-4 sm:max-w-none" aria-label="Supported sports">
          {copy.sports.map((sport) => (
            <span
              key={sport}
              className="rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{
                background: 'color-mix(in srgb, var(--panel2) 78%, transparent)',
                borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
                color: 'var(--muted)',
              }}
            >
              {sport}
            </span>
          ))}
        </div>
      </section>

      <div className="mx-6 border-t" style={{ borderColor: 'var(--border)' }} />

      <section className="mx-auto max-w-6xl px-6 py-20 text-center sm:px-8" aria-labelledby="landing-what-is">
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent-emerald-strong)' }}>
          {copy.whatIs.eyebrow}
        </p>
        <h2
          id="landing-what-is"
          className="mb-4 text-[40px] font-black leading-[0.98] tracking-[0.025em] sm:text-[52px] md:text-[62px]"
          style={{ color: 'var(--text)' }}
        >
          <span className="block">{copy.whatIs.titleTop}</span>
          <span className="block">{copy.whatIs.titleBottom}</span>
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-[17px] leading-8" style={{ color: 'var(--muted)' }}>
          {copy.whatIs.subtitle}
        </p>

        <div className="grid overflow-hidden rounded-2xl border sm:grid-cols-2 xl:grid-cols-4" style={{ borderColor: 'var(--border)', gap: 1, background: 'var(--border)' }}>
          {copy.whatIs.pillars.map((pillar) => (
            <div key={pillar.title} className="px-6 py-8 transition-opacity hover:opacity-95" style={{ background: 'var(--panel)' }}>
              <div className="mb-3 text-[28px]">{pillar.icon}</div>
              <h3 className="mb-2 text-[15px] font-semibold">{pillar.title}</h3>
              <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>
                {pillar.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        className="relative mx-auto max-w-6xl px-6 py-20 sm:px-8"
        aria-labelledby="landing-commissioner"
        style={{
          background: 'var(--panel)',
          borderRadius: '1.5rem',
          margin: '0 1.5rem 4px',
          border: '1px solid color-mix(in srgb, #f59e0b 20%, var(--border))',
          borderLeft: '3px solid #f59e0b',
        }}
      >
        <div className="mb-12 text-center">
          <span
            className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em]"
            style={{
              background: 'color-mix(in srgb, #f59e0b 12%, transparent)',
              borderColor: 'color-mix(in srgb, #f59e0b 30%, transparent)',
              color: '#f59e0b',
            }}
          >
            <span>★</span> {copy.commissioner.eyebrow}
          </span>
          <h2
            id="landing-commissioner"
            className="mb-4 whitespace-pre-line text-[40px] font-black leading-[1.0] tracking-[0.02em] sm:text-[52px] md:text-[62px]"
            style={{ color: 'var(--text)' }}
          >
            {copy.commissioner.title}
          </h2>
          <p className="mx-auto max-w-2xl text-[17px] leading-8" style={{ color: 'var(--muted)' }}>
            {copy.commissioner.subtitle}
          </p>
        </div>

        <div
          className="grid overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-3"
          style={{ borderColor: 'var(--border)', gap: 1, background: 'var(--border)' }}
        >
          {copy.commissioner.features.map((feat) => (
            <div key={feat.title} className="group px-6 py-7" style={{ background: 'var(--bg)' }}>
              <div
                className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border text-xl"
                style={{
                  background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
                  borderColor: 'color-mix(in srgb, #f59e0b 20%, transparent)',
                }}
              >
                {feat.icon}
              </div>
              <h3 className="mb-2 text-[15px] font-semibold">{feat.title}</h3>
              <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>
                {feat.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
            <Link
              href={commissionerSignupHref}
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:opacity-90"
              style={{ backgroundImage: 'linear-gradient(90deg, #f59e0b, #d97706)' }}
              onClick={() =>
                trackLandingCtaClick({
                  cta_label: copy.commissioner.cta,
                  cta_destination: commissionerSignupHref,
                  cta_type: 'primary',
                  source: 'commissioner-section',
                })
              }
            >
              {copy.commissioner.cta}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <span
              className="rounded-xl border px-4 py-2.5 text-xs font-medium"
              style={{
                borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
                color: 'var(--muted)',
                background: 'transparent',
              }}
            >
              {copy.commissioner.badgeBody}
            </span>
          </div>
          <Link
            href={copy.commissioner.secondaryCtaHref}
            className="text-sm font-semibold transition hover:opacity-90"
            style={{ color: '#f59e0b' }}
            onClick={() =>
              trackLandingCtaClick({
                cta_label: copy.commissioner.secondaryCta,
                cta_destination: copy.commissioner.secondaryCtaHref,
                cta_type: 'secondary',
                source: 'commissioner-section',
              })
            }
          >
            {copy.commissioner.secondaryCta}
          </Link>
        </div>
      </section>

      <div className="mx-6 h-px" style={{ background: 'var(--border)' }} />

      <section className="mx-auto max-w-6xl px-6 py-16 sm:px-8" aria-labelledby="landing-tools">
        <div className="mb-12 text-center">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--accent-emerald-strong)' }}>
            {copy.tools.eyebrow}
          </p>
          <h2
            id="landing-tools"
            className="mb-4 text-[40px] font-black leading-[0.98] tracking-[0.025em] sm:text-[52px] md:text-[62px]"
            style={{ color: 'var(--text)' }}
          >
            <span className="block">{copy.tools.titleTop}</span>
            <span className="block">
              <GradientWord>{copy.tools.titleBottom}</GradientWord>
            </span>
          </h2>
          <p className="mx-auto max-w-2xl text-[17px] leading-8" style={{ color: 'var(--muted)' }}>
            {copy.tools.subtitle}
          </p>
        </div>

        <div className="grid overflow-hidden rounded-2xl border md:grid-cols-2 xl:grid-cols-3" style={{ borderColor: 'var(--border)', gap: 1, background: 'var(--border)' }}>
          {copy.tools.cards.map((card) => (
            <article key={card.title} className="group relative px-8 py-8 transition-opacity hover:opacity-95" style={{ background: 'var(--panel)' }}>
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border text-xl" style={{ background: 'color-mix(in srgb, var(--accent-cyan) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-cyan) 18%, transparent)' }}>
                {card.icon}
              </div>
              <h3 className="mb-3 text-base font-semibold">{card.title}</h3>
              <p className="mb-5 text-sm leading-6" style={{ color: 'var(--muted)' }}>
                {card.body}
              </p>
              <div
                className="rounded-2xl border p-4 text-left"
                style={{
                  background: 'color-mix(in srgb, var(--panel2) 86%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--accent-cyan) 16%, var(--border))',
                }}
              >
                <div
                  className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: 'var(--accent-emerald-strong)' }}
                >
                  {card.previewTitle ?? copy.tools.previewLabel}
                </div>
                <div className="space-y-2">
                  {card.previewLines.map((line) => (
                    <div
                      key={line}
                      className="rounded-xl border px-3 py-2 text-xs font-medium sm:text-[13px]"
                      style={{
                        borderColor: 'color-mix(in srgb, var(--border) 92%, transparent)',
                        background: 'color-mix(in srgb, white 3%, transparent)',
                        color: 'var(--text)',
                      }}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-8">
        <div className="grid overflow-hidden rounded-2xl border md:grid-cols-3" style={{ borderColor: 'var(--border)', gap: 1, background: 'var(--border)' }}>
          {copy.stats.map((stat) => (
            <div key={stat.label} className="px-6 py-10 text-center" style={{ background: 'var(--panel)' }}>
              <div className="mb-2 text-5xl font-black leading-none">
                <GradientWord>{stat.value}</GradientWord>
              </div>
              <div className="text-sm font-medium tracking-[0.03em]" style={{ color: 'var(--muted)' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 sm:px-8">
        <div className="mb-8 text-center">
          <p
            className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--muted)" }}
          >
            {copy.geoRestrictions.eyebrow}
          </p>
          <h2 className="mb-2 text-[28px] font-black sm:text-[36px]" style={{ color: 'var(--text)' }}>
            {copy.geoRestrictions.title}
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-6" style={{ color: "var(--muted)" }}>
            {copy.geoRestrictions.subtitle}
          </p>
        </div>

        <div
              className="mb-6 rounded-2xl border p-6"
              style={{
                borderColor: "color-mix(in srgb, #ef4444 25%, var(--border))",
                background: "color-mix(in srgb, #ef4444 5%, var(--panel))",
              }}
            >
              <h3 className="mb-2 text-sm font-bold text-red-400">🔴 {copy.geoRestrictions.fullBlockTitle}</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--muted)" }}>
                {copy.geoRestrictions.fullBlockDesc}
              </p>
              {copy.geoRestrictions.fullBlockStates.map((s) => (
                <div key={s.code} className="mb-3 flex items-start gap-3 last:mb-0">
                  <span className="mt-0.5 rounded border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
                    {s.code} · {s.name}
                  </span>
                  <p className="text-xs leading-5" style={{ color: "var(--muted)" }}>
                    {s.reason}
                  </p>
                </div>
              ))}
            </div>

            <div
              className="rounded-2xl border p-6"
              style={{
                borderColor: "color-mix(in srgb, #f59e0b 25%, var(--border))",
                background: "color-mix(in srgb, #f59e0b 5%, var(--panel))",
              }}
            >
              <h3 className="mb-2 text-sm font-bold text-amber-400">🟡 {copy.geoRestrictions.paidBlockTitle}</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--muted)" }}>
                {copy.geoRestrictions.paidBlockDesc}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {copy.geoRestrictions.paidBlockStates.map((s) => (
                  <div key={s.code} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                      {s.code} · {s.name}
                    </span>
                    <p className="text-xs leading-5" style={{ color: "var(--muted)" }}>
                      {s.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-4 text-center text-[11px]" style={{ color: "var(--muted2)" }}>
              {copy.geoRestrictions.disclaimer}
            </p>
      </section>

      <section className="relative overflow-hidden px-6 pb-24 pt-4 text-center sm:px-8" aria-labelledby="landing-cta">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 65% 80% at 50% 50%, color-mix(in srgb, var(--accent-cyan) 12%, transparent) 0%, transparent 70%)',
          }}
          aria-hidden="true"
        />
        <Image
          src="/af-crest.png"
          alt=""
          width={280}
          height={280}
          className="pointer-events-none absolute left-1/2 top-1/2 h-[240px] w-[240px] -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.05] sm:h-[280px] sm:w-[280px]"
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto max-w-3xl">
          <h2
            id="landing-cta"
            className="mb-4 text-[42px] font-black leading-[1] tracking-[0.025em] sm:text-[56px] md:text-[68px]"
            style={{ color: 'var(--text)' }}
          >
            {copy.cta.title}
          </h2>
          <p className="mx-auto mb-10 max-w-2xl text-[17px] leading-8" style={{ color: 'var(--muted)' }}>
            {copy.cta.body}
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href={isAuthenticated ? dashboardHref : signupHref}
                className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:opacity-90"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
                  color: 'var(--on-accent-bg)',
                }}
                data-testid="landing-cta-primary"
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: isAuthenticated ? copy.cta.primaryAuthed : copy.cta.primary,
                    cta_destination: isAuthenticated ? dashboardHref : signupHref,
                    cta_type: 'primary',
                    source: 'cta-band',
                  })
                }
              >
                {isAuthenticated ? copy.cta.primaryAuthed : copy.cta.primary}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {!isAuthenticated ? (
                <Link
                  href={commissionerSignupHref}
                  className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:opacity-90"
                  style={{ backgroundImage: 'linear-gradient(90deg, #f59e0b, #d97706)' }}
                  data-testid="landing-cta-commissioner"
                  onClick={() =>
                    trackLandingCtaClick({
                      cta_label: copy.cta.commissionerPrimary,
                      cta_destination: commissionerSignupHref,
                      cta_type: 'primary',
                      source: 'cta-band-commissioner',
                    })
                  }
                >
                  {copy.cta.commissionerPrimary}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
              <Link
                href={isAuthenticated ? dashboardHref : loginHref}
                className="inline-flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-medium transition hover:-translate-y-0.5"
                style={{
                  background: 'color-mix(in srgb, var(--panel) 88%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
                  color: 'var(--text)',
                }}
                data-testid="landing-cta-secondary"
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: isAuthenticated ? copy.cta.secondaryAuthed : copy.cta.secondary,
                    cta_destination: isAuthenticated ? dashboardHref : loginHref,
                    cta_type: 'secondary',
                    source: 'cta-band',
                  })
                }
              >
                {isAuthenticated ? copy.cta.secondaryAuthed : copy.cta.secondary}
              </Link>
            </div>
            {!isAuthenticated ? (
              <p style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px', textAlign: 'center' }}>
                {copy.cta.commissionerNote}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="border-t px-6 py-7 sm:px-8" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <Link
            href="/"
            className="flex items-center gap-3 opacity-80 transition-opacity hover:opacity-100"
            aria-label="AllFantasy home"
          >
            <Image
              src="/af-logo-text.png"
              alt="AllFantasy"
              width={1024}
              height={512}
              className="nav-wordmark footer-logo h-[28px] w-auto object-contain"
            />
            <span className="text-sm" style={{ color: 'var(--muted2)' }}>
              © {new Date().getFullYear()} AllFantasy.ai. All rights reserved.
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer navigation">
            <Link
              href="/privacy"
              className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
            >
              {copy.footer.privacy}
            </Link>
            <Link
              href="/terms"
              className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
            >
              {copy.footer.terms}
            </Link>
            <Link
              href="/data-deletion"
              className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
            >
              {copy.footer.dataDeletion}
            </Link>
            <Link
              href={loginUrlWithIntent('/dashboard')}
              className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
            >
              {copy.footer.signIn}
            </Link>
            <Link
              href="/admin"
              className="text-sm transition-colors [color:var(--muted)] hover:[color:var(--text)]"
            >
              {copy.footer.admin}
            </Link>
          </nav>
        </div>
      </footer>

      <style jsx>{`
        .landing-grid {
          background-image:
            linear-gradient(color-mix(in srgb, var(--border) 40%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--border) 40%, transparent) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 78%);
          -webkit-mask-image: radial-gradient(ellipse 75% 75% at 50% 50%, black 20%, transparent 78%);
        }

        .landing-crest-glow {
          background: radial-gradient(
            circle,
            color-mix(in srgb, var(--accent-cyan) 28%, transparent) 0%,
            rgba(59, 130, 246, 0.16) 35%,
            color-mix(in srgb, var(--accent-purple) 12%, transparent) 58%,
            transparent 74%
          );
          filter: blur(6px);
        }

        .landing-float {
          animation: landingFloat 5s ease-in-out infinite;
        }

        .hero-crest {
          mix-blend-mode: screen;
          filter:
            drop-shadow(0 0 32px rgba(6, 182, 212, 0.45))
            drop-shadow(0 0 80px rgba(59, 130, 246, 0.2))
            brightness(1.05);
          isolation: isolate;
        }

        .hero-wordmark {
          mix-blend-mode: screen;
          filter: brightness(1.2) contrast(1.05);
          isolation: isolate;
        }

        .hero-logo-wrap {
          background: transparent !important;
          isolation: auto;
        }

        @keyframes landingFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }

        @keyframes landingPulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.25;
          }
        }
      `}</style>
    </main>
  )
}
