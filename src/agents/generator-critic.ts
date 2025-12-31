/**
 * Generator-Critic Pattern for Code Quality
 * GLM-4.7 Orchestral Agent Upgrade - Dec 2025
 *
 * Implements the "Editor's Desk" pattern for:
 * - Code generation with validation
 * - SQL query verification
 * - API response validation
 * - Trading strategy validation
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export interface GenerationResult<T> {
	success: boolean;
	output: T;
	iterations: number;
	critiques: CritiqueResult[];
	timing: {
		total: number;
		generation: number[];
		critique: number[];
		refinement: number[];
	};
}

export interface CritiqueResult {
	passed: boolean;
	score: number; // 0-100
	issues: CritiqueIssue[];
	suggestions: string[];
	autoFixable: boolean;
}

export interface CritiqueIssue {
	severity: "error" | "warning" | "info";
	code: string;
	message: string;
	location?: { line?: number; column?: number; file?: string };
	fix?: string;
}

export type GeneratorFn<TInput, TOutput> = (input: TInput, previousFeedback?: CritiqueResult) => Promise<TOutput>;

export type CriticFn<TOutput> = (output: TOutput) => Promise<CritiqueResult>;

export type RefinerFn<TOutput> = (output: TOutput, feedback: CritiqueResult) => Promise<TOutput>;

// ============================================================================
// Core Generator-Critic Loop
// ============================================================================

export class GeneratorCritic<TInput, TOutput> extends EventEmitter {
	private generator: GeneratorFn<TInput, TOutput>;
	private critic: CriticFn<TOutput>;
	private refiner?: RefinerFn<TOutput>;
	private maxIterations: number;
	private passingScore: number;

	constructor(config: {
		generator: GeneratorFn<TInput, TOutput>;
		critic: CriticFn<TOutput>;
		refiner?: RefinerFn<TOutput>;
		maxIterations?: number;
		passingScore?: number;
	}) {
		super();
		this.generator = config.generator;
		this.critic = config.critic;
		this.refiner = config.refiner;
		this.maxIterations = config.maxIterations ?? 3;
		this.passingScore = config.passingScore ?? 80;
	}

	async execute(input: TInput): Promise<GenerationResult<TOutput>> {
		const startTime = Date.now();
		const timing = {
			total: 0,
			generation: [] as number[],
			critique: [] as number[],
			refinement: [] as number[],
		};
		const critiques: CritiqueResult[] = [];

		let currentOutput: TOutput;
		let lastCritique: CritiqueResult | undefined;

		this.emit("start", { input, maxIterations: this.maxIterations });

		for (let iteration = 0; iteration < this.maxIterations; iteration++) {
			// Generate
			const genStart = Date.now();
			this.emit("generate:start", { iteration });

			if (iteration === 0 || !this.refiner) {
				currentOutput = await this.generator(input, lastCritique);
			} else {
				// Use refiner if available and not first iteration
				const refineStart = Date.now();
				currentOutput = await this.refiner(currentOutput!, lastCritique!);
				timing.refinement.push(Date.now() - refineStart);
			}

			timing.generation.push(Date.now() - genStart);
			this.emit("generate:complete", { iteration, output: currentOutput });

			// Critique
			const critiqueStart = Date.now();
			this.emit("critique:start", { iteration });
			const critique = await this.critic(currentOutput);
			timing.critique.push(Date.now() - critiqueStart);
			critiques.push(critique);
			lastCritique = critique;
			this.emit("critique:complete", { iteration, critique });

			// Check if passed
			if (critique.passed || critique.score >= this.passingScore) {
				timing.total = Date.now() - startTime;
				this.emit("passed", { iteration, score: critique.score });

				return {
					success: true,
					output: currentOutput,
					iterations: iteration + 1,
					critiques,
					timing,
				};
			}

			// Log issues for debugging
			if (critique.issues.length > 0) {
				this.emit("issues", {
					iteration,
					issues: critique.issues,
					autoFixable: critique.autoFixable,
				});
			}
		}

		timing.total = Date.now() - startTime;
		this.emit("exhausted", { iterations: this.maxIterations });

		return {
			success: false,
			output: currentOutput!,
			iterations: this.maxIterations,
			critiques,
			timing,
		};
	}
}

// ============================================================================
// Pre-built Critics
// ============================================================================

/**
 * TypeScript/JavaScript Code Critic
 */
