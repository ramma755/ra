//+------------------------------------------------------------------+
//|                                          EMA_RSI_RiskBot_v2.mq5  |
//|              EMA crossover + RSI cross + ATR risk management     |
//+------------------------------------------------------------------+
#property strict
#property version   "2.11"

#include <Trade/Trade.mqh>
CTrade trade;

// -------------------- Inputs --------------------
input group "Signal Settings"
input ENUM_TIMEFRAMES SignalTF = PERIOD_CURRENT; // follows tester/chart timeframe
input int FastEMA = 9;
input int SlowEMA = 21;
input int RSIPeriod = 14;
input bool UseRSIExtremeCross = true;
input double RSIBuyLevel = 35.0;   // buy when RSI crosses up from oversold
input double RSISellLevel = 65.0;  // sell when RSI crosses down from overbought
input double RSICenterLevel = 50.0; // fallback cross if UseRSIExtremeCross=false

input group "Trend Filter (Higher Timeframe)"
input bool UseTrendFilter = true;
input ENUM_TIMEFRAMES TrendTF = PERIOD_H4;
input int TrendEMAPeriod = 200;

input group "Volatility Stops (ATR)"
input int ATRPeriod = 14;
input double SL_ATR_Mult = 1.5;
input double TP_ATR_Mult = 2.2;
input double MinSLPips = 30.0; // wider SL default for higher timeframes
input double MinTPPips = 60.0; // larger TP target to improve payoff ratio

input group "Risk Settings"
input bool UseRiskBasedLots = true;
input double RiskPerTradePct = 0.50; // % of balance per trade
input double FixedLots = 0.01;

input group "Execution Safety"
input int MaxSpreadPoints = 25;
input int SlippagePoints = 10;
input int CooldownBars = 5;
input bool OnePositionPerSymbol = true;
input long MagicNumber = 20260622;

input group "Account Protection"
input double MaxDailyLossPct = 3.0;
input int MaxTradesPerDay = 3;

input group "Trade Management"
input bool UseBreakEven = true;
input double BreakEvenRR = 1.0;          // move SL at +1R
input int BreakEvenOffsetPoints = 5;     // lock tiny profit
input bool UseTrailingStop = true;
input double TrailStartRR = 1.5;         // start trailing after +1.5R
input double TrailATRMult = 1.0;         // ATR trail distance

input group "Session Filter (Server Time)"
input bool UseSessionFilter = true;
input int SessionStartHour = 8;   // inclusive
input int SessionEndHour = 21;    // exclusive

// -------------------- Globals --------------------
int gFastHandle = INVALID_HANDLE;
int gSlowHandle = INVALID_HANDLE;
int gRsiHandle  = INVALID_HANDLE;
int gAtrHandle  = INVALID_HANDLE;
int gTrendHandle = INVALID_HANDLE;

ENUM_TIMEFRAMES gSignalTF = PERIOD_CURRENT;

datetime gLastSignalBarTime = 0;
datetime gLastTradeBarTime = 0;

datetime gTodayStart = 0;
double gDayStartEquity = 0.0;
int gTradesToday = 0;

//+------------------------------------------------------------------+
//| Utility                                                          |
//+------------------------------------------------------------------+
double PipSize()
{
   return (_Digits == 3 || _Digits == 5) ? (10.0 * _Point) : _Point;
}

double PipsToPrice(double pips)
{
   return pips * PipSize();
}

double MinStopDistancePrice()
{
   return (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
}

int VolumePrecisionFromStep(double step)
{
   int prec = 0;
   while(step < 1.0 && prec < 8)
   {
      step *= 10.0;
      prec++;
   }
   return prec;
}

double NormalizeVolume(double lots)
{
   double vMin  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vMax  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double vStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   if(vStep <= 0.0) vStep = 0.01;

   lots = MathMax(vMin, MathMin(vMax, lots));
   lots = MathFloor(lots / vStep) * vStep;

   return NormalizeDouble(lots, VolumePrecisionFromStep(vStep));
}

double NormalizePrice(double price)
{
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0)
      return NormalizeDouble(price, _Digits);

   double rounded = MathRound(price / tickSize) * tickSize;
   return NormalizeDouble(rounded, _Digits);
}

datetime StartOfDay(datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   return StructToTime(dt);
}

