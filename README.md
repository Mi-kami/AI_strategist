# Decision Report

A decision-support tool that turns a hard personal decision into a scored, auditable report — built for Day 45 of the #ABTalksOnAI 60-day challenge.

## Why this exists

Most "AI decision tools" ask an LLM to invent scores out of a paragraph of context and present them as if they were measured. That's decision theater: it looks quantitative, but there's no data behind the numbers, and no way to check the model's work.

This tool separates the two things that were previously tangled together:

- **The scoring is deterministic.** Every number in the report comes from a documented decision-science method, computed in plain JavaScript you can read and re-run yourself.
- **The AI is a narrator, not a modeler.** Gemini only explains what the numbers mean — it never produces a number.

## The model, in order

1. **Rank Order Centroid (ROC) weighting** — the user ranks 7 decision dimensions by importance. Ranking, not typing in weights, because people are much better at "which matters more" than "assign a percentage." ROC converts that ordinal ranking into cardinal weights.
2. **Structured scoring, not free text** — the user rates each option 1–10 on each dimension directly. The model never infers a score from prose; if it's in the matrix, a person put it there.
3. **Weighted Sum Model (WSM)** — `total = Σ(score × weight)` per option. Classic MCDA, nothing invented.
4. **Keyword/pattern-based bias detector** — the user's free-text answers (goal, gut feel, biggest fear) are scanned against pattern libraries for sunk cost, loss aversion, status quo bias, confirmation bias, optimism bias, and social proof. Every flagged bias comes with the exact phrase that triggered it — no unexplained "you're biased" from a black box.
5. **Monte Carlo sensitivity analysis** — a 1–10 self-rating is not a precise measurement. The engine runs 2,000 simulations, perturbing every score with Gaussian noise, and reports how often each option actually wins. The headline verdict number is a win probability across uncertainty, not a single fragile point estimate.

## Architecture

```
index.html                       — interview flow + report rendering (no build step)
scoring-engine.js                — pure functions: ROC weights, WSM, bias detector, Monte Carlo sim
netlify/functions/ai-insight.js  — the only place Gemini is called; API key stays server-side
```

The frontend computes everything in `scoring-engine.js` first, then sends only the *computed results* (not raw scores) to the Netlify function, which asks Gemini to narrate them into the report's prose sections under a strict JSON schema.

## Deploying

1. Set `GEMINI_API_KEY` as a Netlify environment variable.
2. Deploy the folder as-is — no build step required.
3. If the AI narration call fails for any reason, the report still renders in full using the computed numbers directly; only the prose gets shorter.

Built with Claude AI · #ABTalksOnAI, Day 45.
