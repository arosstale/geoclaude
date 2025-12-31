/**
 * Model Selection Strategy
 *
 * Strategy Pattern: Different algorithms for model selection
 * OCP: Add new strategies without modifying existing code
 * LSP: All strategies are substitutable for IModelStrategy
 */

/**
 * Model information
 */
export interface ModelInfo {
	id: string;
	provider: string;
	contextLength: number;
	costPerMToken: number;
	speed: "fast" | "medium" | "slow";
	capabilities: ModelCapability[];
}

/**
 * Model capabilities
 */
export type ModelCapability =
	| "chat"
	| "code"
	| "vision"
	| "function_calling"
	| "json_mode"
	| "reasoning"
	| "long_context";

/**
 * Selection context for strategies
 */
export interface SelectionContext {
	/** Task type */
	taskType?: "chat" | "code" | "analysis" | "research" | "trading";

	/** Required capabilities */
	requiredCapabilities?: ModelCapability[];

	/** Message count in context */
	contextSize?: number;

	/** User preference */
	userPreference?: string;

	/** Cost sensitivity */
	optimizeFor?: "speed" | "quality" | "cost";
}

/**
 * Model selection strategy interface
 * ISP: Minimal interface for strategies
 */
export interface IModelStrategy {
	name: string;
	select(context: SelectionContext, models: ModelInfo[]): ModelInfo | null;
}

/**
 * Default strategy: Use user preference or first available
 */
export class DefaultStrategy implements IModelStrategy {
	name = "default";

	select(context: SelectionContext, models: ModelInfo[]): ModelInfo | null {
		if (context.userPreference) {
			const preferred = models.find((m) => m.id === context.userPreference);
			if (preferred) return preferred;
		}
		return models[0] ?? null;
	}
}

/**
 * Cost-optimized strategy: Select cheapest model that meets requirements
 */
export class CostOptimizedStrategy implements IModelStrategy {
	name = "cost-optimized";

	select(context: SelectionContext, models: ModelInfo[]): ModelInfo | null {
		const filtered = this.filterByCapabilities(models, context.requiredCapabilities);
		if (filtered.length === 0) return null;

		return filtered.reduce((cheapest, model) => (model.costPerMToken < cheapest.costPerMToken ? model : cheapest));
	}

	private filterByCapabilities(models: ModelInfo[], required?: ModelCapability[]): ModelInfo[] {
		if (!required || required.length === 0) return models;
		return models.filter((m) => required.every((cap) => m.capabilities.includes(cap)));
	}
}

/**
 * Speed-optimized strategy: Select fastest model that meets requirements
 */
export class SpeedOptimizedStrategy implements IModelStrategy {
	name = "speed-optimized";

	private speedRank = { fast: 0, medium: 1, slow: 2 };

	select(context: SelectionContext, models: ModelInfo[]): ModelInfo | null {
		const filtered = models.filter((m) => {
			if (!context.requiredCapabilities) return true;
			return context.requiredCapabilities.every((cap) => m.capabilities.includes(cap));
		});

		if (filtered.length === 0) return null;

		return filtered.reduce((fastest, model) =>
			this.speedRank[model.speed] < this.speedRank[fastest.speed] ? model : fastest,
		);
	}
}

/**
 * Task-based strategy: Select model best suited for task type
 */
export class TaskBasedStrategy implements IModelStrategy {
	name = "task-based";

	private taskModels: Record<string, string[]> = {
		code: ["anthropic/claude-sonnet-4-20250514", "deepseek/deepseek-chat"],
		analysis: ["anthropic/claude-sonnet-4-20250514", "google/gemini-2.0-flash-001"],
		research: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o"],
		trading: ["google/gemini-2.0-flash-001", "anthropic/claude-sonnet-4-20250514"],
		chat: ["google/gemini-2.0-flash-001", "anthropic/claude-sonnet-4-20250514"],
	};

	select(context: SelectionContext, models: ModelInfo[]): ModelInfo | null {
		const taskType = context.taskType ?? "chat";
		const preferredIds = this.taskModels[taskType] ?? this.taskModels.chat;

		for (const id of preferredIds) {
			const model = models.find((m) => m.id === id);
			if (model) return model;
		}

		return models[0] ?? null;
	}
}

