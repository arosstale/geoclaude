/**
 * Tests for Agent Reviewer System
 * Tests multi-persona review, score aggregation, and validation
 */

import { describe, expect, it } from "vitest";
import {
	DEFAULT_REVIEWERS,
	peerReview,
	quickReview,
	type Review,
	type ReviewConfig,
	ReviewerEngine,
	reviewTradingStrategy,
	TRADING_REVIEWERS,
} from "./agent-reviewer.js";

// Create a valid review JSON response
const createValidReviewJson = (overrides: Partial<Review["scores"]> = {}, verdict = "accept") => {
	return JSON.stringify({
		scores: {
			clarity: 8,
			correctness: 7,
			completeness: 8,
			originality: 6,
			feasibility: 7,
			...overrides,
		},
		strengths: ["Well-structured approach", "Clear methodology"],
		weaknesses: ["Needs more data validation"],
		suggestions: ["Add backtesting results"],
		verdict,
		confidence: 0.85,
		reasoning: "Solid approach with room for improvement",
	});
};

// Mock executor that returns proper JSON
const createMockExecutor = (reviewJson?: string) => {
	return async (_systemPrompt: string, _userPrompt: string): Promise<string> => {
		return reviewJson || createValidReviewJson();
	};
};

describe("ReviewerEngine", () => {
	describe("Parallel Execution", () => {
		it("should run reviews in parallel", async () => {
			const startTimes: number[] = [];
			const endTimes: number[] = [];

			const trackingExecutor = async () => {
				startTimes.push(Date.now());
				await new Promise((r) => setTimeout(r, 50)); // Simulate API call
				endTimes.push(Date.now());
				return createValidReviewJson();
			};

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 2,
				requireUnanimous: false,
				executor: trackingExecutor,
			};

			const engine = new ReviewerEngine(config);
			const reviewers = DEFAULT_REVIEWERS.slice(0, 3);

			await engine.review("Test content", "Test context", reviewers);

			// If parallel, all should start before any finish
			const _allStarted = Math.max(...startTimes);
			const _firstEnded = Math.min(...endTimes);

			// With parallel execution, overlap should exist
			// All 3 reviewers should start within ~10ms of each other
			const startSpread = Math.max(...startTimes) - Math.min(...startTimes);
			expect(startSpread).toBeLessThan(30); // Should start nearly simultaneously
		});

		it("should collect all reviews even with parallel execution", async () => {
			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 2,
				requireUnanimous: false,
				executor: createMockExecutor(),
			};

			const engine = new ReviewerEngine(config);
			const reviewers = DEFAULT_REVIEWERS.slice(0, 4);
			const result = await engine.review("Content", "Context", reviewers);

			expect(result.reviews).toHaveLength(4);
		});
	});

	describe("JSON Validation", () => {
		it("should accept valid review JSON", async () => {
			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.reviews[0].scores.clarity).toBe(8);
			expect(result.reviews[0].scores.correctness).toBe(7);
			expect(result.reviews[0].verdict).toBe("accept");
			expect(result.reviews[0].confidence).toBe(0.85);
		});

		it("should reject JSON with invalid scores (out of range)", async () => {
			const invalidJson = JSON.stringify({
				scores: { clarity: 15, correctness: 7, completeness: 8, originality: 6, feasibility: 7 },
				strengths: [],
				weaknesses: [],
				suggestions: [],
				verdict: "accept",
				confidence: 0.8,
				reasoning: "Test",
			});

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(invalidJson),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			// Should fall back to default scores
			expect(result.reviews[0].scores.clarity).toBe(5);
			expect(result.reviews[0].weaknesses).toContain("Unable to parse reviewer response");
		});

		it("should reject JSON with invalid verdict", async () => {
			const invalidJson = JSON.stringify({
				scores: { clarity: 8, correctness: 7, completeness: 8, originality: 6, feasibility: 7 },
				strengths: [],
				weaknesses: [],
				suggestions: [],
				verdict: "maybe", // Invalid verdict
				confidence: 0.8,
				reasoning: "Test",
			});

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(invalidJson),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.reviews[0].verdict).toBe("major_revision"); // Default
		});

		it("should reject JSON with invalid confidence (out of range)", async () => {
			const invalidJson = JSON.stringify({
				scores: { clarity: 8, correctness: 7, completeness: 8, originality: 6, feasibility: 7 },
				strengths: [],
				weaknesses: [],
				suggestions: [],
				verdict: "accept",
				confidence: 1.5, // Invalid: > 1
				reasoning: "Test",
			});

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(invalidJson),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.reviews[0].confidence).toBe(0.3); // Default
		});

		it("should handle JSON in markdown code blocks", async () => {
			const markdownJson = `Here is my review:

\`\`\`json
${createValidReviewJson({ clarity: 9 }, "minor_revision")}
\`\`\`

That's my assessment.`;

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(markdownJson),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.reviews[0].scores.clarity).toBe(9);
			expect(result.reviews[0].verdict).toBe("minor_revision");
		});

		it("should handle completely invalid responses", async () => {
			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: async () => "This is not JSON at all, just regular text.",
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.reviews[0].verdict).toBe("major_revision");
			expect(result.reviews[0].confidence).toBe(0.3);
		});
	});

	describe("Score Aggregation", () => {
		it("should calculate mean and std for all score dimensions", async () => {
			let callIndex = 0;
			const varyingExecutor = async () => {
				const scores = [
					{ clarity: 8, correctness: 9, completeness: 7, originality: 6, feasibility: 8 },
					{ clarity: 6, correctness: 7, completeness: 9, originality: 8, feasibility: 6 },
					{ clarity: 7, correctness: 8, completeness: 8, originality: 7, feasibility: 7 },
				][callIndex++];
				return JSON.stringify({
					scores,
					strengths: ["Good"],
					weaknesses: ["Needs work"],
					suggestions: ["Improve"],
					verdict: "minor_revision",
					confidence: 0.8,
					reasoning: "Analysis",
				});
			};

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 2,
				requireUnanimous: false,
				executor: varyingExecutor,
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", DEFAULT_REVIEWERS.slice(0, 3));

			expect(result.aggregatedScores.clarity.mean).toBe(7);
			expect(result.aggregatedScores.correctness.mean).toBe(8);
			expect(result.aggregatedScores.clarity.std).toBeGreaterThan(0);
		});

		it("should determine consensus verdict by majority", async () => {
			let callIndex = 0;
			const mixedExecutor = async () => {
				const verdicts = ["accept", "accept", "minor_revision"];
				return createValidReviewJson({}, verdicts[callIndex++]);
			};

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 2,
				requireUnanimous: false,
				executor: mixedExecutor,
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", DEFAULT_REVIEWERS.slice(0, 3));

			expect(result.consensusVerdict).toBe("accept");
			expect(result.verdictDistribution.accept).toBe(2);
			expect(result.verdictDistribution.minor_revision).toBe(1);
		});

		it("should identify unanimous strengths and weaknesses", async () => {
			const sharedFeedback = async () =>
				JSON.stringify({
					scores: { clarity: 8, correctness: 8, completeness: 8, originality: 7, feasibility: 8 },
					strengths: ["Excellent documentation", "Clear code"],
					weaknesses: ["Missing tests", "No error handling"],
					suggestions: ["Add tests"],
					verdict: "minor_revision",
					confidence: 0.9,
					reasoning: "Good work",
				});

			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 2,
				requireUnanimous: false,
				executor: sharedFeedback,
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", DEFAULT_REVIEWERS.slice(0, 3));

			// All reviewers gave same feedback, so these should be unanimous
			expect(result.unanimousStrengths).toContain("Excellent documentation");
			expect(result.unanimousWeaknesses).toContain("Missing tests");
		});
	});

	describe("Pass/Fail Determination", () => {
		it("should pass when score meets threshold and verdict is positive", async () => {
			const config: ReviewConfig = {
				passingThreshold: 7,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(createValidReviewJson({ clarity: 9, correctness: 9 }, "accept")),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.passed).toBe(true);
		});

		it("should fail when score is below threshold", async () => {
			const config: ReviewConfig = {
				passingThreshold: 9,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(createValidReviewJson({ clarity: 5, correctness: 5 }, "accept")),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.passed).toBe(false);
		});

		it("should fail when verdict is reject", async () => {
			const config: ReviewConfig = {
				passingThreshold: 5,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(createValidReviewJson({ clarity: 9, correctness: 9 }, "reject")),
			};

			const engine = new ReviewerEngine(config);
			const result = await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(result.passed).toBe(false);
		});
	});

	describe("Event Emission", () => {
		it("should emit events during review process", async () => {
			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: createMockExecutor(),
			};

			const engine = new ReviewerEngine(config);
			const events: string[] = [];

			engine.on("reviewStarted", () => events.push("started"));
			engine.on("reviewCompleted", () => events.push("completed"));
			engine.on("aggregationCompleted", () => events.push("aggregated"));

			await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(events).toEqual(["started", "completed", "aggregated"]);
		});

		it("should emit error events on failure", async () => {
			const config: ReviewConfig = {
				passingThreshold: 6,
				minReviewers: 1,
				requireUnanimous: false,
				executor: async () => {
					throw new Error("API failed");
				},
			};

			const engine = new ReviewerEngine(config);
			const errorEvents: unknown[] = [];
			engine.on("reviewError", (e) => errorEvents.push(e));

			await engine.review("Content", "Context", [DEFAULT_REVIEWERS[0]]);

			expect(errorEvents).toHaveLength(1);
		});
	});
});

