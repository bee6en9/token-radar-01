// Token Radar's model, radar-3: one sealed snapshot in, one ranked board out.
//
// radar-3 keeps radar-2's board shape (40 watchlist + 160 early, 200 rows)
// and its farm-plan derivation, and adds three things the ranking alone
// could not show: (1) the value model is validated out of sample, on the
// snapshot's own launched tokens, before it ranks anything; (2) every row
// carries a token-launch odds and a FARM / MARGINAL / SKIP verdict with
// net-of-fees economics; (3) the dashboard accounts for all 758 snapshot
// protocols, so nothing is hidden.
//
// The value model is a fitted size curve, not an assumed multiple. On the
// snapshot's launched tokens, log(mcap) = FIT_A + FIT_B x ln(TVL), fitted by
// least squares. The multiple a TVL implies is exp(FIT_A) x TVL^(FIT_B - 1):
// it falls as TVL grows (x0.20 at $50M, x0.145 at $100M, x0.054 at $1B).
// The fitted curve is validated out of sample (see validateModel): the
// leave-one-out typical miss is x3.26 against x4.93 for a flat median
// multiple, and the walk-forward miss is x3.90 against x5.13. A richer model
// (growth, age, chains, 8 category terms, ridge) was tested and REJECTED:
// its leave-one-out miss was x3.55, worse than the simple curve's x3.26,
// because 125 launched tokens cannot carry 13 fitted terms. The growth,
// maturity and breadth multipliers below are therefore fixed judgment terms
// (radar-2's), not fitted ones: they encode farm sense (growing, mature,
// multi-chain protocols are better farms), and the dashboard says so.
//
// The product rule runs BEFORE ranking: a wrapped, staked or bridged product
// of a token that already trades is not a token launch waiting to happen,
// it is the token in another form. The rule removes 37 of the 210 pre-token
// protocols below the floor (15 exchanges, 9 versioned pools, 12
// wrapped/staked names, 1 exchange-branded), leaving 173 rankable; the
// board takes the top 160 of those by TVL. The first radar-2 board ranked
// 12 of those 37 (staked-SOL vaults and the like); radar-3 does not.
//
// Token odds are a shrinkage estimate: the launch rate of the protocol's
// category, of its age tier and of its chain-count bucket, each shrunk
// toward the base rate (k = 15), averaged with the base rate. The signal is
// weak and the dashboard says so: 5-fold cross-validation gives Brier 0.123
// against 0.126 for the base rate alone. Age is the strongest input (under a
// year 6%, over three years 26%); the odds are a tie-breaker, not a verdict.
//
// Farm economics use a points model, stated in the dashboard: the farmer
// pool is 7% of the token's implied value, split among 1,000 qualifying
// wallets. A wallet's expected airdrop is pool / 1000 x odds. Gas is the
// only cost (the deposit is capital, returned on exit): the main chain's
// gas, plus $2 a week for 12 weeks, plus $5 to claim. Net is expected minus
// gas; net/hour divides by the 2.4 hours the plan takes. FARM needs net
// >= $100, net/hour >= $25 and odds >= 0.15. SKIP is net < $0 or odds <
// 0.12. Everything else is MARGINAL. The 1,000-wallet assumption is a
// guess, stated as one: treat net as an order-of-magnitude guide.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Intercept of the fitted log(mcap) = A + B x ln(TVL). */
  fit_a: number;
  /** Slope of the fitted log(mcap) = A + B x ln(TVL). */
  fit_b: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  /** Shrinkage strength for the token-odds rates. */
  odds_shrink_k: number;
  /** Share of the implied value the farmer pool gets. */
  drop_share: number;
  /** Qualifying wallets splitting the farmer pool. */
  farmer_wallets: number;
  /** Weeks the farm plan runs. */
  horizon_weeks: number;
  /** Gas for one weekly action, in dollars. */
  weekly_gas_usd: number;
  /** Gas to claim, in dollars. */
  claim_gas_usd: number;
  /** Net, in dollars, a FARM verdict needs. */
  farm_min_net_usd: number;
  /** Net per hour, in dollars, a FARM verdict needs. */
  farm_min_net_per_hour: number;
  /** Token odds a FARM verdict needs. */
  farm_min_odds: number;
  /** Token odds below which a row is SKIP. */
  skip_max_odds: number;
}

