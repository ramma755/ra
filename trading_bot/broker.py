"""
Broker interface — MetaTrader5 Python API wrapper.

Handles:
  - Connecting to the running MT5 terminal (auto-detects active account)
  - Fetching OHLC bars for both entry and trend timeframes
  - Spread validation before entry
  - Counting open positions
  - Sending market orders
  - Break-even and trailing-stop management
"""

import logging
from typing import Optional, Tuple

import MetaTrader5 as mt5
import numpy as np

import config
from utils import get_mt5_timeframe, atr

log = logging.getLogger("EGMBot")


# ─── Connection ────────────────────────────────────────────────────────────────

def connect() -> bool:
    """
    Attach to the already-running MT5 terminal.
    The bot uses whichever account MT5 is currently logged in to.
    Switch accounts inside MT5 itself — no file editing required.
    """
    if not mt5.initialize():
        log.error(
            "Could not connect to MetaTrader 5.\n"
            "  → Make sure MT5 is open and you are logged in before starting the bot.\n"
            "  → Error: %s", mt5.last_error()
        )
        return False

    info = mt5.account_info()
    if info is None:
        log.error("Could not read account info: %s", mt5.last_error())
        return False

    account_type = "DEMO" if info.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "LIVE"
    log.info(
        "Connected to MT5 | [%s] Account: %s | Name: %s | Balance: %.2f %s",
        account_type, info.login, info.name, info.balance, info.currency,
    )
    return True


def disconnect():
    mt5.shutdown()
    log.info("MT5 connection closed.")


# ─── Spread Guard ──────────────────────────────────────────────────────────────

def spread_ok(symbol: str) -> bool:
    """Returns True if the current spread is within the allowed maximum."""
    tick = mt5.symbol_info_tick(symbol)
    info = mt5.symbol_info(symbol)
    if tick is None or info is None:
        return False
    spread_points = (tick.ask - tick.bid) / info.point
    if spread_points > config.MAX_SPREAD_POINTS:
        log.info(
            "%s | SPREAD TOO WIDE: %.1f pts (max %d) — skipping entry",
            symbol, spread_points, config.MAX_SPREAD_POINTS,
        )
        return False
    return True


# ─── Market Data ───────────────────────────────────────────────────────────────

def _fetch_rates(symbol: str, tf_str: str, count: int):
    tf = get_mt5_timeframe(tf_str)
    if not mt5.symbol_select(symbol, True):
        log.warning("Cannot select symbol %s", symbol)
        return None
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count + 1)
    if rates is None or len(rates) < count:
        log.warning("Not enough bars for %s on %s (%s returned)",
                    symbol, tf_str, len(rates) if rates is not None else 0)
        return None
    return rates[:-1]  # drop still-forming bar


def get_bars(symbol: str, count: int = 120):
    """
    Returns (closes, highs, lows, opens, point) for the ENTRY timeframe,
    or None on failure.
    """
    rates = _fetch_rates(symbol, config.ENTRY_TF, count)
    if rates is None:
        return None
    info = mt5.symbol_info(symbol)
    point = info.point if info else 0.00001
    return (
        rates["close"].astype(np.float64),
        rates["high"].astype(np.float64),
        rates["low"].astype(np.float64),
        rates["open"].astype(np.float64),
        point,
    )


def get_trend_bars(symbol: str, count: int = 60):
    """
    Returns (closes, highs, lows) for the H1 TREND timeframe, or None.
    """
    rates = _fetch_rates(symbol, config.TREND_TF, count)
    if rates is None:
        return None
    return (
        rates["close"].astype(np.float64),
        rates["high"].astype(np.float64),
        rates["low"].astype(np.float64),
    )


def get_macro_bars(symbol: str, count: int = 60):
    """
    Returns (closes, highs, lows) for the H4 MACRO timeframe, or None.
    """
    rates = _fetch_rates(symbol, config.MACRO_TF, count)
    if rates is None:
        return None
    return (
        rates["close"].astype(np.float64),
        rates["high"].astype(np.float64),
        rates["low"].astype(np.float64),
    )


# ─── Position Queries ──────────────────────────────────────────────────────────

def open_position_count_total() -> int:
    positions = mt5.positions_get() or []
    return len([p for p in positions if p.magic == config.MAGIC_NUMBER])


def open_position_count_symbol(symbol: str) -> int:
    positions = mt5.positions_get(symbol=symbol) or []
    return len([p for p in positions if p.magic == config.MAGIC_NUMBER])


