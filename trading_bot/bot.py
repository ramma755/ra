"""
EGM Securities Trading Bot — Scalping Edition
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scans 65+ markets every 15 seconds.
5-gate entry: H1 trend | ADX | M5 crossover | RSI+MACD | Pullback+Body

Run:  python bot.py
Stop: Ctrl-C
"""

import sys
import time
import signal
import logging

import MetaTrader5 as mt5

import config
import broker
import strategy
import risk
from utils import setup_logger

log = setup_logger()
_running = True


def _shutdown(sig, frame):
    global _running
    log.info("Shutdown requested — finishing current scan then stopping...")
    _running = False

signal.signal(signal.SIGINT,  _shutdown)
signal.signal(signal.SIGTERM, _shutdown)


# ── Single-symbol scan ──────────────────────────────────────────────────────────

def scan_symbol(symbol: str):
    if broker.open_count_total() >= config.MAX_OPEN_TRADES:
        return
    if broker.open_count_symbol(symbol) >= config.MAX_TRADES_PER_SYMBOL:
        return
    if not broker.spread_ok(symbol):
        return

    # Fetch bars
    needed = max(
        config.SLOW_MA_PERIOD + config.MACD_SLOW + config.MACD_SIGNAL + 10,
        config.RSI_PERIOD + 10,
        config.ATR_PERIOD + 10,
    )
    entry_bars = broker.get_entry_bars(symbol, count=needed)
    if entry_bars is None:
        log.warning("%s | Cannot get %s bars — symbol may not be available", symbol, config.ENTRY_TF)
        return
    closes, highs, lows, opens, point = entry_bars

    trend_count = config.SLOW_MA_PERIOD + config.ADX_PERIOD * 2 + 10
    trend_bars  = broker.get_trend_bars(symbol, count=trend_count)
    if trend_bars is None:
        log.warning("%s | Cannot get %s bars", symbol, config.TREND_TF)
        return
    h1_closes, h1_highs, h1_lows = trend_bars

    # Analyse
    setup = strategy.analyse(closes, highs, lows, opens, h1_closes, h1_highs, h1_lows)

    log.info("%s | %.5f | %s | %s",
             symbol, closes[-1], setup.signal.name, " | ".join(setup.reasons))

    if setup.signal == strategy.Signal.NONE:
        return

    lot = risk.calculate_lot_size(symbol, setup.sl, setup.entry_price)
    if lot <= 0:
        log.warning("%s | Lot size 0 — check balance or SL distance", symbol)
        return

    order_type = mt5.ORDER_TYPE_BUY if setup.signal == strategy.Signal.BUY else mt5.ORDER_TYPE_SELL
    log.info("🚀 %s %s | entry=%.5f | SL=%.5f | TP=%.5f | lot=%.2f",
             setup.signal.name, symbol, setup.entry_price, setup.sl, setup.tp, lot)
    broker.send_order(symbol, order_type, lot, setup.sl, setup.tp)


# ── Full scan ───────────────────────────────────────────────────────────────────

def scan_all():
    log.info("━━━ Scanning %d symbols on %s ━━━", len(config.SYMBOLS), config.ENTRY_TF)
    for sym in config.SYMBOLS:
        try:
            scan_symbol(sym)
        except Exception as exc:
            log.exception("Error on %s: %s", sym, exc)


# ── Main ────────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 65)
    log.info("  EGM Securities Trading Bot — Scalping Edition")
    log.info("  Account  : auto-detected from running MT5 terminal")
    log.info("  Symbols  : %d markets", len(config.SYMBOLS))
    log.info("  Entry TF : %s  |  Trend TF: %s", config.ENTRY_TF, config.TREND_TF)
    log.info("  EMA %d/%d | RSI %d | MACD %d/%d/%d | ADX min=%d",
             config.FAST_MA_PERIOD, config.SLOW_MA_PERIOD, config.RSI_PERIOD,
             config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL, config.ADX_MIN)
    log.info("  Risk %.1f%% | R:R 1:%.1f | SL %.1f×ATR | Max spread %.2f%%",
             config.RISK_PERCENT, config.REWARD_RATIO,
             config.ATR_MULTIPLIER, config.MAX_SPREAD_PCT)
    log.info("  Scan every %ds | BE at %.1fR | Trail from %.1fR",
             config.POLL_INTERVAL_SECONDS, config.BREAKEVEN_R, config.TRAIL_START_R)
    log.info("=" * 65)

    if not broker.connect():
        sys.exit(1)

    try:
        scan_all()
        broker.manage_open_positions()

        while _running:
            log.info("Next scan in %ds — Ctrl-C to stop.", config.POLL_INTERVAL_SECONDS)
            for _ in range(config.POLL_INTERVAL_SECONDS * 2):
                if not _running:
                    break
                time.sleep(0.5)
            if _running:
                scan_all()
                broker.manage_open_positions()
    finally:
        broker.disconnect()
        log.info("Bot stopped.")


if __name__ == "__main__":
    main()