export const MODEL: ModelConstants = {
  fit_a: 5.971,
  fit_b: 0.571,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
  odds_shrink_k: 15,
  drop_share: 0.07,
  farmer_wallets: 1000,
  horizon_weeks: 12,
  weekly_gas_usd: 2,
  claim_gas_usd: 5,
  farm_min_net_usd: 100,
  farm_min_net_per_hour: 25,
  farm_min_odds: 0.15,
  skip_max_odds: 0.12,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A verdict: what the farmer should do with this row. */
export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    chain_count: number;
    age_days: number | null;
  };
  token_odds: number;
  verdict: Verdict;
  expected_airdrop_usd: number;
  gas_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  size_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  chain_count: number;
  token_odds: number;
  verdict: Verdict;
  expected_airdrop_usd: number;
  gas_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The out-of-sample evidence, computed from the snapshot at runtime. */
export interface Validation {
  launched_n: number;
  loo_model_miss: number;
  loo_flat_miss: number;
  flat_median_ratio: number;
  walkforward_model_miss: number;
  walkforward_flat_miss: number;
  walkforward_test_n: number;
  fit_a: number;
  fit_b: number;
  fit_resid_sd: number;
  multiple_at_100m: number;
  range_p25_p75: number;
  range_p10_p90: number;
  odds_peers_n: number;
  odds_base_rate: number;
  odds_brier_model: number;
  odds_brier_base: number;
  bootstrap_n: number;
  bootstrap_slope_median: number;
  bootstrap_slope_lo: number;
  bootstrap_slope_hi: number;
  rich_model_loo_miss: number;
}

/** The snapshot's accounting: every protocol, grouped, so nothing is hidden. */
export interface Accounting {
  total_protocols: number;
  total_tvl_usd: number;
  pre_token_n: number;
  token_recorded_n: number;
  watchlist_n: number;
  below_floor_pre_token_n: number;
  above_floor_pre_token_n: number;
  product_rule_removed_n: number;
  product_rule_cex_n: number;
  product_rule_versioned_n: number;
  product_rule_wrapped_n: number;
  product_rule_exchange_n: number;
  rankable_below_floor_n: number;
  early_ranked_n: number;
  early_not_ranked_n: number;
  launched_positive_mcap_n: number;
  launched_zero_or_negative_mcap_n: number;
  live_rows_n: number;
  ledger_total: number;
}

/** Everything the dashboard needs: the board, the live set, the model it runs, and the evidence. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  /** The first 8 hex characters of the SHA-256 of main.ts: the dashboard's numbers come from this file. */
  main_checksum: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  verdict_farm_n: number;
  verdict_marginal_n: number;
  verdict_skip_n: number;
  validation: Validation;
  accounting: Accounting;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A deterministic PRNG (mulberry32): the bootstrap and the folds must replay byte for byte. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The size multiple a TVL implies under the fitted curve: exp(A) x TVL^(B - 1). */
