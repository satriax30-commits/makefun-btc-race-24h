// BTC trend rider: long-only EMA(8)/EMA(21) crossover bot for CBBTC/USDC,
// agent-fun/bars-replay/v1. One position at a time, full equity on entry,
// filtered entries to dodge chop, fast exits to bank a rally and cut losers.
//
// Entry (all must hold on a bar's close, filled at the next open):
//   - EMA(8) crosses above EMA(21), close sits above EMA(21),
//   - the EMA gap is wider than 0.03% of price (not a flat-line touch),
//   - the 24-bar return is above +0.10% (momentum is really pointing up),
//   - 60-bar log-return volatility is not spiking above 30 bps/min,
//   - at least 15 bars have passed since the last exit (whipsaw cooldown).
// Exit (sell the whole position) on the first of:
//   - EMA(8) crosses back below EMA(21),
//   - trailing stop: close falls 0.70% from the highest close since entry,
//   - stop-loss: position value drops to 98.5% of its cost,
//   - take-profit: position value reaches 105% of its cost.
// No orders during warm-up, none on a batch with no CBBTC bar, and no
// randomness anywhere: every decision is a pure function of the bars seen.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FAST_SPAN = 8;
const SLOW_SPAN = 21;
const RETURN_LOOKBACK = 24;
const VOL_LOOKBACK = 60;
const MAX_SLIPPAGE_BPS = 100;
const COOLDOWN_BARS = 10;

// Entry filters, as fractions of price / return.
const MIN_GAP_FRACTION = 0.0003; // EMA gap must exceed 0.03% of close
const MIN_RETURN_24 = 0.0005; // 24-bar return must exceed +0.05%
const MAX_VOL_PER_MIN = 0.003; // skip entries when 60-bar vol tops 30 bps/min

// Exit levels, as fractions.
const TRAIL_FRACTION = 0.012; // 1.20% below the peak close since entry
const STOP_FRACTION = 0.985; // position value at 98.5% of cost
const TAKE_FRACTION = 1.08; // position value at 108% of cost

interface EmaTracker {
  span: number;
  seed: number[];
  value: number | null;
}

function emaStep(t: EmaTracker, close: number): void {
  if (t.value !== null) {
    t.value += (2 / (t.span + 1)) * (close - t.value);
    return;
  }
  t.seed.push(close);
  if (t.seed.length === t.span) {
    let sum = 0;
    for (const x of t.seed) sum += x;
    t.value = sum / t.span;
  }
}

const fast: EmaTracker = { span: FAST_SPAN, seed: [], value: null };
const slow: EmaTracker = { span: SLOW_SPAN, seed: [], value: null };
const closes: number[] = [];
const logReturns: number[] = [];

let prevGap: number | null = null;
let peakSinceEntry = 0;
let barsSinceExit = COOLDOWN_BARS; // start cool: first entry needs no wait
let holding = false;

function std(values: number[]): number {
  if (values.length < 2) return 0;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return Math.sqrt(sq / (values.length - 1));
}

await runBars({
  onBatch(state: BarsState, batch) {
    // Only the bar this batch actually carries counts: a missing CBBTC bar
    // means no new close, so no indicator step and no order this minute.
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];

    const close = Number(bar.c);
    const prevClose = closes.length > 0 ? closes[closes.length - 1] : null;
    closes.push(close);
    if (prevClose !== null && prevClose > 0 && close > 0) {
      logReturns.push(Math.log(close / prevClose));
      if (logReturns.length > VOL_LOOKBACK) logReturns.shift();
    }

    emaStep(fast, close);
    emaStep(slow, close);
    const gap = fast.value !== null && slow.value !== null ? fast.value - slow.value : null;
    const crossedUp = prevGap !== null && gap !== null && prevGap <= 0 && gap > 0;
    const crossedDown = prevGap !== null && gap !== null && prevGap >= 0 && gap < 0;
    prevGap = gap;

    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    holding = held !== undefined && BigInt(held.qty) > 0n;

    // Track the peak close while holding, for the trailing stop.
    if (holding) {
      if (close > peakSinceEntry) peakSinceEntry = close;
    } else if (barsSinceExit < COOLDOWN_BARS) {
      barsSinceExit += 1;
    }

    const orders: (BuyInput | SellInput)[] = [];

    if (holding && held !== undefined) {
      const value = state.value(SYMBOL, BigInt(held.qty));
      const cost = BigInt(held.cost);
      const trailingHit = peakSinceEntry > 0 && close <= peakSinceEntry * (1 - TRAIL_FRACTION);
      const stopHit = cost > 0n && value * 1000n <= cost * 985n; // value <= 98.5% of cost
      const takeHit = cost > 0n && value * 100n >= cost * 108n; // value >= 108% of cost
      if (crossedDown || trailingHit || stopHit || takeHit) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: BigInt(held.qty), max_slippage_bps: MAX_SLIPPAGE_BPS });
        barsSinceExit = 0;
        peakSinceEntry = 0;
      }
      return orders;
    }

    // Flat: look for a filtered entry. Only a fresh cross-up triggers; a
    // trend that is already running is not chased, the re-entry test showed
    // chasing it whipsaws through chop and pays the round trip over and over.
    if (barsSinceExit < COOLDOWN_BARS) return [];
    if (!crossedUp || gap === null || slow.value === null) return [];
    if (close <= slow.value) return [];
    if (gap <= close * MIN_GAP_FRACTION) return [];
    if (closes.length <= RETURN_LOOKBACK) return [];
    const ret24 = close / closes[closes.length - 1 - RETURN_LOOKBACK] - 1;
    if (ret24 <= MIN_RETURN_24) return [];
    if (std(logReturns) > MAX_VOL_PER_MIN) return [];

    let notional = state.cash;
    const room = state.weightRoom(SYMBOL);
    if (room < notional) notional = room;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    peakSinceEntry = close;
    orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS });
    return orders;
  },
});
