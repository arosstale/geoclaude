/**
 * Parallel Agent Patterns (Google ADK Style)
 * GLM-4.7 Orchestral Agent Upgrade - Dec 2025
 *
 * Implements:
 * - Sequential Pipeline (Assembly Line)
 * - Parallel Fan-Out/Gather (Octopus)
 * - Coordinator/Dispatcher (Concierge)
 * - Generator-Critic Loop (Editor's Desk)
 * - Iterative Refinement (Sculptor)
 */

import { EventEmitter } from "events";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface AgentTask<TInput = unknown, TOutput = unknown> {
	id: string;
	name: string;
	description?: string;
	execute: (input: TInput, context: AgentContext) => Promise<TOutput>;
	outputKey?: string; // Key to store output in shared state
}

export interface AgentContext {
	state: Map<string, unknown>;
	channelId?: string;
	userId?: string;
	metadata?: Record<string, unknown>;
}

export interface PipelineResult<T> {
	success: boolean;
	output: T;
	state: Map<string, unknown>;
	timing: { total: number; steps: Record<string, number> };
	errors?: Error[];
}

export interface ParallelResult<T> {
	success: boolean;
	outputs: Map<string, T>;
	errors: Map<string, Error>;
	timing: { total: number; agents: Record<string, number> };
}

export interface CriticResult {
	passed: boolean;
	feedback: string;
	score?: number;
	suggestions?: string[];
}

// ============================================================================
// 1. Sequential Pipeline Pattern (Assembly Line)
// ============================================================================

export class SequentialPipeline<TFinal = unknown> extends EventEmitter {
	private steps: AgentTask[] = [];
	private context: AgentContext;

	constructor(initialState: Map<string, unknown> = new Map()) {
		super();
		this.context = { state: initialState };
	}

	addStep<TIn, TOut>(step: AgentTask<TIn, TOut>): this {
		this.steps.push(step as AgentTask);
		return this;
	}

	async execute<TInput>(input: TInput): Promise<PipelineResult<TFinal>> {
		const timing: Record<string, number> = {};
		const startTotal = Date.now();
		let currentOutput: unknown = input;

		this.emit("pipeline:start", { steps: this.steps.length });

		for (const step of this.steps) {
			const stepStart = Date.now();
			this.emit("step:start", { step: step.name });

			try {
				currentOutput = await step.execute(currentOutput, this.context);

				// Store output in shared state if outputKey specified
				if (step.outputKey) {
					this.context.state.set(step.outputKey, currentOutput);
				}

				timing[step.name] = Date.now() - stepStart;
				this.emit("step:complete", { step: step.name, timing: timing[step.name] });
			} catch (error) {
				this.emit("step:error", { step: step.name, error });
				return {
					success: false,
					output: currentOutput as TFinal,
					state: this.context.state,
					timing: { total: Date.now() - startTotal, steps: timing },
					errors: [error as Error],
				};
			}
		}

		this.emit("pipeline:complete", { timing: Date.now() - startTotal });

		return {
			success: true,
			output: currentOutput as TFinal,
			state: this.context.state,
			timing: { total: Date.now() - startTotal, steps: timing },
		};
	}
}

// ============================================================================
// 2. Parallel Fan-Out/Gather Pattern (Octopus)
// ============================================================================

export class ParallelFanOut<TInput = unknown, TOutput = unknown> extends EventEmitter {
	private agents: AgentTask<TInput, TOutput>[] = [];
	private context: AgentContext;
	private maxConcurrency: number;

	constructor(
		options: {
			maxConcurrency?: number;
			initialState?: Map<string, unknown>;
		} = {},
	) {
		super();
		this.maxConcurrency = options.maxConcurrency ?? Infinity;
		this.context = { state: options.initialState ?? new Map() };
	}

	addAgent(agent: AgentTask<TInput, TOutput>): this {
		this.agents.push(agent);
		return this;
	}

