"""
EGM Securities Trading Bot — Configuration

HOW TO SWITCH BETWEEN LIVE AND DEMO
─────────────────────────────────────
Do NOT touch this file for that.
Just open MetaTrader 5, log in to whichever account you want (live or demo),
and then start the bot. The bot automatically connects to whatever account
MT5 is already logged in to.
"""

# ─── MT5 Connection ────────────────────────────────────────────────────────────
# No credentials needed here.
# The bot attaches to the MT5 terminal that is already running and logged in.

# ─── Trading Universe ──────────────────────────────────────────────────────────
SYMBOLS = [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "XAUUSD",       # Gold
    "ETHUSD.lv",    # Ethereum leverage
    "LTCUSD.lv",    # Litecoin leverage
]

# ─── Timeframes ────────────────────────────────────────────────────────────────
# ENTRY_TF  : where signals are detected (M15 recommended)
# TREND_TF  : higher timeframe used to confirm the overall trend (H1 recommended)
# Only trades aligned with the H1 trend are taken — this is the #1 win-rate booster.
ENTRY_TF = "M15"
TREND_TF = "H1"

# ─── Strategy: EMA Crossover + MACD + RSI (triple confirmation) ───────────────
FAST_MA_PERIOD = 9
SLOW_MA_PERIOD = 21
RSI_PERIOD     = 14
RSI_OVERBOUGHT = 60    # Tighter than default 70 — avoids chasing exhausted moves
RSI_OVERSOLD   = 40    # Tighter than default 30

# MACD (Moving Average Convergence Divergence)
MACD_FAST   = 12
MACD_SLOW   = 26
MACD_SIGNAL = 9

# ─── Session Filter ────────────────────────────────────────────────────────────
# Only trade during the two most liquid sessions (UTC times).
# Outside these windows the bot watches but does NOT place new orders.
# London session : 07:00 – 16:00 UTC
# New York session: 13:00 – 21:00 UTC  (overlap 13-16 UTC is the best window)
SESSION_START_UTC = 7    # hour (inclusive)
SESSION_END_UTC   = 21   # hour (exclusive)
TRADE_ON_WEEKENDS = False  # Forex is closed; crypto is open — set True for crypto-only

# ─── Spread Filter ─────────────────────────────────────────────────────────────
# Skip entry if the current spread exceeds this many POINTS.
# Prevents entering during news spikes or low-liquidity periods.
MAX_SPREAD_POINTS = 30   # ~3 pips for a 5-digit broker (EURUSD normal spread ≈ 1–2 pip)

# ─── Risk Management ───────────────────────────────────────────────────────────
RISK_PERCENT   = 1.0     # % of account balance risked per trade
REWARD_RATIO   = 2.0     # TP = SL distance × this value  (1:2 R:R)
ATR_PERIOD     = 14
ATR_MULTIPLIER = 1.5     # SL = ATR × this value

MAX_OPEN_TRADES       = 5
MAX_TRADES_PER_SYMBOL = 1

# ─── Trade Management (protect profits automatically) ──────────────────────────
# Break-even: once price moves BREAKEVEN_R × SL distance in your favour,
#             the stop is moved to entry price (you cannot lose on that trade).
BREAKEVEN_R = 1.0

# Trailing stop: once the trade is profitable beyond TRAIL_START_R × SL distance,
#                the stop trails behind price by TRAIL_STEP_ATR × ATR.
TRAIL_START_R    = 1.5   # start trailing after 1.5× risk is in profit
TRAIL_STEP_ATR   = 1.0   # trail distance = 1 × ATR

# ─── Execution ─────────────────────────────────────────────────────────────────
MAGIC_NUMBER = 20260626
SLIPPAGE     = 10
COMMENT      = "EGMBot"

# ─── Bot Loop ──────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 60

# ─── Logging ───────────────────────────────────────────────────────────────────
LOG_FILE  = "trading_bot.log"
LOG_LEVEL = "INFO"
