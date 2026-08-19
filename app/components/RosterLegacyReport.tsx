'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Award, Shield, TrendingUp, Clock, AlertTriangle, Users, DollarSign, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const iconMap: Record<string, any> = {
  Award, Shield, TrendingUp, Clock, AlertTriangle, Users, DollarSign,
};

type LegacyInsight = {
  title: string;
  description: string;
  score: number;
  iconName: string;
  color: string;
  recommendation?: string;
};

export default function RosterLegacyReport({ leagueId }: { leagueId?: string }) {
  const [insights, setInsights] = useState<LegacyInsight[]>([]);
  const [overallScore, setOverallScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      setError('');
      try {
        const body = leagueId ? { leagueId } : {};
        const res = await fetch('/api/roster/legacy-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        // Never surface the raw response body ({"error":"Unauthorized"}) to the user.
        if (!res.ok) {
          throw new Error(
            res.status === 401
              ? 'Sign in to generate your Roster Legacy Report.'
              : 'Failed to generate legacy report'
          );
        }

        const data = await res.json();
        setInsights(data.insights || []);
        setOverallScore(data.overallScore || 0);
      } catch (err: any) {
        const msg = err.message || 'Failed to generate legacy report';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [leagueId]);

  if (loading) {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-950 p-8 border border-indigo-500/30 min-h-[500px] flex items-center justify-center flex-col gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-cyan-400" />
        <p className="text-slate-400">Analyzing your roster legacy...</p>
      </div>
    );
  }

  if (error || insights.length === 0) {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-950 p-8 border border-indigo-500/30 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-orange-400" />
        <p className="text-slate-300">{error || 'Sync a league to unlock your Roster Legacy Report'}</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-950 p-8 border border-indigo-500/30 shadow-2xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h2 className="text-3xl md:text-4xl font-extrabold flex items-center gap-4">
            <Award className="w-10 h-10 text-yellow-400" />
            Roster Legacy Report
          </h2>
          <p className="text-slate-400 mt-2 text-lg">
            Your dynasty/redraft legacy score — how your roster ranks in contention and long-term value
          </p>
        </div>

        <div className="text-center">
          <div
            className="text-6xl md:text-7xl font-black"
            style={{
              color: overallScore >= 80 ? '#34d399' : overallScore >= 60 ? '#fbbf24' : '#f87171',
            }}
          >
            {overallScore}
          </div>
          <p className="text-sm text-slate-400 mt-1">/100</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight, i) => {
          const IconComponent = iconMap[insight.iconName] || Award;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-indigo-500/50 transition-all group"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className={`p-3 rounded-xl ${insight.color} bg-opacity-20`}>
                  <IconComponent className={`w-8 h-8 ${insight.color}`} />
                </div>
                <h3 className="text-xl font-bold">{insight.title}</h3>
              </div>

              <p className="text-slate-300 mb-5">{insight.description}</p>

              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      insight.score >= 80
                        ? 'bg-emerald-500'
                        : insight.score >= 60
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    }`}
                    style={{ width: `${insight.score}%` }}
                  />
                </div>
                <span
                  className={`font-bold text-lg ${
                    insight.score >= 80
                      ? 'text-emerald-400'
                      : insight.score >= 60
                      ? 'text-yellow-400'
                      : 'text-red-400'
                  }`}
                >
                  {insight.score}
                </span>
              </div>

              {insight.recommendation && (
                <p className="mt-4 text-sm text-slate-400 italic border-t border-slate-800 pt-3">
                  {insight.recommendation}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-10 text-center text-sm text-slate-500">
        Powered by synced roster data &bull; League-adjusted values &bull; Your feedback profile
      </div>
    </div>
  );
}
