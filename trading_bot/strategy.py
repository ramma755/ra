"""
Sharp Strategy Engine — Triple-Confirmation Entry

Every trade must pass ALL of the following gates before an order is placed:

Gate 1 — Higher-Timeframe Trend (H1)
    EMA9 > EMA21 on H1  →  only BUY signals allowed on M15
    EMA9 < EMA21 on H1  →  only SELL signals allowed on M15
    (Trading WITH the trend is the single biggest win-rate factor)

Gate 2 — M15 EMA Crossover
    Fast EMA (9) crosses above slow EMA (21)  →  potential BUY
    Fast EMA (9) crosses below slow EMA (21)  →  potential SELL

Gate 3 — MACD Momentum Confirmation
    MACD histogram must be positive for BUY
    MACD histogram must be negative for SELL
    (Confirms momentum is backing the crossover, not fading)

Gate 4 — RSI Confirmation (tighter bands)
    RSI must be < 60 for BUY  (not already overbought)
    RSI must be > 40 for SELL (not already oversold)

Gate 5 — Candle Body Confirmation
    The last closed candle must be bullish (close > open) for BUY
    The last closed candle must be bearish (close < open) for SELL
    (Avoids false wicks tricking the EMAs)

Stop-loss  : ATR(14) × ATR_MULTIPLIER placed beyond the signal candle
Take-profit: SL distance × REWARD_RATIO
"""

from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional

import numpy as np

import config
from utils import ema, rsi, macd, atr


class Signal(Enum):
    NONE = auto()
    BUY  = auto()
    SELL = auto()


@dataclass
class TradeSetup:
    signal:       Signal
    entry_price:  float
    sl:           float
    tp:           float
    atr_value:    float
    reasons:      list   # human-readable list of why this signal was triggered or blocked


def analyse(
    # M15 arrays (entry timeframe)
    closes: np.ndarray,
    highs:  np.ndarray,
    lows:   np.ndarray,
    opens:  np.ndarray,
    # H1 arrays (trend timeframe)
    h1_closes: np.ndarray,
    h1_highs:  np.ndarray,
    h1_lows:   np.ndarray,
) -> TradeSetup:
    """
    Full triple-confirmation analysis.
    All arrays must be sorted oldest-first.
    Returns a TradeSetup with signal=NONE if any gate fails.
    """
    reasons = []

    # ── Gate 1: H1 trend direction ────────────────────────────────────────────
    h1_fast = ema(h1_closes, config.FAST_MA_PERIOD)
    h1_slow = ema(h1_closes, config.SLOW_MA_PERIOD)
    h1_trend_bull = h1_fast[-1] > h1_slow[-1]
    trend_label = "H1 BULL" if h1_trend_bull else "H1 BEAR"
    reasons.append(f"Trend={trend_label}")

    # ── Gate 2: M15 EMA crossover ─────────────────────────────────────────────
    m15_fast = ema(closes, config.FAST_MA_PERIOD)
    m15_slow = ema(closes, config.SLOW_MA_PERIOD)
    prev_diff = m15_fast[-2] - m15_slow[-2]
    curr_diff = m15_fast[-1] - m15_slow[-1]

    cross_up   = prev_diff < 0 and curr_diff > 0
    cross_down = prev_diff > 0 and curr_diff < 0

    if not cross_up and not cross_down:
        reasons.append("No M15 crossover")
        return _no_signal(closes[-1], reasons)

    cross_label = "CrossUP" if cross_up else "CrossDOWN"
    reasons.append(f"M15 {cross_label}")

    # ── Gate 1+2 alignment check ──────────────────────────────────────────────
    if cross_up and not h1_trend_bull:
        reasons.append("BLOCKED: BUY signal but H1 trend is bearish")
        return _no_signal(closes[-1], reasons)
    if cross_down and h1_trend_bull:
        reasons.append("BLOCKED: SELL signal but H1 trend is bullish")
        return _no_signal(closes[-1], reasons)

    # ── Gate 3: MACD momentum ─────────────────────────────────────────────────
    macd_line, signal_line, hist = macd(
        closes, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL
    )
    reasons.append(f"MACD_hist={hist:+.5f}")

    if cross_up and hist <= 0:
        reasons.append("BLOCKED: BUY crossover but MACD histogram is negative (momentum not confirmed)")
        return _no_signal(closes[-1], reasons)
    if cross_down and hist >= 0:
        reasons.append("BLOCKED: SELL crossover but MACD histogram is positive (momentum not confirmed)")
        return _no_signal(closes[-1], reasons)

    # ── Gate 4: RSI filter ────────────────────────────────────────────────────
    rsi_val = rsi(closes, config.RSI_PERIOD)
    reasons.append(f"RSI={rsi_val:.1f}")

    if cross_up and rsi_val >= config.RSI_OVERBOUGHT:
        reasons.append(f"BLOCKED: RSI {rsi_val:.1f} ≥ {config.RSI_OVERBOUGHT} (overbought)")
        return _no_signal(closes[-1], reasons)
    if cross_down and rsi_val <= config.RSI_OVERSOLD:
        reasons.append(f"BLOCKED: RSI {rsi_val:.1f} ≤ {config.RSI_OVERSOLD} (oversold)")
        return _no_signal(closes[-1], reasons)

    # ── Gate 5: Candle body confirmation ──────────────────────────────────────
    last_bull = closes[-1] > opens[-1]
    last_bear = closes[-1] < opens[-1]

    if cross_up and not last_bull:
        reasons.append("BLOCKED: BUY crossover but last candle is bearish")
        return _no_signal(closes[-1], reasons)
    if cross_down and not last_bear:
        reasons.append("BLOCKED: SELL crossover but last candle is bullish")
        return _no_signal(closes[-1], reasons)

    # ── All gates passed — build setup ────────────────────────────────────────
    atr_val     = atr(highs, lows, closes, config.ATR_PERIOD)
    sl_dist     = atr_val * config.ATR_MULTIPLIER
    tp_dist     = sl_dist * config.REWARD_RATIO
    entry       = closes[-1]

    if cross_up:
        signal = Signal.BUY
        sl     = entry - sl_dist
        tp     = entry + tp_dist
    else:
        signal = Signal.SELL
        sl     = entry + sl_dist
        tp     = entry - tp_dist

    reasons.append("ALL GATES PASSED ✓")
    return TradeSetup(
        signal=signal,
        entry_price=entry,
        sl=sl,
        tp=tp,
        atr_value=atr_val,
        reasons=reasons,
    )


def _no_signal(entry: float, reasons: list) -> TradeSetup:
    return TradeSetup(
        signal=Signal.NONE,
        entry_price=entry,
        sl=0.0,
        tp=0.0,
        atr_value=0.0,
        reasons=reasons,
    )
