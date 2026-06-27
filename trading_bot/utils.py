"""
Utility helpers — logging, timeframe mapping, all technical indicators.
"""

import logging
import sys

import MetaTrader5 as mt5
import numpy as np

import config


# ── Timeframe mapping ───────────────────────────────────────────────────────────

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


# ── Logger ──────────────────────────────────────────────────────────────────────

def setup_logger() -> logging.Logger:
    level = getattr(logging, config.LOG_LEVEL.upper(), logging.INFO)
    fmt     = "%(asctime)s | %(levelname)-8s | %(message)s"
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


# ── EMA ─────────────────────────────────────────────────────────────────────────

def ema(values: np.ndarray, period: int) -> np.ndarray:
    out = np.empty(len(values), dtype=np.float64)
    k   = 2.0 / (period + 1)
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


# ── RSI ─────────────────────────────────────────────────────────────────────────

def rsi(closes: np.ndarray, period: int) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes)
    gains  = np.where(deltas > 0, deltas,  0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    ag = np.mean(gains[:period])
    al = np.mean(losses[:period])
    for i in range(period, len(gains)):
        ag = (ag * (period - 1) + gains[i])  / period
        al = (al * (period - 1) + losses[i]) / period
    if al == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + ag / al))


# ── MACD ────────────────────────────────────────────────────────────────────────

def macd(closes: np.ndarray, fast: int, slow: int, signal_period: int
         ) -> tuple[float, float, float]:
    """Returns (macd_line, signal_line, histogram)."""
    if len(closes) < slow + signal_period:
        return 0.0, 0.0, 0.0
    fast_e   = ema(closes, fast)
    slow_e   = ema(closes, slow)
    line     = fast_e - slow_e
    sig      = ema(line, signal_period)
    return float(line[-1]), float(sig[-1]), float(line[-1] - sig[-1])


# ── ATR ─────────────────────────────────────────────────────────────────────────

def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int) -> float:
    if len(closes) < period + 1:
        return float(highs[-1] - lows[-1])
    tr = np.maximum(
        highs[1:] - lows[1:],
        np.maximum(np.abs(highs[1:] - closes[:-1]),
                   np.abs(lows[1:]  - closes[:-1])),
    )
    val = np.mean(tr[:period])
    for i in range(period, len(tr)):
        val = (val * (period - 1) + tr[i]) / period
    return float(val)


# ── ADX ─────────────────────────────────────────────────────────────────────────

def adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int) -> float:
    """Average Directional Index — always 0 to 100. >25 = strong trend."""
    n = len(closes)
    if n < period * 2 + 1:
        return 0.0

    tr_arr   = np.zeros(n - 1)
    dm_plus  = np.zeros(n - 1)
    dm_minus = np.zeros(n - 1)

    for i in range(1, n):
        up   = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        tr_arr[i - 1]   = max(highs[i] - lows[i],
                              abs(highs[i] - closes[i - 1]),
                              abs(lows[i]  - closes[i - 1]))
        dm_plus[i - 1]  = up   if (up > down and up > 0)   else 0.0
        dm_minus[i - 1] = down if (down > up and down > 0) else 0.0

    # Wilder sum-smoothing for TR / DM+ / DM-
    def _wilder_sum(arr, p):
        out = np.zeros(len(arr))
        out[p - 1] = np.sum(arr[:p])
        for i in range(p, len(arr)):
            out[i] = out[i - 1] - out[i - 1] / p + arr[i]
        return out

    atr_w = _wilder_sum(tr_arr,   period)
    dmp_w = _wilder_sum(dm_plus,  period)
    dmm_w = _wilder_sum(dm_minus, period)

    with np.errstate(divide="ignore", invalid="ignore"):
        di_p  = np.where(atr_w != 0, 100.0 * dmp_w / atr_w, 0.0)
        di_m  = np.where(atr_w != 0, 100.0 * dmm_w / atr_w, 0.0)
        denom = di_p + di_m
        dx    = np.where(denom != 0, 100.0 * np.abs(di_p - di_m) / denom, 0.0)

    # ADX = average-based smoothing of DX (keeps result within 0-100)
    dx_valid = dx[period - 1:]
    if len(dx_valid) < period:
        return 0.0
    adx_val = float(np.mean(dx_valid[:period]))
    for i in range(period, len(dx_valid)):
        adx_val = (adx_val * (period - 1) + dx_valid[i]) / period

    return round(min(100.0, max(0.0, adx_val)), 1)


# ── Stochastic ──────────────────────────────────────────────────────────────────

def stochastic(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
               k_period: int, d_period: int) -> tuple[float, float]:
    """Returns (%K, %D). <20 oversold, >80 overbought."""
    if len(closes) < k_period + d_period:
        return 50.0, 50.0
    k_vals = []
    for i in range(d_period):
        idx   = len(closes) - d_period + i
        wh    = np.max(highs[max(0, idx - k_period + 1): idx + 1])
        wl    = np.min(lows[max(0, idx  - k_period + 1): idx + 1])
        k     = 100.0 * (closes[idx] - wl) / (wh - wl) if wh != wl else 50.0
        k_vals.append(k)
    return float(k_vals[-1]), float(np.mean(k_vals))