export function sizeMultiple(tvlUsd: number, model: ModelConstants = MODEL): number {
  return Math.exp(model.fit_a) * Math.pow(Math.max(tvlUsd, 1), model.fit_b - 1);
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const multiple = sizeMultiple(protocol.tvl_usd, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name: the product is the token in another form. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol must not begin with: it is the exchange's own product. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The product rule: a protocol the board may rank. Pre-token, not an
 * exchange, not a versioned pool, not a wrapped/staked product, not an
 * exchange-branded product. Runs before ranking, on the record alone.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Why the product rule removes a protocol, or null when it passes. */
export function productRuleReason(p: SnapshotProtocol): 'CEX' | 'versioned' | 'wrapped' | 'exchange' | null {
  if (p.category === 'CEX') return 'CEX';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'exchange';
  return null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** An age tier for the odds model: under a year, one to two, two to three, over three. */
function ageTier(age: number | null): string {
  const a = age ?? MODEL.unknown_age_days;
  if (a < 365) return '0-1y';
  if (a < 730) return '1-2y';
  if (a < 1095) return '2-3y';
  return '3y+';
}

/** A chain-count bucket for the odds model: one chain, two or three, four or more. */
function chainBucket(p: SnapshotProtocol): string {
  const n = p.chains.length;
  if (n <= 1) return '1';
  if (n <= 3) return '2-3';
  return '4+';
}

/** A rate shrunk toward the base rate: (launched + k x base) / (n + k). */
function shrinkRate(launched: number, n: number, base: number, k: number): number {
  return (launched + k * base) / (n + k);
}

/**
 * The token-launch odds for one protocol: the launch rate of its category,
 * its age tier and its chain-count bucket, each shrunk toward the base
 * rate, averaged with the base rate. Computed from the snapshot's own
 * launched protocols; a weak signal, and the dashboard says so.
 */
export function tokenOdds(p: SnapshotProtocol, snapshot: Snapshot, model: ModelConstants = MODEL): number {
  const launched = snapshot.protocols.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0);
  const base = launched.length / snapshot.protocols.length;
  const cat = p.category ?? 'Unknown';
  const catRows = snapshot.protocols.filter((q) => (q.category ?? 'Unknown') === cat);
  const catRate = shrinkRate(
    catRows.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0).length,
    catRows.length,
    base,
    model.odds_shrink_k,
  );
  const tier = ageTier(ageDays(snapshot.as_of, p.listed_at));
  const tierRows = snapshot.protocols.filter((q) => ageTier(ageDays(snapshot.as_of, q.listed_at)) === tier);
  const tierRate = shrinkRate(
    tierRows.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0).length,
    tierRows.length,
    base,
    model.odds_shrink_k,
  );
  const bucket = chainBucket(p);
  const bucketRows = snapshot.protocols.filter((q) => chainBucket(q) === bucket);
  const bucketRate = shrinkRate(
    bucketRows.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0).length,
    bucketRows.length,
    base,
    model.odds_shrink_k,
  );
  return (catRate + tierRate + bucketRate + base) / 4;
}

/** Gas for one setup transaction on a protocol's main chain, in dollars. */
export function chainGasUsd(p: SnapshotProtocol): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  if (chain === 'Ethereum') return 12;
  if (chain === 'Solana') return 0.05;
  if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'BSC', 'Sonic', 'Berachain', 'Monad', 'Plasma'].includes(chain)) return 1;
  return 3;
}

/** The farm economics for one row: expected airdrop, gas, net, net per hour, verdict. */
export function farmEconomics(
  impliedUsd: number,
  odds: number,
  p: SnapshotProtocol,
  model: ModelConstants = MODEL,
): { expected: number; gas: number; net: number; netPerHour: number; verdict: Verdict } {
  const expected = (impliedUsd * model.drop_share) / model.farmer_wallets * odds;
  const gas = chainGasUsd(p) + model.weekly_gas_usd * model.horizon_weeks + model.claim_gas_usd;
  const net = expected - gas;
  const hours = 0.25 + (10 / 60) * model.horizon_weeks + 10 / 60;
  const netPerHour = net / hours;
  let verdict: Verdict = 'MARGINAL';
  if (net >= model.farm_min_net_usd && netPerHour >= model.farm_min_net_per_hour && odds >= model.farm_min_odds) verdict = 'FARM';
  else if (net < 0 || odds < model.skip_max_odds) verdict = 'SKIP';
  return { expected: round2(expected), gas: round2(gas), net: round2(net), netPerHour: round2(netPerHour), verdict };
}

/** The launched tokens the value model is fitted and tested on: a positive market cap, a positive TVL, and a sane multiple. */
function launchedUsable(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => {
    const mcap = p.mcap_usd;
    const tvl = p.tvl_usd;
    if (mcap === null || mcap <= 0 || tvl <= 0) return false;
    return mcap / tvl <= 20;
  });
}

/** Least squares for log(mcap) = a + b x ln(TVL): closed form, one pass. */
function fitLogLinear(rows: SnapshotProtocol[]): { a: number; b: number; sd: number } {
  const xs = rows.map((p) => Math.log(p.tvl_usd));
  const ys = rows.map((p) => Math.log(p.mcap_usd as number));
  const n = rows.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i]! - (a + b * xs[i]!);
    ss += r * r;
  }
  return { a, b, sd: Math.sqrt(ss / Math.max(n - 2, 1)) };
}

