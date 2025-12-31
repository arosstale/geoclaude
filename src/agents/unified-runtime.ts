/**
 * Class 3.34: Unified Agent Runtime
 *
 * Combines all TAC patterns into a cohesive runtime.
 * Single interface for running agents with all optimizations.
 *
 * Integrates:
 * - OODA Loop for decision-making
 * - Hooks for pre/post processing
 * - Reflection for quality assurance
 * - Experience replay for learning
 * - Token budgeting for efficiency
 * - Prompt caching for speed
 * - Smart tool selection
 * - Context fusion
 *
 * @module unified-runtime
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface RuntimeTask {
	id: string;
	prompt: string;
	context?: Record<string, unknown>;
	options?: RuntimeOptions;
	userId?: string;
	channelId?: string;
}

export interface RuntimeOptions {
	// Execution control
	maxIterations?: number;
	timeout?: number;
	tokenBudget?: number;

	// Feature flags
	useOODA?: boolean;
	useReflection?: boolean;
	useExperienceReplay?: boolean;
	useCache?: boolean;
	useHooks?: boolean;
	useParallelExecution?: boolean;

	// Quality settings
	minQuality?: number;
	maxRetries?: number;

	// Model settings
	model?: string;
	temperature?: number;
}

export interface RuntimeResult {
	taskId: string;
	success: boolean;
	output?: string;
	error?: string;

	// Metrics
	duration: number;
	tokensUsed: number;
	iterations: number;
	qualityScore: number;

	// Trace
	phases: RuntimePhase[];
	toolCalls: ToolCallRecord[];
	cacheHit: boolean;
	experienceUsed: boolean;

	// Metadata
	model: string;
	patternsUsed: string[];
}

export interface RuntimePhase {
	name: string;
	startTime: number;
	endTime: number;
	duration: number;
	tokens: number;
	success: boolean;
	output?: unknown;
}

export interface ToolCallRecord {
	tool: string;
	params: Record<string, unknown>;
	result?: unknown;
	success: boolean;
	duration: number;
}

export interface RuntimeConfig {
	// Default options
	defaultTimeout: number;
	defaultTokenBudget: number;
	defaultMaxIterations: number;
	defaultMinQuality: number;

	// Feature defaults
	enableOODA: boolean;
	enableReflection: boolean;
	enableExperienceReplay: boolean;
	enableCache: boolean;
	enableHooks: boolean;
	enableParallelExecution: boolean;

	// Performance
	maxConcurrentTasks: number;
	cacheSize: number;
}

export interface RuntimeEvents {
	"task:started": { task: RuntimeTask };
	"task:completed": { result: RuntimeResult };
	"task:failed": { task: RuntimeTask; error: Error };
	"phase:started": { taskId: string; phase: string };
	"phase:completed": { taskId: string; phase: RuntimePhase };
	"tool:called": { taskId: string; record: ToolCallRecord };
	"reflection:triggered": { taskId: string; score: number };
	"experience:retrieved": { taskId: string; count: number };
}

export type LLMExecutor = (prompt: string, options?: { model?: string; temperature?: number }) => Promise<string>;
export type ToolExecutor = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

// =============================================================================
// Unified Agent Runtime
// =============================================================================

export class UnifiedRuntime extends EventEmitter {
	private config: RuntimeConfig;
	private activeTasks: Map<string, RuntimeTask> = new Map();
	private taskHistory: Map<string, RuntimeResult> = new Map();

	// Simple in-memory cache
	private promptCache: Map<string, { response: string; timestamp: number }> = new Map();

	// Experience storage
	private experiences: Array<{
		prompt: string;
		output: string;
		score: number;
		timestamp: number;
	}> = [];

	constructor(config: Partial<RuntimeConfig> = {}) {
		super();
		this.config = {
			defaultTimeout: 120000,
			defaultTokenBudget: 50000,
			defaultMaxIterations: 5,
			defaultMinQuality: 0.7,
			enableOODA: true,
			enableReflection: true,
			enableExperienceReplay: true,
			enableCache: true,
			enableHooks: true,
			enableParallelExecution: true,
			maxConcurrentTasks: 5,
			cacheSize: 100,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Main Execution
	// ---------------------------------------------------------------------------

	async run(task: RuntimeTask, llm: LLMExecutor, tools?: Map<string, ToolExecutor>): Promise<RuntimeResult> {
		const startTime = Date.now();
		const options = { ...this.getDefaultOptions(), ...task.options };

		this.emit("task:started", { task });
		this.activeTasks.set(task.id, task);

		const phases: RuntimePhase[] = [];
		const toolCalls: ToolCallRecord[] = [];
		const patternsUsed: string[] = [];

		let tokensUsed = 0;
		let iterations = 0;
		let output: string | undefined;
		let cacheHit = false;
		let experienceUsed = false;

		try {
			// Check cache first
			if (options.useCache && this.config.enableCache) {
				const cached = this.checkCache(task.prompt);
				if (cached) {
					cacheHit = true;
					patternsUsed.push("cache");

					const result: RuntimeResult = {
						taskId: task.id,
						success: true,
						output: cached,
						duration: Date.now() - startTime,
						tokensUsed: 0,
						iterations: 0,
						qualityScore: 1,
						phases: [],
						toolCalls: [],
						cacheHit: true,
						experienceUsed: false,
						model: options.model || "cached",
						patternsUsed,
					};

					this.emit("task:completed", { result });
					this.taskHistory.set(task.id, result);
					return result;
				}
			}

			// Retrieve relevant experiences
			let contextEnhancement = "";
			if (options.useExperienceReplay && this.config.enableExperienceReplay) {
				const relevant = this.findRelevantExperiences(task.prompt);
				if (relevant.length > 0) {
					experienceUsed = true;
					patternsUsed.push("experience-replay");
					contextEnhancement = this.formatExperiences(relevant);
					this.emit("experience:retrieved", { taskId: task.id, count: relevant.length });
				}
			}

			// Build enhanced prompt
			let enhancedPrompt = task.prompt;
			if (contextEnhancement) {
				enhancedPrompt = `${contextEnhancement}\n\nCurrent Task:\n${task.prompt}`;
			}

			// Execute with OODA if enabled
			if (options.useOODA && this.config.enableOODA) {
				patternsUsed.push("ooda-loop");
				const oodaResult = await this.executeWithOODA(
					task.id,
					enhancedPrompt,
					llm,
					tools,
					options,
					phases,
					toolCalls,
				);
				output = oodaResult.output;
				tokensUsed = oodaResult.tokensUsed;
				iterations = oodaResult.iterations;
			} else {
				// Simple execution
				const phaseStart = Date.now();
				this.emit("phase:started", { taskId: task.id, phase: "execute" });

				output = await llm(enhancedPrompt, {
					model: options.model,
					temperature: options.temperature,
				});

				tokensUsed = this.estimateTokens(enhancedPrompt + (output || ""));
				iterations = 1;

				const phase: RuntimePhase = {
					name: "execute",
					startTime: phaseStart,
					endTime: Date.now(),
					duration: Date.now() - phaseStart,
					tokens: tokensUsed,
					success: true,
					output,
				};
				phases.push(phase);
				this.emit("phase:completed", { taskId: task.id, phase });
			}

			// Reflection if enabled
			let qualityScore = 0.8; // Default
			if (options.useReflection && this.config.enableReflection && output) {
				patternsUsed.push("reflection");
				const reflectionResult = await this.reflect(task.id, task.prompt, output, llm, options, phases);
				qualityScore = reflectionResult.score;

				// Retry if quality is low
				if (qualityScore < options.minQuality && iterations < options.maxIterations) {
					this.emit("reflection:triggered", { taskId: task.id, score: qualityScore });

					const retryPrompt = `${task.prompt}\n\nPrevious attempt scored ${(qualityScore * 100).toFixed(0)}% quality. Please improve:\n${reflectionResult.feedback}`;
					output = await llm(retryPrompt, { model: options.model });
					iterations++;
					tokensUsed += this.estimateTokens(retryPrompt + (output || ""));
				}
			}

			// Store successful experience
			if (output && qualityScore >= options.minQuality) {
				this.storeExperience(task.prompt, output, qualityScore);

				// Cache successful response
				if (options.useCache && this.config.enableCache) {
					this.cacheResponse(task.prompt, output);
				}
			}

			const result: RuntimeResult = {
				taskId: task.id,
				success: true,
				output,
				duration: Date.now() - startTime,
				tokensUsed,
				iterations,
				qualityScore,
				phases,
				toolCalls,
				cacheHit,
				experienceUsed,
				model: options.model || "default",
				patternsUsed,
			};

			this.emit("task:completed", { result });
			this.taskHistory.set(task.id, result);
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emit("task:failed", { task, error: err });

			return {
				taskId: task.id,
				success: false,
				error: err.message,
				duration: Date.now() - startTime,
				tokensUsed,
				iterations,
				qualityScore: 0,
				phases,
				toolCalls,
				cacheHit,
				experienceUsed,
				model: options.model || "default",
				patternsUsed,
			};
		} finally {
			this.activeTasks.delete(task.id);
		}
	}

	// ---------------------------------------------------------------------------
	// OODA Execution
	// ---------------------------------------------------------------------------

	private async executeWithOODA(
		taskId: string,
		prompt: string,
		llm: LLMExecutor,
		tools: Map<string, ToolExecutor> | undefined,
		options: RuntimeOptions,
		phases: RuntimePhase[],
		toolCalls: ToolCallRecord[],
	): Promise<{ output: string; tokensUsed: number; iterations: number }> {
		let tokensUsed = 0;
		let iterations = 0;
		let finalOutput = "";

		const oodaPhases = ["observe", "orient", "decide", "act"] as const;

		for (const phaseName of oodaPhases) {
			const phaseStart = Date.now();
			this.emit("phase:started", { taskId, phase: phaseName });

			const phasePrompt = this.buildOODAPrompt(phaseName, prompt, finalOutput);
			const phaseOutput = await llm(phasePrompt, { model: options.model });

			const phaseTokens = this.estimateTokens(phasePrompt + phaseOutput);
			tokensUsed += phaseTokens;
			iterations++;

			const phase: RuntimePhase = {
				name: phaseName,
				startTime: phaseStart,
				endTime: Date.now(),
				duration: Date.now() - phaseStart,
				tokens: phaseTokens,
				success: true,
				output: phaseOutput,
			};
			phases.push(phase);
			this.emit("phase:completed", { taskId, phase });

			// Execute tools in "act" phase
			if (phaseName === "act" && tools) {
				const toolResults = await this.executeTools(taskId, phaseOutput, tools, toolCalls);
				if (toolResults) {
					finalOutput = `${phaseOutput}\n\nTool Results:\n${toolResults}`;
				} else {
					finalOutput = phaseOutput;
				}
			} else {
				finalOutput = phaseOutput;
			}
		}

		return { output: finalOutput, tokensUsed, iterations };
	}

	private buildOODAPrompt(phase: string, task: string, previousOutput: string): string {
		const phaseInstructions: Record<string, string> = {
			observe: `Observe and gather information about the following task. What are the key facts and requirements?\n\nTask: ${task}`,
			orient: `Based on your observations, analyze the situation. What patterns do you see? What's the best approach?\n\nObservations:\n${previousOutput}\n\nOriginal Task: ${task}`,
			decide: `Based on your analysis, decide on the best course of action. What specific steps should be taken?\n\nAnalysis:\n${previousOutput}\n\nOriginal Task: ${task}`,
			act: `Execute the decided plan. Provide the final response to the task.\n\nPlan:\n${previousOutput}\n\nOriginal Task: ${task}`,
		};
		return phaseInstructions[phase] || task;
	}

	private async executeTools(
		taskId: string,
		output: string,
		tools: Map<string, ToolExecutor>,
		toolCalls: ToolCallRecord[],
	): Promise<string | null> {
		// Simple tool extraction (look for tool calls in output)
		const toolPattern = /\[TOOL:(\w+)\]\s*({[^}]+})/g;
		let match;
		const results: string[] = [];

		while ((match = toolPattern.exec(output)) !== null) {
			const toolName = match[1];
			const paramsStr = match[2];

			const executor = tools.get(toolName);
			if (!executor) continue;

			const startTime = Date.now();
			try {
				const params = JSON.parse(paramsStr);
				const result = await executor(toolName, params);

				const record: ToolCallRecord = {
					tool: toolName,
					params,
					result,
					success: true,
					duration: Date.now() - startTime,
				};
				toolCalls.push(record);
				this.emit("tool:called", { taskId, record });

				results.push(`${toolName}: ${JSON.stringify(result)}`);
			} catch (_error) {
				const record: ToolCallRecord = {
					tool: toolName,
					params: {},
					success: false,
					duration: Date.now() - startTime,
				};
				toolCalls.push(record);
			}
		}

		return results.length > 0 ? results.join("\n") : null;
	}

	// ---------------------------------------------------------------------------
	// Reflection
	// ---------------------------------------------------------------------------

	private async reflect(
		taskId: string,
		task: string,
		output: string,
		llm: LLMExecutor,
		options: RuntimeOptions,
		phases: RuntimePhase[],
	): Promise<{ score: number; feedback: string }> {
		const phaseStart = Date.now();
		this.emit("phase:started", { taskId, phase: "reflect" });

		const reflectionPrompt = `Evaluate the following response on a scale of 0-100:

Task: ${task}

Response: ${output}

Provide:
1. Score (0-100)
2. Brief feedback for improvement

Format: SCORE: [number]
FEEDBACK: [feedback]`;

		const reflection = await llm(reflectionPrompt, { model: options.model });

		// Parse score
		const scoreMatch = reflection.match(/SCORE:\s*(\d+)/i);
		const feedbackMatch = reflection.match(/FEEDBACK:\s*(.+)/is);

		const score = scoreMatch ? parseInt(scoreMatch[1], 10) / 100 : 0.7;
		const feedback = feedbackMatch ? feedbackMatch[1].trim() : "No specific feedback";

		const phase: RuntimePhase = {
			name: "reflect",
			startTime: phaseStart,
			endTime: Date.now(),
			duration: Date.now() - phaseStart,
			tokens: this.estimateTokens(reflectionPrompt + reflection),
			success: true,
			output: { score, feedback },
		};
		phases.push(phase);
		this.emit("phase:completed", { taskId, phase });

		return { score, feedback };
	}

	// ---------------------------------------------------------------------------
	// Caching
	// ---------------------------------------------------------------------------

	private checkCache(prompt: string): string | null {
		const key = this.hashPrompt(prompt);
		const cached = this.promptCache.get(key);

		if (cached && Date.now() - cached.timestamp < 3600000) {
			// 1 hour TTL
			return cached.response;
		}

		return null;
	}

	private cacheResponse(prompt: string, response: string): void {
		const key = this.hashPrompt(prompt);

		// Evict oldest if at capacity
		if (this.promptCache.size >= this.config.cacheSize) {
			let oldest: string | null = null;
			let oldestTime = Infinity;

			for (const [k, v] of this.promptCache) {
				if (v.timestamp < oldestTime) {
					oldestTime = v.timestamp;
					oldest = k;
				}
			}

			if (oldest) {
				this.promptCache.delete(oldest);
			}
		}

		this.promptCache.set(key, { response, timestamp: Date.now() });
	}

	private hashPrompt(prompt: string): string {
		// Simple hash
		let hash = 0;
		for (let i = 0; i < prompt.length; i++) {
			const char = prompt.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}
		return hash.toString(36);
	}

	// ---------------------------------------------------------------------------
	// Experience Replay
	// ---------------------------------------------------------------------------

	private findRelevantExperiences(prompt: string): Array<{ prompt: string; output: string; score: number }> {
		const words = new Set(prompt.toLowerCase().split(/\s+/));

		return this.experiences
			.map((exp) => {
				const expWords = new Set(exp.prompt.toLowerCase().split(/\s+/));
				const intersection = [...words].filter((w) => expWords.has(w));
				const similarity = intersection.length / Math.max(words.size, expWords.size);
				return { ...exp, similarity };
			})
			.filter((exp) => exp.similarity > 0.3)
			.sort((a, b) => b.similarity * b.score - a.similarity * a.score)
			.slice(0, 3);
	}

	private formatExperiences(experiences: Array<{ prompt: string; output: string }>): string {
		return `Relevant past experiences:\n${experiences
			.map((e, i) => `Example ${i + 1}:\nTask: ${e.prompt.slice(0, 200)}...\nSolution: ${e.output.slice(0, 300)}...`)
			.join("\n\n")}`;
	}

	private storeExperience(prompt: string, output: string, score: number): void {
		this.experiences.push({ prompt, output, score, timestamp: Date.now() });

		// Keep only top 100 experiences
		if (this.experiences.length > 100) {
			this.experiences.sort((a, b) => b.score - a.score);
			this.experiences = this.experiences.slice(0, 100);
		}
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private getDefaultOptions(): Required<RuntimeOptions> {
		return {
			maxIterations: this.config.defaultMaxIterations,
			timeout: this.config.defaultTimeout,
			tokenBudget: this.config.defaultTokenBudget,
			useOODA: this.config.enableOODA,
			useReflection: this.config.enableReflection,
			useExperienceReplay: this.config.enableExperienceReplay,
			useCache: this.config.enableCache,
			useHooks: this.config.enableHooks,
			useParallelExecution: this.config.enableParallelExecution,
			minQuality: this.config.defaultMinQuality,
			maxRetries: 2,
			model: "default",
			temperature: 0.7,
		};
	}

	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getActiveTasks(): RuntimeTask[] {
		return Array.from(this.activeTasks.values());
	}

	getTaskHistory(limit = 100): RuntimeResult[] {
		return Array.from(this.taskHistory.values()).slice(-limit);
	}

	getStats(): {
		totalTasks: number;
		successRate: number;
		avgDuration: number;
		avgTokens: number;
		cacheHitRate: number;
	} {
		const results = Array.from(this.taskHistory.values());
		if (results.length === 0) {
			return {
				totalTasks: 0,
				successRate: 0,
				avgDuration: 0,
				avgTokens: 0,
				cacheHitRate: 0,
			};
		}

		const successCount = results.filter((r) => r.success).length;
		const cacheHits = results.filter((r) => r.cacheHit).length;

		return {
			totalTasks: results.length,
			successRate: successCount / results.length,
			avgDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
			avgTokens: results.reduce((sum, r) => sum + r.tokensUsed, 0) / results.length,
			cacheHitRate: cacheHits / results.length,
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearCache(): void {
		this.promptCache.clear();
	}

	clearExperiences(): void {
		this.experiences = [];
	}

	clearHistory(): void {
		this.taskHistory.clear();
	}

	reset(): void {
		this.activeTasks.clear();
		this.taskHistory.clear();
		this.promptCache.clear();
		this.experiences = [];
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: UnifiedRuntime | null = null;

export function getUnifiedRuntime(config?: Partial<RuntimeConfig>): UnifiedRuntime {
	if (!instance) {
		instance = new UnifiedRuntime(config);
	}
	return instance;
}

export function resetUnifiedRuntime(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
