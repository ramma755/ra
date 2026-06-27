"""
Broker interface — MetaTrader5 API wrapper.
Handles: connect, bar fetching, spread check, orders, break-even, trailing stop.
"""

import logging
from typing import Optional, Tuple

import MetaTrader5 as mt5
import numpy as np

import config
from utils import get_mt5_timeframe, atr

log = logging.getLogger("EGMBot")


# ── Connection ──────────────────────────────────────────────────────────────────

def connect() -> bool:
    if not mt5.initialize():
        log.error("MT5 initialize() failed: %s — make sure MT5 is open and logged in.",
                  mt5.last_error())
        return False
    info = mt5.account_info()
    if info is None:
        log.error("Could not read account info: %s", mt5.last_error())
        return False
    mode = "DEMO" if info.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "LIVE"
    log.info("Connected [%s] Account: %s | %s | Balance: %.2f %s",
             mode, info.login, info.name, info.balance, info.currency)
    return True


def disconnect():
    mt5.shutdown()
    log.info("MT5 disconnected.")


# ── Spread guard ────────────────────────────────────────────────────────────────

def spread_ok(symbol: str) -> bool:
    tick = mt5.symbol_info_tick(symbol)
    if tick is None or tick.bid == 0:
        return False
    pct = (tick.ask - tick.bid) / tick.bid * 100.0
    if pct > config.MAX_SPREAD_PCT:
        log.info("%s | SPREAD %.3f%% > %.2f%% — skipping", symbol, pct, config.MAX_SPREAD_PCT)
        return False
    return True


# ── Bar fetching ────────────────────────────────────────────────────────────────

def _fetch(symbol: str, tf_str: str, count: int) -> Optional[np.ndarray]:
    tf = get_mt5_timeframe(tf_str)
    mt5.symbol_select(symbol, True)
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count + 1)
    if rates is None or len(rates) < count:
        return None
    return rates[:-1]   # drop still-forming bar


def get_entry_bars(symbol: str, count: int = 120):
    """M5 bars: returns (closes, highs, lows, opens, point) or None."""
    r = _fetch(symbol, config.ENTRY_TF, count)
    if r is None:
        return None
    info  = mt5.symbol_info(symbol)
    point = info.point if info else 0.00001
    return (r["close"].astype(np.float64), r["high"].astype(np.float64),
            r["low"].astype(np.float64),   r["open"].astype(np.float64), point)


def get_trend_bars(symbol: str, count: int = 100):
    """H1 bars: returns (closes, highs, lows) or None."""
    r = _fetch(symbol, config.TREND_TF, count)
    if r is None:
        return None
    return (r["close"].astype(np.float64), r["high"].astype(np.float64),
            r["low"].astype(np.float64))


# ── Position queries ────────────────────────────────────────────────────────────

def open_count_total() -> int:
    return len([p for p in (mt5.positions_get() or [])
                if p.magic == config.MAGIC_NUMBER])


def open_count_symbol(symbol: str) -> int:
    return len([p for p in (mt5.positions_get(symbol=symbol) or [])
                if p.magic == config.MAGIC_NUMBER])


def get_open_positions():
    return [p for p in (mt5.positions_get() or [])
            if p.magic == config.MAGIC_NUMBER]


# ── Order execution ─────────────────────────────────────────────────────────────

def send_order(symbol: str, order_type: int, lot: float, sl: float, tp: float) -> bool:
    info = mt5.symbol_info(symbol)
    if info is None:
        log.error("send_order: no info for %s", symbol)
        return False
    price  = info.ask if order_type == mt5.ORDER_TYPE_BUY else info.bid
    digits = info.digits
    req = {
        "action":       mt5.TRADE_ACTION_DEAL,
        "symbol":       symbol,
        "volume":       lot,
        "type":         order_type,
        "price":        price,
        "sl":           round(sl, digits),
        "tp":           round(tp, digits),
        "deviation":    config.SLIPPAGE,
        "magic":        config.MAGIC_NUMBER,
        "comment":      config.COMMENT,
        "type_time":    mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    res = mt5.order_send(req)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        log.error("Order REJECTED %s | retcode=%s | %s",
                  symbol, res.retcode if res else "None",
                  res.comment if res else "")
        return False
    direction = "BUY" if order_type == mt5.ORDER_TYPE_BUY else "SELL"
    log.info("✅ %s %s | lot=%.2f | price=%.5f | SL=%.5f | TP=%.5f | #%s",
             direction, symbol, lot, price, round(sl, digits), round(tp, digits), res.order)
    return True


# ── Break-even & trailing stop ──────────────────────────────────────────────────

def _modify_sl(pos, new_sl: float) -> bool:
    info = mt5.symbol_info(pos.symbol)
    if info is None:
        return False
    req = {
        "action":   mt5.TRADE_ACTION_SLTP,
        "position": pos.ticket,
        "symbol":   pos.symbol,
        "sl":       round(new_sl, info.digits),
        "tp":       pos.tp,
    }
    res = mt5.order_send(req)
    return res is not None and res.retcode == mt5.TRADE_RETCODE_DONE


def manage_open_positions():
    for pos in get_open_positions():
        is_buy = pos.type == mt5.POSITION_TYPE_BUY
        bars   = get_entry_bars(pos.symbol, count=config.ATR_PERIOD + 5)
        if bars is None:
            continue
        closes, highs, lows, _, _ = bars
        cur_atr = atr(highs, lows, closes, config.ATR_PERIOD)

        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            continue
        price = tick.bid if is_buy else tick.ask

        sl        = pos.sl
        entry     = pos.price_open
        if sl == 0:
            continue
        risk_dist   = abs(entry - sl)
        profit_dist = (price - entry) if is_buy else (entry - price)
        new_sl      = sl

        # Break-even
        if profit_dist >= risk_dist * config.BREAKEVEN_R:
            if is_buy and sl < entry:
                new_sl = max(new_sl, entry)
            elif not is_buy and sl > entry:
                new_sl = min(new_sl, entry)

        # Trailing stop
        if profit_dist >= risk_dist * config.TRAIL_START_R:
            trail = cur_atr * config.TRAIL_STEP_ATR
            if is_buy:
                new_sl = max(new_sl, price - trail)
            else:
                new_sl = min(new_sl, price + trail)

        info = mt5.symbol_info(pos.symbol)
        if info and abs(new_sl - sl) > info.point:
            tag = "BE" if abs(new_sl - entry) < info.point * 5 else "TRAIL"
            if _modify_sl(pos, new_sl):
                log.info("🔒 %s #%s %s SL %.5f→%.5f",
                         tag, pos.ticket, pos.symbol, sl, new_sl)
