"use client";

import { useState, useEffect } from "react";
import { Info } from "lucide-react";
import type { ConfidenceLevel } from "@/lib/analytics/confidence";
import {
  getConfidenceLabel,
  getConfidenceTooltip,
  getConfidenceColor,
} from "@/lib/analytics/confidence";
import { logConfidenceShown } from "@/lib/analytics/insight-events";

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  insightId: string;
  placement?: "inline_badge" | "tooltip" | "summary_header";
  showLabel?: boolean;
  size?: "sm" | "md";
}

export default function ConfidenceBadge({
  level,
  insightId,
  placement = "inline_badge",
  showLabel = true,
  size = "sm",
}: ConfidenceBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [logged, setLogged] = useState(false);

  const colors = getConfidenceColor(level);
  const label = getConfidenceLabel(level);
  const tooltip = getConfidenceTooltip(level);

  useEffect(() => {
    if (!logged && insightId) {
      logConfidenceShown({
        insight_id: insightId,
        confidence_level: level,
        placement,
      });
      setLogged(true);
    }
  }, [logged, insightId, level, placement]);

  const sizeClasses = size === "sm" 
    ? "px-2 py-0.5 text-[11px] gap-1" 
    : "px-2.5 py-1 text-xs gap-1.5";

  return (
    <div className="relative inline-block">
      <div
        className={`inline-flex items-center rounded-full ${colors.bg} ${colors.border} border ${sizeClasses} cursor-help`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => setShowTooltip(!showTooltip)}
      >
        <span>{colors.dot}</span>
        {showLabel && (
          <span className={`font-medium ${colors.text}`}>{label}</span>
        )}
        <Info className={`h-3 w-3 ${colors.text} opacity-60`} />
      </div>

      {showTooltip && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 rounded-lg bg-slate-800 border border-white/10 shadow-xl text-xs text-white/80 leading-relaxed">
          <div className="text-white/50 text-[11px] uppercase tracking-wide mb-1">
            {label}
          </div>
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </div>
      )}
    </div>
  );
}