describe("Trading Reviewers", () => {
	it("should include Jim Simons with factual accuracy", () => {
		const jimSimons = TRADING_REVIEWERS.find((r) => r.id === "jim_simons_reviewer");

		expect(jimSimons).toBeDefined();
		expect(jimSimons!.persona).toBe("academic");
		expect(jimSimons!.expertise).toContain("differential geometry");
		expect(jimSimons!.systemPrompt).toContain("UC Berkeley");
		expect(jimSimons!.systemPrompt).toContain("1961");
		expect(jimSimons!.systemPrompt).toContain("IDA"); // Correct: IDA not NSA
		expect(jimSimons!.systemPrompt).not.toContain("NSA codebreaker"); // Should not say NSA directly
	});

	it("should have balanced score weights", () => {
		for (const reviewer of TRADING_REVIEWERS) {
			const weights = reviewer.scoreWeights;
			const total =
				weights.clarity + weights.correctness + weights.completeness + weights.originality + weights.feasibility;

			expect(total).toBeCloseTo(1.0, 2);
		}
	});
});

describe("Convenience Functions", () => {
	it("quickReview should use subset of default reviewers", async () => {
		const result = await quickReview("Content", "Context", createMockExecutor());

		expect(result.reviews.length).toBeLessThanOrEqual(3);
	});

	it("reviewTradingStrategy should use trading reviewers", async () => {
		const result = await reviewTradingStrategy("Strategy", "Market context", createMockExecutor());

		const reviewerIds = result.reviews.map((r) => r.reviewerId);
		const tradingReviewerIds = TRADING_REVIEWERS.map((r) => r.id);

		expect(reviewerIds.every((id) => tradingReviewerIds.includes(id))).toBe(true);
	});

	it("peerReview should use all default reviewers", async () => {
		const result = await peerReview("Content", "Context", createMockExecutor());

		expect(result.reviews).toHaveLength(DEFAULT_REVIEWERS.length);
	});
});
