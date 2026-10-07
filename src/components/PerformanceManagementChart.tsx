import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import type { PMCDayPoint } from '../types';

interface PerformanceManagementChartProps {
  data: PMCDayPoint[];
}

const MAX_POINTS = 400;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseDay = (iso: string) => new Date(`${iso}T12:00:00`);

export const PerformanceManagementChart: React.FC<PerformanceManagementChartProps> = ({ data: allData }) => {
  // Years of daily points are far more than the chart can show: thin them evenly, always keeping the latest day
  const stride = Math.max(1, Math.ceil(allData.length / MAX_POINTS));
  const data = stride === 1
    ? allData
    : allData.filter((_, index) => (allData.length - 1 - index) % stride === 0);
  // Long ranges label months and years; short ones label days
  const longRange = allData.length > 180;

  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="ctlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00F0FF" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#00F0FF" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="atlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="tsbGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis 
            dataKey="date" 
            stroke="#64748B" 
            tick={{ fontSize: 11 }}
            minTickGap={32}
            tickFormatter={(str) => {
              const d = parseDay(String(str));
              return longRange
                ? `${SHORT_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`
                : `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          <YAxis stroke="#64748B" tick={{ fontSize: 11 }} />
          <Tooltip 
            labelFormatter={(label) => parseDay(String(label)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            contentStyle={{ 
              backgroundColor: 'rgba(15, 23, 42, 0.95)', 
              borderColor: 'rgba(255, 255, 255, 0.15)',
              borderRadius: '0.5rem',
              backdropFilter: 'blur(8px)',
              fontSize: '12px'
            }}
          />
          <Legend verticalAlign="top" height={36} iconType="circle" />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 2" />

          <Area 
            type="monotone" 
            dataKey="ctl" 
            name="Fitness (CTL)" 
            stroke="#00F0FF" 
            strokeWidth={2.5} 
            fillOpacity={1} 
            fill="url(#ctlGradient)" 
          />
          <Area 
            type="monotone" 
            dataKey="atl" 
            name="Fatigue (ATL)" 
            stroke="#F43F5E" 
            strokeWidth={2} 
            fillOpacity={1} 
            fill="url(#atlGradient)" 
          />
          <Area 
            type="monotone" 
            dataKey="tsb" 
            name="Form / Freshness (TSB)" 
            stroke="#10B981" 
            strokeWidth={1.5} 
            fillOpacity={1} 
            fill="url(#tsbGradient)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