export function createCodeCritic(): CriticFn<string> {
	return async (code: string): Promise<CritiqueResult> => {
		const issues: CritiqueIssue[] = [];
		let score = 100;

		// Check for common issues
		const checks = [
			// Security issues (critical)
			{ pattern: /eval\s*\(/g, severity: "error" as const, code: "SEC001", message: "Avoid eval()", score: -20 },
			{
				pattern: /innerHTML\s*=/g,
				severity: "error" as const,
				code: "SEC002",
				message: "Avoid innerHTML, use textContent",
				score: -15,
			},
			{
				pattern: /dangerouslySetInnerHTML/g,
				severity: "warning" as const,
				code: "SEC003",
				message: "Verify HTML is sanitized",
				score: -10,
			},

			// Code quality
			{
				pattern: /console\.log/g,
				severity: "warning" as const,
				code: "DBG001",
				message: "Remove console.log",
				score: -5,
			},
			{
				pattern: /TODO|FIXME|HACK/g,
				severity: "info" as const,
				code: "TODO001",
				message: "Outstanding TODO found",
				score: -2,
			},
			{
				pattern: /any(?=\s*[;,)\]])/g,
				severity: "warning" as const,
				code: "TS001",
				message: "Avoid 'any' type",
				score: -5,
			},

			// Best practices
			{
				pattern: /==(?!=)/g,
				severity: "warning" as const,
				code: "JS001",
				message: "Use === instead of ==",
				score: -3,
			},
			{
				pattern: /!=(?!=)/g,
				severity: "warning" as const,
				code: "JS002",
				message: "Use !== instead of !=",
				score: -3,
			},
			{
				pattern: /var\s+/g,
				severity: "warning" as const,
				code: "JS003",
				message: "Use const/let instead of var",
				score: -5,
			},
		];

		for (const check of checks) {
			const matches = code.match(check.pattern);
			if (matches) {
				for (const _match of matches) {
					issues.push({
						severity: check.severity,
						code: check.code,
						message: check.message,
					});
					score += check.score;
				}
			}
		}

		// Syntax validation (basic)
		try {
			// Try to parse as expression
			new Function(code);
		} catch (e) {
			const error = e as Error;
			issues.push({
				severity: "error",
				code: "SYN001",
				message: `Syntax error: ${error.message}`,
			});
			score -= 50;
		}

		score = Math.max(0, Math.min(100, score));

		return {
			passed: score >= 80 && !issues.some((i) => i.severity === "error"),
			score,
			issues,
			suggestions: issues.map((i) => i.message),
			autoFixable: issues.every((i) => i.severity !== "error"),
		};
	};
}

/**
 * SQL Query Critic
 */
