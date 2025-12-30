/**
 * Class 3.31: Agent Hub
 *
 * Unified entry point for all agent operations.
 * Coordinates between all TAC pattern components.
 *
 * Features:
 * - Single interface for agent invocation
 * - Automatic pattern selection
 * - Integrated monitoring and logging
 * - Plugin architecture for extensions
 *
 * @module agent-hub
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type AgentCapability =
	| "code"
	| "research"
	| "analysis"
	| "generation"
	| "review"
	| "planning"
	| "execution"
	| "reflection"
	| "trading"
	| "security";

export interface AgentRequest {
	id: string;
	task: string;
	context?: Record<string, unknown>;
	capabilities?: AgentCapability[];
	priority?: "low" | "normal" | "high" | "critical";
	timeout?: number;
	userId?: string;
	channelId?: string;
	options?: {
		useCache?: boolean;
		useReflection?: boolean;
		useExperienceReplay?: boolean;
		maxRetries?: number;
		budgetLimit?: number;
	};
}

export interface AgentResponse {
	requestId: string;
	success: boolean;
	result?: unknown;
	error?: string;
	agentsUsed: string[];
	patternsUsed: string[];
	tokensUsed: number;
	duration: number;
	cached: boolean;
	metadata?: Record<string, unknown>;
}

export interface RegisteredAgent {
	id: string;
	name: string;
	capabilities: AgentCapability[];
	handler: AgentHandler;
	priority: number;
	enabled: boolean;
	stats: AgentStats;
}

export interface AgentStats {
	invocations: number;
	successes: number;
	failures: number;
	avgDuration: number;
	totalTokens: number;
}

export interface HubPlugin {
	name: string;
	version: string;
	beforeRequest?: (request: AgentRequest) => Promise<AgentRequest>;
	afterResponse?: (request: AgentRequest, response: AgentResponse) => Promise<AgentResponse>;
	onError?: (request: AgentRequest, error: Error) => Promise<void>;
}

export interface AgentHubConfig {
	defaultTimeout: number;
	maxConcurrentRequests: number;
	enableCaching: boolean;
	enableReflection: boolean;
	enableExperienceReplay: boolean;
	logLevel: "debug" | "info" | "warn" | "error";
}

export interface AgentHubEvents {
	"request:received": { request: AgentRequest };
	"request:started": { request: AgentRequest; agents: string[] };
	"request:completed": { request: AgentRequest; response: AgentResponse };
	"request:failed": { request: AgentRequest; error: Error };
	"agent:registered": { agent: RegisteredAgent };
	"plugin:loaded": { plugin: HubPlugin };
}

export type AgentHandler = (request: AgentRequest) => Promise<{
	success: boolean;
	result?: unknown;
	error?: string;
	tokensUsed?: number;
}>;

// =============================================================================
// Agent Hub
// =============================================================================

export class AgentHub extends EventEmitter {
	private config: AgentHubConfig;
	private agents: Map<string, RegisteredAgent> = new Map();
	private plugins: HubPlugin[] = [];
	private activeRequests: Map<string, AgentRequest> = new Map();
	private requestHistory: Map<string, AgentResponse> = new Map();

	constructor(config: Partial<AgentHubConfig> = {}) {
		super();
		this.config = {
			defaultTimeout: 60000,
			maxConcurrentRequests: 10,
			enableCaching: true,
			enableReflection: true,
			enableExperienceReplay: true,
			logLevel: "info",
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Agent Registration
	// ---------------------------------------------------------------------------

	registerAgent(params: {
		id: string;
		name: string;
		capabilities: AgentCapability[];
		handler: AgentHandler;
		priority?: number;
	}): void {
		const agent: RegisteredAgent = {
			id: params.id,
			name: params.name,
			capabilities: params.capabilities,
			handler: params.handler,
			priority: params.priority ?? 50,
			enabled: true,
			stats: {
				invocations: 0,
				successes: 0,
				failures: 0,
				avgDuration: 0,
				totalTokens: 0,
			},
		};

		this.agents.set(params.id, agent);
		this.emit("agent:registered", { agent });
	}

	enableAgent(id: string): boolean {
		const agent = this.agents.get(id);
		if (agent) {
			agent.enabled = true;
			return true;
		}
		return false;
	}

	disableAgent(id: string): boolean {
		const agent = this.agents.get(id);
		if (agent) {
			agent.enabled = false;
			return true;
		}
		return false;
	}

	// ---------------------------------------------------------------------------
	// Plugin System
	// ---------------------------------------------------------------------------

	loadPlugin(plugin: HubPlugin): void {
		this.plugins.push(plugin);
		this.emit("plugin:loaded", { plugin });
	}

	unloadPlugin(name: string): boolean {
		const index = this.plugins.findIndex((p) => p.name === name);
		if (index !== -1) {
			this.plugins.splice(index, 1);
			return true;
		}
		return false;
	}

	// ---------------------------------------------------------------------------
	// Request Processing
	// ---------------------------------------------------------------------------

	async process(request: AgentRequest): Promise<AgentResponse> {
		this.emit("request:received", { request });

		// Check concurrency limit
		if (this.activeRequests.size >= this.config.maxConcurrentRequests) {
			return {
				requestId: request.id,
				success: false,
				error: "Max concurrent requests reached",
				agentsUsed: [],
				patternsUsed: [],
				tokensUsed: 0,
				duration: 0,
				cached: false,
			};
		}

		const startTime = Date.now();
		let processedRequest = request;

		try {
			// Run before plugins
			for (const plugin of this.plugins) {
				if (plugin.beforeRequest) {
					processedRequest = await plugin.beforeRequest(processedRequest);
				}
			}

			this.activeRequests.set(request.id, processedRequest);

			// Select agents
			const selectedAgents = this.selectAgents(processedRequest);
			if (selectedAgents.length === 0) {
				throw new Error("No suitable agents found for request");
			}

			this.emit("request:started", {
				request: processedRequest,
				agents: selectedAgents.map((a) => a.id),
			});

			// Execute with best agent
			let response = await this.executeWithAgents(processedRequest, selectedAgents, startTime);

			// Run after plugins
			for (const plugin of this.plugins) {
				if (plugin.afterResponse) {
					response = await plugin.afterResponse(processedRequest, response);
				}
			}

			this.emit("request:completed", { request: processedRequest, response });
			this.requestHistory.set(request.id, response);

			return response;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));

			// Run error plugins
			for (const plugin of this.plugins) {
				if (plugin.onError) {
					await plugin.onError(processedRequest, err);
				}
			}

			const response: AgentResponse = {
				requestId: request.id,
				success: false,
				error: err.message,
				agentsUsed: [],
				patternsUsed: [],
				tokensUsed: 0,
				duration: Date.now() - startTime,
				cached: false,
			};

			this.emit("request:failed", { request: processedRequest, error: err });
			return response;
		} finally {
			this.activeRequests.delete(request.id);
		}
	}

	private selectAgents(request: AgentRequest): RegisteredAgent[] {
		const candidates: RegisteredAgent[] = [];

		for (const agent of this.agents.values()) {
			if (!agent.enabled) continue;

			// Check capability match
			if (request.capabilities && request.capabilities.length > 0) {
				const hasCapability = request.capabilities.some((cap) => agent.capabilities.includes(cap));
				if (!hasCapability) continue;
			}

			candidates.push(agent);
		}

		// Sort by priority and success rate
		return candidates.sort((a, b) => {
			const aScore = a.priority + (a.stats.invocations > 0 ? a.stats.successes / a.stats.invocations * 100 : 50);
			const bScore = b.priority + (b.stats.invocations > 0 ? b.stats.successes / b.stats.invocations * 100 : 50);
			return bScore - aScore;
		});
	}

	private async executeWithAgents(
		request: AgentRequest,
		agents: RegisteredAgent[],
		startTime: number
	): Promise<AgentResponse> {
		const timeout = request.timeout || this.config.defaultTimeout;
		const maxRetries = request.options?.maxRetries ?? 1;

		const agentsUsed: string[] = [];
		const patternsUsed: string[] = [];
		let totalTokens = 0;

		for (let attempt = 0; attempt < maxRetries && attempt < agents.length; attempt++) {
			const agent = agents[attempt];
			agentsUsed.push(agent.id);

			try {
				const result = await this.withTimeout(agent.handler(request), timeout);

				// Update stats
				agent.stats.invocations++;
				const duration = Date.now() - startTime;
				agent.stats.avgDuration = (agent.stats.avgDuration * (agent.stats.invocations - 1) + duration) / agent.stats.invocations;

				if (result.success) {
					agent.stats.successes++;
					if (result.tokensUsed) {
						agent.stats.totalTokens += result.tokensUsed;
						totalTokens += result.tokensUsed;
					}

					// Determine patterns used
					if (request.options?.useCache && this.config.enableCaching) {
						patternsUsed.push("caching");
					}
					if (request.options?.useReflection && this.config.enableReflection) {
						patternsUsed.push("reflection");
					}
					if (request.options?.useExperienceReplay && this.config.enableExperienceReplay) {
						patternsUsed.push("experience-replay");
					}

					return {
						requestId: request.id,
						success: true,
						result: result.result,
						agentsUsed,
						patternsUsed,
						tokensUsed: totalTokens,
						duration,
						cached: false,
					};
				}

				agent.stats.failures++;
			} catch (error) {
				agent.stats.failures++;
				agent.stats.invocations++;
				// Try next agent
			}
		}

		return {
			requestId: request.id,
			success: false,
			error: "All agents failed",
			agentsUsed,
			patternsUsed,
			tokensUsed: totalTokens,
			duration: Date.now() - startTime,
			cached: false,
		};
	}

	private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms)
			),
		]);
	}

	// ---------------------------------------------------------------------------
	// Convenience Methods
	// ---------------------------------------------------------------------------

	async ask(task: string, options?: Partial<AgentRequest>): Promise<AgentResponse> {
		const request: AgentRequest = {
			id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			task,
			...options,
		};
		return this.process(request);
	}

	async code(task: string, options?: Partial<AgentRequest>): Promise<AgentResponse> {
		return this.ask(task, { ...options, capabilities: ["code"] });
	}

	async research(task: string, options?: Partial<AgentRequest>): Promise<AgentResponse> {
		return this.ask(task, { ...options, capabilities: ["research", "analysis"] });
	}

	async review(task: string, options?: Partial<AgentRequest>): Promise<AgentResponse> {
		return this.ask(task, { ...options, capabilities: ["review"] });
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getAgent(id: string): RegisteredAgent | null {
		return this.agents.get(id) || null;
	}

	getAllAgents(): RegisteredAgent[] {
		return Array.from(this.agents.values());
	}

	getActiveRequests(): AgentRequest[] {
		return Array.from(this.activeRequests.values());
	}

	getRequestHistory(limit = 100): AgentResponse[] {
		return Array.from(this.requestHistory.values()).slice(-limit);
	}

	getStats(): {
		totalAgents: number;
		enabledAgents: number;
		totalRequests: number;
		successRate: number;
		avgDuration: number;
		activeRequests: number;
	} {
		const agents = Array.from(this.agents.values());
		const responses = Array.from(this.requestHistory.values());

		const totalRequests = responses.length;
		const successCount = responses.filter((r) => r.success).length;
		const totalDuration = responses.reduce((sum, r) => sum + r.duration, 0);

		return {
			totalAgents: agents.length,
			enabledAgents: agents.filter((a) => a.enabled).length,
			totalRequests,
			successRate: totalRequests > 0 ? successCount / totalRequests : 0,
			avgDuration: totalRequests > 0 ? totalDuration / totalRequests : 0,
			activeRequests: this.activeRequests.size,
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearHistory(): void {
		this.requestHistory.clear();
	}

	reset(): void {
		this.agents.clear();
		this.plugins = [];
		this.activeRequests.clear();
		this.requestHistory.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: AgentHub | null = null;

export function getAgentHub(config?: Partial<AgentHubConfig>): AgentHub {
	if (!instance) {
		instance = new AgentHub(config);
	}
	return instance;
}

export function resetAgentHub(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
