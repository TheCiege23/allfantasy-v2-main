'use client';

import { useState, useEffect } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart } from 'recharts';

interface PortfolioPoint {
  date: string;
  tradeId: string;
  deltaValue: number;
  cumulativeValue: number;
  tradeSummary: string;
  grade: string;
  volatility: string;
  confidence: number;
}

interface PortfolioData {
  points: PortfolioPoint[];
  totalDelta: number;
  bestTrade: PortfolioPoint | null;
  worstTrade: PortfolioPoint | null;
  averageDelta: number;
  volatilityProfile: string;
}

interface PortfolioChartProps {
  leagueId: string;
  userId: string;
  isSuperFlex?: boolean;
  mode?: 'atTime' | 'hindsight';
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  
  const data = payload[0].payload as PortfolioPoint;
  const isPositive = data.deltaValue >= 0;
  
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-lg max-w-xs">
      <p className="text-gray-400 text-xs mb-1">{data.date}</p>
      <p className="text-white text-sm font-medium mb-2">{data.tradeSummary}</p>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}{data.deltaValue.toFixed(0)}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          data.grade.startsWith('A') ? 'bg-green-600' :
          data.grade.startsWith('B') ? 'bg-blue-600' :
          data.grade.startsWith('C') ? 'bg-yellow-600' :
          'bg-red-600'
        } text-white`}>
          {data.grade}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          data.volatility === 'Low' ? 'bg-green-700' :
          data.volatility === 'Medium' ? 'bg-yellow-700' :
          'bg-red-700'
        } text-white`}>
          {data.volatility} Risk
        </span>
      </div>
      <p className="text-gray-400 text-xs">
        Cumulative: <span className={data.cumulativeValue >= 0 ? 'text-green-400' : 'text-red-400'}>
          {data.cumulativeValue >= 0 ? '+' : ''}{data.cumulativeValue.toFixed(0)}
        </span>
      </p>
    </div>
  );
};

export default function PortfolioChart({ leagueId, userId, isSuperFlex = false, mode = 'atTime' }: PortfolioChartProps) {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(
          `/api/legacy/portfolio/history?leagueId=${leagueId}&userId=${userId}&mode=${mode}&sf=${isSuperFlex}`
        );
        
        if (!response.ok) {
          throw new Error('Failed to fetch portfolio data');
        }
        
        const portfolioData = await response.json();
        setData(portfolioData);
      } catch (err: any) {
        setError(err.message || 'Failed to load portfolio');
      } finally {
        setLoading(false);
      }
    };

    if (leagueId && userId) {
      fetchData();
    }
  }, [leagueId, userId, mode, isSuperFlex]);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-48 mb-4"></div>
        <div className="h-64 bg-gray-700 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 text-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!data || data.points.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 text-center">
        <p className="text-gray-400">No trade history to display</p>
      </div>
    );
  }

  const chartData = data.points.map(point => ({
    ...point,
    fill: point.deltaValue >= 0 ? '#22c55e' : '#ef4444',
  }));

  const minValue = Math.min(...data.points.map(p => p.cumulativeValue), 0);
  const maxValue = Math.max(...data.points.map(p => p.cumulativeValue), 0);
  const yDomain = [Math.floor(minValue * 1.1), Math.ceil(maxValue * 1.1)];

  return (
    <div className="bg-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Portfolio Over Time</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className={`font-medium ${data.totalDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            Total: {data.totalDelta >= 0 ? '+' : ''}{data.totalDelta.toFixed(0)}
          </span>
          <span className="text-gray-400">
            {data.points.length} trades
          </span>
          <span className={`px-2 py-0.5 rounded text-xs ${
            data.volatilityProfile === 'Conservative' ? 'bg-green-600/30 text-green-400' :
            data.volatilityProfile === 'Balanced' ? 'bg-yellow-600/30 text-yellow-400' :
            'bg-red-600/30 text-red-400'
          }`}>
            {data.volatilityProfile}
          </span>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="date" 
              stroke="#9ca3af" 
              tick={{ fontSize: 11 }}
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
            />
            <YAxis 
              stroke="#9ca3af" 
              tick={{ fontSize: 11 }}
              domain={yDomain}
              tickFormatter={(value) => value >= 0 ? `+${value}` : value}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="cumulativeValue"
              stroke="transparent"
              fill="url(#portfolioGradient)"
            />
            <Line
              type="monotone"
              dataKey="cumulativeValue"
              stroke="#22c55e"
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, payload } = props;
                const color = payload.deltaValue >= 0 ? '#22c55e' : '#ef4444';
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill={color}
                    stroke="#1f2937"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{ r: 7, fill: '#3b82f6' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {(data.bestTrade || data.worstTrade) && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          {data.bestTrade && (
            <div className="bg-green-900/20 border border-green-800 rounded-lg p-3">
              <p className="text-green-400 text-xs font-medium mb-1">Best Trade</p>
              <p className="text-white text-sm">{data.bestTrade.tradeSummary}</p>
              <p className="text-green-400 text-sm font-bold">+{data.bestTrade.deltaValue.toFixed(0)}</p>
            </div>
          )}
          {data.worstTrade && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
              <p className="text-red-400 text-xs font-medium mb-1">Worst Trade</p>
              <p className="text-white text-sm">{data.worstTrade.tradeSummary}</p>
              <p className="text-red-400 text-sm font-bold">{data.worstTrade.deltaValue.toFixed(0)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
