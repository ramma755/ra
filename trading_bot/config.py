"""
EGM Securities Trading Bot — Scalping Configuration

HOW TO SWITCH BETWEEN LIVE AND DEMO
─────────────────────────────────────
Open MetaTrader 5, log in to the account you want, then start the bot.
The bot connects to whatever account MT5 is already logged in to automatically.
"""

# ─── MT5 Connection ─────────────────────────────────────────────────────────────
# No credentials needed. Bot attaches to the running MT5 terminal automatically.

# ─── Trading Universe ───────────────────────────────────────────────────────────
# All symbols visible in the EGMSecurities Market Watch.
# More markets = more signals per hour = more trading opportunities.
SYMBOLS = [
    # ── Forex Majors ──────────────────────────────────────────────
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "USDCAD",
    "AUDUSD",
    "NZDUSD",

    # ── Forex Crosses — EUR ───────────────────────────────────────
    "EURGBP",
    "EURJPY",
    "EURCHF",
    "EURAUD",
    "EURCAD",
    "EURNZD",
    "EURNOK",
    "EURSEK",
    "EURSGD",
    "EURZAR",
    "EURMXN",
    "EURPLN",

    # ── Forex Crosses — GBP ───────────────────────────────────────
    "GBPJPY",
    "GBPCHF",
    "GBPAUD",
    "GBPCAD",
    "GBPNZD",
    "GBPNOK",
    "GBPSEK",
    "GBPSGD",
    "GBPZAR",

    # ── Forex Crosses — AUD ───────────────────────────────────────
    "AUDJPY",
    "AUDCAD",
    "AUDCHF",
    "AUDNZD",
    "AUDSGD",

    # ── Forex Crosses — CAD ───────────────────────────────────────
    "CADJPY",
    "CADCHF",
    "CADSGD",

    # ── Forex Crosses — Other ─────────────────────────────────────
    "CHFJPY",
    "NZDCAD",
    "NOKSEK",
    "NOKJPY",
    "SEKJPY",
    "SGDJPY",
    "MXNJPY",

    # ── USD Exotics ───────────────────────────────────────────────
    "USDMXN",
    "USDNOK",
    "USDAED",
    "USDCNH",
    "USDHKD",

    # ── Commodities ───────────────────────────────────────────────
    "XAUUSD",       # Gold
    "USOILRoll",    # US Oil (WTI)
    "UKOILRoll",    # UK Oil (Brent)

    # ── Stock Indices ─────────────────────────────────────────────
    "US500Roll",    # S&P 500
    "US30Roll",     # Dow Jones
    "UT100Roll",    # Nasdaq 100
    "UK100Roll",    # FTSE 100
    "DE40Roll",     # DAX 40

    # ── Stocks ────────────────────────────────────────────────────
    "NVIDIA",
    "Apple",
    "Tesla",
    "AMD",
    "Facebook",
    "Microsoft",
    "Netflix",

    # ── Crypto ────────────────────────────────────────────────────
    "ETHUSD.lv",    # Ethereum leverage
    "LTCUSD.lv",    # Litecoin leverage
]

# ─── Timeframes ─────────────────────────────────────────────────────────────────
# Scalping setup:
#   M5  = entry signals  (fires every few minutes)
#   M15 = trend filter   (intermediate direction)
# Both must agree before any trade is placed.
ENTRY_TF = "M5"
TREND_TF = "M15"
MACRO_TF = "H1"    # big-picture safety net

# ─── EMA Settings ───────────────────────────────────────────────────────────────
# Faster periods = more signals on M5
FAST_MA_PERIOD = 8
SLOW_MA_PERIOD = 21

# ─── RSI ────────────────────────────────────────────────────────────────────────
RSI_PERIOD     = 7     # fast RSI reacts quickly on M5
RSI_OVERBOUGHT = 65
RSI_OVERSOLD   = 35

# ─── MACD ───────────────────────────────────────────────────────────────────────
MACD_FAST   = 8
MACD_SLOW   = 21
MACD_SIGNAL = 5    # faster signal line for scalping

# ─── ADX (Trend Strength) ───────────────────────────────────────────────────────
ADX_PERIOD = 14
ADX_MIN    = 20    # lower than swing trading — scalping works in lighter trends too

# ─── Stochastic ─────────────────────────────────────────────────────────────────
STOCH_K_PERIOD = 5    # very fast stochastic for scalping
STOCH_D_PERIOD = 3

# ─── Candle Body Strength ───────────────────────────────────────────────────────
MIN_BODY_RATIO = 0.50   # 50% body — slightly relaxed for faster signals

# ─── Pullback Entry ─────────────────────────────────────────────────────────────
# Price must be within this many ATRs of the slow EMA before entering.
PULLBACK_ATR_MULT = 0.8   # wider window to allow more entries on M5

# ─── Session Filter ─────────────────────────────────────────────────────────────
# Disabled — the bot trades 24/7.
# The SPREAD filter and ADX filter already protect against low-liquidity periods:
#   - Wide spread  → entry skipped automatically
#   - ADX < 20     → choppy/ranging market → entry skipped automatically
SESSION_START_UTC = 0
SESSION_END_UTC   = 24
TRADE_ON_WEEKENDS = True

# ─── Spread Filter ──────────────────────────────────────────────────────────────
# Percentage-based spread check — works for ALL instrument types.
# spread % = (ask - bid) / bid × 100
# Forex majors normal spread: ~0.01–0.03%
# Stocks / indices normal spread: ~0.02–0.08%
# Skip entry if spread exceeds this threshold.
MAX_SPREAD_PCT = 0.10   # 0.10% — catches genuinely wide spreads on any instrument

# ─── Risk Management ────────────────────────────────────────────────────────────
RISK_PERCENT   = 1.0
REWARD_RATIO   = 1.5      # 1:1.5 R:R — smaller TP that gets hit quickly
ATR_PERIOD     = 14
ATR_MULTIPLIER = 1.0      # tighter SL on scalping (1×ATR instead of 1.5×)

MAX_OPEN_TRADES       = 6   # allow more simultaneous trades for scalping
MAX_TRADES_PER_SYMBOL = 1

# ─── Trade Management ───────────────────────────────────────────────────────────
BREAKEVEN_R    = 0.8   # move to break-even sooner (protects quick scalp gains)
TRAIL_START_R  = 1.0   # start trailing at 1R
TRAIL_STEP_ATR = 0.5   # tighter trail on scalps

# ─── Execution ──────────────────────────────────────────────────────────────────
MAGIC_NUMBER = 20260626
SLIPPAGE     = 10
COMMENT      = "EGMBot"

# ─── Bot Loop ───────────────────────────────────────────────────────────────────
# Scan every 15 seconds — catches signals within seconds of them forming on M5
POLL_INTERVAL_SECONDS = 15

# ─── Logging ────────────────────────────────────────────────────────────────────
LOG_FILE  = "trading_bot.log"
LOG_LEVEL = "INFO"