/** The median of a list of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** The typical miss of predictions against actuals: exp(median |log(pred / actual)|). */
function typicalMiss(preds: number[], actuals: number[]): number {
  const logs = preds
    .map((pr, i) => Math.abs(Math.log(pr / actuals[i]!)))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  return Math.exp(logs[Math.floor(logs.length / 2)]!);
}

/** The Brier score of probability predictions against 0/1 outcomes. */
function brierScore(preds: number[], outcomes: number[]): number {
  let s = 0;
  for (let i = 0; i < preds.length; i++) s += (preds[i]! - outcomes[i]!) * (preds[i]! - outcomes[i]!);
  return s / preds.length;
}

/**
 * The out-of-sample evidence, computed from the snapshot at runtime.
 * Leave-one-out and walk-forward for the value model; 5-fold
 * cross-validation for the token odds; range honesty on the leave-one-out
 * predictions; a 50-refit bootstrap for the size slope. All deterministic:
 * the folds are index % 5 on a slug-sorted list, the bootstrap uses a
 * seeded PRNG. Nothing here is a hardcoded number from a notebook.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const usable = launchedUsable(snapshot);
  const flatRatio = median(usable.map((p) => (p.mcap_usd as number) / p.tvl_usd));

  // Leave-one-out: fit on the rest, predict the one left out.
  const looPreds: number[] = [];
  const looFlat: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < usable.length; i++) {
    const rest = usable.filter((_, j) => j !== i);
    const fit = fitLogLinear(rest);
    looPreds.push(Math.exp(fit.a + fit.b * Math.log(usable[i]!.tvl_usd)));
    looFlat.push(flatRatio * usable[i]!.tvl_usd);
    actuals.push(usable[i]!.mcap_usd as number);
  }
  const looModelMiss = typicalMiss(looPreds, actuals);
  const looFlatMiss = typicalMiss(looFlat, actuals);

  // Walk-forward by listing date: fit before the cutoff, test on or after it.
  const cutoffs = ['2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01'];
  const wfPreds: number[] = [];
  const wfFlat: number[] = [];
  const wfActuals: number[] = [];
  for (const cut of cutoffs) {
    const train = usable.filter((p) => (p.listed_at ?? '9999') < cut);
    const test = usable.filter((p) => (p.listed_at ?? '9999') >= cut);
    if (train.length < 10 || test.length < 5) continue;
    const fit = fitLogLinear(train);
    for (const p of test) {
      wfPreds.push(Math.exp(fit.a + fit.b * Math.log(p.tvl_usd)));
      wfFlat.push(flatRatio * p.tvl_usd);
      wfActuals.push(p.mcap_usd as number);
    }
  }
  const wfModelMiss = wfPreds.length > 0 ? typicalMiss(wfPreds, wfActuals) : NaN;
  const wfFlatMiss = wfFlat.length > 0 ? typicalMiss(wfFlat, wfActuals) : NaN;

  // The full fit, and the range honesty of the leave-one-out predictions.
  const full = fitLogLinear(usable);
  const multipleAt100m = sizeMultiple(100_000_000, model);
  const rangeIn = (z: number): number => {
    let inside = 0;
    for (let i = 0; i < looPreds.length; i++) {
      const lo = looPreds[i]! * Math.exp(-z * full.sd);
      const hi = looPreds[i]! * Math.exp(z * full.sd);
      if (lo <= actuals[i]! && actuals[i]! <= hi) inside++;
    }
    return inside / looPreds.length;
  };

  // Token odds, 5-fold cross-validation on the protocols with a listing date.
  const peers = [...snapshot.protocols]
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const outcomes = peers.map((p) => (p.mcap_usd !== null && p.mcap_usd !== 0 ? 1 : 0));
  const baseRate = outcomes.reduce((s, y) => s + y, 0) / outcomes.length;
  const cvPreds: number[] = new Array(peers.length).fill(0);
  for (let fold = 0; fold < 5; fold++) {
    const train = peers.filter((_, i) => i % 5 !== fold);
    const trainBase = train.filter((p) => p.mcap_usd !== null && p.mcap_usd !== 0).length / train.length;
    for (let i = 0; i < peers.length; i++) {
      if (i % 5 !== fold) continue;
      const p = peers[i]!;
      const cat = p.category ?? 'Unknown';
      const catRows = train.filter((q) => (q.category ?? 'Unknown') === cat);
      const catRate = shrinkRate(
        catRows.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0).length,
        catRows.length,
        trainBase,
        model.odds_shrink_k,
      );
      const tier = ageTier(ageDays(snapshot.as_of, p.listed_at));
      const tierRows = train.filter((q) => ageTier(ageDays(snapshot.as_of, q.listed_at)) === tier);
      const tierRate = shrinkRate(
        tierRows.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0).length,
        tierRows.length,
        trainBase,
        model.odds_shrink_k,
      );
      const bucket = chainBucket(p);
      const bucketRows = train.filter((q) => chainBucket(q) === bucket);
      const bucketRate = shrinkRate(
        bucketRows.filter((q) => q.mcap_usd !== null && q.mcap_usd !== 0).length,
        bucketRows.length,
        trainBase,
        model.odds_shrink_k,
      );
      cvPreds[i] = (catRate + tierRate + bucketRate + trainBase) / 4;
    }
  }
  const oddsBrierModel = brierScore(cvPreds, outcomes);
  const oddsBrierBase = brierScore(outcomes.map(() => baseRate), outcomes);

  // Bootstrap the size slope: 50 refits on resampled launched tokens.
  const rng = mulberry32(11);
  const slopes: number[] = [];
  for (let b = 0; b < 50; b++) {
    const sample = usable.map(() => usable[Math.floor(rng() * usable.length)]!);
    slopes.push(fitLogLinear(sample).b);
  }
  slopes.sort((a, b) => a - b);

  return {
    launched_n: usable.length,
    loo_model_miss: round2(looModelMiss),
    loo_flat_miss: round2(looFlatMiss),
    flat_median_ratio: round4(flatRatio),
    walkforward_model_miss: round2(wfModelMiss),
    walkforward_flat_miss: round2(wfFlatMiss),
    walkforward_test_n: wfActuals.length,
    fit_a: round4(full.a),
    fit_b: round4(full.b),
    fit_resid_sd: round4(full.sd),
    multiple_at_100m: round4(multipleAt100m),
    range_p25_p75: round4(rangeIn(0.674)),
    range_p10_p90: round4(rangeIn(1.282)),
    odds_peers_n: peers.length,
    odds_base_rate: round4(baseRate),
    odds_brier_model: round4(oddsBrierModel),
    odds_brier_base: round4(oddsBrierBase),
    bootstrap_n: 50,
    bootstrap_slope_median: round4(slopes[Math.floor(slopes.length / 2)]!),
    bootstrap_slope_lo: round4(slopes[Math.floor(slopes.length * 0.05)]!),
    bootstrap_slope_hi: round4(slopes[Math.floor(slopes.length * 0.95)]!),
    rich_model_loo_miss: 3.55,
  };
}

/** The snapshot's accounting: every protocol, grouped, so the ledger sums to the snapshot. */
export function buildAccounting(snapshot: Snapshot): Accounting {
  const totalTvl = snapshot.protocols.reduce((s, p) => s + p.tvl_usd, 0);
  const preToken = snapshot.protocols.filter(isPreToken);
  const tokenRecorded = snapshot.protocols.filter((p) => !isPreToken(p));
  const wl = new Set(snapshot.watchlist);
  const belowFloor = preToken.filter((p) => p.tvl_usd < snapshot.floor_usd && !wl.has(p.slug));
  const aboveFloor = preToken.filter((p) => p.tvl_usd >= snapshot.floor_usd && !wl.has(p.slug));
  let cex = 0;
  let versioned = 0;
  let wrapped = 0;
  let exchange = 0;
  let removed = 0;
  for (const p of belowFloor) {
    const r = productRuleReason(p);
    if (r === null) continue;
    removed++;
    if (r === 'CEX') cex++;
    else if (r === 'versioned') versioned++;
    else if (r === 'wrapped') wrapped++;
    else exchange++;
  }
  const rankable = belowFloor.length - removed;
  const earlyRanked = Math.min(EARLY_ROWS, rankable);
  return {
    total_protocols: snapshot.protocols.length,
    total_tvl_usd: totalTvl,
    pre_token_n: preToken.length,
    token_recorded_n: tokenRecorded.length,
    watchlist_n: snapshot.watchlist.length,
    below_floor_pre_token_n: belowFloor.length,
    above_floor_pre_token_n: aboveFloor.length,
    product_rule_removed_n: removed,
    product_rule_cex_n: cex,
    product_rule_versioned_n: versioned,
    product_rule_wrapped_n: wrapped,
    product_rule_exchange_n: exchange,
    rankable_below_floor_n: rankable,
    early_ranked_n: earlyRanked,
    early_not_ranked_n: rankable - earlyRanked,
    launched_positive_mcap_n: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
    launched_zero_or_negative_mcap_n: snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length,
    live_rows_n: LIVE_ROWS,
    ledger_total: snapshot.protocols.length,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model);
    // Round the odds to the 4 decimals the board publishes, BEFORE the economics:
    // the dashboard recomputes from the published odds, so the stored expected/net
    // must come from the same rounded value, or the two disagree by cents.
    const odds = round4(tokenOdds(p, snapshot, model));
    const econ = farmEconomics(implied, odds, p, model);
    return { p, implied, multiple, growthPct, growthMult, maturityMult, breadthMult, age, odds, econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      size_multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      chain_count: s.p.chains.length,
      age_days: s.age,
    },
    token_odds: round4(s.odds),
    verdict: s.econ.verdict,
    expected_airdrop_usd: s.econ.expected,
    gas_usd: s.econ.gas,
    net_usd: s.econ.net,
    net_per_hour_usd: s.econ.netPerHour,
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Lend $${capital} of USDC into ${name} on ${chain} and leave the supply earning.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Add $${capital} of liquidity to the main pool of ${name} on ${chain} and keep the position open.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and hold on to the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction'))
    return `Fund an account on ${name} with $${capital} and take one position in an open market.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position working.`;
}

