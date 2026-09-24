// Emergency-response prioritisation formula.
//
// Combines three independent signals into one ranked score so the
// official dashboard can sort zones/incidents by "deal with this
// first" instead of showing a hand-ranked static list:
//   1. AI risk score (0-1 probability from the ML model)
//   2. Rule-based critical flag (thresholdService) — a hard override
//   3. Estimated affected population (populationService) — impact size
//
// Weights are a simple, documented, adjustable formula — not a
// scientifically validated model. That's an honest limitation of a
// hackathon prototype; the point is that it's a real computation
// driven by real inputs, not a hardcoded priority label.

const WEIGHTS = {
    riskScore: 0.55, // AI model's probability of a landslide
    population: 0.30, // scaled impact if it happens
    criticalRuleBonus: 0.15 // flat bump when a hard rule threshold tripped
};

// Squash an unbounded population estimate into 0-1 using a soft cap,
// so a 5,000-person zone and a 500,000-person zone don't blow out the
// linear scale the same way a risk probability would.
//
// BUGFIX (was the root cause of every zone showing "Priority 30"):
// populationService always estimates over a 5km radius, i.e. an area
// of pi*5^2 ~= 78.5 sq km. Multiplied by any of the configured zone
// densities (1200-3000 people/sq km in config/zones.js) that's
// 94,000-236,000 people — every single zone landed well above the old
// capAt of 50,000, so normalizePopulation returned exactly 1 for all
// of them. Combined with the AI risk score defaulting to 0 whenever
// the separate FastAPI AI microservice isn't reachable (a very common
// case in this environment), the formula collapsed to a flat
// 1 * WEIGHTS.population (0.30) => priorityScore 30 for every zone,
// regardless of actual conditions.
//
// capAt is raised to sit just above the highest population estimate
// any configured zone currently produces, so the population term
// keeps differentiating zones by their real estimated impact instead
// of saturating identically for all of them.
const normalizePopulation = (estimatedPopulation, capAt = 250000) => {
    if (typeof estimatedPopulation !== "number" || estimatedPopulation <= 0) {
        return 0;
    }
    return Math.min(1, estimatedPopulation / capAt);
};

// riskScore: 0-1. isCritical: boolean (from thresholdService). estimatedPopulation: number.
const computePriority = ({ riskScore = 0, isCritical = false, estimatedPopulation = 0 }) => {
    // Defensive normalization: the contract with the external AI
    // microservice (ai/docs/AI_INTEGRATION_CONTRACT.md — not included in
    // this backend-only package) says risk_score is a 0-1 probability,
    // but that contract lives outside this repo and can't be verified
    // here. Before this, any value >1 (e.g. a service that actually
    // returns a 0-100 percentage instead) was clamped straight to 1 —
    // i.e. silently treated as maximum risk, which would make every
    // zone read "Critical" priority the moment that mismatch happened,
    // with no signal anything was wrong. If a value >1 shows up, treat
    // it as a 0-100 scale and rescale instead of maxing it out.
    let scaledRiskScore = riskScore;
    if (typeof riskScore === "number" && riskScore > 1) {
        scaledRiskScore = riskScore / 100;
    }
    const normalizedRisk = Math.max(0, Math.min(1, scaledRiskScore));
    const normalizedPop = normalizePopulation(estimatedPopulation);

    let score =
        normalizedRisk * WEIGHTS.riskScore +
        normalizedPop * WEIGHTS.population;

    if (isCritical) {
        score += WEIGHTS.criticalRuleBonus;
    }

    score = Math.max(0, Math.min(1, score));
    const priorityScore = Math.round(score * 100);

    let priorityLevel;
    if (priorityScore >= 75) priorityLevel = "Critical";
    else if (priorityScore >= 50) priorityLevel = "High";
    else if (priorityScore >= 25) priorityLevel = "Moderate";
    else priorityLevel = "Low";

    return {
        priorityScore,
        priorityLevel,
        breakdown: {
            normalizedRisk,
            normalizedPopulation: normalizedPop,
            criticalRuleBonusApplied: isCritical
        },
        weights: WEIGHTS
    };
};

// Sorts a list of { ...anything, priorityScore } zones/incidents, highest first.
const rankByPriority = (items) =>
    [...items].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

module.exports = { computePriority, rankByPriority, WEIGHTS };
