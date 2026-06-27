"""
Position sizing — risk a fixed % of account balance per trade.

lot_size = (balance × RISK_PERCENT/100) / (sl_points × tick_value_per_lot)
"""

import MetaTrader5 as mt5

import config


def calculate_lot_size(symbol: str, sl_price: float, entry_price: float) -> float:
    """
    Returns a lot size rounded to the symbol's volume step.
    Returns 0.0 if the calculation cannot be completed (e.g. no account info).
    """
    account = mt5.account_info()
    if account is None:
        return 0.0

    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        return 0.0

    balance     = account.balance
    risk_amount = balance * (config.RISK_PERCENT / 100.0)

    # Distance in points
    sl_points = abs(entry_price - sl_price) / symbol_info.point
    if sl_points == 0:
        return 0.0

    # Monetary value of 1 point for 1 lot
    tick_value = symbol_info.trade_tick_value  # value of 1 tick (= 1 point for most FX)

    raw_lot = risk_amount / (sl_points * tick_value)

    # Clamp to broker limits and round to volume step
    step     = symbol_info.volume_step
    min_lot  = symbol_info.volume_min
    max_lot  = symbol_info.volume_max

    lot = max(min_lot, min(max_lot, round(raw_lot / step) * step))
    return round(lot, 2)
