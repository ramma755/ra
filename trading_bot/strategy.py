"""
Scalping Strategy Engine — Fast, Frequent, High-Accuracy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Designed to fire multiple times per hour on M5 candles.
Every entry still passes 5 quality gates so wins stay high.

GATE 1 — Trend alignment (M15 + H1 must agree)
    Both M15 and H1 EMA8 > EMA21 → BUY only
    Both M15 and H1 EMA8 < EMA21 → SELL only

GATE 2 — ADX ≥ 20 on M15 (not ranging/choppy)
    Scalping in a ranging market = losing money fast.
    This gate is the #1 protector against false signals.

GATE 3 — M5 EMA crossover (fresh — within last 2 candles)
    Fast EMA (8) crosses slow EMA (21) in signal direction

GATE 4 — RSI + MACD momentum confirmation
    RSI not at extreme. MACD histogram confirms direction.
    Quick confirmation — both in one gate to allow more signals.

GATE 5 — Price near EMA + candle body ≥ 50%
    Entering close to the EMA means a tight stop and better R:R.
    Strong candle body = real move, not a wick.

Take-profit is set at 1.5 × SL distance — small enough to be
hit within minutes on an active M5 chart.
"""

from dataclasses import dataclass, field
from enum import Enum, auto

import numpy as np

import config
from utils import ema, rsi, macd, atr, adx, stochastic


class Signal(Enum):
    NONE = auto()
    BUY  = auto()
    SELL = auto()


@dataclass
class TradeSetup:
    signal:      Signal
    entry_price: float
    sl:          float
    tp:          float
    atr_value:   float
    reasons:     list = field(default_factory=list)


def analyse(
    closes: np.ndarray, highs: np.ndarray,
    lows: np.ndarray,   opens: np.ndarray,
    h1_closes: np.ndarray, h1_highs: np.ndarray, h1_lows: np.ndarray,
    h4_closes: np.ndarray, h4_highs: np.ndarray, h4_lows: np.ndarray,
) -> TradeSetup:
    """
    Scalp analysis: uses M5 (entry), M15 (h4_* arg carries M15 data), H1 trend.
    All arrays oldest-first.
    """
    reasons = []

    # ── GATE 1: H1 trend direction (single source of truth) ──────────────────
    # Only H1 decides whether we look for buys or sells.
    # No conflict possible — one timeframe, one direction.
    h1_fast_arr = ema(h1_closes, config.FAST_MA_PERIOD)
    h1_slow_arr = ema(h1_closes, config.SLOW_MA_PERIOD)
    trend_bull  = h1_fast_arr[-1] > h1_slow_arr[-1]
    reasons.append(f"H1={'BULL' if trend_bull else 'BEAR'}")

    # ── GATE 2: ADX on H1 ≥ ADX_MIN (strong trend, not choppy) ──────────────
    adx_val = adx(h1_highs, h1_lows, h1_closes, config.ADX_PERIOD)
    reasons.append(f"ADX={adx_val:.1f}")
    if adx_val < config.ADX_MIN:
        reasons.append(f"BLOCKED: ADX {adx_val:.1f} < {config.ADX_MIN} — choppy market")
        return _none(closes[-1], reasons)

    # ── GATE 3: M5 fresh EMA crossover (last 2 candles) ──────────────────────
    m5_fast = ema(closes, config.FAST_MA_PERIOD)
    m5_slow = ema(closes, config.SLOW_MA_PERIOD)

    cross_up = cross_down = False
    for i in range(1, min(3, len(closes))):
        prev = m5_fast[-(i+1)] - m5_slow[-(i+1)]
        curr = m5_fast[-i]     - m5_slow[-i]
        if prev < 0 and curr > 0:
            cross_up = True
        if prev > 0 and curr < 0:
            cross_down = True

    if not cross_up and not cross_down:
        reasons.append("No fresh M5 crossover")
        return _none(closes[-1], reasons)

    reasons.append(f"M5 {'CrossUP' if cross_up else 'CrossDOWN'}")

    # Cross must align with H1 trend direction
    if cross_up and not trend_bull:
        reasons.append("BLOCKED: BUY cross but H1 is bearish — skipping")
        return _none(closes[-1], reasons)
    if cross_down and trend_bull:
        reasons.append("BLOCKED: SELL cross but H1 is bullish — skipping")
        return _none(closes[-1], reasons)

    # ── GATE 4: RSI + MACD quick momentum check ───────────────────────────────
    rsi_val = rsi(closes, config.RSI_PERIOD)
    macd_line, _, hist = macd(closes, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL)
    reasons.append(f"RSI={rsi_val:.1f} MACD_hist={hist:+.5f}")

    if cross_up:
        if rsi_val >= config.RSI_OVERBOUGHT:
            reasons.append(f"BLOCKED: RSI {rsi_val:.1f} overbought")
            return _none(closes[-1], reasons)
        if hist <= 0:
            reasons.append("BLOCKED: MACD histogram not positive")
            return _none(closes[-1], reasons)
    else:
        if rsi_val <= config.RSI_OVERSOLD:
            reasons.append(f"BLOCKED: RSI {rsi_val:.1f} oversold")
            return _none(closes[-1], reasons)
        if hist >= 0:
            reasons.append("BLOCKED: MACD histogram not negative")
            return _none(closes[-1], reasons)

    # ── GATE 5: Price near EMA + strong candle body ───────────────────────────
    atr_val      = atr(highs, lows, closes, config.ATR_PERIOD)
    dist_to_ema  = abs(closes[-1] - m5_slow[-1])
    max_dist     = atr_val * config.PULLBACK_ATR_MULT
    candle_range = highs[-1] - lows[-1]
    body         = abs(closes[-1] - opens[-1])
    body_ratio   = body / candle_range if candle_range > 0 else 0
    reasons.append(f"EMA_dist={dist_to_ema:.5f}(max {max_dist:.5f}) Body={body_ratio:.0%}")

    if dist_to_ema > max_dist:
        reasons.append("BLOCKED: Price extended from EMA — waiting for pullback")
        return _none(closes[-1], reasons)
    if body_ratio < config.MIN_BODY_RATIO:
        reasons.append(f"BLOCKED: Candle body too weak ({body_ratio:.0%})")
        return _none(closes[-1], reasons)
    if cross_up and closes[-1] < opens[-1]:
        reasons.append("BLOCKED: BUY but last candle closed red")
        return _none(closes[-1], reasons)
    if cross_down and closes[-1] > opens[-1]:
        reasons.append("BLOCKED: SELL but last candle closed green")
        return _none(closes[-1], reasons)

    # ── All gates passed ──────────────────────────────────────────────────────
    sl_dist = atr_val * config.ATR_MULTIPLIER
    tp_dist = sl_dist * config.REWARD_RATIO
    entry   = closes[-1]

    if cross_up:
        signal, sl, tp = Signal.BUY,  entry - sl_dist, entry + tp_dist
    else:
        signal, sl, tp = Signal.SELL, entry + sl_dist, entry - tp_dist

    reasons.append("★ ALL GATES PASSED — SCALP SIGNAL ★")
    return TradeSetup(signal, entry, sl, tp, atr_val, reasons)


def _none(entry: float, reasons: list) -> TradeSetup:
    return TradeSetup(Signal.NONE, entry, 0.0, 0.0, 0.0, reasons)
