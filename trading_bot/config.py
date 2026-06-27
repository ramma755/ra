"""
EGM Securities Trading Bot — Scalping Configuration

HOW TO SWITCH BETWEEN LIVE AND DEMO
─────────────────────────────────────
Open MetaTrader 5, log in to the account you want, then start the bot.
The bot connects to whatever account MT5 is already logged in to automatically.
No file editing needed to switch accounts.
"""

# ── MT5 Connection ──────────────────────────────────────────────────────────────
# No credentials needed. Bot attaches to the running MT5 terminal automatically.

# ── Trading Universe ────────────────────────────────────────────────────────────
SYMBOLS = [
    # Forex Majors
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    # EUR Crosses
    "EURGBP", "EURJPY", "EURCHF", "EURAUD", "EURCAD", "EURNZD",
    "EURNOK", "EURSEK", "EURSGD", "EURZAR", "EURMXN", "EURPLN",
    # GBP Crosses
    "GBPJPY", "GBPCHF", "GBPAUD", "GBPCAD", "GBPNZD",
    "GBPNOK", "GBPSEK", "GBPSGD", "GBPZAR",
    # AUD Crosses
    "AUDJPY", "AUDCAD", "AUDCHF", "AUDNZD", "AUDSGD",
    # CAD Crosses
    "CADJPY", "CADCHF", "CADSGD",
    # Other Crosses
    "CHFJPY", "NZDCAD", "NOKSEK", "NOKJPY", "SEKJPY", "SGDJPY", "MXNJPY",
    # USD Exotics
    "USDMXN", "USDNOK", "USDAED", "USDCNH", "USDHKD",
    # Commodities
    "XAUUSD", "USOILRoll", "UKOILRoll",
    # Indices
    "US500Roll", "US30Roll", "UT100Roll", "UK100Roll", "DE40Roll",
    # Stocks
    "NVIDIA", "Apple", "Tesla", "AMD", "Facebook", "Microsoft", "Netflix",
    # Crypto
    "ETHUSD.lv", "LTCUSD.lv",
]

# ── Timeframes ──────────────────────────────────────────────────────────────────
ENTRY_TF = "M5"    # where signals are detected
TREND_TF  = "H1"   # trend direction filter

# ── EMA ─────────────────────────────────────────────────────────────────────────
FAST_MA_PERIOD = 8
SLOW_MA_PERIOD = 21

# ── RSI ─────────────────────────────────────────────────────────────────────────
RSI_PERIOD     = 7
RSI_OVERBOUGHT = 65
RSI_OVERSOLD   = 35

# ── MACD ────────────────────────────────────────────────────────────────────────
MACD_FAST   = 8
MACD_SLOW   = 21
MACD_SIGNAL = 5

# ── ADX ─────────────────────────────────────────────────────────────────────────
ADX_PERIOD = 14
ADX_MIN    = 20

# ── Stochastic ──────────────────────────────────────────────────────────────────
STOCH_K_PERIOD = 5
STOCH_D_PERIOD = 3

# ── Candle Body ─────────────────────────────────────────────────────────────────
MIN_BODY_RATIO = 0.50

# ── Pullback Entry ──────────────────────────────────────────────────────────────
PULLBACK_ATR_MULT = 0.8

# ── Spread Filter ───────────────────────────────────────────────────────────────
# Percentage-based — works for forex, stocks, indices, and crypto.
MAX_SPREAD_PCT = 0.10   # skip if spread > 0.10% of price

# ── Risk Management ─────────────────────────────────────────────────────────────
RISK_PERCENT   = 1.0
REWARD_RATIO   = 3.0   # risk $1 to make $3 — only needs 25% win rate to profit
ATR_PERIOD     = 14
ATR_MULTIPLIER = 1.0

MAX_OPEN_TRADES       = 6
MAX_TRADES_PER_SYMBOL = 1

# ── Trade Protection ────────────────────────────────────────────────────────────
BREAKEVEN_R    = 0.8
TRAIL_START_R  = 1.0
TRAIL_STEP_ATR = 0.5

# ── Execution ───────────────────────────────────────────────────────────────────
MAGIC_NUMBER = 20260626
SLIPPAGE     = 10
COMMENT      = "EGMBot"

# ── Bot Loop ────────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 15

# ── Logging ─────────────────────────────────────────────────────────────────────
LOG_FILE  = "trading_bot.log"
LOG_LEVEL = "INFO"