int CountTodayEntriesFromHistory()
{
   if(!HistorySelect(gTodayStart, TimeCurrent()))
      return 0;

   int count = 0;
   int total = HistoryDealsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;

      string sym = HistoryDealGetString(deal, DEAL_SYMBOL);
      if(sym != _Symbol) continue;

      long mg = (long)HistoryDealGetInteger(deal, DEAL_MAGIC);
      if(mg != MagicNumber) continue;

      long entry = (long)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN)
         count++;
   }

   return count;
}

void UpdateDailyState()
{
   datetime today = StartOfDay(TimeCurrent());

   if(today != gTodayStart)
   {
      gTodayStart = today;
      gDayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      gTradesToday = CountTodayEntriesFromHistory();
   }
}

bool DailyLossLimitHit()
{
   if(MaxDailyLossPct <= 0.0) return false;
   if(gDayStartEquity <= 0.0) return false;

   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double ddPct = ((gDayStartEquity - eq) / gDayStartEquity) * 100.0;
   return (ddPct >= MaxDailyLossPct);
}

bool InTradingSession()
{
   if(!UseSessionFilter) return true;
   if(SessionStartHour == SessionEndHour) return true;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int h = dt.hour;

   if(SessionStartHour < SessionEndHour)
      return (h >= SessionStartHour && h < SessionEndHour);

   // Overnight session, e.g. 22 -> 6
   return (h >= SessionStartHour || h < SessionEndHour);
}

bool SpreadIsOK()
{
   if(MaxSpreadPoints <= 0) return true;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask <= 0.0 || bid <= 0.0) return false;

   double spreadPoints = (ask - bid) / _Point;
   return (spreadPoints <= MaxSpreadPoints);
}

bool IsNewSignalBar()
{
   datetime t = iTime(_Symbol, gSignalTF, 0);
   if(t <= 0) return false;

   if(t != gLastSignalBarTime)
   {
      gLastSignalBarTime = t;
      return true;
   }
   return false;
}

bool CooldownPassed()
{
   if(CooldownBars <= 0) return true;
   if(gLastTradeBarTime == 0) return true;

   int barsSince = iBarShift(_Symbol, gSignalTF, gLastTradeBarTime, false);
   if(barsSince < 0) return true;

   return (barsSince >= CooldownBars);
}

bool HasOpenPositionForEA()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      long mg = PositionGetInteger(POSITION_MAGIC);

      if(sym == _Symbol && mg == MagicNumber)
         return true;
   }
   return false;
}

double CalculateLotsFromStopDistance(double stopDistPrice)
{
   if(!UseRiskBasedLots)
      return NormalizeVolume(FixedLots);

   if(stopDistPrice <= 0.0)
      return NormalizeVolume(FixedLots);

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = balance * (RiskPerTradePct / 100.0);

   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0)
      return NormalizeVolume(FixedLots);

   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue <= 0.0)
      tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickValue <= 0.0)
      return NormalizeVolume(FixedLots);

   double moneyPerLot = (stopDistPrice / tickSize) * tickValue;
   if(moneyPerLot <= 0.0)
      return NormalizeVolume(FixedLots);

   double lots = riskMoney / moneyPerLot;
   return NormalizeVolume(lots);
}

void BuildStops(bool isBuy, double entry, double atrValue, double &sl, double &tp, double &slDistanceOut)
{
   double minSL = MathMax(PipsToPrice(MinSLPips), MinStopDistancePrice());
   double minTP = MathMax(PipsToPrice(MinTPPips), MinStopDistancePrice());

   double slDist = MathMax(atrValue * SL_ATR_Mult, minSL);
   double tpDist = MathMax(atrValue * TP_ATR_Mult, minTP);

   slDistanceOut = slDist;

   if(isBuy)
   {
      sl = NormalizePrice(entry - slDist);
      tp = NormalizePrice(entry + tpDist);
   }
   else
   {
      sl = NormalizePrice(entry + slDist);
      tp = NormalizePrice(entry - tpDist);
   }
}

void RegisterNewTrade()
{
   gLastTradeBarTime = iTime(_Symbol, gSignalTF, 0);
   gTradesToday++;
}

void OpenBuy(double atrValue)
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(ask <= 0.0) return;

   double sl = 0.0, tp = 0.0, slDist = 0.0;
   BuildStops(true, ask, atrValue, sl, tp, slDist);

   double lots = CalculateLotsFromStopDistance(slDist);
   if(lots <= 0.0) return;

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);

   bool ok = trade.Buy(lots, _Symbol, 0.0, sl, tp, "EMA_RSI_v2_BUY");
   if(ok)
      RegisterNewTrade();
   else
      Print("Buy failed. Retcode=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription(), " Error=", _LastError);
}

