'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  // [{x: '2026-04-01', y: 1234}, ...]
  data: Array<{ x: string; y: number }>;
  dashed?: boolean;
}

function fmtMoney(n: number) {
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

export default function LineChartBlock({
  height = 280,
  series,
  xType = 'date',
  showDots = false,
  formatValue,
}: {
  height?: number;
  series: LineSeries[];
  xType?: 'date' | 'category';
  showDots?: boolean;
  // How to render Y-axis ticks + tooltip values. Defaults to money so existing
  // revenue charts are unchanged; pass a custom formatter for %, counts, hours.
  formatValue?: (n: number) => string;
}) {
  const fmt = formatValue ?? fmtMoney;
  // Merge by x
  const xs = Array.from(
    new Set(series.flatMap((s) => s.data.map((p) => p.x)))
  ).sort();
  const merged = xs.map((x) => {
    const row: Record<string, any> = { x };
    for (const s of series) {
      const p = s.data.find((d) => d.x === x);
      row[s.key] = p ? p.y : null;
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
          <CartesianGrid stroke="#F0F1F3" strokeDasharray="2 5" vertical={false} />
          <XAxis
            dataKey="x"
            stroke="#ECEEF1"
            tick={{ fill: '#9AA1AC', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (xType === 'date' ? format(new Date(v), 'MMM d') : v)}
            tickMargin={10}
          />
          <YAxis stroke="#ECEEF1" tick={{ fill: '#9AA1AC', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} tickMargin={8} width={48} />
          <Tooltip
            content={(props: any) => {
              const { active, payload, label } = props;
              if (!active || !payload?.length) return null;
              // Sort entries by value descending so leaders appear at the top.
              const items = [...payload]
                .filter((p: any) => p.value != null)
                .sort((a: any, b: any) => (b.value as number) - (a.value as number));
              const labelText = xType === 'date' ? format(new Date(label), 'MMM d, yyyy') : String(label);
              return (
                <div style={{ background: 'white', border: '1px solid #ECEEF1', borderRadius: 10, padding: '9px 12px', fontSize: 12, boxShadow: '0 4px 14px rgba(31,41,55,0.08)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 5, color: '#1F2937' }}>{labelText}</div>
                  {items.map((p: any) => (
                    <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: p.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: '#0F1419' }}>{p.name}</span>
                      <span style={{ fontWeight: 600, color: '#0F1419', tabularNums: true } as any}>{typeof p.value === 'number' ? fmt(p.value) : p.value}</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#6B7280', paddingTop: 6 }} iconType="plainline" />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={1.75}
              strokeDasharray={s.dashed ? '4 4' : undefined}
              dot={showDots ? { r: 2.5, strokeWidth: 0, fill: s.color } : false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
    </ResponsiveContainer>
  );
}
