"""
EGM Securities Trading Bot — High-Accuracy Configuration

HOW TO SWITCH BETWEEN LIVE AND DEMO
─────────────────────────────────────
Do NOT touch this file for that.
Open MetaTrader 5, log in to the account you want, then start the bot.
The bot connects to whatever account MT5 is already logged in to.
"""

# ─── MT5 Connection ─────────────────────────────────────────────────────────────
# No credentials needed. Bot attaches to the running MT5 terminal automatically.

# ─── Trading Universe ───────────────────────────────────────────────────────────
SYMBOLS = [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "XAUUSD",       # Gold
    "ETHUSD.lv",    # Ethereum leverage
    "LTCUSD.lv",    # Litecoin leverage
]

# ─── Timeframes ─────────────────────────────────────────────────────────────────
# Three-timeframe system:
#   H4  = macro trend  (which direction is the market heading overall?)
#   H1  = structure    (is the intermediate move supporting the trade?)
#   M15 = entry timing (exactly when do we get in?)
#
# All three must agree for a trade to be placed.
ENTRY_TF = "M15"   # where crossover signal is detected
TREND_TF  = "H1"   # intermediate trend confirmation
MACRO_TF  = "H4"   # macro (big-picture) trend filter

# ─── EMA Settings ───────────────────────────────────────────────────────────────
FAST_MA_PERIOD = 9
SLOW_MA_PERIOD = 21

# ─── RSI ────────────────────────────────────────────────────────────────────────
RSI_PERIOD     = 14
RSI_OVERBOUGHT = 55   # Very tight — only buy when RSI has real room to run up
RSI_OVERSOLD   = 45   # Very tight — only sell when RSI has real room to run down

# ─── MACD ───────────────────────────────────────────────────────────────────────
MACD_FAST   = 12
MACD_SLOW   = 26
MACD_SIGNAL = 9
# MACD line must also be on the correct side of zero (not just histogram)
# BUY:  MACD line > 0
# SELL: MACD line < 0

# ─── ADX (Trend Strength) ────────────────────────────────────────────────────────
# ADX measures how strong the trend is, regardless of direction.
# < 20  = choppy, sideways market — bot will NOT trade
# 20–25 = developing trend — borderline
# > 25  = strong trend — bot WILL trade
# > 40  = very strong trend (best setups)
ADX_PERIOD    = 14
ADX_MIN       = 25    # minimum ADX to allow entry

# ─── Stochastic ─────────────────────────────────────────────────────────────────
STOCH_K_PERIOD = 14
STOCH_D_PERIOD = 3
# For BUY:  %K must be below 60 (not overbought) and rising
# For SELL: %K must be above 40 (not oversold) and falling

# ─── Candle Body Strength ────────────────────────────────────────────────────────
# The signal candle's body must be at least this fraction of the total candle range.
# 0.60 = body must be 60% of the high-low range (strong directional candle, no wicks).
MIN_BODY_RATIO = 0.60

# ─── Pullback Entry ─────────────────────────────────────────────────────────────
# After an EMA crossover, the bot does NOT enter immediately.
# It waits for price to pull back close to the EMA (better price, tighter stop).
# Entry is only valid if price is within PULLBACK_ATR_MULT × ATR of the slow EMA.
# This is the single biggest accuracy booster — you enter at value, not at extension.
PULLBACK_ATR_MULT = 0.5   # price must be within 0.5 × ATR of the slow EMA

# ─── Session Filter ─────────────────────────────────────────────────────────────
SESSION_START_UTC  = 7    # London open
SESSION_END_UTC    = 21   # NY close
TRADE_ON_WEEKENDS  = False

# ─── Spread Filter ──────────────────────────────────────────────────────────────
MAX_SPREAD_POINTS = 25    # Skip if spread > 2.5 pips (5-digit broker)

# ─── Risk Management ────────────────────────────────────────────────────────────
RISK_PERCENT   = 1.0      # % of account balance risked per trade
REWARD_RATIO   = 2.0      # TP = SL × this  (1:2 R:R)
ATR_PERIOD     = 14
ATR_MULTIPLIER = 1.5      # SL = ATR × this

MAX_OPEN_TRADES       = 5
MAX_TRADES_PER_SYMBOL = 1

# ─── Trade Management ────────────────────────────────────────────────────────────
BREAKEVEN_R      = 1.0    # Move SL to entry after 1× risk in profit
TRAIL_START_R    = 1.5    # Start trailing after 1.5× risk in profit
TRAIL_STEP_ATR   = 1.0    # Trail distance = 1 × ATR

# ─── Execution ──────────────────────────────────────────────────────────────────
MAGIC_NUMBER = 20260626
SLIPPAGE     = 10
COMMENT      = "EGMBot"

# ─── Bot Loop ───────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 60

# ─── Logging ────────────────────────────────────────────────────────────────────
LOG_FILE  = "trading_bot.log"
LOG_LEVEL = "INFO"
