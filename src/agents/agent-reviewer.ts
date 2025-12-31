/**
 * Agent Reviewer System
 *
 * Implements AgentLaboratory-style multi-persona review system.
 * Multiple reviewer personas independently score outputs,
 * providing diverse perspectives and rigorous quality control.
 *
 * Pattern from: https://github.com/SamuelSchmidgall/AgentLaboratory
 */

import { EventEmitter } from "events";

// ============================================================================
// TYPES
// ============================================================================

/** Reviewer persona type */
export type ReviewerPersona =
	| "technical" // Technical accuracy and implementation quality
	| "strategic" // Strategic value and alignment with goals
	| "risk" // Risk assessment and safety considerations
	| "novelty" // Originality and innovation
	| "practical" // Feasibility and resource considerations
	| "academic" // Academic rigor and methodology
	| "market"; // Market relevance and timing

/** Reviewer configuration */
export interface Reviewer {
	id: string;
	name: string;
	persona: ReviewerPersona;
	expertise: string[];
	systemPrompt: string;
	scoreWeights: {
		clarity: number;
		correctness: number;
		completeness: number;
		originality: number;
		feasibility: number;
	};
}

/** Individual review result */
export interface Review {
	reviewerId: string;
	reviewerName: string;
	persona: ReviewerPersona;
	timestamp: number;
	scores: {
		clarity: number; // 1-10
		correctness: number; // 1-10
		completeness: number; // 1-10
		originality: number; // 1-10
		feasibility: number; // 1-10
		overall: number; // Weighted average
	};
	strengths: string[];
	weaknesses: string[];
	suggestions: string[];
	verdict: "accept" | "minor_revision" | "major_revision" | "reject";
	confidence: number; // 0-1
	reasoning: string;
}

/** Aggregated review result */
export interface AggregatedReview {
	contentId: string;
	content: string;
	reviews: Review[];
	aggregatedScores: {
		clarity: { mean: number; std: number };
		correctness: { mean: number; std: number };
		completeness: { mean: number; std: number };
		originality: { mean: number; std: number };
		feasibility: { mean: number; std: number };
		overall: { mean: number; std: number };
	};
	consensusVerdict: "accept" | "minor_revision" | "major_revision" | "reject";
	verdictDistribution: Record<string, number>;
	unanimousStrengths: string[];
	unanimousWeaknesses: string[];
	controversialPoints: string[];
	combinedSuggestions: string[];
	overallConfidence: number;
	passingThreshold: number;
	passed: boolean;
}

