import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardList,
  Crown,
  Flame,
  Lock,
  Share2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from "lucide-react"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Create Your 2026 World Cup Pool | AllFantasy.AI",
  description:
    "Create a free 2026 World Cup pool, invite friends, build brackets, and get AI-powered predictions from Chimmy. Free to start. No gambling. Just bragging rights.",
  openGraph: {
    title: "Create Your 2026 World Cup Pool",
    description:
      "Invite friends, build brackets, track standings, and use Chimmy AI to help predict the tournament.",
    images: ["/images/brackets/world-cup/af-world-cup-hero-poster.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Create Your 2026 World Cup Pool",
    description:
      "Free World Cup pools, private groups, brackets, live standings, and AI-powered predictions.",
    images: ["/images/brackets/world-cup/af-world-cup-hero-poster.jpg"],
  },
}

const createHref = "/brackets/world-cup/create"
const joinHref = "/brackets/world-cup/join"
const bracketHref = "/brackets/world-cup"
const proHref = "/pricing?highlight=af-pro&intent=world-cup"
const commissionerHref = "/pricing?highlight=af-commissioner&intent=world-cup"

const benefits = [
  "Create a private World Cup pool",
  "Invite friends, family, coworkers, or fans",
  "Build brackets before kickoff",
  "Track standings during the tournament",
  "Ask Chimmy AI for predictions and strategy",
]

const steps = [
  {
    title: "Create your pool",
    body: "Start with a free World Cup pool and default scoring that works for casual fans.",
  },
  {
    title: "Invite your crew",
    body: "Share your pool link with friends, family, coworkers, group chats, or soccer communities.",
  },
  {
    title: "Make your picks",
    body: "Build your bracket, follow group-stage action, and compete for bragging rights.",
  },
  {
    title: "Use AI when ready",
    body: "Upgrade later for bracket grades, upset picks, group advice, and commissioner reports.",
  },
]

const aiCards = [
  {
    title: "AF Pro",
    price: "$9.99/mo",
    icon: Sparkles,
    body: "Bracket grades, group-stage advice, knockout strategy, upset picks, team comparisons, and saved AI reports.",
    href: proHref,
    cta: "Unlock player AI",
  },
  {
    title: "AF Commissioner",
    price: "$4.99/mo",
    icon: Crown,
    body: "Custom scoring, bigger pools, pool announcements, invite tools, leaderboard exports, and AI commissioner recaps.",
    href: commissionerHref,
    cta: "Upgrade commissioner tools",
  },
]

