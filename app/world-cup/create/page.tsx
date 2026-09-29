"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Flame,
  Lock,
  Share2,
  Trophy,
  Users,
} from "lucide-react"
import { signupUrlWithIntent, loginUrlWithIntent } from "@/lib/auth/auth-intent-resolver"
import {
  trackWcGuestPoolStarted,
  trackWcPoolDraftCompleted,
  trackWcSignupPromptShown,
  trackWcSignupStarted,
  trackWcFunnelEvent,
} from "@/lib/world-cup/worldCupFunnelAnalytics"
import { WC_ASSETS } from "@/lib/world-cup/worldCupMarketingAssets"

// ── Types ─────────────────────────────────────────────────────────────────────

export type WcGuestPoolDraft = {
  poolName: string
  displayName: string
  poolType: "full_bracket" | "group_stage" | "bracket_and_group"
  privacy: "private" | "public"
  groupType: "friends" | "family" | "coworkers" | "fans" | "other"
  source: "world-cup-landing"
  createdAt: string
}

const DRAFT_KEY = "af:world-cup:guest-pool-draft:v1"

function saveDraft(draft: WcGuestPoolDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // localStorage unavailable — continue without saving
  }
}

// ── Step components ────────────────────────────────────────────────────────────

type Step1Props = {
  poolName: string
  displayName: string
  onChange: (field: "poolName" | "displayName", value: string) => void
  onNext: () => void
}

function Step1({ poolName, displayName, onChange, onNext }: Step1Props) {
  const canContinue = poolName.trim().length >= 2 && displayName.trim().length >= 2

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="mb-1.5 block text-sm font-black text-white">Pool name</label>
        <input
          type="text"
          value={poolName}
          onChange={(e) => onChange("poolName", e.target.value)}
          placeholder="e.g. Family World Cup 2026"
          maxLength={60}
          className="w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-base font-semibold text-white placeholder-white/30 outline-none transition focus:border-cyan-300/60 focus:ring-1 focus:ring-cyan-300/30"
        />
        <p className="mt-1 text-xs text-white/40">Min 2 characters. Others will see this name.</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-black text-white">Your display name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => onChange("displayName", e.target.value)}
          placeholder="e.g. Alex or Coach Alex"
          maxLength={40}
          className="w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-base font-semibold text-white placeholder-white/30 outline-none transition focus:border-cyan-300/60 focus:ring-1 focus:ring-cyan-300/30"
        />
        <p className="mt-1 text-xs text-white/40">This is how you&apos;ll appear in the leaderboard.</p>
      </div>

      <button
        onClick={onNext}
        disabled={!canContinue}
        className="mt-2 inline-flex min-h-13 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-6 py-3.5 text-base font-black text-slate-950 shadow-[0_12px_35px_-10px_rgba(34,211,238,0.8)] transition disabled:opacity-40 enabled:hover:scale-[1.015] enabled:active:scale-[0.99]"
      >
        Continue
        <ArrowRight className="h-5 w-5" />
      </button>
    </div>
  )
}

type Step2Props = {
  poolType: WcGuestPoolDraft["poolType"]
  privacy: WcGuestPoolDraft["privacy"]
  groupType: WcGuestPoolDraft["groupType"]
  onChange: (field: keyof Pick<WcGuestPoolDraft, "poolType" | "privacy" | "groupType">, value: string) => void
  onNext: () => void
  onBack: () => void
}

function Step2({ poolType, privacy, groupType, onChange, onNext, onBack }: Step2Props) {
  return (
    <div className="flex flex-col gap-5">
      {/* Pool type */}
      <div>
        <label className="mb-2 block text-sm font-black text-white">Pool format</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "full_bracket", label: "Full Bracket", desc: "Group stage + knockout rounds" },
            { value: "group_stage", label: "Group Stage Only", desc: "Predict group-stage results" },
            { value: "bracket_and_group", label: "Full Competition", desc: "Groups + brackets + scoring" },
          ].map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() => onChange("poolType", value)}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
                poolType === value
                  ? "border-cyan-300/60 bg-cyan-300/10 text-white"
                  : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/25 hover:bg-white/[0.07]"
              }`}
            >
              <span className="text-sm font-black">{label}</span>
              <span className="text-[11px] text-white/50">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Privacy */}
      <div>
        <label className="mb-2 block text-sm font-black text-white">Privacy</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { value: "private", label: "Private — invite only", Icon: Lock, desc: "Only people with your link can join" },
            { value: "public", label: "Public — discoverable", Icon: Users, desc: "Anyone can find and join" },
          ].map(({ value, label, Icon, desc }) => (
            <button
              key={value}
              onClick={() => onChange("privacy", value)}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                privacy === value
                  ? "border-cyan-300/60 bg-cyan-300/10"
                  : "border-white/15 bg-white/[0.04] hover:border-white/25"
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${privacy === value ? "text-cyan-300" : "text-white/40"}`} />
              <div>
                <div className={`text-sm font-black ${privacy === value ? "text-white" : "text-white/70"}`}>{label}</div>
                <div className="text-[11px] text-white/45">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Group type */}
      <div>
        <label className="mb-2 block text-sm font-black text-white">Who&apos;s in this pool? <span className="font-normal text-white/40">(optional)</span></label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "friends", label: "Friends" },
            { value: "family", label: "Family" },
            { value: "coworkers", label: "Coworkers" },
            { value: "fans", label: "Soccer fans" },
            { value: "other", label: "Other" },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange("groupType", value)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                groupType === value
                  ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-200"
                  : "border-white/15 bg-white/[0.04] text-white/55 hover:border-white/25 hover:text-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] px-5 py-3 text-sm font-black text-white/70 transition hover:bg-white/[0.09]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-6 py-3 text-base font-black text-slate-950 shadow-[0_10px_30px_-8px_rgba(34,211,238,0.7)] transition hover:scale-[1.015] active:scale-[0.99]"
        >
          Preview Pool
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