/** Review configuration */
export interface ReviewConfig {
	/** Minimum score to pass (1-10) */
	passingThreshold: number;
	/** Minimum number of reviewers */
	minReviewers: number;
	/** Whether to require unanimous verdict */
	requireUnanimous: boolean;
	/** LLM executor function */
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

// ============================================================================
// DEFAULT REVIEWERS
// ============================================================================

export const DEFAULT_REVIEWERS: Reviewer[] = [
	{
		id: "technical_reviewer",
		name: "Dr. Technical",
		persona: "technical",
		expertise: ["code quality", "architecture", "performance", "security"],
		systemPrompt: `You are Dr. Technical, a rigorous technical reviewer with 20 years of engineering experience.

You evaluate content for:
- Technical accuracy and correctness
- Code quality and best practices
- Architecture and design patterns
- Performance implications
- Security considerations

Be thorough but fair. Rate on a 1-10 scale with specific justification.`,
		scoreWeights: {
			clarity: 0.15,
			correctness: 0.35,
			completeness: 0.2,
			originality: 0.1,
			feasibility: 0.2,
		},
	},
	{
		id: "strategic_reviewer",
		name: "Prof. Strategy",
		persona: "strategic",
		expertise: ["business value", "goal alignment", "ROI", "market positioning"],
		systemPrompt: `You are Prof. Strategy, a strategic advisor who evaluates initiatives against business objectives.

You evaluate content for:
- Alignment with stated goals
- Business value and ROI potential
- Market timing and positioning
- Competitive advantage
- Resource efficiency

Focus on the "so what" - why does this matter strategically?`,
		scoreWeights: {
			clarity: 0.2,
			correctness: 0.15,
			completeness: 0.15,
			originality: 0.25,
			feasibility: 0.25,
		},
	},
	{
		id: "risk_reviewer",
		name: "Risk Guardian",
		persona: "risk",
		expertise: ["risk assessment", "security", "compliance", "failure modes"],
		systemPrompt: `You are the Risk Guardian, protecting against downside risks.

You evaluate content for:
- Potential failure modes
- Security vulnerabilities
- Compliance issues
- Edge cases and corner cases
- Recovery and rollback plans

Identify risks but also propose mitigations. Be cautious but not obstructive.`,
		scoreWeights: {
			clarity: 0.15,
			correctness: 0.3,
			completeness: 0.25,
			originality: 0.05,
			feasibility: 0.25,
		},
	},
	{
		id: "novelty_reviewer",
		name: "Innovation Scout",
		persona: "novelty",
		expertise: ["creativity", "innovation", "prior art", "breakthroughs"],
		systemPrompt: `You are the Innovation Scout, evaluating originality and creative potential.

You evaluate content for:
- Novelty compared to existing solutions
- Creative problem-solving approaches
- Potential for breakthrough impact
- Prior art and differentiation
- Future potential and extensibility

Value innovation but ground it in practical value. Novel but useless is still useless.`,
		scoreWeights: {
			clarity: 0.1,
			correctness: 0.15,
			completeness: 0.1,
			originality: 0.45,
			feasibility: 0.2,
		},
	},
	{
		id: "practical_reviewer",
		name: "Chief Pragmatist",
		persona: "practical",
		expertise: ["implementation", "resources", "timelines", "dependencies"],
		systemPrompt: `You are the Chief Pragmatist, focused on what actually works in practice.

You evaluate content for:
- Implementation feasibility
- Resource requirements
- Timeline realism
- Dependencies and blockers
- Maintainability over time

Perfect is the enemy of good. Favor working solutions over theoretical perfection.`,
		scoreWeights: {
			clarity: 0.25,
			correctness: 0.15,
			completeness: 0.15,
			originality: 0.05,
			feasibility: 0.4,
		},
	},
];

// ============================================================================
// TRADING-SPECIFIC REVIEWERS
// ============================================================================

export const TRADING_REVIEWERS: Reviewer[] = [
	{
		id: "jim_simons_reviewer",
		name: "Jim Simons",
		persona: "academic",
		expertise: [
			"quantitative trading",
			"statistical arbitrage",
			"pattern recognition",
			"hidden markov models",
			"signal processing",
			"systematic trading",
			"risk management",
			"differential geometry",
			"information theory",
		],
		systemPrompt: `You are Jim Simons, reviewing this trading strategy with the standards of Renaissance Technologies.

FACTUAL BACKGROUND:
- PhD in Mathematics from UC Berkeley (1961) - holonomy of Riemannian manifolds
- Chern-Simons theory (1974) - foundational contribution to topology
- Founded Renaissance Technologies (1982), Medallion Fund (1988)
- IDA codebreaker (1964-1968), not NSA directly
- Medallion: ~66% annual returns BEFORE fees from 1988-2018
- Key insight: hire PhDs in math/physics/astronomy, NOT finance people

DOCUMENTED QUOTES:
- "We don't override the models."
- "We search through historical data looking for anomalous patterns."
- "Past performance is the best predictor of success."

EVALUATION CRITERIA (RenTech standard):

1. STATISTICAL EDGE
- Is the edge statistically significant? (t-stat > 2.5, p < 0.01)
- Sharpe ratio target: 2.0+ (Medallion reportedly achieved 3.0+)
- Is there genuine alpha or disguised beta/factor exposure?
- Out-of-sample performance is the only real test

2. ROBUSTNESS
- Multiple time periods tested? (in-sample vs out-of-sample split)
- Different market regimes (bull/bear/sideways)?
- Parameter sensitivity analysis - small changes shouldn't break it
- Cross-validation properly implemented?

3. CAPACITY & COSTS
- Realistic capacity before market impact degrades returns?
- Transaction costs modeled accurately? (RenTech includes everything)
- Slippage estimates based on actual volume profiles?
- Medallion capped at ~$10B for capacity reasons

4. RISK MANAGEMENT
- Maximum drawdown and recovery time?
- Tail risk (VaR, Expected Shortfall)?
- Correlation to existing systematic strategies?
- Position sizing methodology sound?

5. MECHANISM
- Is there a plausible economic reason WHY this works?
- If not explainable, higher bar for statistical evidence
- Complexity is a red flag for overfitting

SCORING: Be skeptical. Most submitted strategies are either overfitted, too capacity-constrained, or lack genuine edge. Reject more than you accept.`,
		scoreWeights: {
			clarity: 0.1,
			correctness: 0.45,
			completeness: 0.15,
			originality: 0.05,
			feasibility: 0.25,
		},
	},
	{
		id: "quant_reviewer",
		name: "Quant Validator",
		persona: "academic",
		expertise: ["statistical significance", "backtesting", "overfitting", "p-hacking"],
		systemPrompt: `You are the Quant Validator, ensuring quantitative rigor.

You evaluate trading strategies for:
- Statistical significance of results
- Proper backtesting methodology
- Overfitting and curve fitting risks
- Sample size and data quality
- Out-of-sample validation

Reject strategies that show data mining bias or lack statistical robustness.`,
		scoreWeights: {
			clarity: 0.1,
			correctness: 0.4,
			completeness: 0.2,
			originality: 0.1,
			feasibility: 0.2,
		},
	},
	{
		id: "market_reviewer",
		name: "Market Oracle",
		persona: "market",
		expertise: ["market conditions", "timing", "liquidity", "market structure"],
		systemPrompt: `You are the Market Oracle, understanding market dynamics.

You evaluate trading strategies for:
- Current market conditions fit
- Liquidity and execution feasibility
- Market structure alignment
- Regime change sensitivity
- Historical analog accuracy

A strategy that worked in 2020 may not work in 2025. Context matters.`,
		scoreWeights: {
			clarity: 0.15,
			correctness: 0.25,
			completeness: 0.15,
			originality: 0.15,
			feasibility: 0.3,
		},
	},
	{
		id: "risk_reviewer_trading",
		name: "Risk Controller",
		persona: "risk",
		expertise: ["drawdown", "VaR", "tail risk", "position sizing"],
		systemPrompt: `You are the Risk Controller, protecting the portfolio.

You evaluate trading strategies for:
- Maximum drawdown and recovery time
- Value at Risk (VaR) metrics
- Tail risk and black swan exposure
- Position sizing appropriateness
- Correlation with existing positions

Profitability without risk control is gambling, not trading.`,
		scoreWeights: {
			clarity: 0.1,
			correctness: 0.3,
			completeness: 0.2,
			originality: 0.05,
			feasibility: 0.35,
		},
	},
	{
		id: "execution_reviewer",
		name: "Execution Expert",
		persona: "practical",
		expertise: ["slippage", "fees", "latency", "market impact"],
		systemPrompt: `You are the Execution Expert, focused on real-world execution.

You evaluate trading strategies for:
- Slippage and market impact
- Fee structure feasibility
- Latency requirements
- Order type appropriateness
- Infrastructure needs

A profitable strategy on paper may lose money in practice due to execution costs.`,
		scoreWeights: {
			clarity: 0.15,
			correctness: 0.2,
			completeness: 0.15,
			originality: 0.05,
			feasibility: 0.45,
		},
	},
];

// ============================================================================
// REVIEWER ENGINE
// ============================================================================

export class ReviewerEngine extends EventEmitter {
	private config: ReviewConfig;

