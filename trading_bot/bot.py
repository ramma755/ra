"""
EGM Securities Trading Bot — High-Accuracy Edition
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7-gate entry system targeting ~80% win rate.
The bot trades less but wins more — quality over quantity.

Gates:
  1. H4 macro trend alignment
  2. H1 intermediate trend alignment
  3. ADX ≥ 25 (strong trend, not choppy)
  4. M15 fresh EMA crossover (within last 3 candles)
  5. MACD line AND histogram both confirming direction
  6. Stochastic %K + RSI not at extremes
  7. Price pulled back to EMA + strong candle body (≥ 60%)

Active protection:
  Break-even at 1R | Trailing stop from 1.5R

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
    """Run all 7 entry gates for one symbol and place an order if all pass."""

    if broker.open_position_count_total() >= config.MAX_OPEN_TRADES:
        log.info("%s | SKIP — max total positions (%d) reached", symbol, config.MAX_OPEN_TRADES)
        return
    if broker.open_position_count_symbol(symbol) >= config.MAX_TRADES_PER_SYMBOL:
        log.info("%s | SKIP — already have an open position", symbol)
        return
    if not is_trading_session():
        log.info("%s | SKIP — outside session (07:00–21:00 UTC Mon–Fri)", symbol)
        return
    if not broker.spread_ok(symbol):
        return

    # ── Fetch bars for all three timeframes
    needed = max(
        config.SLOW_MA_PERIOD + config.MACD_SLOW + config.MACD_SIGNAL + 10,
        config.RSI_PERIOD + config.STOCH_K_PERIOD + config.STOCH_D_PERIOD + 5,
        config.ATR_PERIOD + 5,
    )

    bars = broker.get_bars(symbol, count=needed)
    if bars is None:
        log.warning("%s | Cannot get M15 bars — symbol may not be available", symbol)
        return
    closes, highs, lows, opens, point = bars

    trend = broker.get_trend_bars(symbol, count=config.SLOW_MA_PERIOD + config.ADX_PERIOD * 2 + 10)
    if trend is None:
        log.warning("%s | Cannot get H1 bars", symbol)
        return
    h1_closes, h1_highs, h1_lows = trend

    macro = broker.get_macro_bars(symbol, count=config.SLOW_MA_PERIOD + 10)
    if macro is None:
        log.warning("%s | Cannot get H4 bars", symbol)
        return
    h4_closes, h4_highs, h4_lows = macro

    # ── Run 7-gate strategy
    setup = strategy.analyse(
        closes, highs, lows, opens,
        h1_closes, h1_highs, h1_lows,
        h4_closes, h4_highs, h4_lows,
    )

    log.info(
        "%s | %.5f | %s | %s",
        symbol, closes[-1],
        setup.signal.name,
        " | ".join(setup.reasons),
    )

    if setup.signal == strategy.Signal.NONE:
        return

    lot = risk.calculate_lot_size(symbol, setup.sl, setup.entry_price)
    if lot <= 0:
        log.warning("%s | Lot size is 0 — check balance or SL distance", symbol)
        return

    order_type = (
        mt5.ORDER_TYPE_BUY if setup.signal == strategy.Signal.BUY
        else mt5.ORDER_TYPE_SELL
    )
    log.info(
        "🚀 ENTERING %s %s | entry≈%.5f | SL=%.5f | TP=%.5f | lot=%.2f",
        setup.signal.name, symbol,
        setup.entry_price, setup.sl, setup.tp, lot,
    )
    broker.send_order(symbol, order_type, lot, setup.sl, setup.tp)


# ─── Full scan ─────────────────────────────────────────────────────────────────

def scan_all():
    log.info("━━━ Scanning %d symbol(s) | H4+H1+M15 | 7 gates ━━━", len(config.SYMBOLS))
    for sym in config.SYMBOLS:
        try:
            scan_symbol(sym)
        except Exception as exc:
            log.exception("Error scanning %s: %s", sym, exc)


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 65)
    log.info("  EGM Securities Trading Bot — High-Accuracy Edition")
    log.info("  Account   : auto-detected from running MT5 terminal")
    log.info("  Symbols   : %s", ", ".join(config.SYMBOLS))
    log.info("  Timeframes: %s (entry) | %s (trend) | %s (macro)",
             config.ENTRY_TF, config.TREND_TF, config.MACRO_TF)
    log.info("  Risk      : %.1f%% per trade | R:R = 1:%.1f",
             config.RISK_PERCENT, config.REWARD_RATIO)
    log.info("  Gates     : H4 trend | H1 trend | ADX≥%d | EMA cross | MACD | Stoch+RSI | Pullback+Body",
             config.ADX_MIN)
    log.info("  Session   : %02d:00–%02d:00 UTC | Spread max: %d pts",
             config.SESSION_START_UTC, config.SESSION_END_UTC, config.MAX_SPREAD_POINTS)
    log.info("  Protection: Break-even at %.1fR | Trail from %.1fR",
             config.BREAKEVEN_R, config.TRAIL_START_R)
    log.info("=" * 65)

    if not broker.connect():
        log.error("Cannot connect to MT5. Make sure it is open and logged in.")
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
            if not _running:
                break
            scan_all()
            broker.manage_open_positions()

    finally:
        broker.disconnect()
        log.info("Bot stopped cleanly.")


if __name__ == "__main__":
    main()
