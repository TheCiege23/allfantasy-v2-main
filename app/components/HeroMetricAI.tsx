"use client";

import React, { useMemo, useState } from "react";

type Confidence = "high" | "medium" | "low";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function confidenceLabel(c?: Confidence) {
  if (!c) return null;
  if (c === "high") return "High confidence";
  if (c === "medium") return "Medium confidence";
  return "Learning";
}

function confidenceClasses(c?: Confidence) {
  if (!c) return "border-white/10 bg-white/5 text-white/70";
  if (c === "high") return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  if (c === "medium") return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  return "border-sky-400/25 bg-sky-500/10 text-sky-200";
}

export default function HeroMetricAI({
  value,
  label,
  helper,
  accent = "emerald",
  confidence,
  whyBullets,
}: {
  value: string;
  label: string;
  helper?: string;
  accent?: "emerald" | "cyan" | "purple" | "amber" | "sky";
  confidence?: Confidence;
  whyBullets?: string[];
}) {
  const [open, setOpen] = useState(false);

  const bullets = useMemo(
    () => (whyBullets || []).filter(Boolean).slice(0, 4),
    [whyBullets]
  );

  return (
    <div className="relative">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xl sm:text-3xl font-extrabold text-white/90 truncate">
              {value || "—"}
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span
                className={cx(
                  "text-xs font-semibold rounded-full px-2.5 py-1 border",
                  accent === "emerald" && "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
                  accent === "cyan" && "border-cyan-400/25 bg-cyan-500/10 text-cyan-200",
                  accent === "purple" && "border-purple-400/25 bg-purple-500/10 text-purple-200",
                  accent === "amber" && "border-amber-400/25 bg-amber-500/10 text-amber-200",
                  accent === "sky" && "border-sky-400/25 bg-sky-500/10 text-sky-200"
                )}
              >
                {label}
              </span>

              <span
                className={cx(
                  "text-[11px] px-2 py-0.5 rounded-full border",
                  confidenceClasses(confidence)
                )}
                title="Confidence applies to Chimmy narrative only. Deterministic engine still drives rankings."
              >
                {confidenceLabel(confidence) ?? "Chimmy Notes"}
              </span>

              {bullets.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 transition"
                  title="Why this is recommended"
                >
                  Why?
                </button>
              ) : null}
            </div>

            {helper ? (
              <div className="mt-2 text-xs sm:text-sm text-white/60">
                {helper}
              </div>
            ) : null}
          </div>
        </div>

        {open && bullets.length > 0 ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="text-[11px] uppercase tracking-wide text-white/50">
              Chimmy reasoning (Grok)
            </div>
            <ul className="mt-2 space-y-1">
              {bullets.map((b, i) => (
                <li key={i} className="text-xs text-white/75 leading-relaxed">
                  <span className="text-white/50 mr-2">•</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
