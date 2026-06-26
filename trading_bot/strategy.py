"""
Strategy engine — EMA crossover with RSI confirmation.

Signal logic:
  BUY  signal → fast EMA crosses above slow EMA  AND  RSI < RSI_OVERBOUGHT
  SELL signal → fast EMA crosses below slow EMA  AND  RSI > RSI_OVERSOLD

Stop-loss  = ATR × ATR_MULTIPLIER  (placed on the correct side of entry)
Take-profit= SL distance × REWARD_RATIO
"""

from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional

import numpy as np

import config
from utils import ema, rsi, atr


class Signal(Enum):
    NONE = auto()
    BUY  = auto()
    SELL = auto()


@dataclass
class TradeSetup:
    signal:      Signal
    entry_price: float
    sl:          float   # stop-loss price
    tp:          float   # take-profit price
    atr_value:   float


def analyse(
    closes: np.ndarray,
    highs:  np.ndarray,
    lows:   np.ndarray,
    point:  float,
) -> TradeSetup:
    """
    Analyse the latest candle data and return a TradeSetup.
    All arrays must be sorted oldest-first.
    """
    fast = ema(closes, config.FAST_MA_PERIOD)
    slow = ema(closes, config.SLOW_MA_PERIOD)
    rsi_now  = rsi(closes, config.RSI_PERIOD)
    atr_now  = atr(highs, lows, closes, config.ATR_PERIOD)

    # Previous and current crossover state
    prev_diff = fast[-2] - slow[-2]
    curr_diff = fast[-1] - slow[-1]

    sl_distance = atr_now * config.ATR_MULTIPLIER
    tp_distance = sl_distance * config.REWARD_RATIO
    entry       = closes[-1]

    # BUY: fast crosses above slow, RSI not overbought
    if prev_diff < 0 and curr_diff > 0 and rsi_now < config.RSI_OVERBOUGHT:
        return TradeSetup(
            signal=Signal.BUY,
            entry_price=entry,
            sl=entry - sl_distance,
            tp=entry + tp_distance,
            atr_value=atr_now,
        )

    # SELL: fast crosses below slow, RSI not oversold
    if prev_diff > 0 and curr_diff < 0 and rsi_now > config.RSI_OVERSOLD:
        return TradeSetup(
            signal=Signal.SELL,
            entry_price=entry,
            sl=entry + sl_distance,
            tp=entry - tp_distance,
            atr_value=atr_now,
        )

    return TradeSetup(
        signal=Signal.NONE,
        entry_price=entry,
        sl=0.0,
        tp=0.0,
        atr_value=atr_now,
    )