	constructor(config: ReviewConfig) {
		super();
		this.config = config;
	}

	/**
	 * Run a complete review cycle
	 */
	async review(
		content: string,
		context: string,
		reviewers: Reviewer[] = DEFAULT_REVIEWERS,
	): Promise<AggregatedReview> {
		const contentId = `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		this.emit("reviewStarted", {
			contentId,
			reviewerCount: reviewers.length,
		});

		// Collect individual reviews IN PARALLEL for performance
		const reviewPromises = reviewers.map(async (reviewer) => {
			try {
				const review = await this.runSingleReview(reviewer, content, context);

				this.emit("reviewCompleted", {
					contentId,
					reviewerId: reviewer.id,
					verdict: review.verdict,
					overall: review.scores.overall,
				});

				return review;
			} catch (error) {
				this.emit("reviewError", {
					contentId,
					reviewerId: reviewer.id,
					error,
				});
				return null;
			}
		});

		const reviewResults = await Promise.all(reviewPromises);
		const reviews: Review[] = reviewResults.filter((r): r is Review => r !== null);

		// Check minimum reviewers
		if (reviews.length < this.config.minReviewers) {
			this.emit("reviewFailed", {
				contentId,
				reason: `Only ${reviews.length} reviews completed, minimum ${this.config.minReviewers} required`,
			});
		}

		// Aggregate reviews
		const aggregated = this.aggregateReviews(contentId, content, reviews);

		this.emit("aggregationCompleted", {
			contentId,
			passed: aggregated.passed,
			consensusVerdict: aggregated.consensusVerdict,
			overallScore: aggregated.aggregatedScores.overall.mean,
		});

		return aggregated;
	}

	/**
	 * Run a single reviewer's evaluation
	 */
	private async runSingleReview(reviewer: Reviewer, content: string, context: string): Promise<Review> {
		const prompt = `
# Review Request

## Context
${context}

## Content to Review
${content}

## Your Task
Evaluate this content as ${reviewer.name} (${reviewer.persona} perspective).

Provide your review in the following JSON format:
\`\`\`json
{
  "scores": {
    "clarity": <1-10>,
    "correctness": <1-10>,
    "completeness": <1-10>,
    "originality": <1-10>,
    "feasibility": <1-10>
  },
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "weaknesses": ["<weakness 1>", "<weakness 2>", ...],
  "suggestions": ["<suggestion 1>", "<suggestion 2>", ...],
  "verdict": "<accept|minor_revision|major_revision|reject>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation of your verdict>"
}
\`\`\`

Be specific and constructive. Justify your scores with evidence from the content.
`;

		const response = await this.config.executor(reviewer.systemPrompt, prompt);

		// Parse the JSON response
		const parsed = this.parseReviewResponse(response);

		// Calculate weighted overall score
		const overallScore =
			parsed.scores.clarity * reviewer.scoreWeights.clarity +
			parsed.scores.correctness * reviewer.scoreWeights.correctness +
			parsed.scores.completeness * reviewer.scoreWeights.completeness +
			parsed.scores.originality * reviewer.scoreWeights.originality +
			parsed.scores.feasibility * reviewer.scoreWeights.feasibility;

		return {
			reviewerId: reviewer.id,
			reviewerName: reviewer.name,
			persona: reviewer.persona,
			timestamp: Date.now(),
			scores: {
				...parsed.scores,
				overall: overallScore,
			},
			strengths: parsed.strengths,
			weaknesses: parsed.weaknesses,
			suggestions: parsed.suggestions,
			verdict: parsed.verdict,
			confidence: parsed.confidence,
			reasoning: parsed.reasoning,
		};
	}

