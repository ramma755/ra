"""
Utility helpers — logging, MT5 timeframe mapping, all technical indicators,
session filter.
"""

import logging
import sys
from datetime import datetime, timezone

import MetaTrader5 as mt5
import numpy as np

import config


# ─── Timeframe mapping ─────────────────────────────────────────────────────────

_TF_MAP = {
    "M1":  mt5.TIMEFRAME_M1,
    "M5":  mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1":  mt5.TIMEFRAME_H1,
    "H4":  mt5.TIMEFRAME_H4,
    "D1":  mt5.TIMEFRAME_D1,
}


def get_mt5_timeframe(tf_str: str) -> int:
    tf = _TF_MAP.get(tf_str.upper())
    if tf is None:
        raise ValueError(f"Unknown timeframe '{tf_str}'. Valid: {list(_TF_MAP)}")
    return tf


# ─── Logger ────────────────────────────────────────────────────────────────────

def setup_logger() -> logging.Logger:
    level = getattr(logging, config.LOG_LEVEL.upper(), logging.INFO)
    fmt = "%(asctime)s | %(levelname)-8s | %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"

    logger = logging.getLogger("EGMBot")
    logger.setLevel(level)
    if logger.handlers:
        return logger

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(level)
    ch.setFormatter(logging.Formatter(fmt, datefmt=datefmt))
    logger.addHandler(ch)

    fh = logging.FileHandler(config.LOG_FILE, encoding="utf-8")
    fh.setLevel(level)
    fh.setFormatter(logging.Formatter(fmt, datefmt=datefmt))
    logger.addHandler(fh)

    return logger


# ─── Session Filter ────────────────────────────────────────────────────────────

def is_trading_session() -> bool:
    """True if current UTC time is within the active trading window."""
    now = datetime.now(timezone.utc)
    if not config.TRADE_ON_WEEKENDS and now.weekday() >= 5:
        return False
    return config.SESSION_START_UTC <= now.hour < config.SESSION_END_UTC


# ─── EMA ───────────────────────────────────────────────────────────────────────

def ema(values: np.ndarray, period: int) -> np.ndarray:
    result = np.empty(len(values), dtype=np.float64)
    k = 2.0 / (period + 1)
    result[0] = values[0]
    for i in range(1, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result


# ─── RSI ───────────────────────────────────────────────────────────────────────

def rsi(closes: np.ndarray, period: int) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes)
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))


# ─── MACD ──────────────────────────────────────────────────────────────────────

def macd(
    closes: np.ndarray,
    fast: int,
    slow: int,
    signal_period: int,
) -> tuple[float, float, float]:
    """Returns (macd_line, signal_line, histogram)."""
    if len(closes) < slow + signal_period:
        return 0.0, 0.0, 0.0
    fast_ema  = ema(closes, fast)
    slow_ema  = ema(closes, slow)
    macd_line = fast_ema - slow_ema
    sig_arr   = ema(macd_line, signal_period)
    return float(macd_line[-1]), float(sig_arr[-1]), float(macd_line[-1] - sig_arr[-1])


# ─── ATR ───────────────────────────────────────────────────────────────────────

def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int) -> float:
    if len(closes) < period + 1:
        return float(highs[-1] - lows[-1])
    tr = np.maximum(
        highs[1:] - lows[1:],
        np.maximum(np.abs(highs[1:] - closes[:-1]), np.abs(lows[1:] - closes[:-1])),
    )
    val = np.mean(tr[:period])
    for i in range(period, len(tr)):
        val = (val * (period - 1) + tr[i]) / period
    return float(val)


# ─── ADX ───────────────────────────────────────────────────────────────────────

def adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int) -> float:
    """
    Average Directional Index — always returns a value between 0 and 100.
    > 25 = strong trend (trade)
    < 20 = choppy/ranging (skip)
    """
    n = len(closes)
    if n < period * 2 + 1:
        return 0.0

    tr_arr   = np.zeros(n - 1)
    dm_plus  = np.zeros(n - 1)
    dm_minus = np.zeros(n - 1)

    for i in range(1, n):
        up   = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        tr_arr[i - 1] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i]  - closes[i - 1]),
        )
        dm_plus[i - 1]  = up   if up > down and up > 0   else 0.0
        dm_minus[i - 1] = down if down > up and down > 0 else 0.0

    # Wilder smoothing — sum-based (used for TR, DM+, DM-)
    def wilder_sum(arr, p):
        out = np.zeros(len(arr))
        out[p - 1] = np.sum(arr[:p])
        for i in range(p, len(arr)):
            out[i] = out[i - 1] - out[i - 1] / p + arr[i]
        return out

    atr_w = wilder_sum(tr_arr,   period)
    dmp_w = wilder_sum(dm_plus,  period)
    dmm_w = wilder_sum(dm_minus, period)

    with np.errstate(divide="ignore", invalid="ignore"):
        di_plus  = np.where(atr_w != 0, 100.0 * dmp_w / atr_w, 0.0)
        di_minus = np.where(atr_w != 0, 100.0 * dmm_w / atr_w, 0.0)
        denom = di_plus + di_minus
        dx    = np.where(denom != 0, 100.0 * np.abs(di_plus - di_minus) / denom, 0.0)

    # ADX = average-based smoothing of DX values (NOT sum-based)
    # Initial ADX = simple average of first `period` DX values
    dx_valid = dx[period - 1:]          # first valid DX starts at index period-1
    if len(dx_valid) < period:
        return 0.0

    adx_val = float(np.mean(dx_valid[:period]))
    for i in range(period, len(dx_valid)):
        adx_val = (adx_val * (period - 1) + dx_valid[i]) / period

    return min(100.0, max(0.0, adx_val))


# ─── Stochastic ────────────────────────────────────────────────────────────────

def stochastic(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    k_period: int,
    d_period: int,
) -> tuple[float, float]:
    """
    Returns (%K, %D) for the most-recent bar.
    %K < 20 = oversold, %K > 80 = overbought.
    For a BUY: %K should be rising from oversold (< 50, trending up)
    For a SELL: %K should be falling from overbought (> 50, trending down)
    """
    if len(closes) < k_period + d_period:
        return 50.0, 50.0

    k_values = []
    for i in range(d_period):
        idx = len(closes) - d_period + i
        window_h = highs[max(0, idx - k_period + 1): idx + 1]
        window_l = lows[max(0, idx - k_period + 1): idx + 1]
        hh = np.max(window_h)
        ll = np.min(window_l)
        k = 100.0 * (closes[idx] - ll) / (hh - ll) if hh != ll else 50.0
        k_values.append(k)

    k_now = k_values[-1]
    d_now = float(np.mean(k_values))
    return float(k_now), d_now
