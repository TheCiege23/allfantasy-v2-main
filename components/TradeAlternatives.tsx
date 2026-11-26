'use client';

import { useState } from 'react';

// Every letter and number here is THE one completed-trade grade (see /api/legacy/trade-alternatives).
interface AlternativeOption {
  label: string;
  totalValue: number;
  deltaImprovement: number;
  type: 'player_swap' | 'pick_package' | 'mixed';
  grade?: string;
}

interface AlternativesResult {
  originalDelta: number | null;
  originalGrade: string | null;
  alternatives: AlternativeOption[];
  bestAlternative: AlternativeOption | null;
  gradeWithheld?: string | null;
}

interface AlternativeExplanation {
  recommended: string;
  reasoning: string[];
  confidence: 'High' | 'Medium' | 'Low' | null;
  alternatives: AlternativesResult;
}

interface TradeData {
  transactionId: string;
  timestamp: number;
  week?: number;
  parties: Array<{
    userId: string;
    teamName?: string;
    playersReceived: Array<{ name: string; position?: string }>;
    picksReceived: Array<{ round: number; season: string; slot?: string }>;
  }>;
}

interface TradeAlternativesProps {
  trade: TradeData;
  userId: string;
  /** The league the trade is graded on. Without it the grade (and so the comparison) is withheld. */
  leagueId?: string | null;
  isSuperFlex?: boolean;
}

export default function TradeAlternatives({ trade, userId, leagueId = null, isSuperFlex = false }: TradeAlternativesProps) {
  const [data, setData] = useState<AlternativeExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchAlternatives = async () => {
    if (data) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/legacy/trade-alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade, userId, leagueId, isSuperFlex })
      });

      if (!response.ok) {
        throw new Error('Failed to generate alternatives');
      }

      const result = await response.json();
      setData(result);
      setExpanded(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load alternatives');
    } finally {
      setLoading(false);
    }
  };

  const confidenceColors = {
    High: 'bg-green-600/30 text-green-400 border-green-600',
    Medium: 'bg-yellow-600/30 text-yellow-400 border-yellow-600',
    Low: 'bg-gray-600/30 text-gray-400 border-gray-600'
  };

  return (
    <div className="mt-3">
      <button
        onClick={fetchAlternatives}
        disabled={loading}
        className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Analyzing alternatives...</span>
          </>
        ) : (
          <>
            <svg className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>{expanded ? 'Hide' : 'What could I have done instead?'}</span>
          </>
        )}
      </button>

      {error && (
        <p className="text-red-400 text-sm mt-2">{error}</p>
      )}

      {expanded && data && (
        <div className="mt-3 bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
          {data.alternatives.gradeWithheld ? (
            <p className="text-gray-400 text-sm">Not graded: {data.alternatives.gradeWithheld}</p>
          ) : data.alternatives.alternatives.length === 0 ? (
            <p className="text-gray-400 text-sm">
              None of the alternatives we compared grades better than your {data.alternatives.originalGrade ?? 'trade'}.
            </p>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-600/30 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-medium text-sm">Recommended Alternative</span>
                    {data.confidence && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${confidenceColors[data.confidence]}`}>
                        {data.confidence} Confidence
                      </span>
                    )}
                  </div>
                  <p className="text-green-400 text-sm font-medium">{data.recommended}</p>
                  {data.alternatives.bestAlternative?.grade && (
                    <p className="text-gray-400 text-xs mt-0.5">
                      Grades {data.alternatives.bestAlternative.grade} from your side · your trade graded {data.alternatives.originalGrade}
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-700 pt-3">
                <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Why this would have been better:</p>
                <ul className="space-y-1.5">
                  {data.reasoning.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-green-400 mt-0.5">•</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              {data.alternatives.alternatives.length > 1 && (
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Other alternatives:</p>
                  <div className="space-y-2">
                    {data.alternatives.alternatives.slice(1, 4).map((alt, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">{alt.label}</span>
                        <span className="text-green-400 font-medium">{alt.grade ? `${alt.grade} · ` : ''}+{alt.deltaImprovement.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
