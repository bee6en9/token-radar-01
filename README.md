# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bee6en9/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bee6en9/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar over a sealed DefiLlama snapshot: 758 protocols scored, 40 on the watchlist, 200 rows ranked by implied value with concrete farm plans. Radar-3: the value model is a fitted size curve, validated out of sample (leave-one-out miss ×3.26 vs ×4.93 flat, walk-forward ×3.90 vs ×5.13, token-odds Brier 0.123 vs 0.126 base), every row carries a token-launch odds and a FARM / MARGINAL / SKIP verdict with net-of-fees economics, and the dashboard accounts for all 758 protocols.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vfk2n47z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
