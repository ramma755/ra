"""
EGM Securities Trading Bot — Configuration
All tuneable parameters live here. Edit this file before starting the bot.
"""

# ─── MT5 Connection ────────────────────────────────────────────────────────────
MT5_LOGIN    = 0          # Replace with your EGM Securities MT5 account number
MT5_PASSWORD = ""         # Replace with your MT5 password
MT5_SERVER   = "EGMSecurities-Live"  # Server name shown in the MT5 login screen
                                      # (use "EGMSecurities-Demo" for demo accounts)

# ─── Trading Universe ──────────────────────────────────────────────────────────
# List every symbol you want the bot to trade simultaneously.
SYMBOLS = [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "XAUUSD",   # Gold
]

# ─── Timeframe ─────────────────────────────────────────────────────────────────
# Supported values: M1 M5 M15 M30 H1 H4 D1
TIMEFRAME = "M15"

# ─── Strategy: Moving-Average Crossover + RSI Filter ──────────────────────────
FAST_MA_PERIOD = 9          # Fast EMA period
SLOW_MA_PERIOD = 21         # Slow EMA period
RSI_PERIOD     = 14         # RSI period
RSI_OVERBOUGHT = 70         # RSI level above which longs are skipped
RSI_OVERSOLD   = 30         # RSI level below which shorts are skipped

# ─── Risk Management ──────────────────────────────────────────────────────────
RISK_PERCENT   = 1.0        # % of account balance risked per trade
REWARD_RATIO   = 2.0        # Risk-to-reward ratio (TP = SL × REWARD_RATIO)
ATR_PERIOD     = 14         # ATR period for dynamic stop-loss sizing
ATR_MULTIPLIER = 1.5        # SL = ATR × ATR_MULTIPLIER

MAX_OPEN_TRADES      = 5    # Maximum simultaneous open positions (all symbols)
MAX_TRADES_PER_SYMBOL = 1   # Max simultaneous positions on a single symbol

# ─── Execution ─────────────────────────────────────────────────────────────────
MAGIC_NUMBER   = 20260626   # Unique identifier for this bot's orders
SLIPPAGE       = 10         # Maximum allowed slippage in points
COMMENT        = "EGMBot"   # Order comment visible in the terminal

# ─── Bot Loop ──────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 30  # How often the bot checks for new signals (seconds)
                             # Set to ≤ 5 for M1; 30 is fine for M15+

# ─── Logging ───────────────────────────────────────────────────────────────────
LOG_FILE  = "trading_bot.log"
LOG_LEVEL = "INFO"   # DEBUG | INFO | WARNING | ERROR
