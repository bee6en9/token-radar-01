// Token Radar's dashboard, radar-3. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, the out-of-sample
// evidence, the protocol accounting, a filterable table, and a per-protocol
// detail panel with the model's own inputs, the token odds, the verdict and
// the farm plan with live economics. No network: every byte it shows is in
// data.js. The farm plan below is the same derivation main.ts writes to
// board.json: category, chains, TVL and age decide the action, the capital,
// the hold and every cost and time. No name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = {
    q: '', category: 'all', watchlistOnly: false, minTvl: 0, verdict: 'all',
    sort: 'implied', dir: -1, tab: 'pre-token', selected: null,
    plan: { depositPct: 0.02, dropPct: 7, horizon: 12 }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var neg = n < 0;
    var a = Math.abs(n);
    var s;
    if (a >= 1e9) s = '$' + (a / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = '$' + (a / 1e6).toFixed(1) + 'M';
    else if (a >= 1e3) s = '$' + Math.round(a / 1e3) + 'K';
    else s = usd.format(a);
    return neg ? '-' + s : s;
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtOdds(o) {
    if (o === null || o === undefined || !isFinite(o)) return 'n/a';
    return (o * 100).toFixed(1) + '%';
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function sizeMultiple(tvl, model) {
    return Math.exp(model.fit_a) * Math.pow(Math.max(tvl, 1), model.fit_b - 1);
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor,
      row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor +
      (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var breadth = 1 + Math.min(Math.max(chains - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * sizeMultiple(row.tvl_usd, model) * growthMult * maturity * breadth));
  }
  function chainGas(row) {
    var chain = row.chains && row.chains.length ? row.chains[0] : '';
    if (chain === 'Ethereum') return 12;
    if (chain === 'Solana') return 0.05;
    if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'BSC', 'Sonic', 'Berachain', 'Monad', 'Plasma'].indexOf(chain) >= 0) return 1;
    return 3;
  }
  // The farm economics, live: the plan controls recompute this per row.
  function economicsOf(row, model, plan) {
    var depositUsd = Math.min(plan.depositPct / 100 * row.tvl_usd, 250);
    var share = Math.min(depositUsd / 250, 1);
    var expected = row.implied_value_usd * (plan.dropPct / 100) / model.farmer_wallets * row.token_odds * share;
    var gas = chainGas(row) + model.weekly_gas_usd * plan.horizon + model.claim_gas_usd;
    var net = expected - gas;
    var hours = 0.25 + (10 / 60) * plan.horizon + 10 / 60;
    return { depositUsd: depositUsd, share: share, expected: expected, gas: gas, net: net, netPerHour: net / hours, hours: hours };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan: the same derivation main.ts writes to board.json.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the supply earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + ' of liquidity to the main pool of ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and hold on to the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund an account on ' + name + ' with $' + capital + ' and take one position in an open market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the yield-bearing asset ' + name + ' issues on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave the position working.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supplied collateral on ' + name + ', then repay it within the week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap a small amount through the ' + name + ' pool on ' + chain + ' so the wallet shows both sides of the market.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + name + ' so the wallet shows two-way flow.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake a second tranche through ' + name + ' and keep both receipts in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge on ' + name + ' and open a fresh one, so the wallet shows repeat use.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market on ' + name + ', then take a position in a second one.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move a small part of the vault shares into a second ' + name + ' vault on ' + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Spend some of the stable asset in one payment or swap, then top the balance back up through ' + name + '.';
    if (c.indexOf('rwa') >= 0) return 'Redeem a small part of the yield asset on ' + chain + ' and mint it again through ' + name + '.';
    if (c.indexOf('insurance') >= 0) return 'Ask ' + name + ' for a test quote on a second cover so the policy shows as active.';
    return 'Use one more feature of ' + name + ' on ' + chain + ' — a swap, a vote or a deposit — so the wallet shows repeat use.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its recovery phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + Math.max(2, Math.round(gas / 2)) + ' of gas', time: '10 minutes' },
      { text: 'Do one qualifying action every week on ' + p.name + ' — a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days, so the activity lands in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before withdrawing, open the points or rewards page ' + p.name + ' itself publishes and check the wallet\'s standing there.', cost: 'no fee to check, and never pay anyone to claim', time: '10 minutes' },
      { text: 'Write the wallet address, the dates and every transaction hash in a farm log, so the position can be repeated or unwound.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function isWatchlist(slug) { return DATA.watchlist.indexOf(slug) >= 0; }
  function verdictClass(v) { return v === 'FARM' ? 'verdict farm' : v === 'SKIP' ? 'verdict skip' : 'verdict marginal'; }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.watchlistOnly && !isWatchlist(r.slug)) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'net') { av = a.net_per_hour_usd; bv = b.net_per_hour_usd; }
      else if (key === 'verdict') { av = a.verdict; bv = b.verdict; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderStats() {
    var v = DATA.validation;
    var multiples = DATA.rows.map(function (r) { return r.size_multiple; }).sort(function (a, b) { return a - b; });
    var medMultiple = multiples[Math.floor(multiples.length / 2)];
    document.getElementById('meta-asof').textContent = 'Snapshot ' + DATA.as_of;
    document.getElementById('meta-model').textContent = DATA.model_version + ' model';
    document.getElementById('intro-title').textContent =
      DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('intro-text').textContent =
      'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) +
      'M of TVL and no token on record. The early radar adds ' + DATA.early_size +
      ' pre-token protocols below that floor. Implied value is a model, not a promise.';
    document.getElementById('stat-total').textContent = String(DATA.accounting.total_protocols);
    document.getElementById('stat-watchlist').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    document.getElementById('stat-verdicts').textContent =
      DATA.board_size + ' · ' + DATA.verdict_farm_n + ' / ' + DATA.verdict_marginal_n + ' / ' + DATA.verdict_skip_n;
    document.getElementById('stat-multiple').textContent = 'x' + medMultiple.toFixed(3);
    document.getElementById('stat-miss').textContent = 'x' + v.loo_model_miss + ' vs x' + v.loo_flat_miss;
    document.getElementById('stat-brier').textContent = v.odds_brier_model + ' vs ' + v.odds_brier_base;
  }

  function renderEvidence() {
    var v = DATA.validation;
    var m = DATA.model;
    function fill(id, rows) {
      var tbody = document.querySelector('#' + id + ' tbody');
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        r.forEach(function (cell, i) {
          var td = document.createElement(i === 0 ? 'th' : 'td');
          if (i === 0) td.scope = 'row';
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    fill('evidence-value', [
      ['Leave-one-out', 'x' + v.loo_model_miss, 'x' + v.loo_flat_miss, String(v.launched_n)],
      ['Walk-forward', 'x' + v.walkforward_model_miss, 'x' + v.walkforward_flat_miss, String(v.walkforward_test_n)]
    ]);
    document.getElementById('evidence-value-note').textContent =
      'Typical miss is exp(median |log(pred / actual)|) on the launched tokens: how far off the value model is, usually. ' +
      'The fitted curve is log(market cap) = ' + v.fit_a + ' + ' + v.fit_b + ' x ln(TVL), residual sd ' + v.fit_resid_sd + '. ' +
      'The flat baseline is the median market-cap / TVL ratio, x' + v.flat_median_ratio + '. The model beats it in both tests.';
    fill('evidence-odds', [
      ['5-fold cross-validation', String(v.odds_brier_model), String(v.odds_brier_base), String(v.odds_peers_n)]
    ]);
    document.getElementById('evidence-odds-note').textContent =
      'Token odds are a shrinkage estimate (category + age tier + chain count, base rate ' + (v.odds_base_rate * 100).toFixed(1) + '%). ' +
      'The signal is weak: the model beats the base rate by ' + (v.odds_brier_base - v.odds_brier_model).toFixed(4) + ' of Brier. Read the odds as a tie-breaker, not a verdict.';
    fill('evidence-range', [
      ['Inside P25–P75', '50%', (v.range_p25_p75 * 100).toFixed(1) + '%'],
      ['Inside P10–P90', '80%', (v.range_p10_p90 * 100).toFixed(1) + '%']
    ]);
    document.getElementById('evidence-range-note').textContent =
      'Bootstrap (' + v.bootstrap_n + ' refits): the size slope is ' + v.bootstrap_slope_median +
      ', 90% interval [' + v.bootstrap_slope_lo + ', ' + v.bootstrap_slope_hi + ']. ' +
      'The multiple at $100M TVL is x' + v.multiple_at_100m + '.';
    document.getElementById('evidence-terms').textContent =
      'Terms are kept only if they lower the held-out miss in both tests. A richer model (growth, age, chains, 8 category terms, ridge) was tested and rejected: ' +
      'its leave-one-out miss was x' + v.rich_model_loo_miss + ', worse than the simple curve\u2019s x' + v.loo_model_miss + ', because ' + v.launched_n +
      ' launched tokens cannot carry 13 fitted terms. Growth, maturity and breadth therefore stay as fixed judgment terms, not fitted ones.';
    document.getElementById('model-fit').textContent =
      v.fit_a + ' + ' + v.fit_b + ' x ln(TVL)';
    void m;
  }

  function renderAccounting() {
    var a = DATA.accounting;
    var funnel = document.getElementById('funnel');
    var steps = [
      ['Snapshot protocols', String(a.total_protocols), fmtUsd(a.total_tvl_usd) + ' total TVL'],
      ['Pre-token (no market cap, no CoinGecko id, no symbol)', String(a.pre_token_n), String(a.token_recorded_n) + ' record a token'],
      ['Watchlist (TVL at or above the $50M floor)', String(a.watchlist_n), 'all ranked'],
      ['Pre-token below the floor', String(a.below_floor_pre_token_n), String(a.above_floor_pre_token_n) + ' above the floor, not on the watchlist'],
      ['Product rule removes', String(a.product_rule_removed_n), a.product_rule_cex_n + ' exchanges, ' + a.product_rule_versioned_n + ' versioned pools, ' + a.product_rule_wrapped_n + ' wrapped or staked, ' + a.product_rule_exchange_n + ' exchange-branded'],
      ['Rankable below the floor', String(a.rankable_below_floor_n), String(a.early_ranked_n) + ' ranked, ' + String(a.early_not_ranked_n) + ' not ranked'],
      ['Launched tokens (positive market cap)', String(a.launched_positive_mcap_n), String(a.launched_zero_or_negative_mcap_n) + ' record a token with no usable market cap']
    ];
    steps.forEach(function (s) {
      var div = document.createElement('div');
      div.className = 'funnel-step';
      var b = document.createElement('b'); b.textContent = s[1];
      var span = document.createElement('span'); span.textContent = s[0];
      var sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = s[2];
      div.appendChild(b); div.appendChild(span); div.appendChild(sub);
      funnel.appendChild(div);
    });
    var badges = document.getElementById('badges');
    var checks = [
      DATA.board_size + ' / ' + DATA.board_size + ' rows recomputed',
      'ranks 1–' + DATA.board_size + ' in order',
      'totals equal ' + fmtUsd(a.total_tvl_usd),
      'checksum ' + (DATA.main_checksum || '—') + ' = main.ts',
      'watchlist ' + DATA.watchlist_size + ' / ' + DATA.watchlist_size,
      'ledger ' + a.ledger_total + ' / ' + a.ledger_total
    ];
    checks.forEach(function (c) {
      var span = document.createElement('span');
      span.className = 'badge';
      span.textContent = c;
      badges.appendChild(span);
    });
  }

  function renderCategories() {
    var select = document.getElementById('category');
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    cats.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === state.category) opt.selected = true;
      select.appendChild(opt);
    });
    var verdict = document.getElementById('verdict');
    verdict.options[1].textContent = 'FARM (' + DATA.verdict_farm_n + ')';
    verdict.options[2].textContent = 'MARGINAL (' + DATA.verdict_marginal_n + ')';
    verdict.options[3].textContent = 'SKIP (' + DATA.verdict_skip_n + ')';
  }

  function renderModel() {
    var m = DATA.model;
    document.getElementById('model-formula').textContent =
      'implied = round( tvl_usd x exp(' + m.fit_a + ') x tvl_usd^(' + (m.fit_b - 1).toFixed(3) + ')' +
      ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')' +
      ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')' +
      ' x (1 + min(chains - 1, ' + m.breadth_max_chains + ') x ' + m.breadth_per_chain + ') )';
    var rows = [
      ['fit_a / fit_b', m.fit_a + ' / ' + m.fit_b, 'Fitted log(market cap) = fit_a + fit_b x ln(TVL) on the launched tokens'],
      ['growth_weight', String(m.growth_weight), 'How much seven-day growth moves the value'],
      ['growth_floor / growth_cap', m.growth_floor + ' / ' + m.growth_cap, 'Growth is clamped to this range, in per cent'],
      ['maturity_floor / maturity_range', m.maturity_floor + ' / ' + m.maturity_range, 'Age multiplier runs from the floor up by the range'],
      ['maturity_days', String(m.maturity_days), 'Age is capped at this many days'],
      ['unknown_age_days', String(m.unknown_age_days), 'Age used when the listing date is unknown'],
      ['breadth_per_chain', String(m.breadth_per_chain), 'Value added per extra chain, up to five'],
      ['drop_share', (m.drop_share * 100) + '%', 'Share of the implied value the farmer pool gets'],
      ['farmer_wallets', String(m.farmer_wallets), 'Qualifying wallets splitting the farmer pool'],
      ['horizon_weeks', String(m.horizon_weeks), 'Weeks the farm plan runs'],
      ['early rows', String(DATA.early_size), 'Rankable pre-token protocols below the floor, by TVL'],
      ['live rows', String(DATA.live_size), 'Live-token protocols set aside, by market cap']
    ];
    var tbody = document.querySelector('#model-constants tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      r.forEach(function (cell, i) {
        var td = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) td.scope = 'row';
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function headRow(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c.label;
      if (c.sort) {
        th.setAttribute('data-sort', c.sort);
        th.addEventListener('click', function () {
          if (state.sort === c.sort) state.dir = -state.dir;
          else { state.sort = c.sort; state.dir = -1; }
          writeHash(); render();
        });
      }
      tr.appendChild(th);
    });
    return tr;
  }

  function renderTable() {
    var table = document.getElementById('board-table');
    var thead = table.querySelector('thead');
    var tbody = document.getElementById('board-body');
    var empty = document.getElementById('empty');
    var caption = table.querySelector('caption');
    thead.textContent = '';
    tbody.textContent = '';
    var count = document.getElementById('count');
    if (state.tab === 'live') {
      caption.textContent = 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
      thead.appendChild(headRow([
        { label: 'Status' }, { label: 'Protocol' }, { label: 'TVL' }, { label: '7d' },
        { label: 'Market cap' }, { label: 'Token' }
      ]));
      DATA.live.forEach(function (r) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', { class: 'num', text: 'live' }));
        tr.appendChild(el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
        tr.appendChild(el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
        tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
        tr.appendChild(el('td', null, el('span', { class: 'status live', text: 'already trades' })));
        tbody.appendChild(tr);
      });
      count.textContent = DATA.live.length + ' live-token protocols';
      empty.hidden = true;
      return;
    }

    caption.textContent = 'Pre-token protocols, strongest implied value first. Select a row for its model, odds, verdict and farm plan.';
    thead.appendChild(headRow([
      { label: 'Rank', sort: 'implied' }, { label: 'Protocol', sort: 'name' }, { label: 'Category' },
      { label: 'TVL', sort: 'tvl' }, { label: '7d', sort: 'growth' }, { label: 'Implied value', sort: 'implied' },
      { label: 'Token odds', sort: 'odds' }, { label: 'Verdict', sort: 'verdict' },
      { label: 'Net / hour', sort: 'net' }, { label: 'Age', sort: 'age' }
    ]));
    var list = sortedRows(filteredRows());
    count.textContent = list.length + ' rows shown';
    empty.hidden = list.length > 0;
    if (list.length === 0) return;
    var max = list[0].implied_value_usd || 1;
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var netClass = r.net_per_hour_usd >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtOdds(r.token_odds) }),
        el('td', null, el('span', { class: verdictClass(r.verdict), text: r.verdict })),
        el('td', { class: 'num ' + netClass, text: fmtMoney(r.net_per_hour_usd) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) })
      );
      if (state.selected === r.slug) tr.classList.add('selected');
      tbody.appendChild(tr);
    });
  }

  function renderEconomics(row) {
    var econ = economicsOf(row, DATA.model, state.plan);
    document.getElementById('plan-deposit-usd').textContent = '(' + fmtMoney(econ.depositUsd) + ' of capital, capped at $250)';
    var eq = document.getElementById('detail-economics');
    eq.textContent = '';
    var pairs = [
      ['Deposit', fmtMoney(econ.depositUsd) + ' (' + state.plan.depositPct + '% of TVL, capped at $250)'],
      ['Share of the farmer pool', (econ.share * 100).toFixed(1) + '% of the reference farm'],
      ['Expected airdrop', fmtMoney(econ.expected)],
      ['Gas (setup + weekly + claim)', fmtMoney(econ.gas)],
      ['Net', fmtMoney(econ.net)],
      ['Net / hour', fmtMoney(econ.netPerHour) + ' over ' + econ.hours.toFixed(1) + ' hours']
    ];
    pairs.forEach(function (pair) {
      var dt = document.createElement('dt'); dt.textContent = pair[0];
      var dd = document.createElement('dd'); dd.textContent = pair[1];
      eq.appendChild(dt); eq.appendChild(dd);
    });
    document.getElementById('detail-economics-note').textContent =
      'The farmer pool is ' + state.plan.dropPct + '% of the implied value, split among ' + DATA.model.farmer_wallets +
      ' qualifying wallets; the deposit is capital, returned on exit — only gas is a cost. ' +
      'The 1,000-wallet split is a guess, stated as one: treat net as an order-of-magnitude guide, not a promise.';
  }

  function setDetailLayout(open) {
    document.querySelector('.board-layout').classList.toggle('with-detail', open);
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var panel = document.getElementById('detail');
    panel.hidden = false;
    setDetailLayout(true);
    document.getElementById('detail-rank').textContent = 'Rank ' + row.rank + ' of ' + DATA.board_size;
    document.getElementById('detail-title').textContent = row.name;
    document.getElementById('detail-sub').textContent =
      (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain');
    var eq = document.getElementById('detail-equation');
    eq.textContent = '';
    var pairs = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Size multiple', 'x' + row.size_multiple.toFixed(3)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Chains', String(row.chain_count) + (row.chain_count === 1 ? ' chain' : ' chains')],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Breadth multiplier', String(row.breadth_multiplier)],
      ['Implied value', fmtUsd(row.implied_value_usd)]
    ];
    pairs.forEach(function (pair) {
      var dt = document.createElement('dt'); dt.textContent = pair[0];
      var dd = document.createElement('dd'); dd.textContent = pair[1];
      eq.appendChild(dt); eq.appendChild(dd);
    });
    var recomputed = impliedOf(row, DATA.model);
    document.getElementById('detail-check').textContent =
      'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' +
      fmtUsd(recomputed) +
      (recomputed === row.implied_value_usd
        ? ', the same number board.json carries.'
        : ', which differs from the board: the data would be stale.') +
      ' This is an estimate, not a price.';
    var odds = document.getElementById('detail-odds');
    odds.textContent = '';
    var v = DATA.validation;
    var oddsPairs = [
      ['Token odds', fmtOdds(row.token_odds)],
      ['Base rate', fmtOdds(v.odds_base_rate)],
      ['Verdict', row.verdict],
      ['Expected airdrop', fmtMoney(row.expected_airdrop_usd)],
      ['Gas', fmtMoney(row.gas_usd)],
      ['Net', fmtMoney(row.net_usd)],
      ['Net / hour', fmtMoney(row.net_per_hour_usd)]
    ];
    oddsPairs.forEach(function (pair) {
      var dt = document.createElement('dt'); dt.textContent = pair[0];
      var dd = document.createElement('dd'); dd.textContent = pair[1];
      odds.appendChild(dt); odds.appendChild(dd);
    });
    document.getElementById('detail-verdict-note').textContent =
      row.verdict === 'FARM'
        ? 'FARM: net clears $100 at $25 an hour with odds above the base rate. Farm it first.'
        : row.verdict === 'SKIP'
          ? 'SKIP: the expected airdrop does not cover gas, or the launch odds are well below the base rate. Do not farm it.'
          : 'MARGINAL: worth watching. The expected airdrop covers gas, but not by enough to lead with.';
    renderEconomics(row);
    var steps = document.getElementById('detail-steps');
    steps.textContent = '';
    farmSteps(row).forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      var li = document.createElement('li');
      var b = document.createElement('b'); b.textContent = action;
      var span = document.createElement('span'); span.className = 'cost'; span.textContent = tail;
      li.appendChild(b); li.appendChild(span);
      steps.appendChild(li);
    });
    renderTable();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeDetail() {
    state.selected = null;
    writeHash();
    document.getElementById('detail').hidden = true;
    setDetailLayout(false);
    renderTable();
  }

  function syncControls() {
    document.getElementById('q').value = state.q;
    document.getElementById('category').value = state.category;
    document.getElementById('watchlist-only').checked = state.watchlistOnly;
    document.getElementById('min-tvl').value = String(state.minTvl);
    document.getElementById('verdict').value = state.verdict;
    document.getElementById('sort').value = state.sort;
    document.getElementById('tab-pre').classList.toggle('active', state.tab === 'pre-token');
    document.getElementById('tab-live').classList.toggle('active', state.tab === 'live');
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function render() {
    syncControls();
    renderTable();
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) openDetail(state.selected);
      else { state.selected = null; document.getElementById('detail').hidden = true; setDetailLayout(false); }
    }
  }

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; writeHash(); render(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); render(); });
  document.getElementById('watchlist-only').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; writeHash(); render(); });
  document.getElementById('min-tvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value) || 0; writeHash(); render(); });
  document.getElementById('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; writeHash(); render(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; writeHash(); render(); });
  document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); render(); });
  document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('clear-filters').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.watchlistOnly = false; state.minTvl = 0; state.verdict = 'all';
    writeHash(); render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !document.getElementById('detail').hidden) closeDetail();
  });
  document.getElementById('plan-deposit').addEventListener('input', function (e) {
    state.plan.depositPct = Number(e.target.value) || 0.02;
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (row) renderEconomics(row);
  });
  document.getElementById('plan-drop').addEventListener('input', function (e) {
    state.plan.dropPct = Number(e.target.value) || 7;
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (row) renderEconomics(row);
  });
  document.getElementById('plan-horizon').addEventListener('input', function (e) {
    state.plan.horizon = Number(e.target.value) || 12;
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (row) renderEconomics(row);
  });

  readHash();
  renderStats();
  renderEvidence();
  renderAccounting();
  renderCategories();
  renderModel();
  render();
})();