void OpenSell(double atrValue)
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(bid <= 0.0) return;

   double sl = 0.0, tp = 0.0, slDist = 0.0;
   BuildStops(false, bid, atrValue, sl, tp, slDist);

   double lots = CalculateLotsFromStopDistance(slDist);
   if(lots <= 0.0) return;

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(SlippagePoints);

   bool ok = trade.Sell(lots, _Symbol, 0.0, sl, tp, "EMA_RSI_v2_SELL");
   if(ok)
      RegisterNewTrade();
   else
      Print("Sell failed. Retcode=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription(), " Error=", _LastError);
}

void ManageOpenPositions()
{
   double atrBuf[];
   ArraySetAsSeries(atrBuf, true);
   if(CopyBuffer(gAtrHandle, 0, 0, 2, atrBuf) < 1)
      return;

   double atrNow = atrBuf[0];
   if(atrNow <= 0.0)
      return;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double minStop = MinStopDistancePrice();

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      long mg = PositionGetInteger(POSITION_MAGIC);
      if(sym != _Symbol || mg != MagicNumber) continue;

      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);

      if(sl <= 0.0) continue; // required to compute initial R

      double initialRisk = MathAbs(openPrice - sl);
      if(initialRisk <= 0.0) continue;

      double profitDist = 0.0;
      if(type == POSITION_TYPE_BUY)  profitDist = bid - openPrice;
      if(type == POSITION_TYPE_SELL) profitDist = openPrice - ask;

      double newSL = sl;
      bool modify = false;

      // Break-even
      if(UseBreakEven && profitDist >= initialRisk * BreakEvenRR)
      {
         if(type == POSITION_TYPE_BUY)
         {
            double beSL = NormalizePrice(openPrice + BreakEvenOffsetPoints * _Point);
            if(beSL > newSL)
            {
               newSL = beSL;
               modify = true;
            }
         }
         else if(type == POSITION_TYPE_SELL)
         {
            double beSL = NormalizePrice(openPrice - BreakEvenOffsetPoints * _Point);
            if(beSL < newSL)
            {
               newSL = beSL;
               modify = true;
            }
         }
      }

      // ATR trailing
      if(UseTrailingStop && profitDist >= initialRisk * TrailStartRR)
      {
         double trailDist = atrNow * TrailATRMult;

         if(type == POSITION_TYPE_BUY)
         {
            double trailSL = NormalizePrice(bid - trailDist);
            if(trailSL > newSL)
            {
               newSL = trailSL;
               modify = true;
            }
         }
         else if(type == POSITION_TYPE_SELL)
         {
            double trailSL = NormalizePrice(ask + trailDist);
            if(trailSL < newSL)
            {
               newSL = trailSL;
               modify = true;
            }
         }
      }

      if(!modify) continue;

      // Respect minimum stop distance from current price
      if(type == POSITION_TYPE_BUY)
      {
         double maxAllowedSL = NormalizePrice(bid - minStop);
         if(newSL > maxAllowedSL) newSL = maxAllowedSL;
         if(newSL <= sl) continue; // never worsen/duplicate
      }
      else if(type == POSITION_TYPE_SELL)
      {
         double minAllowedSL = NormalizePrice(ask + minStop);
         if(newSL < minAllowedSL) newSL = minAllowedSL;
         if(newSL >= sl) continue; // never worsen/duplicate
      }

      if(!trade.PositionModify(sym, newSL, tp))
      {
         Print("PositionModify failed. Symbol=", sym, " Retcode=", trade.ResultRetcode(),
               " ", trade.ResultRetcodeDescription(), " Error=", _LastError);
      }
   }
}

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   if(FastEMA <= 0 || SlowEMA <= 0 || RSIPeriod <= 0 || ATRPeriod <= 0 || TrendEMAPeriod <= 0)
      return INIT_PARAMETERS_INCORRECT;
   if(FastEMA >= SlowEMA)
      return INIT_PARAMETERS_INCORRECT;
   if(RSIBuyLevel <= 0 || RSIBuyLevel >= 50 || RSISellLevel <= 50 || RSISellLevel >= 100)
      return INIT_PARAMETERS_INCORRECT;
   if(RSIBuyLevel >= RSISellLevel)
      return INIT_PARAMETERS_INCORRECT;

   gSignalTF = (SignalTF == PERIOD_CURRENT) ? (ENUM_TIMEFRAMES)_Period : SignalTF;

   gFastHandle = iMA(_Symbol, gSignalTF, FastEMA, 0, MODE_EMA, PRICE_CLOSE);
   gSlowHandle = iMA(_Symbol, gSignalTF, SlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   gRsiHandle  = iRSI(_Symbol, gSignalTF, RSIPeriod, PRICE_CLOSE);
   gAtrHandle  = iATR(_Symbol, gSignalTF, ATRPeriod);
   gTrendHandle = iMA(_Symbol, TrendTF, TrendEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);

   if(gFastHandle == INVALID_HANDLE || gSlowHandle == INVALID_HANDLE ||
      gRsiHandle == INVALID_HANDLE  || gAtrHandle == INVALID_HANDLE ||
      gTrendHandle == INVALID_HANDLE)
   {
      Print("Failed to create indicator handles.");
      return INIT_FAILED;
   }

   UpdateDailyState();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(gFastHandle != INVALID_HANDLE)  IndicatorRelease(gFastHandle);
   if(gSlowHandle != INVALID_HANDLE)  IndicatorRelease(gSlowHandle);
   if(gRsiHandle != INVALID_HANDLE)   IndicatorRelease(gRsiHandle);
   if(gAtrHandle != INVALID_HANDLE)   IndicatorRelease(gAtrHandle);
   if(gTrendHandle != INVALID_HANDLE) IndicatorRelease(gTrendHandle);
}