	async execute(input: TInput): Promise<ParallelResult<TOutput>> {
		const startTotal = Date.now();
		const outputs = new Map<string, TOutput>();
		const errors = new Map<string, Error>();
		const timing: Record<string, number> = {};

		this.emit("fanout:start", { agents: this.agents.length });

		// Execute all agents in parallel with concurrency limit
		const executeAgent = async (agent: AgentTask<TInput, TOutput>) => {
			const agentStart = Date.now();
			this.emit("agent:start", { agent: agent.name });

			try {
				const output = await agent.execute(input, this.context);
				outputs.set(agent.id, output);

				// Store in shared state (unique key per agent)
				if (agent.outputKey) {
					this.context.state.set(agent.outputKey, output);
				}

				timing[agent.name] = Date.now() - agentStart;
				this.emit("agent:complete", { agent: agent.name, timing: timing[agent.name] });
			} catch (error) {
				errors.set(agent.id, error as Error);
				timing[agent.name] = Date.now() - agentStart;
				this.emit("agent:error", { agent: agent.name, error });
			}
		};

		// Process with concurrency limit
		const chunks = [];
		for (let i = 0; i < this.agents.length; i += this.maxConcurrency) {
			chunks.push(this.agents.slice(i, i + this.maxConcurrency));
		}

		for (const chunk of chunks) {
			await Promise.all(chunk.map(executeAgent));
		}

		this.emit("fanout:complete", { timing: Date.now() - startTotal, success: errors.size === 0 });

		return {
			success: errors.size === 0,
			outputs,
			errors,
			timing: { total: Date.now() - startTotal, agents: timing },
		};
	}

	// Synthesizer: Combine outputs from all agents
	async gather<TSynthesized>(
		input: TInput,
		synthesizer: (outputs: Map<string, TOutput>, context: AgentContext) => Promise<TSynthesized>,
	): Promise<{ fanOut: ParallelResult<TOutput>; synthesized: TSynthesized }> {
		const fanOut = await this.execute(input);
		const synthesized = await synthesizer(fanOut.outputs, this.context);
		return { fanOut, synthesized };
	}
}

// ============================================================================
// 3. Coordinator/Dispatcher Pattern (Concierge)
// ============================================================================

export interface RoutingRule<TInput = unknown> {
	id: string;
	description: string;
	match: (input: TInput, context: AgentContext) => boolean;
	agentId: string;
}

export class Coordinator<TInput = unknown, TOutput = unknown> extends EventEmitter {
	private agents = new Map<string, AgentTask<TInput, TOutput>>();
	private rules: RoutingRule<TInput>[] = [];
	private defaultAgentId?: string;
	private context: AgentContext;

	constructor(initialState: Map<string, unknown> = new Map()) {
		super();
		this.context = { state: initialState };
	}

	registerAgent(agent: AgentTask<TInput, TOutput>): this {
		this.agents.set(agent.id, agent);
		return this;
	}

	addRule(rule: RoutingRule<TInput>): this {
		this.rules.push(rule);
		return this;
	}

	setDefaultAgent(agentId: string): this {
		this.defaultAgentId = agentId;
		return this;
	}

	async dispatch(input: TInput): Promise<{ agentId: string; output: TOutput }> {
		this.emit("dispatch:start", { input });

		// Find matching rule
		let targetAgentId: string | undefined;
		for (const rule of this.rules) {
			if (rule.match(input, this.context)) {
				targetAgentId = rule.agentId;
				this.emit("dispatch:matched", { rule: rule.id, agent: rule.agentId });
				break;
			}
		}

		// Fall back to default
		if (!targetAgentId) {
			targetAgentId = this.defaultAgentId;
			this.emit("dispatch:default", { agent: targetAgentId });
		}

		if (!targetAgentId || !this.agents.has(targetAgentId)) {
			throw new Error(`No agent found for routing (tried: ${targetAgentId})`);
		}

		const agent = this.agents.get(targetAgentId)!;
		const startTime = Date.now();

		try {
			const output = await agent.execute(input, this.context);
			this.emit("dispatch:complete", { agent: targetAgentId, timing: Date.now() - startTime });
			return { agentId: targetAgentId, output };
		} catch (error) {
			this.emit("dispatch:error", { agent: targetAgentId, error });
			throw error;
		}
	}
}

// ============================================================================
// 4. Generator-Critic Loop Pattern (Editor's Desk)
// ============================================================================

export interface GeneratorCriticConfig {
	maxIterations: number;
	passingScore?: number; // 0-100, default 80
}

export class GeneratorCriticLoop<TInput = unknown, TOutput = unknown> extends EventEmitter {
	private generator: AgentTask<TInput, TOutput>;
	private critic: AgentTask<TOutput, CriticResult>;
	private refiner?: AgentTask<{ draft: TOutput; feedback: CriticResult }, TOutput>;
	private config: GeneratorCriticConfig;
	private context: AgentContext;

	constructor(
		generator: AgentTask<TInput, TOutput>,
		critic: AgentTask<TOutput, CriticResult>,
		config: GeneratorCriticConfig = { maxIterations: 3 },
		refiner?: AgentTask<{ draft: TOutput; feedback: CriticResult }, TOutput>,
	) {
		super();
		this.generator = generator;
		this.critic = critic;
		this.refiner = refiner;
		this.config = config;
		this.context = { state: new Map() };
	}

