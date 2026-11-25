import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { HistoryResponse, Thresholds } from '../shared/types';
import { THRESHOLD_COLORS } from '../lib/format';

interface Props {
  history: HistoryResponse;
  showFlow: boolean;
  showForecast: boolean;
  theme: 'dark' | 'light';
  height?: number;
}

function bands(t: Thresholds | null, top: number) {
  if (!t) return [];
  const levels: [keyof typeof THRESHOLD_COLORS, number | undefined][] = [
    ['action', t.action],
    ['minor', t.minor],
    ['moderate', t.moderate],
    ['major', t.major],
  ];
  const defined = levels.filter((l): l is [keyof typeof THRESHOLD_COLORS, number] => l[1] !== undefined);
  return defined.map(([name, v], i) => {
    const upper = defined[i + 1]?.[1] ?? Math.max(top, v + 1);
    return [
      { yAxis: v, itemStyle: { color: THRESHOLD_COLORS[name], opacity: 0.13 }, name: name[0].toUpperCase() + name.slice(1) },
      { yAxis: upper },
    ];
  });
}

export default function HistoryChart({ history, showFlow, showForecast, theme, height = 260 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    chart.current = echarts.init(ref.current!, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const text = theme === 'dark' ? '#8ea0b8' : '#4b5d77';
    const grid = theme === 'dark' ? 'rgba(120,160,210,0.10)' : 'rgba(30,60,100,0.10)';
    const now = Date.now();
    const from = now - history.rangeHours * 3600_000;
    const stage = history.stage?.points.filter((p) => p.t >= from) ?? [];
    const fc = showForecast ? (history.forecast?.points ?? []) : [];
    const flow = showFlow ? (history.flow?.points.filter((p) => p.t >= from) ?? []) : [];
    const vals = [...stage.map((p) => p.v), ...fc.map((p) => p.v)];
    const t = history.thresholds;
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 1;
    // Bring the nearest official threshold into view when it is close to the data.
    const thr = [t?.action, t?.minor, t?.moderate, t?.major].filter((x): x is number => x !== undefined);
    for (const v of thr) if (v > hi && v - hi < Math.max(2.5, (hi - lo) * 1.2)) hi = v;
    for (const v of thr) if (v < lo && lo - v < 1.5) lo = v;
    const pad = Math.max(0.15, (hi - lo) * 0.08);
    const yMin = +(lo - pad).toFixed(2);
    const yMax = +(hi + pad).toFixed(2);
    const xMax = fc.length ? Math.max(now, fc[fc.length - 1].t) : now;

    c.setOption(
      {
        animationDuration: 400,
        backgroundColor: 'transparent',
        textStyle: { fontFamily: 'Inter, Segoe UI, system-ui, sans-serif' },
        grid: { left: 46, right: showFlow && flow.length ? 54 : 14, top: 28, bottom: 52 },
        legend: { top: 0, right: 4, textStyle: { color: text, fontSize: 10.5 }, itemWidth: 14, itemHeight: 8 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: theme === 'dark' ? 'rgba(14,22,38,0.95)' : 'rgba(255,255,255,0.97)',
          borderColor: 'rgba(120,160,210,0.3)',
          textStyle: { color: theme === 'dark' ? '#e6edf7' : '#0f1b2d', fontSize: 12 },
          valueFormatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : String(v)),
        },
        xAxis: {
          type: 'time',
          min: from,
          max: xMax,
          axisLine: { lineStyle: { color: grid } },
          axisLabel: { color: text, fontSize: 10.5, hideOverlap: true },
          splitLine: { show: false },
        },
        yAxis: [
          {
            type: 'value',
            name: 'ft',
            min: yMin,
            max: yMax,
            nameTextStyle: { color: text, fontSize: 10 },
            axisLabel: { color: text, fontSize: 10.5, formatter: (v: number) => v.toFixed(1) },
            splitLine: { lineStyle: { color: grid } },
          },
          {
            type: 'value',
            name: 'cfs',
            show: showFlow && flow.length > 0,
            nameTextStyle: { color: text, fontSize: 10 },
            axisLabel: { color: text, fontSize: 10, formatter: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)) },
            splitLine: { show: false },
            scale: true,
          },
        ],
        dataZoom: [
          { type: 'inside', xAxisIndex: 0 },
          { type: 'slider', xAxisIndex: 0, height: 16, bottom: 8, borderColor: 'transparent', textStyle: { color: text, fontSize: 9 }, fillerColor: 'rgba(34,211,238,0.15)', handleStyle: { color: '#22d3ee' } },
        ],
        series: [
          {
            name: `Observed stage${history.stage ? ` (${history.stage.datum})` : ''}`,
            type: 'line',
            showSymbol: false,
            sampling: 'lttb',
            data: stage.map((p) => [p.t, p.v]),
            lineStyle: { width: 2, color: '#22d3ee' },
            itemStyle: { color: '#22d3ee' },
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(34,211,238,0.28)' }, { offset: 1, color: 'rgba(34,211,238,0)' }]) },
            markArea: { silent: true, label: { show: true, position: 'insideTopLeft', color: text, fontSize: 9.5 }, data: bands(t, yMax) as any },
            markLine: {
              silent: true,
              symbol: 'none',
              label: { color: text, fontSize: 9.5, formatter: (d: any) => d.name },
              data: [
                { xAxis: now, name: 'now', lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 } },
                ...thr.map((v, i) => ({ yAxis: v, name: '', lineStyle: { color: Object.values(THRESHOLD_COLORS)[i] ?? '#999', width: 1, type: 'solid', opacity: 0.6 } })),
              ],
            },
            z: 3,
          },
          ...(fc.length
            ? [
                {
                  name: 'Official NWS forecast',
                  type: 'line',
                  showSymbol: true,
                  symbolSize: 4,
                  data: fc.map((p) => [p.t, p.v]),
                  lineStyle: { width: 2, type: 'dashed', color: '#c084fc' },
                  itemStyle: { color: '#c084fc' },
                  z: 4,
                },
              ]
            : []),
          ...(flow.length
            ? [
                {
                  name: 'Discharge (cfs)',
                  type: 'line',
                  yAxisIndex: 1,
                  showSymbol: false,
                  sampling: 'lttb',
                  data: flow.map((p) => [p.t, p.v]),
                  lineStyle: { width: 1.4, color: '#60a5fa', opacity: 0.8 },
                  itemStyle: { color: '#60a5fa' },
                  z: 2,
                },
              ]
            : []),
        ],
      },
      { notMerge: true },
    );
  }, [history, showFlow, showForecast, theme]);

  return <div ref={ref} style={{ height }} className="w-full" role="img" aria-label="Water level chart with flood stage bands" />;
}