export default function WorldCupAdLandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 pb-24 text-white sm:pb-0">
      <div className="sticky top-0 z-50 border-b border-cyan-200/10 bg-slate-950/82 px-4 py-2 text-center text-xs font-black uppercase tracking-[0.18em] text-cyan-100 backdrop-blur-xl">
        <span className="inline-flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-amber-200" />
          Brackets lock when the tournament starts
        </span>
      </div>

      <section className="relative isolate px-4 pb-14 pt-4 sm:px-6 lg:px-8">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.33),transparent_34%),radial-gradient(circle_at_12%_18%,rgba(250,204,21,0.24),transparent_28%),radial-gradient(circle_at_86%_20%,rgba(168,85,247,0.18),transparent_26%),linear-gradient(180deg,#07111f_0%,#020617_58%,#01030a_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:42px_42px] opacity-35 [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />
          <div className="absolute left-1/2 top-28 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="absolute inset-x-[-20%] bottom-[-10rem] h-72 rounded-[50%] border-t border-cyan-200/20 bg-cyan-300/10 blur-sm" />
        </div>

        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 py-2">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-black tracking-tight text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300 text-slate-950 shadow-[0_0_35px_rgba(34,211,238,0.45)]">
              AF
            </span>
            AllFantasy.AI
          </Link>
          <div className="flex items-center gap-2 text-xs font-bold">
            <Link href={joinHref} className="rounded-full border border-white/15 px-3 py-2 text-white/75 hover:bg-white/10 hover:text-white">
              Join Pool
            </Link>
            <Link href="/login?callbackUrl=/brackets/world-cup" className="rounded-full bg-white px-3 py-2 text-slate-950 hover:bg-cyan-100">
              Sign In
            </Link>
          </div>
        </nav>

        <div className="mx-auto grid max-w-6xl items-center gap-9 pt-8 lg:grid-cols-[1.03fr_0.97fr] lg:pt-14">
          <div className="text-center lg:text-left">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.20em] text-emerald-200 lg:mx-0">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.9)]" />
              World Cup pools are open
            </div>

            <h1 className="mt-6 text-4xl font-black leading-[0.98] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Create Your 2026 World Cup Pool in 60 Seconds
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-200/82 sm:text-lg lg:mx-0">
              Invite friends, build brackets, track standings, and use Chimmy AI to help predict the tournament. Free to start. No gambling. Just bragging rights.
            </p>

            <div className="mt-6 grid gap-2 rounded-3xl border border-white/10 bg-white/[0.055] p-3 text-left shadow-2xl backdrop-blur sm:max-w-xl lg:max-w-none">
              <div className="flex items-center gap-3 rounded-2xl bg-slate-950/72 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-300 text-sm font-black text-slate-950">1</div>
                <div>
                  <p className="text-sm font-black">Name your pool</p>
                  <p className="text-xs text-white/55">Example: Family World Cup Challenge</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-slate-950/72 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-300 text-sm font-black text-slate-950">2</div>
                <div>
                  <p className="text-sm font-black">Invite your group</p>
                  <p className="text-xs text-white/55">Friends, family, coworkers, group chats, soccer fans</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-slate-950/72 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300 text-sm font-black text-slate-950">3</div>
                <div>
                  <p className="text-sm font-black">Make picks before kickoff</p>
                  <p className="text-xs text-white/55">Brackets, leaderboards, and AI help when you want it</p>
                </div>
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link
                href={createHref}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-7 py-4 text-base font-black text-slate-950 shadow-[0_18px_55px_-18px_rgba(34,211,238,0.9)] transition hover:scale-[1.015] active:scale-[0.99]"
              >
                Create Free Pool
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href={bracketHref}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/8 px-7 py-4 text-base font-black text-white backdrop-blur transition hover:bg-white/12"
              >
                Build My Bracket
                <ClipboardList className="h-5 w-5" />
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-bold text-white/65 lg:justify-start">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-300" />Free to start</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-cyan-300" />No gambling</span>
              <span className="inline-flex items-center gap-1.5"><Bot className="h-4 w-4 text-amber-200" />AI optional</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="absolute -inset-5 rounded-[2.5rem] bg-cyan-400/20 blur-3xl" aria-hidden />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.08] p-4 shadow-2xl backdrop-blur-xl">
              <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.20em] text-cyan-200">Live pool preview</p>
                    <h2 className="mt-2 text-2xl font-black">Family World Cup Pool</h2>
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-300 text-slate-950 shadow-[0_0_40px_rgba(252,211,77,0.35)]">
                    <Trophy className="h-8 w-8" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                    <div className="text-2xl font-black">48</div>
                    <div className="text-[10px] font-bold uppercase text-white/45">Teams</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                    <div className="text-2xl font-black">104</div>
                    <div className="text-[10px] font-bold uppercase text-white/45">Matches</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                    <div className="text-2xl font-black">AI</div>
                    <div className="text-[10px] font-bold uppercase text-white/45">Chimmy</div>
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {benefits.map((benefit) => (
                    <div key={benefit} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-semibold text-white/82">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                      {benefit}
                    </div>
                  ))}
                </div>

                <Link href={createHref} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-sm font-black text-slate-950 hover:bg-cyan-100">
                  Start My Pool
                  <Zap className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-950 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 rounded-[2rem] border border-amber-300/20 bg-amber-300/[0.08] p-5 text-center">
            <p className="text-sm font-black text-amber-100 sm:text-base">
              Cold traffic should not have to learn AllFantasy first. This page sends visitors straight to World Cup pools, brackets, and invites.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Link href={createHref} className="group rounded-3xl border border-cyan-300/25 bg-cyan-300/[0.08] p-6 transition hover:-translate-y-1 hover:bg-cyan-300/[0.12]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300 text-slate-950"><Trophy className="h-6 w-6" /></div>
              <h3 className="mt-5 text-2xl font-black">Create a Pool</h3>
              <p className="mt-2 text-sm leading-6 text-white/65">Run a private World Cup pool for friends, family, coworkers, or fans.</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-cyan-200">Create free <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
            </Link>
            <Link href={joinHref} className="group rounded-3xl border border-violet-300/25 bg-violet-300/[0.08] p-6 transition hover:-translate-y-1 hover:bg-violet-300/[0.12]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-300 text-slate-950"><Users className="h-6 w-6" /></div>
              <h3 className="mt-5 text-2xl font-black">Join With Code</h3>
              <p className="mt-2 text-sm leading-6 text-white/65">Already have an invite? Jump into your group and make your picks.</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-violet-200">Join pool <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
            </Link>
            <Link href={bracketHref} className="group rounded-3xl border border-amber-300/25 bg-amber-300/[0.08] p-6 transition hover:-translate-y-1 hover:bg-amber-300/[0.12]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300 text-slate-950"><ClipboardList className="h-6 w-6" /></div>
              <h3 className="mt-5 text-2xl font-black">Build a Bracket</h3>
              <p className="mt-2 text-sm leading-6 text-white/65">Pick the path to the final and see if your bracket survives the tournament.</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-amber-200">Start bracket <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.03] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">How it works</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">From group chat idea to live pool fast.</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-3xl border border-white/10 bg-slate-900/80 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-black text-slate-950">{index + 1}</div>
                <h3 className="mt-5 text-lg font-black">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/62">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-cyan-300/15 via-white/[0.05] to-amber-300/10 p-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300 text-slate-950"><Bot className="h-6 w-6" /></div>
            <h2 className="mt-5 text-3xl font-black">Want an edge? Ask Chimmy.</h2>
            <p className="mt-3 text-sm leading-6 text-white/68">
              Start free. When you want deeper help, unlock AI bracket grades, upset picks, group-stage advice, knockout paths, and commissioner recaps.
            </p>
            <div className="mt-5 flex flex-col gap-2 text-sm font-semibold text-white/78">
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-200" />Grade my bracket</span>
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-200" />Find my riskiest picks</span>
              <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-200" />Give me upset alerts</span>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {aiCards.map((card) => {
              const Icon = card.icon
              return (
                <div key={card.title} className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-950"><Icon className="h-6 w-6" /></div>
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black text-cyan-100">{card.price}</span>
                  </div>
                  <h3 className="mt-5 text-2xl font-black">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/64">{card.body}</p>
                  <Link href={card.href} className="mt-5 inline-flex items-center gap-2 text-sm font-black text-cyan-200 hover:text-cyan-100">
                    {card.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-[2rem] border border-emerald-300/25 bg-emerald-300/[0.08] p-6 text-center sm:p-9">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-300 text-slate-950"><Share2 className="h-7 w-7" /></div>
          <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">One commissioner can bring the whole crew.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-white/68 sm:text-base">
            Create the pool first, then invite the people who make the World Cup fun: friends, family, coworkers, fans, and rival group chats.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={createHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-6 py-3 text-sm font-black text-slate-950 hover:bg-emerald-200">
              Create Free Pool
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href={joinHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 px-6 py-3 text-sm font-black text-white hover:bg-white/10">
              Join Existing Pool
              <Lock className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-cyan-200/20 bg-slate-950/92 p-3 shadow-[0_-16px_45px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:hidden">
        <Link href={createHref} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-5 py-3 text-sm font-black text-slate-950">
          Create Free World Cup Pool
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </main>
  )
}
