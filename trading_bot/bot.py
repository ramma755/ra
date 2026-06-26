"""
EGM Securities Trading Bot — main loop.

Run:
    python bot.py

The bot connects to the MT5 terminal, then immediately scans all configured
symbols for entry signals. After the first scan it repeats every
POLL_INTERVAL_SECONDS seconds until you press Ctrl-C.
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


def _handle_sigint(sig, frame):
    global _running
    log.info("Shutdown signal received — stopping after current cycle...")
    _running = False


signal.signal(signal.SIGINT,  _handle_sigint)
signal.signal(signal.SIGTERM, _handle_sigint)


# ─── Single-symbol scan ────────────────────────────────────────────────────────

def scan_symbol(symbol: str):
    """Fetch bars, evaluate strategy, manage positions for one symbol."""

    # ── Guard: too many total open positions
    if broker.open_position_count_total() >= config.MAX_OPEN_TRADES:
        log.info("%s | SKIP — max total positions (%d) reached",
                 symbol, config.MAX_OPEN_TRADES)
        return

    # ── Guard: already in this symbol
    if broker.open_position_count_symbol(symbol) >= config.MAX_TRADES_PER_SYMBOL:
        log.info("%s | SKIP — already have an open position on this symbol", symbol)
        return

    # ── Fetch bars
    bars = broker.get_bars(symbol, count=max(
        config.SLOW_MA_PERIOD + 5,
        config.RSI_PERIOD + 5,
        config.ATR_PERIOD + 5,
    ))
    if bars is None:
        log.warning("%s | Could not get bar data — symbol may not be available on this account", symbol)
        return
    closes, highs, lows, point = bars

    # ── Evaluate signal
    setup = strategy.analyse(closes, highs, lows, point)

    # ── Always show live market status so you can see the bot is active
    from utils import ema as _ema, rsi as _rsi
    fast_arr = _ema(closes, config.FAST_MA_PERIOD)
    slow_arr = _ema(closes, config.SLOW_MA_PERIOD)
    rsi_val  = _rsi(closes, config.RSI_PERIOD)
    gap      = fast_arr[-1] - slow_arr[-1]
    trend    = "EMA above (bullish bias)" if gap > 0 else "EMA below (bearish bias)"
    log.info(
        "%s | Price: %.5f | EMA9: %.5f | EMA21: %.5f | RSI: %.1f | %s | Signal: %s",
        symbol, closes[-1],
        fast_arr[-1], slow_arr[-1],
        rsi_val, trend,
        setup.signal.name,
    )

    if setup.signal == strategy.Signal.NONE:
        return

    # ── Size the position
    lot = risk.calculate_lot_size(symbol, setup.sl, setup.entry_price)
    if lot <= 0:
        log.warning("%s | Lot size calculated as 0 — check account balance or SL distance", symbol)
        return

    # ── Place the order
    order_type = (
        mt5.ORDER_TYPE_BUY if setup.signal == strategy.Signal.BUY
        else mt5.ORDER_TYPE_SELL
    )
    direction = "BUY" if setup.signal == strategy.Signal.BUY else "SELL"
    log.info(
        "*** SIGNAL %s %s | entry≈%.5f | SL=%.5f | TP=%.5f | lot=%.2f | ATR=%.5f ***",
        direction, symbol,
        setup.entry_price, setup.sl, setup.tp,
        lot, setup.atr_value,
    )
    broker.send_order(symbol, order_type, lot, setup.sl, setup.tp)


# ─── Full scan across all symbols ─────────────────────────────────────────────

def scan_all():
    log.info("─── Scanning %d symbol(s) on %s ───",
             len(config.SYMBOLS), config.TIMEFRAME)
    for sym in config.SYMBOLS:
        try:
            scan_symbol(sym)
        except Exception as exc:
            log.exception("Unexpected error scanning %s: %s", sym, exc)


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info("EGM Securities Trading Bot starting up")
    log.info("Account : auto-detected from running MT5 terminal")
    log.info("Symbols : %s", ", ".join(config.SYMBOLS))
    log.info("TF      : %s | Fast/Slow EMA: %d/%d | RSI: %d",
             config.TIMEFRAME,
             config.FAST_MA_PERIOD, config.SLOW_MA_PERIOD,
             config.RSI_PERIOD)
    log.info("Risk    : %.1f%% per trade | R:R 1:%.1f",
             config.RISK_PERCENT, config.REWARD_RATIO)
    log.info("=" * 60)

    if not broker.connect():
        log.error("Cannot connect to MT5. Check login credentials and that the terminal is running.")
        sys.exit(1)

    try:
        # First scan happens immediately — no waiting
        scan_all()

        while _running:
            log.info("Next scan in %d seconds. Press Ctrl-C to stop.",
                     config.POLL_INTERVAL_SECONDS)
            # Sleep in small increments so Ctrl-C is responsive
            for _ in range(config.POLL_INTERVAL_SECONDS * 2):
                if not _running:
                    break
                time.sleep(0.5)

            if _running:
                scan_all()

    finally:
        broker.disconnect()
        log.info("Bot stopped cleanly.")


if __name__ == "__main__":
    main()