	/**
	 * Validate review response structure
	 */
	private validateReviewResponse(obj: unknown): obj is {
		scores: {
			clarity: number;
			correctness: number;
			completeness: number;
			originality: number;
			feasibility: number;
		};
		strengths: string[];
		weaknesses: string[];
		suggestions: string[];
		verdict: "accept" | "minor_revision" | "major_revision" | "reject";
		confidence: number;
		reasoning: string;
	} {
		if (!obj || typeof obj !== "object") return false;
		const o = obj as Record<string, unknown>;

		// Validate scores object
		if (!o.scores || typeof o.scores !== "object") return false;
		const scores = o.scores as Record<string, unknown>;
		const scoreKeys = ["clarity", "correctness", "completeness", "originality", "feasibility"];
		for (const key of scoreKeys) {
			if (typeof scores[key] !== "number" || scores[key] < 1 || scores[key] > 10) return false;
		}

		// Validate arrays
		if (!Array.isArray(o.strengths) || !o.strengths.every((s) => typeof s === "string")) return false;
		if (!Array.isArray(o.weaknesses) || !o.weaknesses.every((s) => typeof s === "string")) return false;
		if (!Array.isArray(o.suggestions) || !o.suggestions.every((s) => typeof s === "string")) return false;

		// Validate verdict
		const validVerdicts = ["accept", "minor_revision", "major_revision", "reject"];
		if (typeof o.verdict !== "string" || !validVerdicts.includes(o.verdict)) return false;

		// Validate confidence
		if (typeof o.confidence !== "number" || o.confidence < 0 || o.confidence > 1) return false;

		// Validate reasoning
		if (typeof o.reasoning !== "string") return false;

		return true;
	}

