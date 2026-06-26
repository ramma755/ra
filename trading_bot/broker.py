"""
Broker interface — thin wrapper around the MetaTrader5 Python API.

Handles:
  - Initialising and authenticating the MT5 terminal
  - Fetching OHLC bars
  - Counting open positions for a symbol / magic
  - Sending market orders (BUY / SELL)
  - Closing positions
"""

import time
import logging
from typing import Optional, Tuple

import MetaTrader5 as mt5
import numpy as np

import config
from utils import get_mt5_timeframe

log = logging.getLogger("EGMBot")


# ─── Connection ────────────────────────────────────────────────────────────────

def connect() -> bool:
    """Initialise the MT5 terminal and log in. Returns True on success."""
    if not mt5.initialize(
        login=config.MT5_LOGIN,
        password=config.MT5_PASSWORD,
        server=config.MT5_SERVER,
    ):
        log.error("MT5 initialize() failed: %s", mt5.last_error())
        return False

    info = mt5.account_info()
    if info is None:
        log.error("Could not retrieve account info: %s", mt5.last_error())
        return False

    log.info(
        "Connected | Account: %s | Name: %s | Balance: %.2f %s",
        info.login, info.name, info.balance, info.currency,
    )
    return True


def disconnect():
    mt5.shutdown()
    log.info("MT5 connection closed.")


# ─── Market Data ───────────────────────────────────────────────────────────────

def get_bars(
    symbol: str,
    count: int = 100,
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray, float]]:
    """
    Fetch the last `count` closed candles for `symbol` on the configured timeframe.
    Returns (closes, highs, lows, point) or None on failure.
    """
    tf = get_mt5_timeframe(config.TIMEFRAME)

    # Ensure symbol is visible in Market Watch
    if not mt5.symbol_select(symbol, True):
        log.warning("Cannot select symbol %s", symbol)
        return None

    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count + 1)
    if rates is None or len(rates) < count:
        log.warning("Not enough bars for %s (%s returned)", symbol, len(rates) if rates is not None else 0)
        return None

    # Drop the still-forming (last) bar so signals are based on closed candles
    rates = rates[:-1]

    closes = rates["close"].astype(np.float64)
    highs  = rates["high"].astype(np.float64)
    lows   = rates["low"].astype(np.float64)

    symbol_info = mt5.symbol_info(symbol)
    point = symbol_info.point if symbol_info else 0.00001

    return closes, highs, lows, point


# ─── Position Queries ──────────────────────────────────────────────────────────

def open_position_count_total() -> int:
    positions = mt5.positions_get(comment=config.COMMENT) or []
    return len([p for p in positions if p.magic == config.MAGIC_NUMBER])


def open_position_count_symbol(symbol: str) -> int:
    positions = mt5.positions_get(symbol=symbol) or []
    return len([p for p in positions if p.magic == config.MAGIC_NUMBER])


# ─── Order Execution ───────────────────────────────────────────────────────────

def send_order(
    symbol:    str,
    order_type: int,   # mt5.ORDER_TYPE_BUY or mt5.ORDER_TYPE_SELL
    lot:       float,
    sl:        float,
    tp:        float,
) -> bool:
    """Send a market order. Returns True if accepted by the broker."""
    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        log.error("send_order: no symbol info for %s", symbol)
        return False

    price = symbol_info.ask if order_type == mt5.ORDER_TYPE_BUY else symbol_info.bid

    # Round SL/TP to the symbol's digit precision
    digits = symbol_info.digits
    sl = round(sl, digits)
    tp = round(tp, digits)

    request = {
        "action":     mt5.TRADE_ACTION_DEAL,
        "symbol":     symbol,
        "volume":     lot,
        "type":       order_type,
        "price":      price,
        "sl":         sl,
        "tp":         tp,
        "deviation":  config.SLIPPAGE,
        "magic":      config.MAGIC_NUMBER,
        "comment":    config.COMMENT,
        "type_time":  mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        retcode = result.retcode if result else "None"
        log.error("Order rejected for %s | retcode=%s | comment=%s",
                  symbol, retcode, result.comment if result else "")
        return False

    direction = "BUY" if order_type == mt5.ORDER_TYPE_BUY else "SELL"
    log.info(
        "Order placed | %s %s | lot=%.2f | price=%.5f | SL=%.5f | TP=%.5f | ticket=#%s",
        direction, symbol, lot, price, sl, tp, result.order,
    )
    return True


def close_position(position) -> bool:
    """Close a single open position by sending an opposite market order."""
    symbol_info = mt5.symbol_info(position.symbol)
    if symbol_info is None:
        return False

    if position.type == mt5.POSITION_TYPE_BUY:
        close_type = mt5.ORDER_TYPE_SELL
        price      = symbol_info.bid
    else:
        close_type = mt5.ORDER_TYPE_BUY
        price      = symbol_info.ask

    request = {
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       position.symbol,
        "volume":       position.volume,
        "type":         close_type,
        "position":     position.ticket,
        "price":        price,
        "deviation":    config.SLIPPAGE,
        "magic":        config.MAGIC_NUMBER,
        "comment":      f"close #{position.ticket}",
        "type_time":    mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        log.error("Close failed for ticket #%s | retcode=%s",
                  position.ticket, result.retcode if result else "None")
        return False

    log.info("Closed position #%s on %s | P&L=%.2f",
             position.ticket, position.symbol, position.profit)
    return True
