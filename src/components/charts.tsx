'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { CHART_COLORS, SERIES_PALETTE } from './ui';
import { compactNumber, money, moneyAxis } from '@/lib/format';

const AXIS = { stroke: 'rgba(255,255,255,0.10)', tickLine: false, axisLine: false } as const;

/**
 * Axis gutters. These were previously pulled negative to save space, which
 * clipped the left-hand tick labels ("$1,200.00" rendering as "0.00"). Keep a
 * real gutter and give each axis enough width for its widest formatted tick.
 */
const M = { top: 6, right: 10, left: 0, bottom: 0 } as const;
const W_NUM = 46; // "1.5B"
const W_MONEY = 52; // "$2.5k"

function Tip({ active, payload, label, kind }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="mb-1 font-medium text-ink">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink3">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color ?? p.fill }} />
            {p.name}
          </span>
          <span className="mono text-ink">
            {kind === 'money' ? money(p.value) : compactNumber(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface TokenPoint {
  bucket: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

export function TokenVolumeChart({ data, height = 220 }: { data: TokenPoint[]; height?: number }) {
  const series = [
    { key: 'input', name: 'Input', color: CHART_COLORS.input },
    { key: 'output', name: 'Output', color: CHART_COLORS.output },
    { key: 'cacheRead', name: 'Cache read', color: CHART_COLORS.cacheRead },
    { key: 'cacheWrite', name: 'Cache write', color: CHART_COLORS.cacheWrite },
    { key: 'reasoning', name: 'Reasoning', color: CHART_COLORS.reasoning },
  ];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={M}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.06} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="bucket" {...AXIS} minTickGap={28} />
        <YAxis {...AXIS} tickFormatter={(v) => compactNumber(v, 0)} width={W_NUM} />
        <Tooltip content={<Tip />} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stackId="1"
            stroke={s.color}
            strokeWidth={1}
            fill={`url(#g-${s.key})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CostBarsChart({
  data,
  height = 220,
  budgetLine,
}: {
  data: Array<{ bucket: string; api: number; cash: number }>;
  height?: number;
  budgetLine?: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={M}>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="bucket" {...AXIS} minTickGap={28} />
        <YAxis {...AXIS} tickFormatter={(v) => moneyAxis(v)} width={W_MONEY} />
        <Tooltip content={<Tip kind="money" />} />
        <Bar dataKey="api" name="API equivalent" fill={CHART_COLORS.input} radius={[2, 2, 0, 0]} maxBarSize={22} />
        <Bar dataKey="cash" name="Allocated cash" fill={CHART_COLORS.output} radius={[2, 2, 0, 0]} maxBarSize={22} />
        {budgetLine != null && budgetLine > 0 && (
          <ReferenceLine
            y={budgetLine}
            stroke="var(--warn)"
            strokeDasharray="4 4"
            label={{ value: 'Budget', fill: 'var(--warn)', fontSize: 10, position: 'right' }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CumulativeChart({
  data,
  breakEvenDate,
  height = 240,
}: {
  data: Array<{ date: string; cumCost: number; cumValue: number }>;
  breakEvenDate?: string | null;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={M}>
        <defs>
          <linearGradient id="cumValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.value} stopOpacity={0.4} />
            <stop offset="100%" stopColor={CHART_COLORS.value} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="cumCost" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F87171" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#F87171" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="date" {...AXIS} minTickGap={34} />
        <YAxis {...AXIS} tickFormatter={(v) => moneyAxis(v)} width={W_MONEY} />
        <Tooltip content={<Tip kind="money" />} />
        <Area type="monotone" dataKey="cumValue" name="Cumulative value" stroke={CHART_COLORS.value} strokeWidth={1.4} fill="url(#cumValue)" />
        <Area type="monotone" dataKey="cumCost" name="Cumulative AI cost" stroke="#F87171" strokeWidth={1.4} fill="url(#cumCost)" />
        {breakEvenDate && (
          <ReferenceLine
            x={breakEvenDate}
            stroke="var(--warn)"
            strokeDasharray="4 4"
            label={{ value: 'Break-even', fill: 'var(--warn)', fontSize: 10, position: 'insideTopRight' }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface ScatterPoint {
  name: string;
  cost: number;
  value: number;
  tokens: number;
}

export function CostValueScatter({
  data,
  height = 280,
  quadrants = true,
}: {
  data: ScatterPoint[];
  height?: number;
  quadrants?: boolean;
}) {
  const medCost = median(data.map((d) => d.cost));
  const medValue = median(data.map((d) => d.value));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ ...M, bottom: 4 }}>
        <CartesianGrid strokeDasharray="2 4" />
        <XAxis type="number" dataKey="cost" name="AI cost" {...AXIS} tickFormatter={(v) => moneyAxis(v)} />
        <YAxis type="number" dataKey="value" name="Project value" {...AXIS} tickFormatter={(v) => moneyAxis(v)} width={W_MONEY} />
        <ZAxis type="number" dataKey="tokens" range={[40, 420]} name="Tokens" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as ScatterPoint;
            return (
              <div className="chart-tip">
                <div className="mb-1 font-medium text-ink">{d.name}</div>
                <Row label="AI cost" value={money(d.cost)} />
                <Row label="Project value" value={money(d.value)} />
                <Row label="Tokens" value={compactNumber(d.tokens)} />
              </div>
            );
          }}
        />
        {quadrants && medCost > 0 && <ReferenceLine x={medCost} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" />}
        {quadrants && medValue > 0 && <ReferenceLine y={medValue} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" />}
        <Scatter data={data} name="Projects">
          {data.map((d, i) => (
            <Cell key={i} fill={SERIES_PALETTE[i % SERIES_PALETTE.length]} fillOpacity={0.75} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-ink3">{label}</span>
      <span className="mono text-ink">{value}</span>
    </div>
  );
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function HorizontalBars({
  data,
  height = 240,
  kind = 'money',
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
  kind?: 'money' | 'number';
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={(v) => (kind === 'money' ? moneyAxis(v) : compactNumber(v))} />
        <YAxis type="category" dataKey="name" {...AXIS} width={124} tick={{ fontSize: 10, fill: 'var(--ink-2)' }} />
        <Tooltip content={<Tip kind={kind} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="value" name="Value" radius={[0, 2, 2, 0]} maxBarSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={SERIES_PALETTE[i % SERIES_PALETTE.length]} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleLine({
  data,
  dataKey,
  height = 180,
  color = CHART_COLORS.output,
  kind = 'number',
}: {
  data: Array<Record<string, any>>;
  dataKey: string;
  height?: number;
  color?: string;
  kind?: 'money' | 'number';
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={M}>
        <CartesianGrid strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="bucket" {...AXIS} minTickGap={28} />
        <YAxis {...AXIS} width={50} tickFormatter={(v) => (kind === 'money' ? moneyAxis(v) : compactNumber(v, 0))} />
        <Tooltip content={<Tip kind={kind} />} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} name={dataKey} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
