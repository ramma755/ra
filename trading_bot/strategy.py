"""
High-Accuracy Strategy Engine — 7-Gate Entry System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every trade must pass ALL 7 gates. A single failure = no trade.
The bot trades less, but wins more.

GATE 1 — H4 Macro Trend (big-picture direction)
    EMA9 > EMA21 on H4 → only BUY setups considered
    EMA9 < EMA21 on H4 → only SELL setups considered

GATE 2 — H1 Intermediate Trend (structure confirmation)
    EMA9 > EMA21 on H1 → confirms H4 bull trend
    EMA9 < EMA21 on H1 → confirms H4 bear trend
    H4 and H1 must BOTH agree — triple timeframe alignment

GATE 3 — ADX Trend Strength
    ADX on H1 must be ≥ ADX_MIN (default 25)
    Below 25 = choppy, sideways market → skip (false signals in ranging markets)

GATE 4 — M15 EMA Crossover (entry timing signal)
    Fast EMA (9) crosses above slow EMA (21) → BUY candidate
    Fast EMA (9) crosses below slow EMA (21) → SELL candidate
    Crossover must have occurred within the last 3 candles (fresh signal only)

GATE 5 — MACD Double Confirmation
    Histogram must be positive (BUY) or negative (SELL)
    MACD LINE must also be on the correct side of zero
    Both conditions together = momentum fully committed to direction

GATE 6 — Stochastic + RSI combined
    For BUY:  Stochastic %K < 60 and rising, RSI < RSI_OVERBOUGHT (55)
    For SELL: Stochastic %K > 40 and falling, RSI > RSI_OVERSOLD  (45)

GATE 7 — Pullback to EMA + Strong Candle Body
    Price must have pulled back within PULLBACK_ATR_MULT × ATR of the slow EMA
    (entering at value, not chasing an extended move)
    Last candle body must be ≥ MIN_BODY_RATIO of the full candle range
    (real directional move, not a wick fake-out)

Stop-loss  = ATR(14) × ATR_MULTIPLIER beyond the signal candle low/high
Take-profit= SL distance × REWARD_RATIO
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
    # M15 — entry timeframe
    closes: np.ndarray,
    highs:  np.ndarray,
    lows:   np.ndarray,
    opens:  np.ndarray,
    # H1 — intermediate trend
    h1_closes: np.ndarray,
    h1_highs:  np.ndarray,
    h1_lows:   np.ndarray,
    # H4 — macro trend
    h4_closes: np.ndarray,
    h4_highs:  np.ndarray,
    h4_lows:   np.ndarray,
) -> TradeSetup:
    reasons = []

    # ── GATE 1: H4 macro trend ────────────────────────────────────────────────
    h4_fast = ema(h4_closes, config.FAST_MA_PERIOD)
    h4_slow = ema(h4_closes, config.SLOW_MA_PERIOD)
    h4_bull  = h4_fast[-1] > h4_slow[-1]
    reasons.append(f"H4={'BULL' if h4_bull else 'BEAR'}")

    # ── GATE 2: H1 intermediate trend ─────────────────────────────────────────
    h1_fast = ema(h1_closes, config.FAST_MA_PERIOD)
    h1_slow = ema(h1_closes, config.SLOW_MA_PERIOD)
    h1_bull  = h1_fast[-1] > h1_slow[-1]
    reasons.append(f"H1={'BULL' if h1_bull else 'BEAR'}")

    # Both timeframes must agree
    if h4_bull != h1_bull:
        reasons.append("BLOCKED: H4 and H1 trends conflict — no clear direction")
        return _none(closes[-1], reasons)

    trend_is_bull = h4_bull  # confirmed trend direction

    # ── GATE 3: ADX trend strength (H1) ──────────────────────────────────────
    adx_val = adx(h1_highs, h1_lows, h1_closes, config.ADX_PERIOD)
    reasons.append(f"ADX={adx_val:.1f}")
    if adx_val < config.ADX_MIN:
        reasons.append(f"BLOCKED: ADX {adx_val:.1f} < {config.ADX_MIN} — market is choppy/ranging")
        return _none(closes[-1], reasons)

    # ── GATE 4: M15 EMA crossover (must be fresh — within last 3 candles) ────
    m15_fast = ema(closes, config.FAST_MA_PERIOD)
    m15_slow = ema(closes, config.SLOW_MA_PERIOD)

    cross_up = cross_down = False
    lookback = min(3, len(closes) - 1)
    for i in range(1, lookback + 1):
        prev = m15_fast[-(i+1)] - m15_slow[-(i+1)]
        curr = m15_fast[-i]     - m15_slow[-i]
        if prev < 0 and curr > 0:
            cross_up = True
        if prev > 0 and curr < 0:
            cross_down = True

    if not cross_up and not cross_down:
        reasons.append("No fresh M15 EMA crossover (last 3 candles)")
        return _none(closes[-1], reasons)

    cross_label = "CrossUP" if cross_up else "CrossDOWN"
    reasons.append(f"M15 {cross_label}")

    # Crossover must align with the confirmed trend
    if cross_up and not trend_is_bull:
        reasons.append("BLOCKED: BUY crossover but H4+H1 trend is bearish")
        return _none(closes[-1], reasons)
    if cross_down and trend_is_bull:
        reasons.append("BLOCKED: SELL crossover but H4+H1 trend is bullish")
        return _none(closes[-1], reasons)

    # ── GATE 5: MACD double confirmation ──────────────────────────────────────
    macd_line, sig_line, hist = macd(
        closes, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL
    )
    reasons.append(f"MACD_line={macd_line:+.5f} hist={hist:+.5f}")

    if cross_up:
        if hist <= 0 or macd_line <= 0:
            reasons.append("BLOCKED: BUY needs MACD line > 0 AND histogram > 0")
            return _none(closes[-1], reasons)
    else:
        if hist >= 0 or macd_line >= 0:
            reasons.append("BLOCKED: SELL needs MACD line < 0 AND histogram < 0")
            return _none(closes[-1], reasons)

    # ── GATE 6: Stochastic + RSI ──────────────────────────────────────────────
    rsi_val = rsi(closes, config.RSI_PERIOD)
    stoch_k, stoch_d = stochastic(
        highs, lows, closes,
        config.STOCH_K_PERIOD, config.STOCH_D_PERIOD
    )
    reasons.append(f"RSI={rsi_val:.1f} Stoch%K={stoch_k:.1f}")

    if cross_up:
        if rsi_val >= config.RSI_OVERBOUGHT:
            reasons.append(f"BLOCKED: RSI {rsi_val:.1f} ≥ {config.RSI_OVERBOUGHT} — overbought")
            return _none(closes[-1], reasons)
        if stoch_k >= 60 or stoch_k <= stoch_d:
            reasons.append(f"BLOCKED: Stoch %K={stoch_k:.1f} — not confirming upward momentum")
            return _none(closes[-1], reasons)
    else:
        if rsi_val <= config.RSI_OVERSOLD:
            reasons.append(f"BLOCKED: RSI {rsi_val:.1f} ≤ {config.RSI_OVERSOLD} — oversold")
            return _none(closes[-1], reasons)
        if stoch_k <= 40 or stoch_k >= stoch_d:
            reasons.append(f"BLOCKED: Stoch %K={stoch_k:.1f} — not confirming downward momentum")
            return _none(closes[-1], reasons)

    # ── GATE 7a: Pullback to EMA ──────────────────────────────────────────────
    atr_val     = atr(highs, lows, closes, config.ATR_PERIOD)
    slow_ema_now = m15_slow[-1]
    dist_to_ema  = abs(closes[-1] - slow_ema_now)
    max_dist     = atr_val * config.PULLBACK_ATR_MULT
    reasons.append(f"EMA_dist={dist_to_ema:.5f} (max {max_dist:.5f})")

    if dist_to_ema > max_dist:
        reasons.append(
            f"BLOCKED: Price too far from EMA ({dist_to_ema:.5f} > {max_dist:.5f}) "
            "— waiting for pullback"
        )
        return _none(closes[-1], reasons)

    # ── GATE 7b: Strong candle body ───────────────────────────────────────────
    candle_range = highs[-1] - lows[-1]
    body_size    = abs(closes[-1] - opens[-1])
    body_ratio   = body_size / candle_range if candle_range > 0 else 0
    last_bull_candle = closes[-1] > opens[-1]
    reasons.append(f"BodyRatio={body_ratio:.2f}")

    if body_ratio < config.MIN_BODY_RATIO:
        reasons.append(f"BLOCKED: Weak candle body ({body_ratio:.2f} < {config.MIN_BODY_RATIO}) — wick fake-out risk")
        return _none(closes[-1], reasons)
    if cross_up and not last_bull_candle:
        reasons.append("BLOCKED: BUY signal but last candle closed bearish")
        return _none(closes[-1], reasons)
    if cross_down and last_bull_candle:
        reasons.append("BLOCKED: SELL signal but last candle closed bullish")
        return _none(closes[-1], reasons)

    # ── All 7 gates passed ────────────────────────────────────────────────────
    sl_dist = atr_val * config.ATR_MULTIPLIER
    tp_dist = sl_dist * config.REWARD_RATIO
    entry   = closes[-1]

    if cross_up:
        sl = entry - sl_dist
        tp = entry + tp_dist
        signal = Signal.BUY
    else:
        sl = entry + sl_dist
        tp = entry - tp_dist
        signal = Signal.SELL

    reasons.append("★ ALL 7 GATES PASSED — HIGH PROBABILITY SETUP ★")
    return TradeSetup(
        signal=signal,
        entry_price=entry,
        sl=sl,
        tp=tp,
        atr_value=atr_val,
        reasons=reasons,
    )


def _none(entry: float, reasons: list) -> TradeSetup:
    return TradeSetup(Signal.NONE, entry, 0.0, 0.0, 0.0, reasons)
