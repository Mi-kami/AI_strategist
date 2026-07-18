// Netlify Function: ai-insight
// -------------------------------------------------------------
// Receives ALREADY-COMPUTED numbers (weighted scores, bias hits,
// Monte Carlo win probabilities) and asks Gemini to narrate them
// into the report's prose sections. It is never given raw scoring
// authority — the JSON schema below is the contract that keeps it
// that way: every number in the response must come from the input.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    decisionContext,   // { decision, options: [names] }
    goalAndTimeline,    // string
    gutFeel,            // string
    biggestFear,         // string
    rankedScores,        // output of weightedSum()
    biasHits,            // output of detectBiases()
    simulation,          // output of monteCarloSensitivity()
  } = payload;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: "Server not configured (missing GEMINI_API_KEY)" };
  }

  const prompt = `
You are narrating a decision analysis report. ALL numbers below are already
computed by a deterministic scoring engine — do not invent, recompute, or
contradict any number. Your job is only to explain what they mean in plain,
direct, non-generic language. Keep every field concise (2-3 lines max unless noted).

DECISION: ${decisionContext.decision}
OPTIONS: ${decisionContext.options.join(", ")}
GOAL & TIMELINE (user's words): ${goalAndTimeline}
GUT FEEL (user's words): ${gutFeel}
BIGGEST FEAR (user's words): ${biggestFear}

WEIGHTED SCORES (0-10 scale, higher = better, already computed):
${rankedScores.map(r => `- ${r.option}: ${r.total.toFixed(1)}`).join("\n")}

DETECTED BIASES (already detected via keyword matching, with evidence quoted from the user):
${biasHits.length ? biasHits.map(b => `- ${b.label}: "${b.evidence[0]}"`).join("\n") : "- none detected above threshold"}

MONTE CARLO SENSITIVITY (2000 simulations with score uncertainty, already computed):
${Object.entries(simulation.winProbability).map(([o, p]) => `- ${o} wins in ${(p*100).toFixed(0)}% of simulations`).join("\n")}
Leading option: ${simulation.leader}

Return ONLY valid JSON, no markdown fences, matching exactly this schema:
{
  "real_decision": "3 lines max: the actual decision, the real trade-off, why it's emotionally hard",
  "option_cases": [
    { "option": "name", "strongest_case": "2-3 lines", "hidden_upside": "1 line", "biggest_weakness": "1 line", "best_if_you_value": "short phrase" }
  ],
  "assumptions": ["assumption 1", "assumption 2", "assumption 3"],
  "ignored_thing": "1 sentence — what they're definitely ignoring",
  "premortem": [
    { "option": "name", "failure_reasons": ["reason1","reason2","reason3"], "early_warning_sign": "1 line", "prevention_action": "1 line" }
  ],
  "seven_day_plan": {
    "day1_2": "research actions, 1 line",
    "day3_4": "one small experiment, 1 line",
    "day5_6": "one conversation to have, 1 line",
    "day7": "decision day criteria, 1 line"
  },
  "verdict": {
    "why_it_wins": "2 lines, must reference the win probability number",
    "what_could_flip_it": "1 line",
    "hard_truth": "1 sentence, italicized tone"
  },
  "linkedin_hook": "1 punchy line",
  "linkedin_caption": "3 lines max"
}`.trim();

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, responseMimeType: "application/json" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: `Gemini error: ${errText}` };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: cleaned,
    };
  } catch (err) {
    return { statusCode: 500, body: `Function error: ${err.message}` };
  }
};
