"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BarChart3, LayoutDashboard, PanelsTopLeft, Trophy } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProviderClient";

export default function ProductDemoSection() {
  const { t } = useLanguage();

  return (
    <section className="px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="space-y-2 text-center">
          <h2 className="text-lg font-semibold sm:text-xl">
            {t("home.demo.title")}
          </h2>
          <p className="mx-auto max-w-2xl text-xs text-white/70 sm:text-sm mode-muted">
            {t("home.demo.subtitle")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* AI Trade Analyzer */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25, delay: 0.02 }}
            className="flex flex-col justify-between rounded-2xl border border-white/10 bg-black/30 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.4)] mode-panel-soft"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-white">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/60 bg-black/40 mode-panel">
                  <BarChart3 className="h-4 w-4 text-cyan-300" />
                </div>
                <span className="text-sm font-semibold">
                  {t("home.demo.card1.title")}
                </span>
              </div>
              <p className="text-xs text-white/75 mode-muted">
                {t("home.demo.card1.body")}
              </p>

              {/* Mock trade analyzer preview */}
              <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-3 text-xs mode-panel">
                <div className="flex items-center justify-between text-[11px] text-white/80">
                  <span className="font-medium">Team A</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                    +8.4 value
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 rounded-full bg-emerald-400" />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-white/70">
                  <span>AI grade</span>
                  <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                    B+
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Link
                href="/trade-analyzer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-xs font-semibold text-black shadow-sm hover:bg-cyan-300 sm:text-sm"
              >
                <BarChart3 className="h-4 w-4" />
                <span>{t("home.demo.card1.cta")}</span>
              </Link>
            </div>
          </motion.div>

          {/* Fantasy Sports App */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25, delay: 0.06 }}
            className="flex flex-col justify-between rounded-2xl border border-white/10 bg-black/30 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.4)] mode-panel-soft"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-white">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/60 bg-black/40 mode-panel">
                  <LayoutDashboard className="h-4 w-4 text-emerald-300" />
                </div>
                <span className="text-sm font-semibold">
                  {t("home.demo.card2.title")}
                </span>
              </div>
              <p className="text-xs text-white/75 mode-muted">
                {t("home.demo.card2.body")}
              </p>

              {/* Mock roster dashboard preview */}
              <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-3 text-xs mode-panel">
                <div className="mb-2 flex items-center justify-between text-[11px] text-white/80">
                  <span className="font-medium">Week 5 Lineup</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                    +12.3 projected
                  </span>
                </div>
                <div className="space-y-1.5 text-[11px] text-white/75">
                  <div className="flex items-center justify-between">
                    <span>QB · J. Allen</span>
                    <span className="text-emerald-300">+3.4</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>RB · B. Robinson</span>
                    <span className="text-emerald-300">+2.1</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>WR · A. St. Brown</span>
                    <span className="text-emerald-300">+1.8</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Link
                href="/dashboard"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-400 px-4 py-2 text-xs font-semibold text-black shadow-sm hover:bg-emerald-300 sm:text-sm"
              >
                <PanelsTopLeft className="h-4 w-4" />
                <span>{t("home.demo.card2.cta")}</span>
              </Link>
            </div>
          </motion.div>

          {/* Bracket Challenge */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="flex flex-col justify-between rounded-2xl border border-white/10 bg-black/30 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.4)] mode-panel-soft"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-white">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/60 bg-black/40 mode-panel">
                  <Trophy className="h-4 w-4 text-sky-300" />
                </div>
                <span className="text-sm font-semibold">
                  {t("home.demo.card3.title")}
                </span>
              </div>
              <p className="text-xs text-white/75 mode-muted">
                {t("home.demo.card3.body")}
              </p>

              {/* Mock bracket preview */}
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/40 p-2 text-[10px] text-white/75 mode-panel">
                <div className="space-y-1">
                  <div className="rounded-md bg-white/5 px-1 py-0.5">1 vs 16</div>
                  <div className="rounded-md bg-white/5 px-1 py-0.5">8 vs 9</div>
                </div>
                <div className="flex items-center justify-center">
                  <div className="h-10 w-px bg-white/15" />
                </div>
                <div className="space-y-1 text-right">
                  <div className="rounded-md bg-sky-500/20 px-1 py-0.5">
                    1 advances
                  </div>
                  <div className="rounded-md bg-sky-500/20 px-1 py-0.5">
                    9 advances
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Link
                href="/brackets"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-xs font-semibold text-black shadow-sm hover:bg-sky-300 sm:text-sm"
              >
                <Trophy className="h-4 w-4" />
                <span>{t("home.demo.card3.cta")}</span>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

