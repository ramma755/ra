# EGM Securities Trading Bot

An automated Python trading bot that connects directly to the **MetaTrader 5**
terminal running under your EGM Securities account and trades using an
**EMA-crossover + RSI-filter** strategy with dynamic ATR-based risk management.

The bot scans every configured symbol **immediately on startup** and then
repeats every `POLL_INTERVAL_SECONDS` seconds.

---

## Strategy

| Component | Detail |
|-----------|--------|
| Entry | Fast EMA (default 9) crosses above/below Slow EMA (default 21) |
| Filter | RSI (14) must not be overbought/oversold at the crossover |
| Stop-Loss | `ATR(14) × 1.5` placed on the opposite side of entry |
| Take-Profit | `SL distance × 2.0` (configurable reward ratio) |

---

## Requirements

- **Windows PC or VPS** with **MetaTrader 5** installed and logged in to your
  EGM Securities account (MT5 must be running when the bot starts).
- Python **3.9 +** (64-bit, matching the MT5 bitness).

> **Note:** The `MetaTrader5` Python package only works on Windows.  
> Use a Windows VPS or run the bot on the same machine as your MT5 terminal.

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Edit `config.py`

Open `config.py` and fill in your credentials:

```python
MT5_LOGIN    = 1234567          # your EGM Securities account number
MT5_PASSWORD = "YourPassword"   # MT5 password
MT5_SERVER   = "EGMSecurities-Live"   # or "EGMSecurities-Demo"
```

Customise the symbols, timeframe, and risk settings to your liking.

### 3. Start the bot

Make sure MetaTrader 5 is **open and logged in**, then run:

```bash
python bot.py
```

The bot will:
1. Connect to MT5.
2. Print account balance/name to the console.
3. **Immediately** scan all symbols for signals.
4. Place orders where valid signals are found.
5. Repeat every `POLL_INTERVAL_SECONDS` seconds.

Press **Ctrl-C** to stop gracefully.

---

## Configuration reference (`config.py`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MT5_LOGIN` | `0` | EGM Securities account number |
| `MT5_PASSWORD` | `""` | MT5 account password |
| `MT5_SERVER` | `EGMSecurities-Live` | MT5 server name |
| `SYMBOLS` | EURUSD, GBPUSD, USDJPY, XAUUSD | Symbols to trade |
| `TIMEFRAME` | `M15` | Chart timeframe |
| `FAST_MA_PERIOD` | `9` | Fast EMA period |
| `SLOW_MA_PERIOD` | `21` | Slow EMA period |
| `RSI_PERIOD` | `14` | RSI period |
| `RSI_OVERBOUGHT` | `70` | Skip BUY signals above this |
| `RSI_OVERSOLD` | `30` | Skip SELL signals below this |
| `RISK_PERCENT` | `1.0` | % of balance risked per trade |
| `REWARD_RATIO` | `2.0` | TP = SL × this value |
| `ATR_PERIOD` | `14` | ATR period for SL sizing |
| `ATR_MULTIPLIER` | `1.5` | SL = ATR × this value |
| `MAX_OPEN_TRADES` | `5` | Max simultaneous positions (all symbols) |
| `MAX_TRADES_PER_SYMBOL` | `1` | Max positions per symbol |
| `MAGIC_NUMBER` | `20260626` | Unique ID for bot orders |
| `POLL_INTERVAL_SECONDS` | `30` | Seconds between scans |
| `LOG_FILE` | `trading_bot.log` | Log file path |
| `LOG_LEVEL` | `INFO` | Log verbosity |

---

## File structure

```
trading_bot/
├── bot.py           — Main loop (entry point)
├── config.py        — All tuneable settings
├── strategy.py      — Signal generation (EMA crossover + RSI)
├── risk.py          — Position sizing (% risk model)
├── broker.py        — MT5 API wrapper (connect, bars, orders)
├── utils.py         — Indicators (EMA, RSI, ATR) + logger
└── requirements.txt
```

---

## Risk warning

Trading forex and CFDs involves substantial risk and is not suitable for all
investors. Past performance is not indicative of future results. Always test
on a **demo account** before going live. Never risk money you cannot afford
to lose.
