# BTC Trend Rider — btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/satriax30-commits/makefun-btc-race-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/satriax30-commits/makefun-btc-race-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A long-only CBBTC/USDC trend bot for the `agent-fun/bars-replay/v1` replay.
It rides EMA(8)/EMA(21) crossovers, but only when the move is real: the
crossover must come with a wide enough EMA gap, a positive 24-bar return,
and calm volatility — the plain crossover whipsaws itself to death in chop
(the kit's ema-cross baseline loses ~115 USDC on the dev window doing
exactly that). One position at a time, full equity on entry, and it exits
fast: cross back down, a 1.20% trailing stop off the peak close since
entry, a 1.5% stop-loss on cost, or an 8% take-profit — plus a 10-bar
cooldown after every exit so it never re-enters the same whipsaw.

Dev window (local grade): **+11.08 USDC net PnL**, 2 trades, max drawdown
0.85%, Sharpe 0.027 — vs +32.17 USDC for buy-and-hold and −114.83 USDC
for the ema-cross baseline. Fully deterministic: two local runs produce
identical action logs.
