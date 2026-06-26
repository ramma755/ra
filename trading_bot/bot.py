"""
EGM Securities Trading Bot — Sharp Edition
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every entry must pass 5 gates:
  1. H1 trend direction (trade WITH the trend)
  2. M15 EMA crossover (entry timing)
  3. MACD histogram confirmation (momentum backing the move)
  4. RSI filter (not overbought/oversold)
  5. Last candle body confirmation (real move, not a wick)

Active trade protection:
  - Break-even: SL moved to entry once 1R in profit
  - Trailing stop: SL trails price once 1.5R in profit

Session filter:
  - New entries only during London + New York sessions (07:00–21:00 UTC)
  - Spread guard: skip entry if spread is unusually wide

Run:
    python bot.py
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
from utils import setup_logger, is_trading_session


log = setup_logger()
_running = True


def _handle_sigint(sig, frame):
    global _running
    log.info("Shutdown signal received — stopping after current cycle...")
    _running = False


signal.signal(signal.SIGINT,  _handle_sigint)
signal.signal(signal.SIGTERM, _handle_sigint)


# ─── Single-symbol entry scan ──────────────────────────────────────────────────

def scan_symbol(symbol: str):
    """Run all entry gates for one symbol and place an order if all pass."""

    # ── Guard: position limits
    if broker.open_position_count_total() >= config.MAX_OPEN_TRADES:
        log.info("%s | SKIP — max total positions (%d) reached", symbol, config.MAX_OPEN_TRADES)
        return
    if broker.open_position_count_symbol(symbol) >= config.MAX_TRADES_PER_SYMBOL:
        log.info("%s | SKIP — already have an open position", symbol)
        return

    # ── Guard: session filter (only trade during liquid hours)
    if not is_trading_session():
        log.info("%s | SKIP — outside trading session (07:00–21:00 UTC, Mon–Fri)", symbol)
        return

    # ── Guard: spread check
    if not broker.spread_ok(symbol):
        return

    # ── Fetch M15 bars
    bars = broker.get_bars(symbol, count=max(
        config.SLOW_MA_PERIOD + config.MACD_SLOW + config.MACD_SIGNAL + 5,
        config.RSI_PERIOD + 5,
        config.ATR_PERIOD + 5,
    ))
    if bars is None:
        log.warning("%s | Could not get M15 bars — symbol may not be on this account", symbol)
        return
    closes, highs, lows, opens, point = bars

    # ── Fetch H1 trend bars
    trend = broker.get_trend_bars(symbol, count=config.SLOW_MA_PERIOD + 10)
    if trend is None:
        log.warning("%s | Could not get H1 bars for trend filter", symbol)
        return
    h1_closes, h1_highs, h1_lows = trend

    # ── Run strategy (all 5 gates)
    setup = strategy.analyse(closes, highs, lows, opens, h1_closes, h1_highs, h1_lows)

    # Log every symbol scan so you can see the bot is alive
    log.info(
        "%s | Price: %.5f | Signal: %-5s | %s",
        symbol, closes[-1], setup.signal.name,
        " | ".join(setup.reasons),
    )

    if setup.signal == strategy.Signal.NONE:
        return

    # ── Size the position
    lot = risk.calculate_lot_size(symbol, setup.sl, setup.entry_price)
    if lot <= 0:
        log.warning("%s | Lot size is 0 — check balance or SL distance", symbol)
        return

    # ── Place the order
    order_type = (
        mt5.ORDER_TYPE_BUY if setup.signal == strategy.Signal.BUY
        else mt5.ORDER_TYPE_SELL
    )
    direction = setup.signal.name
    log.info(
        "🚀 ENTERING %s %s | entry≈%.5f | SL=%.5f | TP=%.5f | lot=%.2f",
        direction, symbol,
        setup.entry_price, setup.sl, setup.tp, lot,
    )
    broker.send_order(symbol, order_type, lot, setup.sl, setup.tp)


# ─── Full scan ─────────────────────────────────────────────────────────────────

def scan_all():
    log.info("━━━ Scanning %d symbol(s) on %s ━━━", len(config.SYMBOLS), config.ENTRY_TF)
    for sym in config.SYMBOLS:
        try:
            scan_symbol(sym)
        except Exception as exc:
            log.exception("Unexpected error scanning %s: %s", sym, exc)


# ─── Main loop ─────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 65)
    log.info("  EGM Securities Trading Bot — Sharp Edition")
    log.info("  Account  : auto-detected from running MT5 terminal")
    log.info("  Symbols  : %s", ", ".join(config.SYMBOLS))
    log.info("  Entry TF : %s  |  Trend TF : %s", config.ENTRY_TF, config.TREND_TF)
    log.info("  EMA      : %d / %d  |  RSI: %d  |  MACD: %d/%d/%d",
             config.FAST_MA_PERIOD, config.SLOW_MA_PERIOD, config.RSI_PERIOD,
             config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL)
    log.info("  Risk     : %.1f%% per trade  |  R:R = 1:%.1f",
             config.RISK_PERCENT, config.REWARD_RATIO)
    log.info("  Session  : %02d:00 – %02d:00 UTC (Mon–Fri)",
             config.SESSION_START_UTC, config.SESSION_END_UTC)
    log.info("  Max spread: %d pts  |  Break-even at %.1fR  |  Trail at %.1fR",
             config.MAX_SPREAD_POINTS, config.BREAKEVEN_R, config.TRAIL_START_R)
    log.info("=" * 65)

    if not broker.connect():
        log.error("Cannot connect to MT5. Make sure the terminal is open and logged in.")
        sys.exit(1)

    try:
        # ── Immediate first scan on startup
        scan_all()
        broker.manage_open_positions()

        while _running:
            log.info("Next scan in %ds — Press Ctrl-C to stop.", config.POLL_INTERVAL_SECONDS)
            for _ in range(config.POLL_INTERVAL_SECONDS * 2):
                if not _running:
                    break
                time.sleep(0.5)

            if not _running:
                break

            scan_all()
            # Manage SL on open trades every cycle (break-even + trailing)
            broker.manage_open_positions()

    finally:
        broker.disconnect()
        log.info("Bot stopped cleanly.")


if __name__ == "__main__":
    main()
