'use client'

import type { Session } from 'next-auth'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  ClipboardList,
  Users,
  ArrowLeftRight,
  UserPlus,
  Trophy,
  LineChart,
  MessageCircle,
  Menu,
  X,
} from 'lucide-react'
import { useOptionalSession } from '@/components/auth/useOptionalSession'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { loginUrlWithIntent, signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import SeoLandingFooter from '@/components/landing/SeoLandingFooter'

const LANDING_COPY = {
  en: {
    nav: {
      ariaHome: 'AllFantasy home',
      features: 'Features',
      sports: 'Sports',
      forCommissioners: 'For Commissioners',
      pricing: 'Pricing',
      resources: 'Resources',
      signIn: 'Sign In',
      signUp: 'Create Your League',
      dashboard: 'Dashboard',
      ariaOpenMenu: 'Open menu',
      ariaCloseMenu: 'Close menu',
    },
    hero: {
      seasonal: 'Football season is coming.',
      titleTop: 'Fantasy starts here.',
      titleBottom: 'Win all season.',
      subtitle:
        'AllFantasy gives commissioners, managers, and players the tools to create leagues, draft, trade, manage waivers, score matchups, chat, and enjoy fantasy sports all season long.',
      primary: 'Create Your League',
      secondary: 'See How It Works',
      primaryAuthed: 'Go to Dashboard',
    },
    sportsStrip: { eyebrow: 'Built for every fantasy sport', soccer: 'Soccer' },
    tools: {
      eyebrow: 'Everything your league needs',
      draft: 'Draft',
      manage: 'Manage',
      trade: 'Trade',
      waivers: 'Waivers',
      scoring: 'Scoring',
      insights: 'Insights',
      chat: 'Chat',
    },
    finalCta: {
      title: 'Better leagues. More fun. All season long.',
      cta: 'Create Your League',
    },
  },
  es: {
    nav: {
      ariaHome: 'Inicio de AllFantasy',
      features: 'Funciones',
      sports: 'Deportes',
      forCommissioners: 'Para Comisionados',
      pricing: 'Precios',
      resources: 'Recursos',
      signIn: 'Iniciar Sesión',
      signUp: 'Crea Tu Liga',
      dashboard: 'Panel',
      ariaOpenMenu: 'Abrir menú',
      ariaCloseMenu: 'Cerrar menú',
    },
    hero: {
      seasonal: 'La temporada de fútbol americano se acerca.',
      titleTop: 'La fantasía empieza aquí.',
      titleBottom: 'Gana toda la temporada.',
      subtitle:
        'AllFantasy le da a comisionados, mánagers y jugadores las herramientas para crear ligas, hacer drafts, intercambiar jugadores, gestionar waivers, anotar partidos, chatear y disfrutar de los deportes de fantasía toda la temporada.',
      primary: 'Crea Tu Liga',
      secondary: 'Ver Cómo Funciona',
      primaryAuthed: 'Ir al Panel',
    },
    sportsStrip: { eyebrow: 'Hecho para cada deporte de fantasía', soccer: 'Fútbol' },
    tools: {
      eyebrow: 'Todo lo que tu liga necesita',
      draft: 'Draft',
      manage: 'Gestionar',
      trade: 'Intercambios',
      waivers: 'Waivers',
      scoring: 'Puntuación',
      insights: 'Estadísticas',
      chat: 'Chat',
    },
    finalCta: {
      title: 'Mejores ligas. Más diversión. Toda la temporada.',
      cta: 'Crea Tu Liga',
    },
  },
  zh: {
    nav: {
      ariaHome: 'AllFantasy 主页',
      features: '功能',
      sports: '运动项目',
      forCommissioners: '联盟管理员专区',
      pricing: '价格',
      resources: '资源',
      signIn: '登录',
      signUp: '创建你的联盟',
      dashboard: '仪表盘',
      ariaOpenMenu: '打开菜单',
      ariaCloseMenu: '关闭菜单',
    },
    hero: {
      seasonal: '橄榄球赛季即将开始。',
      titleTop: '梦幻体育，从这里开始。',
      titleBottom: '赢得整个赛季。',
      subtitle:
        'AllFantasy 为联盟管理员、经理和玩家提供创建联盟、选秀、交易、管理落选球员、比赛计分、聊天等全套工具，让你整个赛季畅玩梦幻体育。',
      primary: '创建你的联盟',
      secondary: '了解运作方式',
      primaryAuthed: '前往仪表盘',
    },
    sportsStrip: { eyebrow: '覆盖每一项梦幻体育运动', soccer: '足球' },
    tools: {
      eyebrow: '联盟所需的一切',
      draft: '选秀',
      manage: '管理',
      trade: '交易',
      waivers: '落选球员',
      scoring: '计分',
      insights: '数据洞察',
      chat: '聊天',
    },
    finalCta: {
      title: '更好的联盟，更多乐趣，整个赛季。',
      cta: '创建你的联盟',
    },
  },
  fil: {
    nav: {
      ariaHome: 'Home ng AllFantasy',
      features: 'Mga Feature',
      sports: 'Mga Sports',
      forCommissioners: 'Para sa mga Commissioner',
      pricing: 'Presyo',
      resources: 'Mga Resource',
      signIn: 'Mag-sign In',
      signUp: 'Gumawa ng Liga Mo',
      dashboard: 'Dashboard',
      ariaOpenMenu: 'Buksan ang menu',
      ariaCloseMenu: 'Isara ang menu',
    },
    hero: {
      seasonal: 'Malapit na ang football season.',
      titleTop: 'Dito nagsisimula ang fantasy.',
      titleBottom: 'Manalo ng buong season.',
      subtitle:
        'Binibigyan ng AllFantasy ang mga commissioner, manager, at players ng mga tool para gumawa ng liga, mag-draft, mag-trade, mamahala ng waivers, mag-score ng matchups, mag-chat, at mag-enjoy sa fantasy sports buong season.',
      primary: 'Gumawa ng Liga Mo',
      secondary: 'Tingnan Kung Paano Gumagana',
      primaryAuthed: 'Pumunta sa Dashboard',
    },
    sportsStrip: { eyebrow: 'Gawa para sa bawat fantasy sport', soccer: 'Soccer' },
    tools: {
      eyebrow: 'Lahat ng kailangan ng liga mo',
      draft: 'Draft',
      manage: 'Pamahalaan',
      trade: 'Trade',
      waivers: 'Waivers',
      scoring: 'Scoring',
      insights: 'Mga Insight',
      chat: 'Chat',
    },
    finalCta: {
      title: 'Mas magandang liga. Mas masaya. Buong season.',
      cta: 'Gumawa ng Liga Mo',
    },
  },
  vi: {
    nav: {
      ariaHome: 'Trang chủ AllFantasy',
      features: 'Tính năng',
      sports: 'Môn thể thao',
      forCommissioners: 'Dành cho Commissioner',
      pricing: 'Giá',
      resources: 'Tài nguyên',
      signIn: 'Đăng nhập',
      signUp: 'Tạo Giải Đấu Của Bạn',
      dashboard: 'Bảng điều khiển',
      ariaOpenMenu: 'Mở menu',
      ariaCloseMenu: 'Đóng menu',
    },
    hero: {
      seasonal: 'Mùa bóng bầu dục sắp bắt đầu.',
      titleTop: 'Fantasy bắt đầu từ đây.',
      titleBottom: 'Chiến thắng cả mùa giải.',
      subtitle:
        'AllFantasy mang đến cho commissioner, quản lý và người chơi các công cụ để tạo giải đấu, chọn cầu thủ, trao đổi, quản lý waiver, tính điểm trận đấu, trò chuyện và tận hưởng thể thao fantasy suốt mùa giải.',
      primary: 'Tạo Giải Đấu Của Bạn',
      secondary: 'Xem Cách Hoạt Động',
      primaryAuthed: 'Đến Bảng Điều Khiển',
    },
    sportsStrip: { eyebrow: 'Dành cho mọi môn thể thao fantasy', soccer: 'Bóng đá' },
    tools: {
      eyebrow: 'Mọi thứ giải đấu của bạn cần',
      draft: 'Chọn cầu thủ',
      manage: 'Quản lý',
      trade: 'Trao đổi',
      waivers: 'Waiver',
      scoring: 'Tính điểm',
      insights: 'Thông tin',
      chat: 'Trò chuyện',
    },
    finalCta: {
      title: 'Giải đấu tốt hơn. Vui hơn. Suốt cả mùa giải.',
      cta: 'Tạo Giải Đấu Của Bạn',
    },
  },
} as const

const SPORTS = [
  { code: 'NFL', emoji: '🏈', href: '/fantasy-football' },
  { code: 'NCAAF', emoji: '🎓', href: '/fantasy-ncaa' },
  { code: 'NBA', emoji: '🏀', href: '/fantasy-basketball' },
  { code: 'NHL', emoji: '🏒', href: '/fantasy-hockey' },
  { code: 'MLB', emoji: '⚾', href: '/fantasy-baseball' },
  { code: 'SOCCER', emoji: '⚽', href: '/fantasy-soccer' },
] as const

const TOOLS = [
  { key: 'draft', Icon: ClipboardList },
  { key: 'manage', Icon: Users },
  { key: 'trade', Icon: ArrowLeftRight },
  { key: 'waivers', Icon: UserPlus },
  { key: 'scoring', Icon: Trophy },
  { key: 'insights', Icon: LineChart },
  { key: 'chat', Icon: MessageCircle },
] as const

type LandingPageClientProps = {
  initialSession?: Session | null
}

export default function LandingPageClient({ initialSession = null }: LandingPageClientProps) {
  const { language } = useOptionalLanguage()
  const { status } = useOptionalSession()
  const copy = LANDING_COPY[language as keyof typeof LANDING_COPY] ?? LANDING_COPY.en
  const isAuthenticated =
    status === 'unauthenticated' ? false : status === 'authenticated' ? true : Boolean(initialSession?.user)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const loginHref = loginUrlWithIntent('/dashboard')
  const createLeagueHref = signupUrlWithIntent('/create-league')
  const dashboardHref = '/dashboard'

  const navLinks = [
    { label: copy.nav.features, href: '#tools' },
    { label: copy.nav.sports, href: '#sports' },
    { label: copy.nav.forCommissioners, href: '/commissioner-hub' },
    { label: copy.nav.pricing, href: '/pricing' },
    { label: copy.nav.resources, href: '/blog' },
  ]

  return (
    <main className="mode-readable min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* ─── HEADER / NAV ─── */}
      <header
        className="sticky inset-x-0 top-0 z-50 border-b"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={copy.nav.ariaHome}>
            <Image
              src="/af-crest.png"
              alt="AllFantasy logo"
              width={36}
              height={36}
              priority
              className="mode-logo-safe h-9 w-9 rounded-lg object-contain"
            />
            <span className="hidden text-base font-bold tracking-tight sm:inline-block" style={{ color: 'var(--text)' }}>
              AllFantasy
            </span>
          </Link>

          <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium transition hover:opacity-70"
                style={{ color: 'var(--muted)' }}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex">
              <LanguageToggle />
            </div>

            {isAuthenticated ? (
              <Link
                href={dashboardHref}
                className="hidden rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90 sm:inline-flex"
                style={{ borderColor: 'var(--border)', color: 'var(--text)', background: 'var(--panel2)' }}
              >
                {copy.nav.dashboard}
              </Link>
            ) : (
              <>
                <Link
                  href={loginHref}
                  className="hidden rounded-lg border px-3 py-2 text-sm font-medium transition hover:opacity-90 sm:inline-flex"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)', background: 'var(--panel2)' }}
                  data-testid="landing-nav-sign-in"
                  onClick={() =>
                    trackLandingCtaClick({ cta_label: copy.nav.signIn, cta_destination: loginHref, cta_type: 'secondary', source: 'nav' })
                  }
                >
                  {copy.nav.signIn}
                </Link>
                <Link
                  href={createLeagueHref}
                  className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 sm:px-4"
                  style={{ background: 'var(--accent-purple)' }}
                  data-testid="landing-nav-sign-up"
                  onClick={() =>
                    trackLandingCtaClick({ cta_label: copy.nav.signUp, cta_destination: createLeagueHref, cta_type: 'primary', source: 'nav' })
                  }
                >
                  {copy.nav.signUp}
                </Link>
              </>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border lg:hidden"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              aria-label={mobileMenuOpen ? copy.nav.ariaCloseMenu : copy.nav.ariaOpenMenu}
              aria-expanded={mobileMenuOpen}
              data-testid="landing-mobile-menu-toggle"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div
            className="border-t px-4 py-3 lg:hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            data-testid="landing-mobile-menu"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-2 py-2.5 text-sm font-medium"
                  style={{ color: 'var(--text)' }}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <LanguageToggle />
              {!isAuthenticated && (
                <Link
                  href={loginHref}
                  className="text-sm font-medium"
                  style={{ color: 'var(--text)' }}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {copy.nav.signIn}
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in srgb, var(--accent-purple) 8%, transparent) 0%, transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-12">
          <div className="text-center lg:text-left">
            <div
              className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold lg:mx-0"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent-purple) 30%, transparent)',
                background: 'color-mix(in srgb, var(--accent-purple) 8%, transparent)',
                color: 'var(--accent-purple)',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-purple)' }} />
              {copy.hero.seasonal}
            </div>

            <h1
              className="mb-4 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
              style={{ color: 'var(--text)' }}
              data-testid="landing-hero-headline"
            >
              <span className="block">{copy.hero.titleTop}</span>
              <span className="block" style={{ color: 'var(--accent-purple)' }}>
                {copy.hero.titleBottom}
              </span>
            </h1>

            <p
              className="mx-auto mb-8 max-w-xl text-base leading-relaxed sm:text-lg lg:mx-0"
              style={{ color: 'var(--muted)' }}
              data-testid="landing-hero-subheadline"
            >
              {copy.hero.subtitle}
            </p>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link
                href={isAuthenticated ? dashboardHref : createLeagueHref}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white transition hover:opacity-90 sm:w-auto"
                style={{ background: 'var(--accent-purple)' }}
                data-testid="landing-hero-primary-cta"
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: isAuthenticated ? copy.hero.primaryAuthed : copy.hero.primary,
                    cta_destination: isAuthenticated ? dashboardHref : createLeagueHref,
                    cta_type: 'primary',
                    source: 'hero',
                  })
                }
              >
                {isAuthenticated ? copy.hero.primaryAuthed : copy.hero.primary}
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
              <Link
                href="#tools"
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border px-6 py-3 text-base font-semibold transition hover:opacity-80 sm:w-auto"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                data-testid="landing-hero-secondary-cta"
                onClick={() =>
                  trackLandingCtaClick({ cta_label: copy.hero.secondary, cta_destination: '#tools', cta_type: 'secondary', source: 'hero' })
                }
              >
                {copy.hero.secondary}
              </Link>
            </div>
          </div>

          {/* Simple football / college football visual */}
          <div className="relative mx-auto flex h-64 w-64 items-center justify-center sm:h-80 sm:w-80 lg:h-96 lg:w-96">
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-6 rounded-full border-2"
              style={{ borderColor: 'color-mix(in srgb, var(--accent-purple) 22%, transparent)' }}
              aria-hidden="true"
            />
            <span className="text-[100px] sm:text-[130px] lg:text-[160px]" role="img" aria-label="Football">
              🏈
            </span>
            <span
              className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm sm:right-4"
              style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
            >
              🎓 NCAAF
            </span>
          </div>
        </div>
      </section>

      {/* ─── SPORTS STRIP ─── */}
      <section id="sports" className="border-t px-4 py-14 sm:px-6" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-6 text-center text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            {copy.sportsStrip.eyebrow}
          </h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {SPORTS.map((sport) => (
              <li key={sport.code}>
                <Link
                  href={sport.href}
                  className="flex flex-col items-center gap-2 rounded-2xl border px-2 py-5 text-center transition hover:opacity-80"
                  style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
                >
                  <span className="text-3xl" role="img" aria-hidden="true">
                    {sport.emoji}
                  </span>
                  <span className="text-xs font-semibold sm:text-sm" style={{ color: 'var(--text)' }}>
                    {sport.code === 'SOCCER' ? copy.sportsStrip.soccer : sport.code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── CORE TOOLS STRIP ─── */}
      <section id="tools" className="border-t px-4 py-14 sm:px-6" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-6 text-center text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            {copy.tools.eyebrow}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {TOOLS.map(({ key, Icon }) => (
              <li key={key}>
                <div
                  className="flex flex-col items-center gap-2 rounded-2xl border px-3 py-6 text-center"
                  style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
                >
                  <Icon className="h-6 w-6" style={{ color: 'var(--accent-purple)' }} aria-hidden="true" />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {copy.tools[key as keyof typeof copy.tools]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="border-t px-4 py-16 text-center sm:px-6" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-6 text-2xl font-extrabold sm:text-3xl" style={{ color: 'var(--text)' }}>
            {copy.finalCta.title}
          </h2>
          <Link
            href={isAuthenticated ? dashboardHref : createLeagueHref}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-8 py-3 text-base font-semibold text-white transition hover:opacity-90"
            style={{ background: 'var(--accent-purple)' }}
            data-testid="landing-final-cta"
            onClick={() =>
              trackLandingCtaClick({
                cta_label: isAuthenticated ? copy.hero.primaryAuthed : copy.finalCta.cta,
                cta_destination: isAuthenticated ? dashboardHref : createLeagueHref,
                cta_type: 'primary',
                source: 'final_cta',
              })
            }
          >
            {isAuthenticated ? copy.hero.primaryAuthed : copy.finalCta.cta}
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </div>
      </section>

      <SeoLandingFooter />
    </main>
  )
}