def get_open_positions():
    """Return all positions belonging to this bot."""
    positions = mt5.positions_get() or []
    return [p for p in positions if p.magic == config.MAGIC_NUMBER]


# ─── Order Execution ───────────────────────────────────────────────────────────

def send_order(
    symbol:     str,
    order_type: int,
    lot:        float,
    sl:         float,
    tp:         float,
) -> bool:
    info = mt5.symbol_info(symbol)
    if info is None:
        log.error("send_order: no symbol info for %s", symbol)
        return False

    price  = info.ask if order_type == mt5.ORDER_TYPE_BUY else info.bid
    digits = info.digits
    sl = round(sl, digits)
    tp = round(tp, digits)

    request = {
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       symbol,
        "volume":       lot,
        "type":         order_type,
        "price":        price,
        "sl":           sl,
        "tp":           tp,
        "deviation":    config.SLIPPAGE,
        "magic":        config.MAGIC_NUMBER,
        "comment":      config.COMMENT,
        "type_time":    mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        log.error("Order rejected for %s | retcode=%s | %s",
                  symbol,
                  result.retcode if result else "None",
                  result.comment if result else "")
        return False

    direction = "BUY" if order_type == mt5.ORDER_TYPE_BUY else "SELL"
    log.info(
        "✅ Order placed | %s %s | lot=%.2f | price=%.5f | SL=%.5f | TP=%.5f | ticket=#%s",
        direction, symbol, lot, price, sl, tp, result.order,
    )
    return True


# ─── Trade Management — Break-Even & Trailing Stop ─────────────────────────────

def _modify_sl(position, new_sl: float) -> bool:
    """Send a request to move the stop-loss of an open position."""
    info = mt5.symbol_info(position.symbol)
    if info is None:
        return False
    new_sl = round(new_sl, info.digits)

    request = {
        "action":   mt5.TRADE_ACTION_SLTP,
        "position": position.ticket,
        "symbol":   position.symbol,
        "sl":       new_sl,
        "tp":       position.tp,
    }
    result = mt5.order_send(request)
    return result is not None and result.retcode == mt5.TRADE_RETCODE_DONE


def manage_open_positions():
    """
    For every open position placed by this bot:
      1. Break-even: move SL to entry once price is BREAKEVEN_R × risk in profit.
      2. Trailing stop: once TRAIL_START_R × risk in profit, trail by TRAIL_STEP_ATR × ATR.
    """
    for pos in get_open_positions():
        symbol = pos.symbol
        is_buy = pos.type == mt5.POSITION_TYPE_BUY

        # Get current ATR for this symbol
        bars = get_bars(symbol, count=max(config.ATR_PERIOD + 5, 30))
        if bars is None:
            continue
        closes, highs, lows, opens, point = bars
        current_atr = atr(highs, lows, closes, config.ATR_PERIOD)

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            continue
        current_price = tick.bid if is_buy else tick.ask

        entry  = pos.price_open
        sl     = pos.sl
        tp     = pos.tp

        if sl == 0:
            continue

        risk_dist  = abs(entry - sl)
        profit_dist = (current_price - entry) if is_buy else (entry - current_price)

        new_sl = sl  # default: no change

        # ── Break-even ────────────────────────────────────────────────────────
        be_threshold = risk_dist * config.BREAKEVEN_R
        if profit_dist >= be_threshold:
            if is_buy and sl < entry:
                new_sl = max(new_sl, entry)
            elif not is_buy and sl > entry:
                new_sl = min(new_sl, entry)

        # ── Trailing stop ─────────────────────────────────────────────────────
        trail_threshold = risk_dist * config.TRAIL_START_R
        if profit_dist >= trail_threshold:
            trail_dist = current_atr * config.TRAIL_STEP_ATR
            if is_buy:
                trailed_sl = current_price - trail_dist
                new_sl = max(new_sl, trailed_sl)
            else:
                trailed_sl = current_price + trail_dist
                new_sl = min(new_sl, trailed_sl)

        # ── Apply if changed ──────────────────────────────────────────────────
        info = mt5.symbol_info(symbol)
        if info and abs(new_sl - sl) > info.point:
            action = "BREAK-EVEN" if abs(new_sl - entry) < info.point * 2 else "TRAIL SL"
            if _modify_sl(pos, new_sl):
                log.info(
                    "🔒 %s #%s %s | SL moved %.5f → %.5f | profit_dist=%.5f",
                    action, pos.ticket, symbol, sl, new_sl, profit_dist,
                )
            else:
                log.warning("Failed to modify SL for #%s", pos.ticket)
