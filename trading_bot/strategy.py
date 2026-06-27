"""
Scalping Strategy — 5-Gate Entry System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GATE 1  H1 trend      EMA8 vs EMA21 on H1 sets the allowed direction
GATE 2  ADX ≥ 20      H1 ADX must confirm a real trend (not choppy)
GATE 3  M5 crossover  EMA8 crosses EMA21 on M5 in the trend direction
GATE 4  RSI + MACD    Momentum confirms the move
GATE 5  Pullback+Body Price near EMA, candle body ≥ 50%
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
    # M5 entry bars
    closes: np.ndarray, highs: np.ndarray,
    lows:   np.ndarray, opens: np.ndarray,
    # H1 trend bars
    h1_closes: np.ndarray, h1_highs: np.ndarray, h1_lows: np.ndarray,
) -> TradeSetup:
    reasons = []

    # ── GATE 1: H1 trend direction ────────────────────────────────────────────
    h1_fast = ema(h1_closes, config.FAST_MA_PERIOD)
    h1_slow = ema(h1_closes, config.SLOW_MA_PERIOD)
    trend_bull = bool(h1_fast[-1] > h1_slow[-1])
    reasons.append(f"H1={'BULL' if trend_bull else 'BEAR'}")

    # ── GATE 2: ADX on H1 ─────────────────────────────────────────────────────
    adx_val = adx(h1_highs, h1_lows, h1_closes, config.ADX_PERIOD)
    reasons.append(f"ADX={adx_val:.1f}")
    if adx_val < config.ADX_MIN:
        reasons.append(f"SKIP: ADX {adx_val:.1f} < {config.ADX_MIN} (choppy)")
        return _none(closes[-1], reasons)

    # ── GATE 3: Fresh M5 EMA crossover (within last 3 candles) ───────────────
    m5_fast = ema(closes, config.FAST_MA_PERIOD)
    m5_slow = ema(closes, config.SLOW_MA_PERIOD)

    cross_up = cross_down = False
    for i in range(1, min(4, len(closes))):
        prev = m5_fast[-(i + 1)] - m5_slow[-(i + 1)]
        curr = m5_fast[-i]       - m5_slow[-i]
        if prev < 0 and curr > 0:
            cross_up = True
        if prev > 0 and curr < 0:
            cross_down = True

    if not cross_up and not cross_down:
        reasons.append("SKIP: no fresh M5 crossover")
        return _none(closes[-1], reasons)

    reasons.append(f"M5 {'CrossUP' if cross_up else 'CrossDOWN'}")

    if cross_up and not trend_bull:
        reasons.append("SKIP: BUY cross but H1 is bearish")
        return _none(closes[-1], reasons)
    if cross_down and trend_bull:
        reasons.append("SKIP: SELL cross but H1 is bullish")
        return _none(closes[-1], reasons)

    # ── GATE 4: RSI + MACD momentum ───────────────────────────────────────────
    rsi_val              = rsi(closes, config.RSI_PERIOD)
    macd_line, _, hist   = macd(closes, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL)
    reasons.append(f"RSI={rsi_val:.1f} MACD={hist:+.5f}")

    if cross_up:
        if rsi_val >= config.RSI_OVERBOUGHT:
            reasons.append(f"SKIP: RSI {rsi_val:.1f} overbought")
            return _none(closes[-1], reasons)
        if hist <= 0:
            reasons.append("SKIP: MACD histogram not positive")
            return _none(closes[-1], reasons)
    else:
        if rsi_val <= config.RSI_OVERSOLD:
            reasons.append(f"SKIP: RSI {rsi_val:.1f} oversold")
            return _none(closes[-1], reasons)
        if hist >= 0:
            reasons.append("SKIP: MACD histogram not negative")
            return _none(closes[-1], reasons)

    # ── GATE 5: Pullback to EMA + candle body ─────────────────────────────────
    atr_val     = atr(highs, lows, closes, config.ATR_PERIOD)
    dist        = abs(closes[-1] - m5_slow[-1])
    max_dist    = atr_val * config.PULLBACK_ATR_MULT
    candle_rng  = highs[-1] - lows[-1]
    body        = abs(closes[-1] - opens[-1])
    body_ratio  = body / candle_rng if candle_rng > 0 else 0.0
    reasons.append(f"dist={dist:.5f}(max {max_dist:.5f}) body={body_ratio:.0%}")

    if dist > max_dist:
        reasons.append("SKIP: price too far from EMA — wait for pullback")
        return _none(closes[-1], reasons)
    if body_ratio < config.MIN_BODY_RATIO:
        reasons.append(f"SKIP: weak candle body ({body_ratio:.0%})")
        return _none(closes[-1], reasons)
    if cross_up and closes[-1] < opens[-1]:
        reasons.append("SKIP: BUY but last candle closed bearish")
        return _none(closes[-1], reasons)
    if cross_down and closes[-1] > opens[-1]:
        reasons.append("SKIP: SELL but last candle closed bullish")
        return _none(closes[-1], reasons)

    # ── All gates passed ──────────────────────────────────────────────────────
    sl_dist = atr_val * config.ATR_MULTIPLIER
    tp_dist = sl_dist * config.REWARD_RATIO
    entry   = closes[-1]

    if cross_up:
        signal, sl, tp = Signal.BUY,  entry - sl_dist, entry + tp_dist
    else:
        signal, sl, tp = Signal.SELL, entry + sl_dist, entry - tp_dist

    reasons.append("★ ALL GATES PASSED — ENTERING ★")
    return TradeSetup(signal, entry, sl, tp, atr_val, reasons)


def _none(entry: float, reasons: list) -> TradeSetup:
    return TradeSetup(Signal.NONE, entry, 0.0, 0.0, 0.0, reasons)