type PreviewProps = {
  draft: WcGuestPoolDraft
  onBack: () => void
}

function PreviewAndSave({ draft, onBack }: PreviewProps) {
  const signupUrl = signupUrlWithIntent("/world-cup/finish")
  const loginUrl = loginUrlWithIntent("/world-cup/finish")

  const poolTypeLabel = {
    full_bracket: "Full Bracket",
    group_stage: "Group Stage Only",
    bracket_and_group: "Full Competition",
  }[draft.poolType]

  useEffect(() => {
    trackWcSignupPromptShown("preview_screen")
  }, [])

  return (
    <div className="flex flex-col gap-5">
      {/* Pool preview */}
      <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.06] p-5">
        <div className="flex items-center gap-2.5 text-emerald-300">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-black">Your pool is ready.</span>
        </div>
        <p className="mt-1.5 text-sm text-white/60">Create a free account to save it and invite friends.</p>

        <div className="mt-4 grid gap-2.5">
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2.5">
            <span className="text-xs text-white/50">Pool name</span>
            <span className="text-sm font-black text-white">{draft.poolName}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2.5">
            <span className="text-xs text-white/50">Format</span>
            <span className="text-sm font-black text-white">{poolTypeLabel}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2.5">
            <span className="text-xs text-white/50">Privacy</span>
            <span className="text-sm font-black text-white capitalize">{draft.privacy}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2.5">
            <span className="text-xs text-white/50">Commissioner</span>
            <span className="text-sm font-black text-white">{draft.displayName}</span>
          </div>
        </div>
      </div>

      {/* Fake invite link preview */}
      <div className="rounded-2xl border border-dashed border-white/20 bg-white/[0.04] p-4">
        <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-white/35">Your invite link (preview)</p>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5">
          <Share2 className="h-4 w-4 shrink-0 text-white/30" />
          <span className="flex-1 select-none truncate text-xs font-mono text-white/30">
            allfantasy.ai/j/••••••••
          </span>
          <Lock className="h-3.5 w-3.5 shrink-0 text-white/20" />
        </div>
        <p className="mt-2 text-[11px] text-white/40">
          Your real invite link is generated after account creation.
        </p>
      </div>

      {/* What you get */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <p className="mb-3 text-xs font-black uppercase tracking-widest text-white/40">Your pool will include</p>
        <div className="grid gap-2 text-sm">
          {[
            "Real-time leaderboard",
            "Bracket picks for all knockout rounds",
            "Group stage scoring",
            "Shareable invite link",
            "Optional AI help (with upgrade)",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
              <span className="text-white/70">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTAs */}
      <Link
        href={signupUrl}
        onClick={() => trackWcSignupStarted("preview_screen")}
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-6 py-4 text-base font-black text-slate-950 shadow-[0_18px_50px_-15px_rgba(34,211,238,0.9)] transition hover:scale-[1.015] active:scale-[0.99]"
      >
        <Trophy className="h-5 w-5" />
        Save Pool &amp; Invite Friends
      </Link>
      <Link
        href={loginUrl}
        className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-black text-white/70 transition hover:bg-white/[0.09]"
      >
        I already have an account
      </Link>
      <button
        onClick={onBack}
        className="inline-flex items-center justify-center gap-1.5 text-xs text-white/35 transition hover:text-white/60"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Edit pool settings
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3

export default function WorldCupGuestCreatePage() {
  const [step, setStep] = useState(1)
  const [poolName, setPoolName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [poolType, setPoolType] = useState<WcGuestPoolDraft["poolType"]>("full_bracket")
  const [privacy, setPrivacy] = useState<WcGuestPoolDraft["privacy"]>("private")
  const [groupType, setGroupType] = useState<WcGuestPoolDraft["groupType"]>("friends")

  useEffect(() => {
    trackWcFunnelEvent("WorldCupGuestPoolStarted")
  }, [])

  function handleStep1Next() {
    trackWcGuestPoolStarted(2)
    setStep(2)
  }

  function handleStep2Next() {
    const draft: WcGuestPoolDraft = {
      poolName: poolName.trim(),
      displayName: displayName.trim(),
      poolType,
      privacy,
      groupType,
      source: "world-cup-landing",
      createdAt: new Date().toISOString(),
    }
    saveDraft(draft)
    trackWcPoolDraftCompleted(draft.poolName)
    setStep(3)
  }

  const draft: WcGuestPoolDraft = {
    poolName: poolName.trim(),
    displayName: displayName.trim(),
    poolType,
    privacy,
    groupType,
    source: "world-cup-landing",
    createdAt: new Date().toISOString(),
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-950 text-white">
      {/* Background — stadium atmosphere */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.22),transparent_38%),radial-gradient(circle_at_85%_60%,rgba(251,191,36,0.10),transparent_32%),radial-gradient(circle_at_15%_70%,rgba(168,85,247,0.08),transparent_28%),linear-gradient(180deg,#07111f_0%,#020617_100%)]" />
        {/* Stadium arc glow */}
        <div className="absolute inset-x-0 top-0 h-[22rem] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.04),transparent_70%)]" />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/world-cup" className="inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-black text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-300 text-xs font-black text-slate-950">AF</span>
          AllFantasy.AI
        </Link>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-lg px-4 pb-16 pt-4 sm:px-6">

        {/* ── World Cup identity strip ─────────────────────────────────── */}
        <div className="mb-5 flex items-center gap-3 overflow-hidden rounded-2xl border border-cyan-300/20 bg-gradient-to-r from-cyan-300/[0.08] via-cyan-300/[0.04] to-transparent px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/[0.12] p-1.5 shadow-[0_0_20px_-6px_rgba(34,211,238,0.45)]">
            <Image
              src={WC_ASSETS.logoSrc}
              alt="AllFantasy World Cup"
              width={36}
              height={36}
              className="h-full w-full object-contain drop-shadow-[0_2px_6px_rgba(34,211,238,0.35)]"
              priority
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300/70">2026 FIFA World Cup</p>
            <p className="text-sm font-black text-white">World Cup Pool Setup</p>
          </div>
          {/* Visual steps indicator */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            {["Setup", "Invite", "Picks"].map((label, i) => (
              <div key={label} className="flex items-center gap-1">
                <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[11px] font-bold text-white/50">
                  {label}
                </span>
                {i < 2 && <span className="text-white/20 text-[11px]">›</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Step indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>
              Step {step} of {TOTAL_STEPS}
            </span>
            <div className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-amber-300/70" />
              <span className="text-amber-200/60">Takes less than 60 seconds</span>
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < step ? "bg-cyan-400" : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step title */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white sm:text-3xl">
            {step === 1 && "Name your pool"}
            {step === 2 && "Pool settings"}
            {step === 3 && "Ready to save"}
          </h1>
          <p className="mt-1.5 text-sm text-white/55">
            {step === 1 && "Give your pool a name and set your display name for the leaderboard."}
            {step === 2 && "Choose your format and privacy settings."}
            {step === 3 && "Your pool draft is saved. Create an account to activate it."}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur sm:p-6">
          {step === 1 && (
            <Step1
              poolName={poolName}
              displayName={displayName}
              onChange={(field, value) => {
                if (field === "poolName") setPoolName(value)
                else setDisplayName(value)
              }}
              onNext={handleStep1Next}
            />
          )}
          {step === 2 && (
            <Step2
              poolType={poolType}
              privacy={privacy}
              groupType={groupType}
              onChange={(field, value) => {
                if (field === "poolType") setPoolType(value as WcGuestPoolDraft["poolType"])
                else if (field === "privacy") setPrivacy(value as WcGuestPoolDraft["privacy"])
                else setGroupType(value as WcGuestPoolDraft["groupType"])
              }}
              onNext={handleStep2Next}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && <PreviewAndSave draft={draft} onBack={() => setStep(2)} />}
        </div>

        {/* Trust line */}
        {step < 3 && (
          <p className="mt-5 text-center text-xs text-white/30">
            Free to start · No gambling · AI optional · Private groups
          </p>
        )}
      </div>
    </main>
  )
}
