import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { riskColorClasses } from './Icons';

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const colorForClass = (cls) => {
  if (cls === 'Go') return '#16a34a';
  if (cls === 'Caution') return '#d97706';
  if (cls === 'No-Go') return '#dc2626';
  return '#94a3b8';
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const c = riskColorClasses(p.risk_class);
  return (
    <div className="bg-white border border-slate-200 shadow-card-hover rounded-lg px-3 py-2 text-sm">
      <div className="font-medium text-slate-900">
        {new Date(p.forecast_time).toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className={`risk-dot ${c.dot}`} />
        <span className={`font-semibold ${c.text}`}>{p.risk_class}</span>
        <span className="text-slate-600">
          · {Math.round(p.no_go_probability * 100)}% no-go
        </span>
      </div>
    </div>
  );
};

const ForecastChart = ({ forecast = [] }) => {
  const data = forecast.map((f) => ({
    ...f,
    timeLabel: formatTime(f.forecast_time),
  }));

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
        No forecast data available. Run Ingest Weather → Run Predictions.
      </div>
    );
  }

  return (
    <div className="h-64 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="timeLabel"
            interval={Math.max(1, Math.floor(data.length / 8))}
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={0.3}
            stroke="#16a34a"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
          />
          <ReferenceLine
            y={0.6}
            stroke="#dc2626"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
          />
          <Line
            type="monotone"
            dataKey="no_go_probability"
            stroke="#0369a1"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              return (
                <circle
                  key={`dot-${payload.forecast_time}`}
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill={colorForClass(payload.risk_class)}
                  stroke="white"
                  strokeWidth={1.5}
                />
              );
            }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ForecastChart;