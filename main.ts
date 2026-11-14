// btc-cent-forecast-01 entry.
//
// I/O contract:
//   Reads every "<id>.in" file in MAKEFUN_INPUT_DIR (default "/input"),
//   sorted by filename. Each file is one canonical JSON case:
//     {"schema":"makefun/btc-cent-case/v1","competition","case","at",
//      "horizon_minutes",
//      "markets":[{"id","name","start","prices"}]}
//   where "prices" is one close per minute, in USD per whole BTC, from
//   "start" through "at" inclusive, so the final element is the close at
//   the checkpoint. Exactly one market is expected.
//   Writes "<id>.out" to MAKEFUN_OUTPUT_DIR (default "/output") with
//   exactly {"forecasts":[{"case":"<id>","price":<number>}]} plus a
//   trailing newline.
//
// Forecast (final, with drift term):
//   Let L be the last close, M the mean of the last W closes (W =
//   max(2, horizon)), and D the median of the horizon-length price
//   changes over the last 2,880 minutes: for each index t from
//   max(horizon, len - 12*horizon) to len - 1, the change is
//   close[t] - close[t - horizon]; if there is no such change, D = 0.
//   If the series holds fewer than two prices, the forecast is simply
//   the last close. Otherwise:
//     guess = 0.85 * L + 0.15 * M + 0.25 * D
//   The guess is clamped into (0, 10,000,000) and snapped to the
//   5-decimal grid before it is written out.
//
// Runs offline, deterministic, and fast. Node 22, standard library only.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";

const MIN_PRICE = 0.00001;
const MAX_PRICE = 9_999_999.99999;

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

function clampToGrid(value: number): number {
  const bounded = Math.min(MAX_PRICE, Math.max(MIN_PRICE, value));
  return Math.round(bounded * 1e5) / 1e5;
}

function mean(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[mid];
  return (ordered[mid - 1] + ordered[mid]) / 2;
}

function forecastOne(prices: number[], horizon: number): number {
  const last = prices[prices.length - 1];
  if (prices.length < 2) return clampToGrid(last);
  const window = Math.max(2, horizon);
  const recent = prices.slice(-window);
  const avg = mean(recent);
  const firstT = Math.max(horizon, prices.length - 12 * horizon);
  const changes: number[] = [];
  for (let t = firstT; t < prices.length; t++) {
    changes.push(prices[t] - prices[t - horizon]);
  }
  const drift = median(changes);
  const guess = 0.85 * last + 0.15 * avg + 0.25 * drift;
  return clampToGrid(guess);
}

function processCase(fileName: string): void {
  const raw = readFileSync(join(inputDir, fileName), "utf8");
  const parsed = JSON.parse(raw) as {
    case: string;
    horizon_minutes?: number;
    markets: Array<{ prices: number[] }>;
  };
  if (!Array.isArray(parsed.markets) || parsed.markets.length !== 1) {
    throw new Error(`${fileName}: expected exactly one market`);
  }
  const prices = parsed.markets[0].prices;
  if (!Array.isArray(prices) || prices.length === 0) {
    throw new Error(`${fileName}: case has no prices`);
  }
  const last = prices[prices.length - 1];
  if (!Number.isFinite(last)) {
    throw new Error(`${fileName}: last price is not finite`);
  }
  const horizon =
    typeof parsed.horizon_minutes === "number" &&
    Number.isFinite(parsed.horizon_minutes) &&
    parsed.horizon_minutes > 0
      ? parsed.horizon_minutes
      : 240;
  const price = forecastOne(prices, horizon);
  const caseId = parsed.case ?? basename(fileName, ".in");
  const out = { forecasts: [{ case: caseId, price }] };
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, `${basename(fileName, ".in")}.out`),
    JSON.stringify(out) + "\n",
    "utf8",
  );
}

function main(): void {
  const names = readdirSync(inputDir)
    .filter((n) => extname(n) === ".in")
    .sort();
  for (const name of names) processCase(name);
}

main();
