"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Check,
  AlertCircle,
  Send,
  Trophy,
  Target,
  Zap,
  Settings,
  User,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const SPORTS = ["NFL", "NHL", "NBA", "MLB", "NCAAF", "NCAAB", "SOCCER"];
const LEAGUE_SIZES = ["8", "10", "12", "14", "16+"];
const SEASON_FORMATS = ["Redraft", "Dynasty", "Keeper", "Best Ball", "Tournament", "Other"];
const DRAFT_TYPES = ["Snake", "Auction", "Linear", "Third-Round Reversal", "By Team", "Other"];
const WIN_CONDITIONS = ["Points", "Head-to-Head", "Rotisserie", "Elimination", "Voting", "Hybrid"];
const SPECIAL_MECHANICS = [
  "Eliminations",
  "Stealing players",
  "Salary cap/contracts",
  "Voting/social gameplay",
  "Hidden advantages (idols, power-ups)",
  "Random events (wheel/spin)",
  "Multi-sport scoring",
];
const WAIVER_SYSTEMS = ["FAAB", "Rolling", "FCFS", "Reverse standings"];

type FormData = {
  leagueTypeName: string;
  tagline: string;
  description: string;
  sports: string[];
  recommendedSize: string;
  seasonFormat: string;
  draftType: string;
  winCondition: string;
  hasSpecialScoring: boolean;
  scoringRules: string;
  positionsImpacted: string;
  specialMechanics: string[];
  otherMechanic: string;
  weeklyFlow: string;
  edgeCases: string;
  rosterSetup: string;
  waiverSystem: string;
  tradeRules: string;
  playoffSetup: string;
  commissionerTools: string;
  creditName: string;
  email: string;
  socialHandle: string;
  permissionConsent: boolean;
  rightsConsent: boolean;
  canContact: boolean;
};

const initialFormData: FormData = {
  leagueTypeName: "",
  tagline: "",
  description: "",
  sports: [],
  recommendedSize: "",
  seasonFormat: "",
  draftType: "",
  winCondition: "",
  hasSpecialScoring: false,
  scoringRules: "",
  positionsImpacted: "",
  specialMechanics: [],
  otherMechanic: "",
  weeklyFlow: "",
  edgeCases: "",
  rosterSetup: "",
  waiverSystem: "",
  tradeRules: "",
  playoffSetup: "",
  commissionerTools: "",
  creditName: "",
  email: "",
  socialHandle: "",
  permissionConsent: false,
  rightsConsent: false,
  canContact: false,
};

function Section({
  title,
  icon: Icon,
  children,
  number,
}: {
  title: string;
  icon: any;
  children: React.ReactNode;
  number: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600">
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-xs text-white/40 font-medium">Section {number}</div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
        </div>
      </div>
      {children}
    </div>
  );
}

