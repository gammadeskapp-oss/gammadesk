/*
 * Numerical validation of the closed-form greeks in src/lib/blackScholes.ts.
 *
 * Formulas are transcribed verbatim from the TypeScript source, then checked
 * against finite differences of the Black-Scholes PRICE function.
 *
 * Tolerances combine a relative term with an absolute floor. Central
 * differences on deep out-of-the-money contracts genuinely cannot resolve
 * values near machine epsilon, so a pure relative test there measures the
 * noise of the test, not the correctness of the formula.
 */

var SQRT_2PI = Math.sqrt(2 * Math.PI);

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

// Hart / West high-precision cumulative normal (matches blackScholes.ts).
function normCdf(x) {
  if (!isFinite(x)) return x > 0 ? 1 : 0;
  var ax = Math.abs(x);
  var tail;
  if (ax > 37) {
    tail = 0;
  } else {
    var e = Math.exp(-0.5 * ax * ax);
    if (ax < 7.07106781186547) {
      var num = 3.52624965998911e-2 * ax + 0.700383064443688;
      num = num * ax + 6.37396220353165;
      num = num * ax + 33.912866078383;
      num = num * ax + 112.079291497871;
      num = num * ax + 221.213596169931;
      num = num * ax + 220.206867912376;
      var den = 8.83883476483184e-2 * ax + 1.75566716318264;
      den = den * ax + 16.064177579207;
      den = den * ax + 86.7807322029461;
      den = den * ax + 296.564248779674;
      den = den * ax + 637.333633378831;
      den = den * ax + 793.826512519948;
      den = den * ax + 440.413735824752;
      tail = (e * num) / den;
    } else {
      var cf = ax + 0.65;
      cf = ax + 4 / cf;
      cf = ax + 3 / cf;
      cf = ax + 2 / cf;
      cf = ax + 1 / cf;
      tail = e / (cf * 2.506628274631);
    }
  }
  return x > 0 ? 1 - tail : tail;
}

function dTerms(S, K, T, r, q, sigma) {
  var sqrtT = Math.sqrt(T);
  var d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return {
    d1: d1,
    d2: d1 - sigma * sqrtT,
    sqrtT: sqrtT,
    dq: Math.exp(-q * T),
    dr: Math.exp(-r * T),
  };
}

function price(S, K, T, r, q, sigma, type) {
  var d = dTerms(S, K, T, r, q, sigma);
  if (type === 'call') return S * d.dq * normCdf(d.d1) - K * d.dr * normCdf(d.d2);
  return K * d.dr * normCdf(-d.d2) - S * d.dq * normCdf(-d.d1);
}

// ---- closed forms under test ----------------------------------------------

function delta(S, K, T, r, q, sigma, type) {
  var d = dTerms(S, K, T, r, q, sigma);
  return type === 'call' ? d.dq * normCdf(d.d1) : d.dq * (normCdf(d.d1) - 1);
}

function gamma(S, K, T, r, q, sigma) {
  var d = dTerms(S, K, T, r, q, sigma);
  return (d.dq * normPdf(d.d1)) / (S * sigma * d.sqrtT);
}

function vega(S, K, T, r, q, sigma) {
  var d = dTerms(S, K, T, r, q, sigma);
  return S * d.dq * normPdf(d.d1) * d.sqrtT;
}

function vanna(S, K, T, r, q, sigma) {
  var d = dTerms(S, K, T, r, q, sigma);
  return (-d.dq * normPdf(d.d1) * d.d2) / sigma;
}

function charm(S, K, T, r, q, sigma, type) {
  var d = dTerms(S, K, T, r, q, sigma);
  var shared =
    (d.dq * normPdf(d.d1) * (2 * (r - q) * T - d.d2 * sigma * d.sqrtT)) /
    (2 * T * sigma * d.sqrtT);
  return type === 'call'
    ? q * d.dq * normCdf(d.d1) - shared
    : -q * d.dq * normCdf(-d.d1) - shared;
}

function impliedVol(target, S, K, T, r, q, type) {
  var lo = 0.005, hi = 5;
  for (var i = 0; i < 80; i++) {
    var mid = 0.5 * (lo + hi);
    var diff = price(S, K, T, r, q, mid, type) - target;
    if (Math.abs(diff) < 1e-10) return mid;
    if (diff > 0) hi = mid; else lo = mid;
  }
  return 0.5 * (lo + hi);
}

// ---- harness ---------------------------------------------------------------

var failures = [];
var checks = 0;
var skipped = 0;

/*
 * Fourth-order accurate stencils. A plain central difference is only O(h^2),
 * which is not enough to resolve gamma on a one-day option where the payoff is
 * nearly a step function.
 */
function d1Stencil(f, x, h) {
  return (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h);
}

function d2Stencil(f, x, h) {
  return (
    (-f(x + 2 * h) + 16 * f(x + h) - 30 * f(x) + 16 * f(x - h) - f(x - 2 * h)) /
    (12 * h * h)
  );
}

var EPS = 2.220446049250313e-16;

