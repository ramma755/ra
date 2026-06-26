"""
Utility helpers — logging setup, MT5 timeframe mapping, indicator maths,
session filter, spread check.
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
    """
    Returns True if the current UTC time falls within the configured trading
    window AND it is not a weekend (unless TRADE_ON_WEEKENDS is True).
    """
    now = datetime.now(timezone.utc)
    weekday = now.weekday()  # 0=Monday … 6=Sunday

    if not config.TRADE_ON_WEEKENDS:
        # Saturday=5, Sunday=6 — skip new entries
        if weekday >= 5:
            return False

    hour = now.hour
    return config.SESSION_START_UTC <= hour < config.SESSION_END_UTC


# ─── Technical Indicators ──────────────────────────────────────────────────────

def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average."""
    result = np.empty_like(values, dtype=np.float64)
    k = 2.0 / (period + 1)
    result[0] = values[0]
    for i in range(1, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result


def rsi(closes: np.ndarray, period: int) -> float:
    """Most-recent RSI value."""
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


def macd(
    closes: np.ndarray,
    fast: int,
    slow: int,
    signal_period: int,
) -> tuple[float, float, float]:
    """
    Returns (macd_line, signal_line, histogram) for the most-recent bar.
    macd_line > 0 and histogram > 0  → bullish momentum
    macd_line < 0 and histogram < 0  → bearish momentum
    """
    if len(closes) < slow + signal_period:
        return 0.0, 0.0, 0.0
    fast_ema   = ema(closes, fast)
    slow_ema   = ema(closes, slow)
    macd_line  = fast_ema - slow_ema
    signal_arr = ema(macd_line, signal_period)
    hist       = macd_line[-1] - signal_arr[-1]
    return float(macd_line[-1]), float(signal_arr[-1]), float(hist)


def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int) -> float:
    """Most-recent ATR value."""
    if len(closes) < period + 1:
        return float(highs[-1] - lows[-1])
    tr = np.maximum(
        highs[1:] - lows[1:],
        np.maximum(
            np.abs(highs[1:] - closes[:-1]),
            np.abs(lows[1:]  - closes[:-1]),
        ),
    )
    atr_val = np.mean(tr[:period])
    for i in range(period, len(tr)):
        atr_val = (atr_val * (period - 1) + tr[i]) / period
    return float(atr_val)