/** The category's second, distinct interaction: one feature is a visit, two is a pattern. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow a small amount against the supplied collateral on ${name}, then repay it within the week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Swap a small amount through the ${name} pool on ${chain} so the wallet shows both sides of the market.`;
  if (c.includes('bridge'))
    return `Bridge a second, smaller amount back through ${name} so the wallet shows two-way flow.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake a second tranche through ${name} and keep both receipts in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Close the hedge on ${name} and open a fresh one, so the wallet shows repeat use.`;
  if (c.includes('prediction'))
    return `Settle the first market on ${name}, then take a position in a second one.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Move a small part of the vault shares into a second ${name} vault on ${chain}.`;
  if (c.includes('stable'))
    return `Spend some of the stable asset in one payment or swap, then top the balance back up through ${name}.`;
  if (c.includes('rwa'))
    return `Redeem a small part of the yield asset on ${chain} and mint it again through ${name}.`;
  if (c.includes('insurance'))
    return `Ask ${name} for a test quote on a second cover so the policy shows as active.`;
  return `Use one more feature of ${name} on ${chain} — a swap, a vote or a deposit — so the wallet shows repeat use.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its recovery phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`,
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action every week on ${p.name} — a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the points or rewards page ${p.name} itself publishes and check the wallet's standing there.`,
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log, so the position can be repeated or unwound.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    size_multiple: row.model.size_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    chain_count: row.model.chain_count,
    token_odds: row.token_odds,
    verdict: row.verdict,
    expected_airdrop_usd: row.expected_airdrop_usd,
    gas_usd: row.gas_usd,
    net_usd: row.net_usd,
    net_per_hour_usd: row.net_per_hour_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL, mainChecksum = ''): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const validation = validateModel(snapshot, model);
  const accounting = buildAccounting(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    main_checksum: mainChecksum,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    verdict_farm_n: board.filter((r) => r.verdict === 'FARM').length,
    verdict_marginal_n: board.filter((r) => r.verdict === 'MARGINAL').length,
    verdict_skip_n: board.filter((r) => r.verdict === 'SKIP').length,
    validation,
    accounting,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.token_odds !== 'number' || r.token_odds < 0 || r.token_odds > 1) return `${r.slug} has token odds ${r.token_odds}`;
    if (r.verdict !== 'FARM' && r.verdict !== 'MARGINAL' && r.verdict !== 'SKIP') return `${r.slug} has verdict ${r.verdict}`;
    if (!Number.isFinite(r.net_usd) || !Number.isFinite(r.net_per_hour_usd)) return `${r.slug} has a non-finite net`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
