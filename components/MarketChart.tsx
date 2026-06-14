"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PricePoint } from "@/lib/types";

export type ChartMode = "line" | "candles";
export type ChartTimeframe = "1m" | "5m";

interface Candle { timestamp: number; open: number; high: number; low: number; close: number }

function pathFor(values: number[], width: number, height: number, min: number, max: number) {
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function aggregate(points: PricePoint[], timeframe: ChartTimeframe): Candle[] {
  const bucketMs = timeframe === "1m" ? 60_000 : 300_000;
  const buckets = new Map<number, number[]>();
  for (const point of points) {
    const bucket = Math.floor(point.timestamp / bucketMs) * bucketMs;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), point.sol]);
  }
  return [...buckets.entries()].map(([timestamp, prices]) => ({
    timestamp,
    open: prices[0] ?? 0,
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices.at(-1) ?? 0,
  }));
}

export function MarketChart({ points, mode, timeframe }: { points: PricePoint[]; mode: ChartMode; timeframe: ChartTimeframe }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 330 });

  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    const pad = 24;
    const width = Math.max(10, size.width - pad * 2);
    const height = Math.max(10, size.height - pad * 2);
    const candles = aggregate(points, timeframe);
    const solValues = points.map((point) => point.sol);
    const btcValues = points.map((point) => point.btc);
    const min = Math.min(...solValues, ...candles.map((candle) => candle.low));
    const max = Math.max(...solValues, ...candles.map((candle) => candle.high));
    const btcMin = Math.min(...btcValues);
    const btcMax = Math.max(...btcValues);
    return { sol: pathFor(solValues, width, height, min, max), btc: pathFor(btcValues, width, height, btcMin, btcMax), candles, min, max, width, height, pad };
  }, [points, size, timeframe]);

  const y = (value: number) => chart.height - ((value - chart.min) / (chart.max - chart.min || 1)) * chart.height;
  const candleWidth = Math.max(4, Math.min(18, chart.width / Math.max(1, chart.candles.length) * .55));

  return (
    <div className="chart-wrap" ref={wrap}>
      <div className="chart-grid" />
      {points.length < 2 ? <div className="chart-shimmer" /> : null}
      <svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none">
        <defs><linearGradient id="sol-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16e6d0" stopOpacity=".25" /><stop offset="100%" stopColor="#16e6d0" stopOpacity="0" /></linearGradient></defs>
        <g transform={`translate(${chart.pad} ${chart.pad})`}>
          <path d={chart.btc} fill="none" stroke="#9b6cff" strokeWidth="1.5" opacity=".55" strokeDasharray="5 6" />
          {mode === "line" ? <>
            <path d={`${chart.sol} L ${chart.width} ${chart.height} L 0 ${chart.height} Z`} fill="url(#sol-fill)" />
            <path d={chart.sol} fill="none" stroke="#16e6d0" strokeWidth="2.2" />
          </> : chart.candles.map((candle, index) => {
            const x = (index + .5) * (chart.width / Math.max(1, chart.candles.length));
            const up = candle.close >= candle.open;
            return <g key={candle.timestamp} className="candle"><line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={up ? "#35f2a0" : "#ff5576"} /><rect x={x - candleWidth / 2} y={Math.min(y(candle.open), y(candle.close))} width={candleWidth} height={Math.max(2, Math.abs(y(candle.open) - y(candle.close)))} fill={up ? "#35f2a0" : "#ff5576"} rx="1" /></g>;
          })}
        </g>
      </svg>
    </div>
  );
}
