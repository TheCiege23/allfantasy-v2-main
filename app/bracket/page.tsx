'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Trophy, LogIn, UserPlus, Sparkles, Goal, Dribbble, IceCream2, Flag } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

function BracketLandingInner() {
  const { status } = useSession()
  const isAuthed = status === 'authenticated'
  const { t } = useLanguage()

  return (
    <main
      className="min-h-0 mode-readable pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Hero */}
      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:flex-row lg:items-start lg:gap-10">
        <div className="flex-1 space-y-4 sm:space-y-5">
          <p className="inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-100">
            <Trophy className="h-3.5 w-3.5" />
            AllFantasy Bracket Challenge
          </p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
            {t('bracket.page.hero.h1')}
          </h1>
          <p className="max-w-2xl text-sm text-white/80 sm:text-base mode-muted">
            {t('bracket.page.hero.subtitle')}
          </p>
          <p className="max-w-2xl text-xs text-white/65 sm:text-sm mode-muted-2">
            {t('bracket.page.hero.supporting')}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <Link
              href={isAuthed ? '/brackets/leagues/new' : '/signup?next=/brackets/leagues/new'}
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full bg-sky-400 px-3 py-2.5 text-center text-xs font-semibold text-black shadow-sm hover:bg-sky-300 sm:min-h-0 sm:px-4 sm:py-2 sm:text-sm"
              data-testid="bracket-landing-create-button"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" />
              <span className="leading-tight">{t('bracket.page.hero.cta.create')}</span>
            </Link>
            <Link
              href={isAuthed ? '/brackets/join' : '/login?next=/brackets/join'}
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full border border-sky-300/80 bg-sky-900/40 px-3 py-2.5 text-center text-xs font-medium text-sky-100 hover:bg-sky-800/60 sm:min-h-0 sm:px-4 sm:py-2 sm:text-sm"
              data-testid="bracket-landing-join-button"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" />
              <span className="leading-tight">{t('bracket.page.hero.cta.join')}</span>
            </Link>
            <Link
              href="/login?next=/brackets"
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-2.5 text-center text-xs font-medium text-white/80 hover:bg-white/10 sm:min-h-0 sm:py-2 sm:text-sm"
              data-testid="bracket-landing-signin-button"
            >
              <LogIn className="h-3.5 w-3.5 shrink-0" />
              <span className="leading-tight">{t('bracket.page.hero.cta.signIn')}</span>
            </Link>
            <Link
              href="/brackets"
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-900/30 px-3 py-2.5 text-center text-xs font-medium text-cyan-100 hover:bg-cyan-800/60 sm:min-h-0 sm:py-2 sm:text-sm"
              data-testid="bracket-open-challenge-button"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" />
              <span className="leading-tight">Open Challenge</span>
            </Link>
            {!isAuthed && (
              <Link
                href="/signup?next=/brackets"
                className="col-span-2 inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-2.5 text-center text-xs font-medium text-white/80 hover:bg-white/10 sm:col-span-1 sm:min-h-0 sm:py-2 sm:text-sm"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0" />
                <span className="leading-tight">{t('bracket.page.hero.cta.signUp')}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Shell links */}
        <aside className="flex-1 space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-6 mode-panel-soft">
          <h2 className="text-sm font-semibold text-white/80 sm:text-base">
            Product shell links
          </h2>
          <div className="space-y-2 text-xs sm:text-sm">
            <Link
              href="/brackets"
              className="flex min-h-[48px] touch-manipulation items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 hover:bg-black/60 active:bg-black/70"
            >
              <span className="min-w-0 font-medium">{t('bracket.landing.secondaryLink')}</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-white/50 sm:inline">/brackets</span>
            </Link>
            <Link
              href="/brackets/leagues/new"
              className="flex min-h-[48px] touch-manipulation items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 hover:bg-black/60 active:bg-black/70"
            >
              <span className="min-w-0 font-medium">Create a pool</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-white/50 sm:inline">/brackets/leagues/new</span>
            </Link>
            <Link
              href="/brackets/join"
              className="flex min-h-[48px] touch-manipulation items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3 hover:bg-black/60 active:bg-black/70"
            >
              <span className="min-w-0 font-medium">Join a pool</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-white/50 sm:inline">/brackets/join</span>
            </Link>
          </div>
        </aside>
      </section>

      {/* Bracket entry / start */}
      <section className="border-t border-white/10/5 bg-[rgba(15,23,42,0.6)] px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <h2 className="text-sm font-semibold text-white/80 sm:text-base">
            {t('bracket.page.entry.title')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-400/40 bg-black/30 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <Trophy className="h-4 w-4 text-sky-300" />
                <span className="text-sm font-semibold">
                  {t('bracket.page.entry.card.create.title')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.entry.card.create.body')}
              </p>
              <Link
                href={isAuthed ? '/brackets/leagues/new' : '/signup?next=/brackets/leagues/new'}
                className="mt-4 inline-flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-3 text-xs font-semibold text-black shadow-sm hover:bg-sky-300 sm:min-h-0 sm:py-2 sm:text-sm"
              >
                <span>{t('bracket.page.entry.card.create.cta')}</span>
              </Link>
            </div>

            <div className="rounded-2xl border border-white/15 bg-black/30 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <LogIn className="h-4 w-4 text-emerald-300" />
                <span className="text-sm font-semibold">
                  {t('bracket.page.entry.card.join.title')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.entry.card.join.body')}
              </p>
              <Link
                href={isAuthed ? '/brackets/join' : '/login?next=/brackets/join'}
                className="mt-4 inline-flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-900/40 px-4 py-3 text-xs font-semibold text-emerald-50 hover:bg-emerald-800/60 sm:min-h-0 sm:py-2 sm:text-sm"
              >
                <span>{t('bracket.page.entry.card.join.cta')}</span>
              </Link>
            </div>

            <div className="rounded-2xl border border-sky-400/40 bg-gradient-to-br from-sky-500/20 via-sky-500/5 to-sky-500/0 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <Sparkles className="h-4 w-4 text-cyan-300" />
                <span className="text-sm font-semibold">
                  {t('bracket.page.entry.card.ai.title')}
                </span>
              </div>
              <p className="text-xs text-white/75">
                {t('bracket.page.entry.card.ai.body')}
              </p>
              <Link
                href="/brackets"
                className="mt-4 inline-flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-cyan-400 px-4 py-3 text-xs font-semibold text-black shadow-sm hover:bg-cyan-300 sm:min-h-0 sm:py-2 sm:text-sm"
              >
                <span>{t('bracket.page.entry.card.ai.cta')}</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <h2 className="text-sm font-semibold text-white/80 sm:text-base">
            {t('bracket.page.how.title')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                  1
                </span>
                <span className="text-sm font-semibold">
                  {t('bracket.page.how.step1.title')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.how.step1.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                  2
                </span>
                <span className="text-sm font-semibold">
                  {t('bracket.page.how.step2.title')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.how.step2.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                  3
                </span>
                <span className="text-sm font-semibold">
                  {t('bracket.page.how.step3.title')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.how.step3.body')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AI Bracket Assistant */}
      <section className="border-t border-white/10/5 bg-[rgba(15,23,42,0.7)] px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-white/80 sm:text-base">
              {t('bracket.page.ai.title')}
            </h2>
            <p className="max-w-3xl text-xs text-white/70 sm:text-sm mode-muted">
              {t('bracket.page.ai.body')}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <Sparkles className="h-4 w-4 text-cyan-300" />
                <span className="text-sm font-semibold">
                  {t('bracket.page.ai.feature.matchup')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.ai.feature.matchup.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <Trophy className="h-4 w-4 text-purple-300" />
                <span className="text-sm font-semibold">
                  {t('bracket.page.ai.feature.upset')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.ai.feature.upset.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4 mode-panel-soft">
              <div className="mb-2 flex items-center gap-2 text-white">
                <Goal className="h-4 w-4 text-emerald-300" />
                <span className="text-sm font-semibold">
                  {t('bracket.page.ai.feature.strategy')}
                </span>
              </div>
              <p className="text-xs text-white/70">
                {t('bracket.page.ai.feature.strategy.body')}
              </p>
            </div>
          </div>
          <div>
            <Link
              href="/brackets"
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-xs font-semibold text-black shadow-sm hover:bg-cyan-300 sm:min-h-0 sm:py-2 sm:text-sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t('bracket.page.ai.cta')}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Team import / bracket population */}
      <section className="px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-white/80 sm:text-base">
              {t('bracket.page.teams.title')}
            </h2>
            <p className="max-w-3xl text-xs text-white/70 sm:text-sm mode-muted">
              {t('bracket.page.teams.body')}
            </p>
          </div>
          <div className="grid gap-4 text-xs text-white/70 sm:grid-cols-3 sm:text-sm">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p>{t('bracket.page.teams.item1')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p>{t('bracket.page.teams.item2')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p>{t('bracket.page.teams.item3')}</p>
            </div>
          </div>
          <div>
            <Link
              href="/brackets"
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full border border-white/40 bg-transparent px-5 py-3 text-xs font-semibold text-white hover:bg-white/10 sm:min-h-0 sm:py-2 sm:text-sm"
            >
              <Trophy className="h-4 w-4" />
              <span>{t('bracket.page.teams.cta')}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Feature / benefits */}
      <section className="border-t border-white/10/5 bg-[rgba(15,23,42,0.7)] px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <h2 className="text-sm font-semibold text-white/80 sm:text-base">
            {t('bracket.page.benefits.title')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p className="text-sm font-semibold text-white">
                {t('bracket.page.benefits.card1.title')}
              </p>
              <p className="mt-1 text-xs text-white/70">
                {t('bracket.page.benefits.card1.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p className="text-sm font-semibold text-white">
                {t('bracket.page.benefits.card2.title')}
              </p>
              <p className="mt-1 text-xs text-white/70">
                {t('bracket.page.benefits.card2.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p className="text-sm font-semibold text-white">
                {t('bracket.page.benefits.card3.title')}
              </p>
              <p className="mt-1 text-xs text-white/70">
                {t('bracket.page.benefits.card3.body')}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mode-panel-soft">
              <p className="text-sm font-semibold text-white">
                {t('bracket.page.benefits.card4.title')}
              </p>
              <p className="mt-1 text-xs text-white/70">
                {t('bracket.page.benefits.card4.body')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA / signup section */}
      <section className="px-4 py-10 sm:px-6 sm:py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 rounded-3xl border border-sky-400/60 bg-gradient-to-r from-sky-500/20 via-sky-500/10 to-sky-500/0 p-6 sm:p-8">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              {t('bracket.page.cta.title')}
            </h2>
            <p className="max-w-2xl text-xs text-white/80 sm:text-sm">
              {t('bracket.page.cta.subtitle')}
            </p>
          </div>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link
              href={isAuthed ? '/brackets/leagues/new' : '/signup?next=/brackets/leagues/new'}
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-semibold text-black shadow-sm hover:bg-gray-100 sm:min-h-0 sm:py-2.5 sm:text-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>{t('bracket.page.cta.primary')}</span>
            </Link>
            <Link
              href="/brackets"
              className="inline-flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-full border border-white/60 bg-transparent px-5 py-3 text-xs font-semibold text-white hover:bg-white/10 sm:min-h-0 sm:py-2.5 sm:text-sm"
            >
              <Sparkles className="h-4 w-4" />
              <span>{t('bracket.page.cta.secondary')}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10/5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-xs text-white/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4">
          <span>© {new Date().getFullYear()} AllFantasy</span>
          <span className="hidden text-white/30 sm:inline">•</span>
          <Link href="/disclaimer" className="text-white/50 hover:text-white/80">
            Disclaimer
          </Link>
          <span className="text-white/30">•</span>
          <Link
            href="/privacy"
            className="text-white/50 hover:text-white/80"
          >
            Privacy
          </Link>
          <span className="text-white/30">•</span>
          <Link href="/terms" className="text-white/50 hover:text-white/80">
            Terms
          </Link>
          <span className="text-white/30">•</span>
          <Link href="/data-deletion" className="text-white/50 hover:text-white/80">
            Data Deletion
          </Link>
        </div>
      </footer>
    </main>
  )
}

export default function BracketRootPage() {
  return (
    <Suspense
      fallback={
        <main
          className="min-h-screen flex items-center justify-center"
          style={{ background: 'var(--bg)', color: 'var(--text)' }}
        >
          <div style={{ color: 'var(--muted2)' }}>Loading...</div>
        </main>
      }
    >
      <BracketLandingInner />
    </Suspense>
  )
}
