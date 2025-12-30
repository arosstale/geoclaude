/**
 * Class 3.29: Self-Reflection Module
 *
 * Quality assessment and automatic retry triggers.
 * Based on AgentJo's reflection patterns.
 *
 * Features:
 * - Output quality scoring
 * - Automatic retry on low quality
 * - Improvement suggestions generation
 * - Reflection history tracking
 *
 * @module self-reflection
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface ReflectionCriteria {
	name: string;
	weight: number;
	evaluate: (output: string, context: ReflectionContext) => number; // 0-1 score
	threshold: number; // minimum acceptable score
}

export interface ReflectionContext {
	task: string;
	output: string;
	model?: string;
	attempt: number;
	previousScores?: QualityScore[];
	metadata?: Record<string, unknown>;
}

export interface QualityScore {
	overall: number;
	criteria: Map<string, number>;
	passed: boolean;
	failedCriteria: string[];
	timestamp: number;
}

export interface ReflectionResult {
	score: QualityScore;
	shouldRetry: boolean;
	improvements: string[];
	feedback: string;
	refinedPrompt?: string;
}

export interface ReflectionHistory {
	taskId: string;
	task: string;
	attempts: Array<{
		output: string;
		score: QualityScore;
		improvements: string[];
		timestamp: number;
	}>;
	finalOutput?: string;
	success: boolean;
}

export interface SelfReflectionConfig {
	maxRetries: number;
	minQualityThreshold: number;
	enableAutoRetry: boolean;
	improvementPromptTemplate: string;
	criteriaWeights: Map<string, number>;
}

export interface SelfReflectionEvents {
	"reflection:started": { context: ReflectionContext };
	"reflection:completed": { result: ReflectionResult };
	"reflection:retry": { context: ReflectionContext; result: ReflectionResult };
	"reflection:success": { history: ReflectionHistory };
	"reflection:failed": { history: ReflectionHistory };
}

// =============================================================================
// Built-in Criteria
// =============================================================================

export const BUILTIN_CRITERIA: ReflectionCriteria[] = [
	{
		name: "completeness",
		weight: 0.25,
		threshold: 0.6,
		evaluate: (output, context) => {
			// Check if output addresses the task
			const taskWords = context.task.toLowerCase().split(/\s+/);
			const outputLower = output.toLowerCase();
			let matched = 0;
			for (const word of taskWords) {
				if (word.length > 3 && outputLower.includes(word)) {
					matched++;
				}
			}
			return Math.min(1, matched / Math.max(1, taskWords.filter((w) => w.length > 3).length));
		},
	},
	{
		name: "coherence",
		weight: 0.2,
		threshold: 0.5,
		evaluate: (output) => {
			// Check for logical structure
			const sentences = output.split(/[.!?]+/).filter((s) => s.trim().length > 0);
			if (sentences.length === 0) return 0;

			// Penalize very short outputs
			if (output.length < 50) return 0.3;

			// Check for proper sentence structure
			let wellFormed = 0;
			for (const sentence of sentences) {
				const trimmed = sentence.trim();
				if (trimmed.length > 10 && /^[A-Z]/.test(trimmed)) {
					wellFormed++;
				}
			}

			return wellFormed / sentences.length;
		},
	},
	{
		name: "specificity",
		weight: 0.2,
		threshold: 0.5,
		evaluate: (output) => {
			// Check for specific details (numbers, names, technical terms)
			const specificPatterns = [
				/\d+/, // numbers
				/\b[A-Z][a-z]+\b/, // proper nouns
				/`[^`]+`/, // code snippets
				/"[^"]+"/,  // quoted text
				/\b(function|class|const|let|var|import|export)\b/i, // code keywords
			];

			let matches = 0;
			for (const pattern of specificPatterns) {
				if (pattern.test(output)) {
					matches++;
				}
			}

			return matches / specificPatterns.length;
		},
	},
	{
		name: "relevance",
		weight: 0.2,
		threshold: 0.6,
		evaluate: (output, context) => {
			// Check if output stays on topic
			const taskKeywords = new Set(
				context.task
					.toLowerCase()
					.split(/\s+/)
					.filter((w) => w.length > 4)
			);

			const outputWords = output.toLowerCase().split(/\s+/);
			let relevantWords = 0;

			for (const word of outputWords) {
				if (taskKeywords.has(word)) {
					relevantWords++;
				}
			}

			// Normalize by output length
			return Math.min(1, (relevantWords * 10) / outputWords.length);
		},
	},
	{
		name: "actionability",
		weight: 0.15,
		threshold: 0.4,
		evaluate: (output) => {
			// Check for actionable content
			const actionPatterns = [
				/\b(should|must|need to|can|will|could)\b/i,
				/\b(step \d|first|second|then|finally)\b/i,
				/\b(here's how|to do this|you can)\b/i,
				/^[\s]*[-*\d]\.?\s/m, // bullet points or numbered lists
			];

			let matches = 0;
			for (const pattern of actionPatterns) {
				if (pattern.test(output)) {
					matches++;
				}
			}

			return matches / actionPatterns.length;
		},
	},
];

// =============================================================================
// Self-Reflection Module
// =============================================================================

export class SelfReflection extends EventEmitter {
	private config: SelfReflectionConfig;
	private criteria: ReflectionCriteria[];
	private history: Map<string, ReflectionHistory> = new Map();

	constructor(config: Partial<SelfReflectionConfig> = {}) {
		super();
		this.config = {
			maxRetries: 3,
			minQualityThreshold: 0.7,
			enableAutoRetry: true,
			improvementPromptTemplate: `
The previous response scored {{score}}/1.0 on quality.
Failed criteria: {{failedCriteria}}

Improvements needed:
{{improvements}}

Please revise your response to address these issues while maintaining the good aspects.
`,
			criteriaWeights: new Map([
				["completeness", 0.25],
				["coherence", 0.2],
				["specificity", 0.2],
				["relevance", 0.2],
				["actionability", 0.15],
			]),
			...config,
		};

		this.criteria = BUILTIN_CRITERIA;
	}

	// ---------------------------------------------------------------------------
	// Criteria Management
	// ---------------------------------------------------------------------------

	addCriteria(criteria: ReflectionCriteria): void {
		this.criteria.push(criteria);
	}

	removeCriteria(name: string): boolean {
		const index = this.criteria.findIndex((c) => c.name === name);
		if (index !== -1) {
			this.criteria.splice(index, 1);
			return true;
		}
		return false;
	}

	setCriteriaWeight(name: string, weight: number): boolean {
		const criteria = this.criteria.find((c) => c.name === name);
		if (criteria) {
			criteria.weight = weight;
			return true;
		}
		return false;
	}

	// ---------------------------------------------------------------------------
	// Reflection
	// ---------------------------------------------------------------------------

	reflect(context: ReflectionContext): ReflectionResult {
		this.emit("reflection:started", { context });

		const score = this.evaluate(context);
		const improvements = this.generateImprovements(score, context);
		const feedback = this.generateFeedback(score, context);

		const shouldRetry =
			this.config.enableAutoRetry &&
			!score.passed &&
			context.attempt < this.config.maxRetries;

		const result: ReflectionResult = {
			score,
			shouldRetry,
			improvements,
			feedback,
		};

		if (shouldRetry) {
			result.refinedPrompt = this.generateRefinedPrompt(context, score, improvements);
		}

		this.emit("reflection:completed", { result });
		return result;
	}

	private evaluate(context: ReflectionContext): QualityScore {
		const scores = new Map<string, number>();
		const failedCriteria: string[] = [];
		let weightedSum = 0;
		let totalWeight = 0;

		for (const criteria of this.criteria) {
			const score = criteria.evaluate(context.output, context);
			scores.set(criteria.name, score);

			if (score < criteria.threshold) {
				failedCriteria.push(criteria.name);
			}

			weightedSum += score * criteria.weight;
			totalWeight += criteria.weight;
		}

		const overall = totalWeight > 0 ? weightedSum / totalWeight : 0;
		const passed = overall >= this.config.minQualityThreshold && failedCriteria.length === 0;

		return {
			overall,
			criteria: scores,
			passed,
			failedCriteria,
			timestamp: Date.now(),
		};
	}

	private generateImprovements(score: QualityScore, context: ReflectionContext): string[] {
		const improvements: string[] = [];

		for (const criteriaName of score.failedCriteria) {
			const criteriaScore = score.criteria.get(criteriaName) || 0;
			const improvement = this.getImprovementForCriteria(criteriaName, criteriaScore, context);
			if (improvement) {
				improvements.push(improvement);
			}
		}

		// Add general improvements if score is low but no specific failures
		if (score.overall < 0.5 && improvements.length === 0) {
			improvements.push("Provide more detailed and specific information");
			improvements.push("Ensure the response directly addresses the task");
		}

		return improvements;
	}

	private getImprovementForCriteria(name: string, score: number, context: ReflectionContext): string | null {
		switch (name) {
			case "completeness":
				return `Address all aspects of the task: "${context.task.slice(0, 100)}..."`;
			case "coherence":
				return "Improve logical flow and sentence structure";
			case "specificity":
				return "Include specific examples, numbers, or technical details";
			case "relevance":
				return "Focus more directly on the task requirements";
			case "actionability":
				return "Provide clear, actionable steps or recommendations";
			default:
				return `Improve ${name} (current score: ${(score * 100).toFixed(0)}%)`;
		}
	}

	private generateFeedback(score: QualityScore, context: ReflectionContext): string {
		const parts: string[] = [];

		parts.push(`Quality Score: ${(score.overall * 100).toFixed(1)}%`);

		if (score.passed) {
			parts.push("Output meets quality standards.");
		} else {
			parts.push(`Failed criteria: ${score.failedCriteria.join(", ")}`);
		}

		// Highlight best and worst criteria
		let best: { name: string; score: number } | null = null;
		let worst: { name: string; score: number } | null = null;

		for (const [name, criteriaScore] of score.criteria) {
			if (!best || criteriaScore > best.score) {
				best = { name, score: criteriaScore };
			}
			if (!worst || criteriaScore < worst.score) {
				worst = { name, score: criteriaScore };
			}
		}

		if (best) {
			parts.push(`Best: ${best.name} (${(best.score * 100).toFixed(0)}%)`);
		}
		if (worst && worst.name !== best?.name) {
			parts.push(`Needs work: ${worst.name} (${(worst.score * 100).toFixed(0)}%)`);
		}

		return parts.join(" | ");
	}

	private generateRefinedPrompt(context: ReflectionContext, score: QualityScore, improvements: string[]): string {
		return this.config.improvementPromptTemplate
			.replace("{{score}}", (score.overall * 100).toFixed(0))
			.replace("{{failedCriteria}}", score.failedCriteria.join(", ") || "none")
			.replace("{{improvements}}", improvements.map((i) => `- ${i}`).join("\n"));
	}

	// ---------------------------------------------------------------------------
	// Reflection Loop
	// ---------------------------------------------------------------------------

	async reflectWithRetry<T>(
		taskId: string,
		task: string,
		executor: (attempt: number, refinedPrompt?: string) => Promise<string>,
		options: { maxRetries?: number; model?: string } = {}
	): Promise<{ output: string; history: ReflectionHistory }> {
		const maxRetries = options.maxRetries ?? this.config.maxRetries;

		const history: ReflectionHistory = {
			taskId,
			task,
			attempts: [],
			success: false,
		};

		let output: string;
		let refinedPrompt: string | undefined;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			output = await executor(attempt, refinedPrompt);

			const context: ReflectionContext = {
				task,
				output,
				model: options.model,
				attempt,
				previousScores: history.attempts.map((a) => a.score),
			};

			const result = this.reflect(context);

			history.attempts.push({
				output,
				score: result.score,
				improvements: result.improvements,
				timestamp: Date.now(),
			});

			if (result.score.passed) {
				history.success = true;
				history.finalOutput = output;
				this.history.set(taskId, history);
				this.emit("reflection:success", { history });
				return { output, history };
			}

			if (!result.shouldRetry) {
				break;
			}

			refinedPrompt = result.refinedPrompt;
			this.emit("reflection:retry", { context, result });
		}

		// Return best attempt even if failed
		const bestAttempt = history.attempts.reduce((best, current) =>
			current.score.overall > best.score.overall ? current : best
		);

		history.finalOutput = bestAttempt.output;
		this.history.set(taskId, history);
		this.emit("reflection:failed", { history });

		return { output: bestAttempt.output, history };
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getHistory(taskId: string): ReflectionHistory | null {
		return this.history.get(taskId) || null;
	}

	getAllHistory(): ReflectionHistory[] {
		return Array.from(this.history.values());
	}

	getStats(): {
		totalReflections: number;
		successRate: number;
		avgAttempts: number;
		avgScore: number;
	} {
		const histories = Array.from(this.history.values());
		if (histories.length === 0) {
			return {
				totalReflections: 0,
				successRate: 0,
				avgAttempts: 0,
				avgScore: 0,
			};
		}

		const successCount = histories.filter((h) => h.success).length;
		const totalAttempts = histories.reduce((sum, h) => sum + h.attempts.length, 0);
		const allScores = histories.flatMap((h) => h.attempts.map((a) => a.score.overall));

		return {
			totalReflections: histories.length,
			successRate: successCount / histories.length,
			avgAttempts: totalAttempts / histories.length,
			avgScore: allScores.reduce((a, b) => a + b, 0) / allScores.length,
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearHistory(): void {
		this.history.clear();
	}

	reset(): void {
		this.history.clear();
		this.criteria = [...BUILTIN_CRITERIA];
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: SelfReflection | null = null;

export function getSelfReflection(config?: Partial<SelfReflectionConfig>): SelfReflection {
	if (!instance) {
		instance = new SelfReflection(config);
	}
	return instance;
}

export function resetSelfReflection(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
