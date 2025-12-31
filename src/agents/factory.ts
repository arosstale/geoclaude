/**
 * Agent Factory
 *
 * Factory Pattern: Encapsulates agent creation logic
 * OCP: New agent types can be added without modifying existing code
 * DIP: Depends on abstractions (AgentConfig), not concretions
 */

import { Agent, ProviderTransport } from "@mariozechner/pi-agent-core";
import type { AgentTool, Model } from "@mariozechner/pi-ai";

/**
 * Model configuration type
 */
export type ModelConfig = Model<"openai-completions"> | Model<"anthropic-messages">;

/**
 * Provider configuration
 */
export interface ProviderConfig {
	name: "openrouter" | "zai" | "cerebras" | "groq" | "ollama";
	apiKey?: string;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
	/** System prompt for the agent */
	systemPrompt: string;

	/** Model configuration */
	model: ModelConfig;

	/** Available tools */
	tools: AgentTool[];

	/** Provider to use */
	provider: ProviderConfig;

	/** Thinking level */
	thinkingLevel?: "off" | "low" | "medium" | "high";

	/** Message transformer function - matches Agent's expected signature */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	messageTransformer?: (messages: any[]) => any[] | Promise<any[]>;
}

/**
 * Agent types for the factory
 */
export type AgentType =
	| "default" // Standard chat agent
	| "expert" // Domain expert with learning
	| "task" // Two-phase task agent
	| "research" // Autonomous research agent
	| "trading"; // Trading analysis agent

/**
 * Create an Agent instance with the given configuration
 * Factory Pattern: Encapsulates complex object creation
 */
export function createAgent(config: AgentConfig): Agent {
	const { systemPrompt, model, tools, provider, thinkingLevel = "off", messageTransformer } = config;

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel,
			tools,
		},
		transport: new ProviderTransport({
			getApiKey: async (_provider?: string) => {
				return provider.apiKey ?? "ollama";
			},
		}),
		messageTransformer,
	});

	return agent;
}

/**
 * Default message transformer - filters and validates messages
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDefaultMessageTransformer(): (messages: any[]) => Promise<any[]> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return async (messages: any[]): Promise<any[]> => {
		return messages
			.filter((m: { role: string }) => m.role === "user" || m.role === "assistant" || m.role === "toolResult")
			.filter((m: { content: unknown }) => m.content !== undefined && m.content !== null);
	};
}

/**
 * Model creator function type
 */
export type ModelCreator = (modelId: string) => ModelConfig;

/**
 * Agent Factory class - creates different agent types
 * Strategy Pattern: Different creation strategies per type
 */
export class AgentFactory {
	private providers: Map<string, ProviderConfig> = new Map();
	private defaultProvider: ProviderConfig;
	private modelCreator: ModelCreator;

	constructor(defaultProvider: ProviderConfig, modelCreator: ModelCreator) {
		this.defaultProvider = defaultProvider;
		this.modelCreator = modelCreator;
	}

	/**
	 * Register a provider configuration
	 */
	registerProvider(name: string, config: ProviderConfig): void {
		this.providers.set(name, config);
	}

	/**
	 * Get provider config by name
	 */
	getProvider(name: string): ProviderConfig {
		return this.providers.get(name) ?? this.defaultProvider;
	}

	/**
	 * Create an agent of the specified type
	 */
	create(
		type: AgentType,
		options: {
			systemPrompt?: string;
			modelId?: string;
			model?: ModelConfig;
			tools?: AgentTool[];
			providerName?: string;
		},
	): Agent {
		const provider = options.providerName ? this.getProvider(options.providerName) : this.defaultProvider;

		const basePrompt = this.getBasePrompt(type);
		const systemPrompt = options.systemPrompt ? `${basePrompt}\n\n${options.systemPrompt}` : basePrompt;

		const model = options.model ?? this.modelCreator(options.modelId ?? this.getDefaultModelId(type));

		return createAgent({
			systemPrompt,
			model,
			tools: options.tools ?? [],
			provider,
			messageTransformer: createDefaultMessageTransformer(),
		});
	}

	/**
	 * Get base system prompt for agent type
	 */
	private getBasePrompt(type: AgentType): string {
		switch (type) {
			case "expert":
				return "You are a domain expert assistant. Learn from interactions and apply knowledge to solve problems efficiently.";
			case "task":
				return "You are a task-focused agent. First plan, then execute. Verify results before completion.";
			case "research":
				return "You are an autonomous research agent. Gather information systematically, cite sources, and synthesize findings.";
			case "trading":
				return "You are a trading analysis agent. Analyze markets, identify opportunities, and provide actionable insights.";
			default:
				return "You are a helpful AI assistant.";
		}
	}

	/**
	 * Get default model ID for agent type
	 */
	private getDefaultModelId(type: AgentType): string {
		switch (type) {
			case "expert":
			case "research":
				return "anthropic/claude-sonnet-4-20250514";
			case "trading":
				return "google/gemini-2.0-flash-001";
			default:
				return "anthropic/claude-sonnet-4-20250514";
		}
	}
}

/**
 * Singleton factory instance
 */
let factoryInstance: AgentFactory | null = null;

/**
 * Initialize the agent factory with default provider and model creator
 */
export function initAgentFactory(defaultProvider: ProviderConfig, modelCreator: ModelCreator): AgentFactory {
	factoryInstance = new AgentFactory(defaultProvider, modelCreator);
	return factoryInstance;
}

/**
 * Get the agent factory instance
 */
export function getAgentFactory(): AgentFactory {
	if (!factoryInstance) {
		throw new Error("AgentFactory not initialized. Call initAgentFactory first.");
	}
	return factoryInstance;
}