export function createSQLCritic(): CriticFn<string> {
	return async (sql: string): Promise<CritiqueResult> => {
		const issues: CritiqueIssue[] = [];
		let score = 100;

		const checks = [
			// SQL Injection risks
			{
				pattern: /'\s*\+\s*[a-zA-Z]/g,
				severity: "error" as const,
				code: "SQL001",
				message: "String concatenation detected, use parameterized queries",
				score: -30,
			},
			{
				pattern: /`\s*\$\{/g,
				severity: "error" as const,
				code: "SQL002",
				message: "Template literal detected, use parameterized queries",
				score: -30,
			},

			// Performance
			{
				pattern: /SELECT\s+\*/gi,
				severity: "warning" as const,
				code: "PERF001",
				message: "Avoid SELECT *, specify columns explicitly",
				score: -10,
			},
			{
				pattern: /ORDER BY\s+\d/gi,
				severity: "warning" as const,
				code: "PERF002",
				message: "Avoid ORDER BY column number, use column name",
				score: -5,
			},

			// Best practices
			{
				pattern: /DELETE\s+FROM\s+\w+\s*(?:;|$)/gi,
				severity: "error" as const,
				code: "SAFE001",
				message: "DELETE without WHERE clause will delete all rows",
				score: -40,
			},
			{
				pattern: /UPDATE\s+\w+\s+SET.*(?:;|$)(?!.*WHERE)/gi,
				severity: "error" as const,
				code: "SAFE002",
				message: "UPDATE without WHERE clause will update all rows",
				score: -40,
			},
		];

		for (const check of checks) {
			if (check.pattern.test(sql)) {
				issues.push({
					severity: check.severity,
					code: check.code,
					message: check.message,
				});
				score += check.score;
			}
		}

		// Basic syntax check
		const requiredKeywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP"];
		const hasValidKeyword = requiredKeywords.some((kw) => sql.toUpperCase().includes(kw));
		if (!hasValidKeyword) {
			issues.push({
				severity: "error",
				code: "SYN001",
				message: "No valid SQL keyword found",
			});
			score -= 50;
		}

		score = Math.max(0, Math.min(100, score));

		return {
			passed: score >= 80 && !issues.some((i) => i.severity === "error"),
			score,
			issues,
			suggestions: issues.map((i) => i.message),
			autoFixable: false,
		};
	};
}

/**
 * Trading Signal Critic
 */
export interface TradingSignal {
	symbol: string;
	direction: "buy" | "sell" | "hold";
	confidence: number;
	entry?: number;
	stopLoss?: number;
	takeProfit?: number;
	reasoning: string;
}

export function createTradingSignalCritic(config?: {
	minConfidence?: number;
	requireStopLoss?: boolean;
	requireTakeProfit?: boolean;
	maxRiskRewardRatio?: number;
}): CriticFn<TradingSignal> {
	const minConfidence = config?.minConfidence ?? 0.6;
	const requireStopLoss = config?.requireStopLoss ?? true;
	const requireTakeProfit = config?.requireTakeProfit ?? false;
	const maxRiskRewardRatio = config?.maxRiskRewardRatio ?? 3;

	return async (signal: TradingSignal): Promise<CritiqueResult> => {
		const issues: CritiqueIssue[] = [];
		let score = 100;

		// Confidence check
		if (signal.confidence < minConfidence) {
			issues.push({
				severity: "error",
				code: "CONF001",
				message: `Confidence ${(signal.confidence * 100).toFixed(1)}% below minimum ${(minConfidence * 100).toFixed(1)}%`,
			});
			score -= 30;
		}

		// Stop loss check
		if (requireStopLoss && signal.direction !== "hold" && !signal.stopLoss) {
			issues.push({
				severity: "error",
				code: "RISK001",
				message: "Stop loss required for non-hold signals",
			});
			score -= 25;
		}

		// Take profit check
		if (requireTakeProfit && signal.direction !== "hold" && !signal.takeProfit) {
			issues.push({
				severity: "warning",
				code: "RISK002",
				message: "Take profit recommended",
			});
			score -= 10;
		}

		// Risk/reward ratio
		if (signal.entry && signal.stopLoss && signal.takeProfit) {
			const risk = Math.abs(signal.entry - signal.stopLoss);
			const reward = Math.abs(signal.takeProfit - signal.entry);
			const ratio = risk / reward;

			if (ratio > maxRiskRewardRatio) {
				issues.push({
					severity: "warning",
					code: "RISK003",
					message: `Risk/reward ratio ${ratio.toFixed(2)} exceeds maximum ${maxRiskRewardRatio}`,
				});
				score -= 15;
			}
		}

		// Reasoning check
		if (!signal.reasoning || signal.reasoning.length < 20) {
			issues.push({
				severity: "warning",
				code: "QUAL001",
				message: "Reasoning is too brief or missing",
			});
			score -= 10;
		}

		// Symbol validation
		if (!signal.symbol || !/^[A-Z]{2,10}$/i.test(signal.symbol)) {
			issues.push({
				severity: "error",
				code: "SYM001",
				message: "Invalid symbol format",
			});
			score -= 20;
		}

		score = Math.max(0, Math.min(100, score));

		return {
			passed: score >= 80 && !issues.some((i) => i.severity === "error"),
			score,
			issues,
			suggestions: issues.map((i) => i.message),
			autoFixable: false,
		};
	};
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createCodeGenerator<TInput>(
	generateFn: (input: TInput, feedback?: CritiqueResult) => Promise<string>,
	options?: {
		maxIterations?: number;
		passingScore?: number;
	},
): GeneratorCritic<TInput, string> {
	return new GeneratorCritic({
		generator: generateFn,
		critic: createCodeCritic(),
		maxIterations: options?.maxIterations,
		passingScore: options?.passingScore,
	});
}

export function createSQLGenerator<TInput>(
	generateFn: (input: TInput, feedback?: CritiqueResult) => Promise<string>,
	options?: {
		maxIterations?: number;
		passingScore?: number;
	},
): GeneratorCritic<TInput, string> {
	return new GeneratorCritic({
		generator: generateFn,
		critic: createSQLCritic(),
		maxIterations: options?.maxIterations,
		passingScore: options?.passingScore,
	});
}

export function createSignalGenerator<TInput>(
	generateFn: (input: TInput, feedback?: CritiqueResult) => Promise<TradingSignal>,
	options?: {
		maxIterations?: number;
		passingScore?: number;
		minConfidence?: number;
		requireStopLoss?: boolean;
	},
): GeneratorCritic<TInput, TradingSignal> {
	return new GeneratorCritic({
		generator: generateFn,
		critic: createTradingSignalCritic({
			minConfidence: options?.minConfidence,
			requireStopLoss: options?.requireStopLoss,
		}),
		maxIterations: options?.maxIterations,
		passingScore: options?.passingScore,
	});
}

// ============================================================================
// Exports
// ============================================================================

export default {
	GeneratorCritic,
	createCodeCritic,
	createSQLCritic,
	createTradingSignalCritic,
	createCodeGenerator,
	createSQLGenerator,
	createSignalGenerator,
};