//+------------------------------------------------------------------+
//| Expert tick                                                      |
//+------------------------------------------------------------------+
void OnTick()
{
   UpdateDailyState();
   ManageOpenPositions(); // always manage open trades first

   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      return;

   if(DailyLossLimitHit())
   {
      Comment("EA paused: daily loss limit hit.");
      return;
   }
   Comment("");

   if(!InTradingSession()) return;
   if(!SpreadIsOK()) return;
   if(!IsNewSignalBar()) return;
   if(!CooldownPassed()) return;
   if(gTradesToday >= MaxTradesPerDay) return;
   if(OnePositionPerSymbol && HasOpenPositionForEA()) return;

   double fast[], slow[], rsi[], atr[];
   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(atr, true);

   int c1 = CopyBuffer(gFastHandle, 0, 0, 3, fast);
   int c2 = CopyBuffer(gSlowHandle, 0, 0, 3, slow);
   int c3 = CopyBuffer(gRsiHandle,  0, 0, 3, rsi);
   int c4 = CopyBuffer(gAtrHandle,  0, 0, 3, atr);

   if(c1 < 3 || c2 < 3 || c3 < 3 || c4 < 3) return;
   if(atr[1] <= 0.0) return;

   bool emaCrossUp   = (fast[1] > slow[1] && fast[2] <= slow[2]);
   bool emaCrossDown = (fast[1] < slow[1] && fast[2] >= slow[2]);

   bool rsiCrossUp = false;
   bool rsiCrossDown = false;
   if(UseRSIExtremeCross)
   {
      rsiCrossUp = (rsi[2] <= RSIBuyLevel && rsi[1] > RSIBuyLevel);
      rsiCrossDown = (rsi[2] >= RSISellLevel && rsi[1] < RSISellLevel);
   }
   else
   {
      rsiCrossUp = (rsi[2] <= RSICenterLevel && rsi[1] > RSICenterLevel);
      rsiCrossDown = (rsi[2] >= RSICenterLevel && rsi[1] < RSICenterLevel);
   }

   bool trendBull = true;
   bool trendBear = true;

   if(UseTrendFilter)
   {
      double trend[];
      ArraySetAsSeries(trend, true);
      if(CopyBuffer(gTrendHandle, 0, 0, 3, trend) < 3) return;

      double trendClose = iClose(_Symbol, TrendTF, 1);
      if(trendClose <= 0.0) return;

      trendBull = (trendClose > trend[1]);
      trendBear = (trendClose < trend[1]);
   }

   bool buySignal = emaCrossUp && rsiCrossUp && trendBull;
   bool sellSignal = emaCrossDown && rsiCrossDown && trendBear;

   if(buySignal)
      OpenBuy(atr[1]);
   else if(sellSignal)
      OpenSell(atr[1]);
}
