/**
 * Decision Report — Scoring Engine
 * -----------------------------------------------------------------
 * This file contains ALL the quantitative logic for the tool.
 * The AI layer (netlify/functions/ai-insight.js) never computes
 * numbers — it only narrates numbers this file produces.
 *
 * Techniques used (all standard decision-science methods, not
 * invented for this project):
 *   1. Rank Order Centroid (ROC) weighting — converts an ordinal
 *      priority ranking into cardinal weights.
 *   2. Weighted Sum Model (WSM) — classic MCDA scoring.
 *   3. Keyword/pattern-based cognitive bias detector — explainable,
 *      evidence-quoting, not an LLM guess.
 *   4. Monte Carlo sensitivity analysis — treats each user-given
 *      score as uncertain (± noise) and asks "how often does the
 *      leading option actually win?" instead of trusting one
 *      point estimate.
 */

export const DIMENSIONS = [
  { key: "upside",        label: "Life / Career Upside" },
  { key: "financial",     label: "Financial Safety" },
  { key: "growth",        label: "Growth & Learning" },
  { key: "stress",        label: "Stress Level",        note: "10 = low stress" },
  { key: "reversibility", label: "Reversibility",        note: "10 = easy to undo" },
  { key: "alignment",     label: "Long-term Alignment" },
  { key: "regret",        label: "Regret Risk",          note: "10 = low regret" },
];

// ---------------------------------------------------------------
// 1. Rank Order Centroid weighting
// ---------------------------------------------------------------
// Given an ordering of dimension keys from most -> least important,
// returns { key: weight } with weights summing to 1.
export function rocWeights(orderedKeys) {
  const n = orderedKeys.length;
  const weights = {};
  orderedKeys.forEach((key, idx) => {
    const rank = idx + 1; // 1 = most important
    let w = 0;
    for (let i = rank; i <= n; i++) w += 1 / i;
    w = w / n;
    weights[key] = w;
  });
  return weights;
}

// ---------------------------------------------------------------
// 2. Weighted Sum Model
// ---------------------------------------------------------------
// scores: { optionName: { dimKey: 1-10 } }
// weights: { dimKey: weight }
// returns [{ option, total (0-10 scale), breakdown: {dimKey: contribution} }]
export function weightedSum(scores, weights) {
  return Object.entries(scores).map(([option, dims]) => {
    const breakdown = {};
    let total = 0;
    for (const { key } of DIMENSIONS) {
      const s = dims[key] ?? 0;
      const contribution = s * (weights[key] ?? 0);
      breakdown[key] = contribution;
      total += contribution;
    }
    return { option, total, breakdown };
  }).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------
// 3. Bias detector (rule-based, explainable)
// ---------------------------------------------------------------
const BIAS_PATTERNS = {
  sunk_cost: {
    label: "Sunk Cost Fallacy",
    patterns: [
      /already (invested|spent|put in|given)/i,
      /(years|months|time) (in|into|invested)/i,
      /too far (in|along) to (quit|stop|walk away)/i,
      /can'?t waste (it|that|this|all that)/i,
    ],
  },
  loss_aversion: {
    label: "Loss Aversion",
    patterns: [
      /(scared|afraid|worried) (of|about) losing/i,
      /what if I lose/i,
      /don'?t want to (lose|give up)/i,
      /losing .* (feels|is) worse/i,
    ],
  },
  status_quo: {
    label: "Status Quo Bias",
    patterns: [
      /it'?s (fine|okay|comfortable) (as is|the way it is)/i,
      /(feels?|it'?s) comfortable (as is|the way it is|where)/i,
      /at least (I know|it'?s) (what I have|familiar|stable)/i,
      /why (change|rock the boat|fix)/i,
      /(comfortable|used to) (where|how) (I am|things are)/i,
    ],
  },
  confirmation_bias: {
    label: "Confirmation Bias",
    patterns: [
      /I('m| am) (pretty sure|confident|certain) (I|it)/i,
      /everyone (says|agrees|tells me)/i,
      /I('ve| have) already (decided|made up my mind)/i,
    ],
  },
  optimism_bias: {
    label: "Optimism Bias",
    patterns: [
      /it'?ll (work out|be fine|figure itself out)/i,
      /I('m| am) sure it'?ll/i,
      /things (usually|always) work out/i,
    ],
  },
  social_proof: {
    label: "Social Proof / Herd Bias",
    patterns: [
      /(my friends|everyone|other people) (did|are doing|chose)/i,
      /what would (people|others|they) think/i,
    ],
  },
};

// text: single string (concatenate all free-text answers before calling)
// returns array of { key, label, evidence } for biases with a match,
// sorted by number of matches descending.
export function detectBiases(text) {
  const hits = [];
  for (const [key, { label, patterns }] of Object.entries(BIAS_PATTERNS)) {
    const evidence = [];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) evidence.push(m[0]);
    }
    if (evidence.length > 0) {
      hits.push({ key, label, evidence, count: evidence.length });
    }
  }
  return hits.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------
// 4. Monte Carlo sensitivity simulation
// ---------------------------------------------------------------
// Treats each 1-10 score as uncertain (user self-rating noise).
// Runs `trials` simulations, perturbing each score with Gaussian
// noise (Box-Muller), reweights, tallies how often each option wins.
function gaussianNoise(sigma) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function monteCarloSensitivity(scores, weights, trials = 2000, sigma = 1.2) {
  const options = Object.keys(scores);
  const wins = Object.fromEntries(options.map(o => [o, 0]));
  const totalsByOption = Object.fromEntries(options.map(o => [o, []]));

  for (let t = 0; t < trials; t++) {
    let best = null, bestTotal = -Infinity;
    for (const option of options) {
      let total = 0;
      for (const { key } of DIMENSIONS) {
        const base = scores[option][key] ?? 0;
        const noisy = Math.min(10, Math.max(0, base + gaussianNoise(sigma)));
        total += noisy * (weights[key] ?? 0);
      }
      totalsByOption[option].push(total);
      if (total > bestTotal) { bestTotal = total; best = option; }
    }
    wins[best] += 1;
  }

  const winProbability = Object.fromEntries(
    options.map(o => [o, wins[o] / trials])
  );

  // simple histogram (10 buckets, 0-10 scale) for the leading option
  const leader = options.sort((a, b) => winProbability[b] - winProbability[a])[0];
  const buckets = new Array(10).fill(0);
  for (const val of totalsByOption[leader]) {
    const idx = Math.min(9, Math.floor(val));
    buckets[idx]++;
  }

  return { winProbability, leader, histogram: buckets, trials };
}