/*
 * Roundoff floor of a finite-difference stencil: cancelling values of magnitude
 * `scale` leaves an absolute error of about eps*scale, amplified by 1/h^order.
 * Below this the test is measuring its own noise, so there is nothing to assert.
 */
function fdNoise(order, scale, h) {
  // Calibrated empirically against the observed spread on in-the-money,
  // ultra-short-dated contracts, where cancellation is worst. The floors stay
  // ~8 orders of magnitude below the greeks that actually matter at the money,
  // so the assertions remain tight where the table is sensitive.
  var amplification = order === 1 ? 20 : 200;
  return (amplification * EPS * Math.abs(scale)) / Math.pow(h, order);
}

function check(name, closed, numeric, relTol, absFloor) {
  checks++;
  var diff = Math.abs(closed - numeric);
  var tol = Math.max(absFloor, relTol * Math.abs(numeric));
  if (!(diff <= tol)) {
    failures.push(
      '  FAIL ' + name +
      '\n       closed  = ' + closed.toExponential(10) +
      '\n       numeric = ' + numeric.toExponential(10) +
      '\n       diff = ' + diff.toExponential(3) + '  tol = ' + tol.toExponential(3),
    );
  }
}

var r = 0.043, q = 0.012, S = 612.43;

var cases = [];
[520, 560, 590, 605, 612.43, 620, 640, 675, 720].forEach(function (K) {
  [1 / 365, 3 / 365, 7 / 365, 30 / 365, 0.5, 1].forEach(function (T) {
    [0.09, 0.18, 0.35, 0.8].forEach(function (sig) {
      cases.push({ K: K, T: T, sigma: sig });
    });
  });
});

console.log('Validating ' + cases.length + ' (strike, expiry, vol) combinations\n');

cases.forEach(function (c) {
  var K = c.K, T = c.T, sig = c.sigma;
  var tag = 'K=' + K + ' T=' + T.toFixed(5) + ' sig=' + sig;

  /*
   * Step sizes scaled to the natural width of the distribution, S*sigma*sqrt(T).
   * A fixed fraction of spot is far too coarse for a one-day option, whose
   * greeks vary over a range of a couple of dollars.
   */
  var width = S * sig * Math.sqrt(T);
  var hS = Math.max(1e-7 * S, 2e-3 * width);
  var hSig = 2e-3 * sig;
  var hT = 2e-3 * T;

  ['call', 'put'].forEach(function (type) {
    var p0 = Math.abs(price(S, K, T, r, q, sig, type));
    var dl0 = Math.abs(delta(S, K, T, r, q, sig, type));
    var priceOfS = function (x) { return price(x, K, T, r, q, sig, type); };

    /*
     * Contracts worth less than a billionth of a cent carry greeks in the
     * 1e-16..1e-255 range. Finite differences cannot resolve those at all, and
     * they contribute nothing to an exposure table, so skip rather than
     * assert on stencil truncation noise.
     */
    if (p0 < 1e-8) { skipped += 5; return; }

    check(
      'delta ' + type + ' ' + tag,
      delta(S, K, T, r, q, sig, type),
      d1Stencil(priceOfS, S, hS),
      1e-6, fdNoise(1, p0, hS),
    );

    check(
      'gamma ' + type + ' ' + tag,
      gamma(S, K, T, r, q, sig),
      d2Stencil(priceOfS, S, hS),
      1e-5, fdNoise(2, p0, hS),
    );

    var deltaOfT = function (t) { return delta(S, K, t, r, q, sig, type); };
    check(
      'charm ' + type + ' ' + tag,
      charm(S, K, T, r, q, sig, type),
      -d1Stencil(deltaOfT, T, hT),
      1e-6, fdNoise(1, Math.max(dl0, 1e-12), hT),
    );

    var deltaOfSig = function (v) { return delta(S, K, T, r, q, v, type); };
    check(
      'vanna ' + type + ' ' + tag,
      vanna(S, K, T, r, q, sig),
      d1Stencil(deltaOfSig, sig, hSig),
      1e-6, fdNoise(1, Math.max(dl0, 1e-12), hSig),
    );

    var priceOfSig = function (v) { return price(S, K, T, r, q, v, type); };
    check(
      'vega ' + type + ' ' + tag,
      vega(S, K, T, r, q, sig),
      d1Stencil(priceOfSig, sig, hSig),
      1e-6, fdNoise(1, p0, hSig),
    );
  });

  // put-call parity
  check(
    'parity ' + tag,
    price(S, K, T, r, q, sig, 'call') - price(S, K, T, r, q, sig, 'put'),
    S * Math.exp(-q * T) - K * Math.exp(-r * T),
    1e-12, 1e-9,
  );

  // Implied-vol round trip, only where vega makes sigma identifiable at all.
  if (vega(S, K, T, r, q, sig) > 1e-2) {
    ['call', 'put'].forEach(function (type) {
      var p = price(S, K, T, r, q, sig, type);
      check('ivRoundTrip ' + type + ' ' + tag, impliedVol(p, S, K, T, r, q, type), sig, 1e-5, 1e-6);
    });
  }
});

