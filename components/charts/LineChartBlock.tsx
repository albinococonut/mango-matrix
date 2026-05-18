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
}: {
  height?: number;
  series: LineSeries[];
  xType?: 'date' | 'category';
}) {
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
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
          <CartesianGrid stroke="#E6E8EC" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x"
            stroke="#5B6471"
            fontSize={11}
            tickFormatter={(v) => (xType === 'date' ? format(new Date(v), 'MMM d') : v)}
            tickMargin={8}
          />
          <YAxis stroke="#5B6471" fontSize={11} tickFormatter={fmtMoney} tickMargin={6} />
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
                <div style={{ background: 'white', border: '1px solid #E6E8EC', borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 8px rgba(15,20,25,0.08)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{labelText}</div>
                  {items.map((p: any) => (
                    <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: p.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: '#0F1419' }}>{p.name}</span>
                      <span style={{ fontWeight: 600, color: '#0F1419', tabularNums: true } as any}>{typeof p.value === 'number' ? fmtMoney(p.value) : p.value}</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '4 4' : undefined}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