	async execute(input: TInput): Promise<{
		success: boolean;
		iterations: number;
		finalOutput: TOutput;
		criticFeedback: CriticResult;
		history: Array<{ output: TOutput; feedback: CriticResult }>;
	}> {
		const history: Array<{ output: TOutput; feedback: CriticResult }> = [];
		let currentOutput: TOutput;
		let feedback: CriticResult = { passed: false, feedback: "" };
		const passingScore = this.config.passingScore ?? 80;

		this.emit("loop:start", { maxIterations: this.config.maxIterations });

		// Initial generation
		this.emit("generate:start", { iteration: 0 });
		currentOutput = await this.generator.execute(input, this.context);
		this.emit("generate:complete", { iteration: 0 });

		for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
			// Critique
			this.emit("critique:start", { iteration });
			feedback = await this.critic.execute(currentOutput, this.context);
			this.emit("critique:complete", { iteration, feedback });

			history.push({ output: currentOutput, feedback });

			// Check if passed
			if (feedback.passed || (feedback.score !== undefined && feedback.score >= passingScore)) {
				this.emit("loop:passed", { iteration, score: feedback.score });
				return {
					success: true,
					iterations: iteration,
					finalOutput: currentOutput,
					criticFeedback: feedback,
					history,
				};
			}

			// Refine if not passed and not last iteration
			if (iteration < this.config.maxIterations) {
				this.emit("refine:start", { iteration });
				if (this.refiner) {
					currentOutput = await this.refiner.execute({ draft: currentOutput, feedback }, this.context);
				} else {
					// Re-generate with feedback context
					this.context.state.set("previousFeedback", feedback);
					currentOutput = await this.generator.execute(input, this.context);
				}
				this.emit("refine:complete", { iteration });
			}
		}

		this.emit("loop:exhausted", { iterations: this.config.maxIterations });

		return {
			success: false,
			iterations: this.config.maxIterations,
			finalOutput: currentOutput,
			criticFeedback: feedback,
			history,
		};
	}
}

// ============================================================================
// 5. Iterative Refinement Pattern (Sculptor)
// ============================================================================

export interface RefinementStep<T> {
	id: string;
	name: string;
	refine: (current: T, context: AgentContext) => Promise<T>;
	shouldContinue?: (current: T, iteration: number) => Promise<boolean>;
}

export class IterativeRefinement<T> extends EventEmitter {
	private steps: RefinementStep<T>[] = [];
	private maxIterations: number;
	private context: AgentContext;

	constructor(maxIterations: number = 5, initialState: Map<string, unknown> = new Map()) {
		super();
		this.maxIterations = maxIterations;
		this.context = { state: initialState };
	}

	addStep(step: RefinementStep<T>): this {
		this.steps.push(step);
		return this;
	}

	async execute(initial: T): Promise<{
		final: T;
		iterations: number;
		history: T[];
	}> {
		const history: T[] = [initial];
		let current = initial;
		let iteration = 0;

		this.emit("refinement:start", { maxIterations: this.maxIterations });

		while (iteration < this.maxIterations) {
			iteration++;
			let improved = false;

			for (const step of this.steps) {
				this.emit("step:start", { step: step.name, iteration });

				// Check if we should continue with this step
				if (step.shouldContinue) {
					const shouldContinue = await step.shouldContinue(current, iteration);
					if (!shouldContinue) {
						this.emit("step:skip", { step: step.name, reason: "shouldContinue returned false" });
						continue;
					}
				}

				const refined = await step.refine(current, this.context);

				// Check if improvement was made (simple JSON comparison)
				if (JSON.stringify(refined) !== JSON.stringify(current)) {
					current = refined;
					improved = true;
					this.emit("step:improved", { step: step.name, iteration });
				}

				this.emit("step:complete", { step: step.name, iteration });
			}

			history.push(current);

			// Early termination if no improvements
			if (!improved) {
				this.emit("refinement:converged", { iteration });
				break;
			}
		}

		this.emit("refinement:complete", { iterations: iteration });

		return { final: current, iterations: iteration, history };
	}
}

// ============================================================================
// 6. Composite Pattern Builder
// ============================================================================

export class AgentWorkflowBuilder {
	private components: Array<{
		type: "sequential" | "parallel" | "coordinator" | "generator-critic" | "iterative";
		instance: unknown;
	}> = [];

