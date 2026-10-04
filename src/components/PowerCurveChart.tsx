import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { PowerCurvePoint } from '../types';

interface PowerCurveChartProps {
  data: PowerCurvePoint[];
}

export const PowerCurveChart: React.FC<PowerCurveChartProps> = ({ data }) => {
  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 12 }} />
          <YAxis stroke="#64748B" tick={{ fontSize: 12 }} unit="W" />
          <Tooltip 
            formatter={(value: any, _name: any, props: any) => [
              `${value} Watts (${props.payload.wattsPerKg} W/kg)`,
              'Peak Power'
            ]}
            contentStyle={{ 
              backgroundColor: 'rgba(15, 23, 42, 0.95)', 
              borderColor: 'rgba(255, 255, 255, 0.15)',
              borderRadius: '0.5rem',
              backdropFilter: 'blur(8px)',
              fontSize: '12px'
            }}
          />
          <Area 
            type="monotone" 
            dataKey="watts" 
            name="Watts" 
            stroke="#F59E0B" 
            strokeWidth={3} 
            fillOpacity={1} 
            fill="url(#powerGradient)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