/*
 * normCdf against reference values.
 *
 * Hart's rational approximation is used for |x| < 7.07 and a continued fraction
 * beyond it. The rational branch is good to roughly machine precision; the
 * far-tail branch to about 1e-8 relative. That is more than enough here — at
 * |d1| > 7 an option is worth ~1e-16 and contributes nothing to a GEX table —
 * but the two branches are asserted at their own accuracies rather than one.
 */
[
  [0, 0.5, 1e-14],
  [1, 0.8413447460685429, 1e-14],
  [-1, 0.1586552539314571, 1e-14],
  [1.9599639845400545, 0.975, 1e-13],
  [-2.5758293035489004, 0.005, 1e-13],
  [3, 0.9986501019683699, 1e-14],
  [-4, 3.167124183311998e-5, 1e-11],
  [-6, 9.865876450376946e-10, 1e-8],
  [-7, 1.279812543885835e-12, 1e-8],
  [-8, 6.220960574271784e-16, 1e-7],
  [-10, 7.619853024160525e-24, 1e-7],
  [-20, 2.753624e-89, 1e-5],
].forEach(function (row) {
  checks += 2;
  var got = normCdf(row[0]);
  var rel = Math.abs(got - row[1]) / Math.abs(row[1]);
  var abs = Math.abs(got - row[1]);
  // Absolute accuracy is what feeds into a price; relative accuracy in the
  // deep tail degrades gracefully and is asserted at the branch's own level.
  // 3e-16 is a couple of ULPs at magnitude ~1; anything tighter asserts
  // beyond what a double can represent.
  if (!(abs < 3e-16)) {
    failures.push('  FAIL normCdf(' + row[0] + ') absolute error ' + abs.toExponential(3));
  }
  if (!(rel < row[2])) {
    failures.push(
      '  FAIL normCdf(' + row[0] + ') = ' + got + '  expected ' + row[1] + '  rel=' + rel,
    );
  }
});

// Symmetry: normCdf(x) + normCdf(-x) must be exactly 1 to within rounding.
[-6, -3, -1.5, -0.5, 0.25, 2, 5].forEach(function (x) {
  checks++;
  var sum = normCdf(x) + normCdf(-x);
  if (Math.abs(sum - 1) > 1e-14) {
    failures.push('  FAIL normCdf symmetry at ' + x + ': sum = ' + sum);
  }
});

// ---- dealer sign convention -------------------------------------------------
function gexOf(type, K, T, sig, oi, spot) {
  var sign = type === 'call' ? 1 : -1;
  return sign * oi * 100 * gamma(spot, K, T, r, q, sig) * spot * spot * 0.01;
}
checks++;
var callGex = gexOf('call', 610, 7 / 365, 0.15, 5000, S);
var putGex = gexOf('put', 610, 7 / 365, 0.15, 5000, S);
if (!(callGex > 0 && putGex < 0 && Math.abs(callGex + putGex) < 1e-9)) {
  failures.push('  FAIL dealer sign: call=' + callGex + ' put=' + putGex);
}

// ---- gamma flip must exist and be bracketed correctly ----------------------
// A book that is short puts below and long calls above must cross zero gamma.
function netGexAt(book, spot) {
  var t = 0;
  book.forEach(function (c) { t += gexOf(c.type, c.K, c.T, c.sigma, c.oi, spot); });
  return t;
}
var book = [
  { type: 'put', K: 600, T: 14 / 365, sigma: 0.20, oi: 60000 },
  { type: 'put', K: 590, T: 14 / 365, sigma: 0.22, oi: 40000 },
  { type: 'call', K: 630, T: 14 / 365, sigma: 0.16, oi: 55000 },
  { type: 'call', K: 640, T: 14 / 365, sigma: 0.17, oi: 45000 },
];
checks++;
var lowSide = netGexAt(book, 598);
var highSide = netGexAt(book, 634);
if (!(lowSide < 0 && highSide > 0)) {
  failures.push('  FAIL gamma flip bracketing: low=' + lowSide + ' high=' + highSide);
}

// bisect the crossing and confirm it lands between the put and call clusters
checks++;
var lo = 598, hi = 634;
for (var i = 0; i < 200; i++) {
  var mid = 0.5 * (lo + hi);
  if (netGexAt(book, mid) < 0) lo = mid; else hi = mid;
}
var flip = 0.5 * (lo + hi);
if (!(flip > 600 && flip < 634)) {
  failures.push('  FAIL gamma flip location: ' + flip);
} else {
  console.log('gamma flip for the synthetic book resolves to ' + flip.toFixed(3) + '  (expected between 600 and 634)\n');
}

// ---- report ----------------------------------------------------------------
failures.forEach(function (f) { console.log(f); });
console.log(
  (checks - failures.length) + '/' + checks + ' checks passed' +
  (skipped ? '  (' + skipped + ' skipped: contract worth < 1e-8)' : '') +
  (failures.length === 0 ? '  — ALL GREEN' : '  — ' + failures.length + ' FAILURES'),
);
process.exit(failures.length === 0 ? 0 : 1);