	sequential(): SequentialPipeline {
		const pipeline = new SequentialPipeline();
		this.components.push({ type: "sequential", instance: pipeline });
		return pipeline;
	}

	parallel(options?: { maxConcurrency?: number }): ParallelFanOut {
		const fanOut = new ParallelFanOut(options);
		this.components.push({ type: "parallel", instance: fanOut });
		return fanOut;
	}

	coordinator(): Coordinator {
		const coord = new Coordinator();
		this.components.push({ type: "coordinator", instance: coord });
		return coord;
	}

	generatorCritic<TIn, TOut>(
		generator: AgentTask<TIn, TOut>,
		critic: AgentTask<TOut, CriticResult>,
		config?: GeneratorCriticConfig,
	): GeneratorCriticLoop<TIn, TOut> {
		const loop = new GeneratorCriticLoop(generator, critic, config);
		this.components.push({ type: "generator-critic", instance: loop });
		return loop;
	}

	iterative<T>(maxIterations?: number): IterativeRefinement<T> {
		const refinement = new IterativeRefinement<T>(maxIterations);
		this.components.push({ type: "iterative", instance: refinement });
		return refinement;
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createPipeline<TFinal = unknown>(): SequentialPipeline<TFinal> {
	return new SequentialPipeline<TFinal>();
}

export function createParallelFanOut<TIn = unknown, TOut = unknown>(options?: {
	maxConcurrency?: number;
}): ParallelFanOut<TIn, TOut> {
	return new ParallelFanOut<TIn, TOut>(options);
}

export function createCoordinator<TIn = unknown, TOut = unknown>(): Coordinator<TIn, TOut> {
	return new Coordinator<TIn, TOut>();
}

export function createGeneratorCritic<TIn, TOut>(
	generator: AgentTask<TIn, TOut>,
	critic: AgentTask<TOut, CriticResult>,
	config?: GeneratorCriticConfig,
): GeneratorCriticLoop<TIn, TOut> {
	return new GeneratorCriticLoop(generator, critic, config);
}

export function createIterativeRefinement<T>(maxIterations?: number): IterativeRefinement<T> {
	return new IterativeRefinement<T>(maxIterations);
}

export function workflow(): AgentWorkflowBuilder {
	return new AgentWorkflowBuilder();
}

// ============================================================================
// Pre-built Trading Patterns
// ============================================================================

export interface TradingSignal {
	symbol: string;
	direction: "buy" | "sell" | "hold";
	confidence: number;
	reasoning: string;
	source: string;
}

export interface MarketData {
	symbol: string;
	price: number;
	volume: number;
	change24h: number;
}

/**
 * Create a trading analysis fan-out pattern
 * Runs Price, Sentiment, and Whale agents in parallel, then synthesizes
 */
export function createTradingFanOut(agents: {
	price: (data: MarketData) => Promise<TradingSignal>;
	sentiment: (data: MarketData) => Promise<TradingSignal>;
	whale: (data: MarketData) => Promise<TradingSignal>;
	synthesize: (signals: TradingSignal[]) => Promise<TradingSignal>;
}): ParallelFanOut<MarketData, TradingSignal> {
	const fanOut = new ParallelFanOut<MarketData, TradingSignal>({ maxConcurrency: 3 });

	fanOut.addAgent({
		id: "price-agent",
		name: "Price Analyzer",
		description: "Analyzes price action and technicals",
		outputKey: "price_signal",
		execute: async (data) => agents.price(data),
	});

	fanOut.addAgent({
		id: "sentiment-agent",
		name: "Sentiment Analyzer",
		description: "Analyzes social sentiment and news",
		outputKey: "sentiment_signal",
		execute: async (data) => agents.sentiment(data),
	});

	fanOut.addAgent({
		id: "whale-agent",
		name: "Whale Tracker",
		description: "Tracks whale wallet activity",
		outputKey: "whale_signal",
		execute: async (data) => agents.whale(data),
	});

	return fanOut;
}

/**
 * Create a trading signal pipeline
 * Data Collection → Pattern Analysis → Signal Generation → Risk Assessment
 */
export function createTradingPipeline<TResult = TradingSignal>(): SequentialPipeline<TResult> {
	return new SequentialPipeline<TResult>();
}

export default {
	SequentialPipeline,
	ParallelFanOut,
	Coordinator,
	GeneratorCriticLoop,
	IterativeRefinement,
	AgentWorkflowBuilder,
	createPipeline,
	createParallelFanOut,
	createCoordinator,
	createGeneratorCritic,
	createIterativeRefinement,
	workflow,
	createTradingFanOut,
	createTradingPipeline,
};