	/**
	 * Parse review response from LLM with validation
	 */
	private parseReviewResponse(response: string): {
		scores: {
			clarity: number;
			correctness: number;
			completeness: number;
			originality: number;
			feasibility: number;
		};
		strengths: string[];
		weaknesses: string[];
		suggestions: string[];
		verdict: "accept" | "minor_revision" | "major_revision" | "reject";
		confidence: number;
		reasoning: string;
	} {
		const defaultResponse = {
			scores: {
				clarity: 5,
				correctness: 5,
				completeness: 5,
				originality: 5,
				feasibility: 5,
			},
			strengths: [],
			weaknesses: ["Unable to parse reviewer response"],
			suggestions: [],
			verdict: "major_revision" as const,
			confidence: 0.3,
			reasoning: "Review response could not be parsed",
		};

		// Try to extract JSON from response
		const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);

		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1]);
				if (this.validateReviewResponse(parsed)) {
					return parsed;
				}
			} catch {
				// Fall through to default
			}
		}

		// Try direct JSON parse
		try {
			const parsed = JSON.parse(response);
			if (this.validateReviewResponse(parsed)) {
				return parsed;
			}
		} catch {
			// Fall through to default
		}

		// Return default scores if parsing or validation fails
		return defaultResponse;
	}

	/**
	 * Aggregate multiple reviews into a single result
	 */
	private aggregateReviews(contentId: string, content: string, reviews: Review[]): AggregatedReview {
		// Calculate mean and std for each score dimension
		const calculateStats = (values: number[]) => {
			const mean = values.reduce((a, b) => a + b, 0) / values.length;
			const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
			return { mean, std: Math.sqrt(variance) };
		};

		const aggregatedScores = {
			clarity: calculateStats(reviews.map((r) => r.scores.clarity)),
			correctness: calculateStats(reviews.map((r) => r.scores.correctness)),
			completeness: calculateStats(reviews.map((r) => r.scores.completeness)),
			originality: calculateStats(reviews.map((r) => r.scores.originality)),
			feasibility: calculateStats(reviews.map((r) => r.scores.feasibility)),
			overall: calculateStats(reviews.map((r) => r.scores.overall)),
		};

		// Calculate verdict distribution
		const verdictDistribution: Record<string, number> = {
			accept: 0,
			minor_revision: 0,
			major_revision: 0,
			reject: 0,
		};
		for (const review of reviews) {
			verdictDistribution[review.verdict]++;
		}

		// Determine consensus verdict
		const sortedVerdicts = Object.entries(verdictDistribution).sort((a, b) => b[1] - a[1]);

		let consensusVerdict: "accept" | "minor_revision" | "major_revision" | "reject";
		if (this.config.requireUnanimous && sortedVerdicts[0][1] === reviews.length) {
			consensusVerdict = sortedVerdicts[0][0] as "accept" | "minor_revision" | "major_revision" | "reject";
		} else {
			// Use majority vote
			consensusVerdict = sortedVerdicts[0][0] as "accept" | "minor_revision" | "major_revision" | "reject";
		}

		// Find unanimous points
		const allStrengths = reviews.flatMap((r) => r.strengths);
		const allWeaknesses = reviews.flatMap((r) => r.weaknesses);

		const strengthCounts = new Map<string, number>();
		const weaknessCounts = new Map<string, number>();

		for (const s of allStrengths) {
			strengthCounts.set(s, (strengthCounts.get(s) || 0) + 1);
		}
		for (const w of allWeaknesses) {
			weaknessCounts.set(w, (weaknessCounts.get(w) || 0) + 1);
		}

		const unanimousStrengths = Array.from(strengthCounts.entries())
			.filter(([, count]) => count >= reviews.length * 0.75)
			.map(([strength]) => strength);

		const unanimousWeaknesses = Array.from(weaknessCounts.entries())
			.filter(([, count]) => count >= reviews.length * 0.75)
			.map(([weakness]) => weakness);

		// Find controversial points (high std in scores)
		const controversialPoints: string[] = [];
		if (aggregatedScores.correctness.std > 2) {
			controversialPoints.push("Correctness assessment varies significantly between reviewers");
		}
		if (aggregatedScores.feasibility.std > 2) {
			controversialPoints.push("Feasibility assessment varies significantly between reviewers");
		}

		// Combine suggestions (deduplicated)
		const allSuggestions = reviews.flatMap((r) => r.suggestions);
		const combinedSuggestions = [...new Set(allSuggestions)];

		// Calculate overall confidence
		const overallConfidence = reviews.reduce((sum, r) => sum + r.confidence, 0) / reviews.length;

		// Determine if passed
		const passed =
			aggregatedScores.overall.mean >= this.config.passingThreshold &&
			(consensusVerdict === "accept" || consensusVerdict === "minor_revision");

		return {
			contentId,
			content,
			reviews,
			aggregatedScores,
			consensusVerdict,
			verdictDistribution,
			unanimousStrengths,
			unanimousWeaknesses,
			controversialPoints,
			combinedSuggestions,
			overallConfidence,
			passingThreshold: this.config.passingThreshold,
			passed,
		};
	}
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick review with default reviewers
 */