function MultiSelect({
  options,
  selected,
  onChange,
  label,
}: {
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
  label?: string;
}) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div className="space-y-2">
      {label && <label className="block text-sm font-medium text-white/70">{label}</label>}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selected.includes(opt)
                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 border"
                : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function RadioGroup({
  options,
  value,
  onChange,
  label,
  required,
}: {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-white/70">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              value === opt
                ? "bg-purple-500/20 border-purple-500/50 text-purple-300 border"
                : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SubmitLeaguePage() {
  const [form, setForm] = useState<FormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [expandedOptional, setExpandedOptional] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validate = (): string | null => {
    if (!form.leagueTypeName.trim()) return "League type name is required";
    if (!form.tagline.trim()) return "One-line hook/tagline is required";
    if (!form.description.trim()) return "Full description is required";
    if (form.sports.length === 0) return "Select at least one sport";
    if (!form.recommendedSize) return "Recommended league size is required";
    if (!form.seasonFormat) return "Season format is required";
    if (!form.draftType) return "Draft type is required";
    if (!form.winCondition) return "Win condition is required";
    if (form.hasSpecialScoring && !form.scoringRules.trim()) return "Scoring rules are required when special scoring is enabled";
    if (form.specialMechanics.length === 0 && !form.otherMechanic.trim()) return "Select at least one special mechanic or describe your own";
    if (!form.weeklyFlow.trim()) return "Weekly flow description is required";
    if (!form.creditName.trim()) return "Credit name is required";
    if (!form.email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Please enter a valid email";
    if (!form.permissionConsent) return "You must agree to the permission consent";
    if (!form.rightsConsent) return "You must agree to the rights consent";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const mechanics = [...form.specialMechanics];
      if (form.otherMechanic.trim()) {
        mechanics.push(form.otherMechanic.trim());
      }

      const res = await fetch("/api/submit-league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueTypeName: form.leagueTypeName.trim(),
          tagline: form.tagline.trim(),
          description: form.description.trim(),
          sports: form.sports,
          recommendedSize: form.recommendedSize,
          seasonFormat: form.seasonFormat,
          draftType: form.draftType,
          winCondition: form.winCondition,
          hasSpecialScoring: form.hasSpecialScoring,
          scoringRules: form.scoringRules.trim() || null,
          positionsImpacted: form.positionsImpacted.trim() || null,
          specialMechanics: mechanics,
          weeklyFlow: form.weeklyFlow.trim(),
          edgeCases: form.edgeCases.trim() || null,
          rosterSetup: form.rosterSetup.trim() || null,
          waiverSystem: form.waiverSystem || null,
          tradeRules: form.tradeRules.trim() || null,
          playoffSetup: form.playoffSetup.trim() || null,
          commissionerTools: form.commissionerTools.trim() || null,
          creditName: form.creditName.trim(),
          email: form.email.trim().toLowerCase(),
          socialHandle: form.socialHandle.trim() || null,
          permissionConsent: form.permissionConsent,
          rightsConsent: form.rightsConsent,
          canContact: form.canContact,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit");
      }

      setSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/20 to-slate-950 text-white">
        <div className="mx-auto max-w-2xl px-4 py-20">
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-center space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg shadow-emerald-500/20">
              <Check className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold">Submission Received!</h1>
            <p className="text-white/60 max-w-md mx-auto">
              We&apos;ve received your league idea: <strong className="text-white">{form.leagueTypeName}</strong>.
              Check your email for a confirmation.
            </p>
            <div className="pt-4 space-y-3">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-3 font-semibold text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
              >
                Back to Home
              </Link>
              <p className="text-sm text-white/40">
                Want to submit another idea?{" "}
                <button
                  onClick={() => {
                    setSuccess(false);
                    setForm(initialFormData);
                  }}
                  className="text-cyan-400 hover:underline"
                >
                  Start over
                </button>
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/20 to-slate-950 text-white">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-white/60 hover:text-white transition mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20 px-4 py-2 mb-4">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-300">Community League Ideas</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            Submit Your League Type
          </h1>
          <p className="text-white/60 max-w-xl mx-auto">
            Have a unique fantasy league format? Share it with us! If accepted, your idea could be featured
            in AllFantasy with full credit to you.
          </p>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <Section title="Basics" icon={Trophy} number="A">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  League Type Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.leagueTypeName}
                  onChange={(e) => update("leagueTypeName", e.target.value)}
                  placeholder="Zombie Dynasty, Pirate Guilly, etc."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  One-line Hook / Tagline <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.tagline}
                  onChange={(e) => update("tagline", e.target.value)}
                  placeholder="Last-place team gets 'cursed' and can steal one bench player weekly."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Full Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="Explain how it works week-to-week..."
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none resize-none"
                />
              </div>
            </div>
          </Section>

          <Section title="Structure & Rules" icon={Target} number="B">
            <div className="space-y-5">
              <MultiSelect
                label="Sport(s) *"
                options={SPORTS}
                selected={form.sports}
                onChange={(val) => update("sports", val)}
              />
              <RadioGroup
                label="Recommended League Size"
                required
                options={LEAGUE_SIZES}
                value={form.recommendedSize}
                onChange={(val) => update("recommendedSize", val)}
              />
              <RadioGroup
                label="Season Format"
                required
                options={SEASON_FORMATS}
                value={form.seasonFormat}
                onChange={(val) => update("seasonFormat", val)}
              />
              <RadioGroup
                label="Draft Type"
                required
                options={DRAFT_TYPES}
                value={form.draftType}
                onChange={(val) => update("draftType", val)}
              />
              <RadioGroup
                label="How do teams win?"
                required
                options={WIN_CONDITIONS}
                value={form.winCondition}
                onChange={(val) => update("winCondition", val)}
              />
            </div>
          </Section>

          <Section title="Scoring" icon={Zap} number="C">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => update("hasSpecialScoring", !form.hasSpecialScoring)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    form.hasSpecialScoring ? "bg-cyan-500" : "bg-white/20"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                      form.hasSpecialScoring ? "translate-x-5" : ""
                    }`}
                  />
                </button>
                <span className="text-sm text-white/70">Does your league have special scoring changes?</span>
              </div>
              {form.hasSpecialScoring && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1.5">
                      Scoring Rules <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={form.scoringRules}
                      onChange={(e) => update("scoringRules", e.target.value)}
                      placeholder="+0.5 per carry, bonus for long TDs, etc."
                      rows={3}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1.5">
                      Positions Impacted (optional)
                    </label>
                    <input
                      type="text"
                      value={form.positionsImpacted}
                      onChange={(e) => update("positionsImpacted", e.target.value)}
                      placeholder="RB, WR, K, etc."
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>
          </Section>

          <Section title="Unique Mechanics" icon={Sparkles} number="D">
            <div className="space-y-4">
              <MultiSelect
                label="Core Special Mechanic(s) *"
                options={SPECIAL_MECHANICS}
                selected={form.specialMechanics}
                onChange={(val) => update("specialMechanics", val)}
              />
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Other Mechanic (describe your own)
                </label>
                <input
                  type="text"
                  value={form.otherMechanic}
                  onChange={(e) => update("otherMechanic", e.target.value)}
                  placeholder="Describe a unique mechanic not listed above..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Weekly Flow <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={form.weeklyFlow}
                  onChange={(e) => update("weeklyFlow", e.target.value)}
                  placeholder="What happens each week from matchup end → waivers → lineup lock?"
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Edge Cases / Anti-cheat Rules (encouraged)
                </label>
                <textarea
                  value={form.edgeCases}
                  onChange={(e) => update("edgeCases", e.target.value)}
                  placeholder="What stops collusion? What happens if someone quits?"
                  rows={2}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none resize-none"
                />
              </div>
            </div>
          </Section>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedOptional(!expandedOptional)}
              className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600">
                  <Settings className="h-5 w-5 text-white" />
                </div>
                <div className="text-left">
                  <div className="text-xs text-white/40 font-medium">Section E</div>
                  <h2 className="text-lg font-semibold text-white">Setup Recommendations (Optional)</h2>
                </div>
              </div>
              {expandedOptional ? (
                <ChevronUp className="h-5 w-5 text-white/40" />
              ) : (
                <ChevronDown className="h-5 w-5 text-white/40" />
              )}
            </button>
            {expandedOptional && (
              <div className="p-6 pt-0 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    Roster Setup
                  </label>
                  <input
                    type="text"
                    value={form.rosterSetup}
                    onChange={(e) => update("rosterSetup", e.target.value)}
                    placeholder="Starters/bench/IR/taxi/devy..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
                <RadioGroup
                  label="Waiver System"
                  options={WAIVER_SYSTEMS}
                  value={form.waiverSystem}
                  onChange={(val) => update("waiverSystem", val)}
                />
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    Trade Rules
                  </label>
                  <input
                    type="text"
                    value={form.tradeRules}
                    onChange={(e) => update("tradeRules", e.target.value)}
                    placeholder="Veto %, review window, commissioner override..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    Playoffs
                  </label>
                  <input
                    type="text"
                    value={form.playoffSetup}
                    onChange={(e) => update("playoffSetup", e.target.value)}
                    placeholder="Teams, weeks, reseeding, byes..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    Commissioner Tools Needed
                  </label>
                  <input
                    type="text"
                    value={form.commissionerTools}
                    onChange={(e) => update("commissionerTools", e.target.value)}
                    placeholder="Auto elimination, vote collection, random event engine..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          <Section title="Attribution & Contact" icon={User} number="F">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Your Name (credit name) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.creditName}
                  onChange={(e) => update("creditName", e.target.value)}
                  placeholder="How you want to be credited in-app"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="For confirmation and follow-up"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Social Handle / Website (optional)
                </label>
                <input
                  type="text"
                  value={form.socialHandle}
                  onChange={(e) => update("socialHandle", e.target.value)}
                  placeholder="@yourhandle or website URL"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
            </div>
          </Section>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-5">
            <h2 className="text-lg font-semibold text-white">Required Consent</h2>
            
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.permissionConsent}
                onChange={(e) => update("permissionConsent", e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
              />
              <span className="text-sm text-white/70 group-hover:text-white/90 transition">
                I give AllFantasy permission to review, host, display, and promote my submission in the AllFantasy website/app. <span className="text-red-400">*</span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.rightsConsent}
                onChange={(e) => update("rightsConsent", e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
              />
              <span className="text-sm text-white/70 group-hover:text-white/90 transition">
                If my submission is accepted, I agree that AllFantasy will own the rights to the league format and may use it commercially and for marketing. I will receive full public credit as the creator. <span className="text-red-400">*</span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={form.canContact}
                onChange={(e) => update("canContact", e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50"
              />
              <span className="text-sm text-white/70 group-hover:text-white/90 transition">
                You can contact me to collaborate on refining this idea (optional)
              </span>
            </label>

            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
              <p className="text-xs text-amber-200/80">
                <strong>Submission Notice:</strong> We won&apos;t use your league idea in the app or marketing unless you agree to the permissions above. If accepted, your league type may be hosted in AllFantasy after launch and used to promote the platform. You will be credited as the creator, and AllFantasy will own the rights to the league type and related materials as permitted by your agreement. This does not create a partnership, employment relationship, or entitlement to payment.
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-600 py-4 font-semibold text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-5 w-5" />
                Submit League Idea
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
