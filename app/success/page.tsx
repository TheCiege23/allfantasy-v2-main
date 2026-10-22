'use client'

import Link from 'next/link'
import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import confetti from 'canvas-confetti'
import { gtagEvent } from '@/lib/gtag'
import { trackLandingSignupComplete } from '@/lib/landing-analytics'

const SPORTS = ['NFL', 'NHL', 'NBA', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']
const LEAGUE_TYPES = ['Redraft', 'Dynasty', 'Keeper', 'Best Ball', 'Guilly', 'Survivor', 'Tournament']
const COMPETITIVENESS = ['Casual', 'Competitive', 'Degenerate 😈']
const DRAFT_PREFS = ['Snake', 'Auction', 'Either']
const PAIN_POINTS = ['Drafting', 'Waivers', 'Trades', 'Start/Sit', 'League Management']
const EXPERIMENTAL_FORMATS = [
  'Survivor (TV Show Style)',
  'Big Brother',
  'Zombie',
  'Guilly++',
  'Vampire / Pirate',
  'King of the Hill',
  'Draft Lottery Chaos',
  'Yes — surprise me with new formats',
  'No — I prefer traditional leagues'
]

const questionnaireSchema = z.object({
  favoriteSport: z.string().min(1, 'Please select your favorite sport'),
  favoriteLeagueType: z.string().min(1, 'Please select a league type'),
  competitiveness: z.string().min(1, 'Please select your competitiveness level'),
  draftPreference: z.string().min(1, 'Please select a draft preference'),
  painPoint: z.string().min(1, 'Please select your biggest pain point'),
  experimentalInterest: z.array(z.string()).min(1, 'Please select at least one option'),
  freeText: z.string().max(1000).optional(),
})
type QuestionnaireForm = z.infer<typeof questionnaireSchema>

function SuccessContent() {
  const searchParams = useSearchParams()
  const email = searchParams?.get('email') || ''
  const isExisting = searchParams?.get('existing') === 'true'

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<QuestionnaireForm>({
    resolver: zodResolver(questionnaireSchema),
    defaultValues: {
      favoriteSport: '',
      favoriteLeagueType: '',
      competitiveness: '',
      draftPreference: '',
      painPoint: '',
      experimentalInterest: [],
      freeText: '',
    },
  })

  const experimentalInterest = watch('experimentalInterest')

  useEffect(() => {
    if (!isExisting) {
      trackLandingSignupComplete({ existing_user: false, source: 'early_access' });
    }

    const duration = 3000
    const end = Date.now() + duration

    const colors = ['#00f5ff', '#bf00ff', '#ff00aa', '#0066ff']

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors
      })
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors
      })

      if (Date.now() < end) {
        requestAnimationFrame(frame)
      }
    }

    frame()

    setTimeout(() => {
      confetti({
        particleCount: 100,
        spread: 100,
        origin: { y: 0.6 },
        colors
      })
    }, 500)
  }, [])

  const handleCheckbox = (value: string) => {
    const current = experimentalInterest || []
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value]
    setValue('experimentalInterest', updated, { shouldValidate: true })
  }

  const onSubmit = async (formData: QuestionnaireForm) => {
    try {
      const res = await fetch('/api/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, email }),
      })

      if (res.ok) {
        toast.success('Questionnaire saved!')
        gtagEvent('questionnaire_submitted', {
          favorite_sport: formData.favoriteSport,
          league_type: formData.favoriteLeagueType,
          competitiveness: formData.competitiveness,
        })
      } else {
        const data = await res.json()
        toast.error(data.error || 'Error saving questionnaire')
      }
    } catch {
      toast.error('Network error. Please try again.')
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12 relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-neon-purple/20 rounded-full blur-3xl animate-glow-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-neon-cyan/20 rounded-full blur-3xl animate-glow-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <section className="text-center mb-8 sm:mb-12 relative z-10">
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white mb-3 sm:mb-4 neon-text">
          You&apos;re in 🎉
        </h1>
        {isExisting ? (
          <div className="space-y-2">
            <p className="text-xl text-gray-300">You&apos;re already on the early access list!</p>
            <p className="text-sm text-cyan-400">We&apos;ll notify you as soon as new features launch.</p>
          </div>
        ) : (
          <p className="text-xl text-gray-300">
            Thank you for signing up for early access to AllFantasy
          </p>
        )}
      </section>

      <section className="w-full max-w-xl relative z-10 px-2 sm:px-0">
        <div className="text-center mb-6 sm:mb-8">
          <p className="text-base sm:text-lg text-gray-300">Help us build the leagues you actually want.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="bg-dark-800/60 backdrop-blur-sm rounded-2xl p-4 sm:p-6 md:p-8 border border-white/10 space-y-4 sm:space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Favorite Sport *</label>
            <select
              {...register('favoriteSport')}
              className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white text-base focus:outline-none input-glow min-h-[48px]"
            >
              <option value="">Select...</option>
              {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.favoriteSport && <p className="text-xs text-red-400 mt-1">{errors.favoriteSport.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Favorite League Type *</label>
            <select
              {...register('favoriteLeagueType')}
              className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white text-base focus:outline-none input-glow min-h-[48px]"
            >
              <option value="">Select...</option>
              {LEAGUE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.favoriteLeagueType && <p className="text-xs text-red-400 mt-1">{errors.favoriteLeagueType.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Competitiveness *</label>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {COMPETITIVENESS.map(c => (
                <label key={c} className="flex items-center gap-2.5 cursor-pointer py-2 px-1 min-h-[44px]">
                  <input
                    type="radio"
                    value={c}
                    {...register('competitiveness')}
                    className="w-5 h-5 accent-neon-cyan"
                  />
                  <span className="text-gray-300 text-sm sm:text-base">{c}</span>
                </label>
              ))}
            </div>
            {errors.competitiveness && <p className="text-xs text-red-400 mt-1">{errors.competitiveness.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Draft Preference *</label>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {DRAFT_PREFS.map(d => (
                <label key={d} className="flex items-center gap-2.5 cursor-pointer py-2 px-1 min-h-[44px]">
                  <input
                    type="radio"
                    value={d}
                    {...register('draftPreference')}
                    className="w-5 h-5 accent-neon-cyan"
                  />
                  <span className="text-gray-300 text-sm sm:text-base">{d}</span>
                </label>
              ))}
            </div>
            {errors.draftPreference && <p className="text-xs text-red-400 mt-1">{errors.draftPreference.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Biggest Pain Point *</label>
            <select
              {...register('painPoint')}
              className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white text-base focus:outline-none input-glow min-h-[48px]"
            >
              <option value="">Select...</option>
              {PAIN_POINTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {errors.painPoint && <p className="text-xs text-red-400 mt-1">{errors.painPoint.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Experimental League Formats? *
            </label>
            <p className="text-xs text-gray-400 mb-3">Would you be interested in experimental league formats inspired by TV shows & game modes?</p>
            <div className="space-y-1">
              {EXPERIMENTAL_FORMATS.map(f => (
                <label key={f} className="flex items-center gap-2.5 cursor-pointer py-1.5 px-1 min-h-[40px]">
                  <input
                    type="checkbox"
                    checked={experimentalInterest?.includes(f) || false}
                    onChange={() => handleCheckbox(f)}
                    className="w-5 h-5 accent-neon-cyan rounded flex-shrink-0"
                  />
                  <span className="text-gray-300 text-sm">{f}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Sneak peek:{' '}
              <Link href="/formats/king-of-the-hill" className="inline-flex min-h-[44px] items-center text-neon-cyan underline">King of the Hill</Link>
              {' · '}
              <Link href="/formats/pirate" className="inline-flex min-h-[44px] items-center text-neon-cyan underline">Pirate</Link>
            </p>
            {errors.experimentalInterest && <p className="text-xs text-red-400 mt-1">{errors.experimentalInterest.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Anything you&apos;d want AllFantasy to do better than other apps? (optional)
            </label>
            <textarea
              {...register('freeText')}
              maxLength={1000}
              rows={3}
              className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white text-base focus:outline-none input-glow resize-none"
              placeholder="Your ideas..."
            />
          </div>

          {!isSubmitSuccessful && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-8 py-4 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-blue text-dark-900 font-semibold glow-button disabled:opacity-50 disabled:cursor-not-allowed min-h-[52px] active:scale-[0.98] transition-transform"
            >
              {isSubmitting ? 'Saving...' : 'Submit'}
            </button>
          )}
        </form>

        {isSubmitSuccessful && (
          <div className="mt-8 animate-fadeIn">
            <div className="text-center mb-5">
              <div className="inline-flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full px-4 py-2 text-sm font-medium">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Questionnaire saved
              </div>
            </div>

            <a
              href="/af-legacy"
              className="group relative block w-full rounded-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan/20 via-neon-purple/20 to-neon-cyan/20 animate-shimmer" />
              <div className="relative bg-gradient-to-br from-dark-800/90 to-dark-900/90 border-2 border-neon-cyan/40 rounded-2xl p-6 sm:p-8 text-center transition-all duration-300 group-hover:border-neon-cyan/70 group-hover:shadow-[0_0_30px_rgba(0,245,255,0.15)]">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="text-2xl">⚡</span>
                  <span className="text-xs font-bold uppercase tracking-widest text-neon-cyan/80">Live Preview</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">
                  See the AI in action with AF Legacy
                </h3>
                <p className="text-sm text-gray-400 mb-5 max-w-sm mx-auto">
                  Import your Sleeper leagues and get AI-powered trade evaluations, rankings, and insights — right now.
                </p>
                <div className="inline-flex items-center gap-2 bg-gradient-to-r from-neon-cyan to-neon-blue text-dark-900 font-bold rounded-xl px-6 py-3 text-sm transition-transform group-hover:scale-105">
                  Try AF Legacy
                  <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </a>
          </div>
        )}
      </section>

      <footer className="mt-12 text-center relative z-10">
        <a href="/" className="text-neon-cyan/60 hover:text-neon-cyan hover:underline text-sm">← Back to home</a>
      </footer>
    </main>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-white">Loading...</p>
      </main>
    }>
      <SuccessContent />
    </Suspense>
  )
}