/**
 * Context-aware strategy: Consider context size for model selection
 */
export class ContextAwareStrategy implements IModelStrategy {
	name = "context-aware";

	select(context: SelectionContext, models: ModelInfo[]): ModelInfo | null {
		const contextSize = context.contextSize ?? 0;

		// Filter models that can handle the context
		const suitable = models.filter((m) => m.contextLength > contextSize * 1.2);

		if (suitable.length === 0) {
			// Fall back to model with largest context
			return models.reduce((largest, m) => (m.contextLength > largest.contextLength ? m : largest));
		}

		// Among suitable, prefer based on optimization goal
		if (context.optimizeFor === "cost") {
			return suitable.reduce((cheapest, m) => (m.costPerMToken < cheapest.costPerMToken ? m : cheapest));
		}

		return suitable[0];
	}
}

/**
 * Model Router: Applies strategy pattern for model selection
 */
export class ModelRouter {
	private strategies: Map<string, IModelStrategy> = new Map();
	private defaultStrategy: IModelStrategy;
	private models: ModelInfo[] = [];

	constructor(defaultStrategy?: IModelStrategy) {
		this.defaultStrategy = defaultStrategy ?? new DefaultStrategy();

		// Register built-in strategies
		this.registerStrategy(new DefaultStrategy());
		this.registerStrategy(new CostOptimizedStrategy());
		this.registerStrategy(new SpeedOptimizedStrategy());
		this.registerStrategy(new TaskBasedStrategy());
		this.registerStrategy(new ContextAwareStrategy());
	}

	/**
	 * Register a selection strategy
	 */
	registerStrategy(strategy: IModelStrategy): void {
		this.strategies.set(strategy.name, strategy);
	}

	/**
	 * Register available models
	 */
	registerModels(models: ModelInfo[]): void {
		this.models = models;
	}

	/**
	 * Select a model using the specified strategy
	 */
	select(context: SelectionContext, strategyName?: string): ModelInfo | null {
		const strategy = strategyName
			? (this.strategies.get(strategyName) ?? this.defaultStrategy)
			: this.defaultStrategy;

		return strategy.select(context, this.models);
	}

	/**
	 * Get model by ID
	 */
	getModel(id: string): ModelInfo | undefined {
		return this.models.find((m) => m.id === id);
	}

	/**
	 * List all available strategies
	 */
	listStrategies(): string[] {
		return Array.from(this.strategies.keys());
	}
}

/**
 * Pre-configured models
 */
export const KNOWN_MODELS: ModelInfo[] = [
	{
		id: "anthropic/claude-sonnet-4-20250514",
		provider: "openrouter",
		contextLength: 200000,
		costPerMToken: 3.0,
		speed: "medium",
		capabilities: ["chat", "code", "vision", "function_calling", "json_mode", "reasoning"],
	},
	{
		id: "google/gemini-2.0-flash-001",
		provider: "openrouter",
		contextLength: 1000000,
		costPerMToken: 0.1,
		speed: "fast",
		capabilities: ["chat", "code", "vision", "function_calling", "long_context"],
	},
	{
		id: "deepseek/deepseek-chat",
		provider: "openrouter",
		contextLength: 64000,
		costPerMToken: 0.14,
		speed: "fast",
		capabilities: ["chat", "code", "function_calling"],
	},
	{
		id: "openai/gpt-4o",
		provider: "openrouter",
		contextLength: 128000,
		costPerMToken: 5.0,
		speed: "medium",
		capabilities: ["chat", "code", "vision", "function_calling", "json_mode"],
	},
	{
		id: "meta-llama/llama-3.3-70b-instruct",
		provider: "groq",
		contextLength: 128000,
		costPerMToken: 0.0,
		speed: "fast",
		capabilities: ["chat", "code", "function_calling"],
	},
];

/**
 * Singleton router instance
 */
let routerInstance: ModelRouter | null = null;

/**
 * Initialize the model router
 */
export function initModelRouter(): ModelRouter {
	routerInstance = new ModelRouter();
	routerInstance.registerModels(KNOWN_MODELS);
	return routerInstance;
}

/**
 * Get the model router instance
 */
export function getModelRouter(): ModelRouter {
	if (!routerInstance) {
		return initModelRouter();
	}
	return routerInstance;
}