export async function quickReview(
	content: string,
	context: string,
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>,
	options: Partial<ReviewConfig> = {},
): Promise<AggregatedReview> {
	const engine = new ReviewerEngine({
		passingThreshold: 7,
		minReviewers: 3,
		requireUnanimous: false,
		executor,
		...options,
	});

	return engine.review(content, context, DEFAULT_REVIEWERS.slice(0, 3));
}

/**
 * Trading-specific review
 */
export async function reviewTradingStrategy(
	strategy: string,
	marketContext: string,
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<AggregatedReview> {
	const engine = new ReviewerEngine({
		passingThreshold: 7,
		minReviewers: 3,
		requireUnanimous: false,
		executor,
	});

	return engine.review(strategy, marketContext, TRADING_REVIEWERS);
}

/**
 * Full peer review with all default reviewers
 */
export async function peerReview(
	content: string,
	context: string,
	executor: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<AggregatedReview> {
	const engine = new ReviewerEngine({
		passingThreshold: 7,
		minReviewers: 4,
		requireUnanimous: false,
		executor,
	});

	return engine.review(content, context, DEFAULT_REVIEWERS);
}

/**
 * Create a custom reviewer engine
 */
export function createReviewerEngine(config: ReviewConfig): ReviewerEngine {
	return new ReviewerEngine(config);
}

export { ReviewerEngine as default };
