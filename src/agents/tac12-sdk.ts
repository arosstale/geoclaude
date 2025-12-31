/**
 * TAC-12 SDK Adapter for Pi-Mono Discord Bot
 *
 * Integrates TAC-12 Platform's 12 SDK orchestrator with pi-mono's cross-platform swarm.
 * Provides access to:
 * - Vercel AI SDK (5 variants)
 * - Cloudflare Workers (5 variants)
 * - Inngest workflows
 * - ClaudeCO agentic coding
 * - Antigravity sandbox
 * - Daytona dev environments
 * - Google Colab GPU
 * - Lightning AI ML
 *
 * @see https://github.com/arosstale/irreplaceable-engineer-stack
 */

import { EventEmitter } from "events";

// TAC-12 SDK Types
export type TAC12SDKType =
	| "vercel-ai"
	| "vercel-ai-edge"
	| "vercel-ai-streaming"
	| "vercel-ai-tools"
	| "vercel-ai-agents"
	| "cloudflare-workers"
	| "cloudflare-durable"
	| "cloudflare-ai"
	| "cloudflare-vectorize"
	| "cloudflare-queues"
	| "inngest"
	| "claudeco"
	| "antigravity"
	| "daytona"
	| "google-colab"
	| "lightning-ai";

export interface TAC12Config {
	baseUrl: string;
	apiKey?: string;
	timeout?: number;
	enableWebSocket?: boolean;
}

export interface TAC12Agent {
	id: string;
	name: string;
	sdk: TAC12SDKType;
	status: "idle" | "running" | "completed" | "failed";
	task?: string;
	result?: unknown;
	cost?: number;
	startedAt?: Date;
	completedAt?: Date;
}

export interface TAC12Task {
	id: string;
	prompt: string;
	sdk?: TAC12SDKType;
	pattern?: "parallel" | "scout-builder" | "sequential";
	agentIds?: string[];
	priority?: "low" | "normal" | "high" | "critical";
	timeout?: number;
	metadata?: Record<string, unknown>;
}

export interface TAC12Result {
	success: boolean;
	taskId: string;
	output?: string;
	error?: string;
	agents?: TAC12Agent[];
	totalCost?: number;
	duration?: number;
	assets?: string[];
}

export interface TAC12Pattern {
	name: string;
	description: string;
	sdks: TAC12SDKType[];
	steps: Array<{
		name: string;
		sdk: TAC12SDKType;
		role: "scout" | "builder" | "reviewer" | "executor";
	}>;
}

// TAC-12 API Endpoints
const TAC12_ENDPOINTS = {
	health: "/health",
	agents: "/api/agents",
	tasks: "/api/tasks",
	patterns: "/api/patterns",
	sdks: "/api/sdks",
	costs: "/api/costs",
	websocket: "/ws",
	// Specific routers
	vibe: "/api/vibe",
	parallel: "/api/parallel",
	claudecode: "/api/claudecode",
	pimono: "/api/pimono",
	fdsa: "/api/fdsa",
	cui: "/api/cui",
};

/**
 * TAC-12 SDK Client
 * Connects pi-mono to the TAC-12 Multi-SDK AI Orchestrator
 */
export class TAC12Client extends EventEmitter {
	private config: TAC12Config;
	private ws: WebSocket | null = null;
	private agents: Map<string, TAC12Agent> = new Map();
	private connected: boolean = false;

	constructor(config: TAC12Config) {
		super();
		this.config = {
			timeout: 60000,
			enableWebSocket: true,
			...config,
		};
	}

	/**
	 * Connect to TAC-12 server
	 */
	async connect(): Promise<boolean> {
		try {
			// Health check
			const health = await this.request<{ status: string }>("GET", TAC12_ENDPOINTS.health);
			if (health.status !== "healthy") {
				throw new Error(`TAC-12 unhealthy: ${health.status}`);
			}

			// Connect WebSocket for real-time updates
			if (this.config.enableWebSocket) {
				await this.connectWebSocket();
			}

			this.connected = true;
			this.emit("connected");
			return true;
		} catch (error) {
			this.emit("error", error);
			return false;
		}
	}

	/**
	 * Disconnect from TAC-12 server
	 */
	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
		this.emit("disconnected");
	}

	/**
	 * Check if connected to TAC-12 server
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Create a new agent
	 */
	async createAgent(name: string, sdk: TAC12SDKType): Promise<TAC12Agent> {
		const agent = await this.request<TAC12Agent>("POST", TAC12_ENDPOINTS.agents, {
			name,
			sdk,
		});
		this.agents.set(agent.id, agent);
		this.emit("agent:created", agent);
		return agent;
	}

	/**
	 * Get agent by ID
	 */
	async getAgent(id: string): Promise<TAC12Agent | null> {
		try {
			const agent = await this.request<TAC12Agent>("GET", `${TAC12_ENDPOINTS.agents}/${id}`);
			this.agents.set(agent.id, agent);
			return agent;
		} catch {
			return null;
		}
	}

	/**
	 * List all agents
	 */
	async listAgents(): Promise<TAC12Agent[]> {
		const agents = await this.request<TAC12Agent[]>("GET", TAC12_ENDPOINTS.agents);
		for (const a of agents) {
			this.agents.set(a.id, a);
		}
		return agents;
	}

	/**
	 * Delete an agent
	 */
	async deleteAgent(id: string): Promise<boolean> {
		try {
			await this.request("DELETE", `${TAC12_ENDPOINTS.agents}/${id}`);
			this.agents.delete(id);
			this.emit("agent:deleted", id);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Execute a task using TAC-12's orchestrator
	 */
	async executeTask(task: TAC12Task): Promise<TAC12Result> {
		const result = await this.request<TAC12Result>("POST", TAC12_ENDPOINTS.tasks, task);
		this.emit("task:completed", result);
		return result;
	}

	/**
	 * Execute using Scout-Builder pattern
	 * Scout explores, Builder implements
	 */
	async scoutBuilder(
		prompt: string,
		options?: { scoutSdk?: TAC12SDKType; builderSdk?: TAC12SDKType },
	): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", `${TAC12_ENDPOINTS.patterns}/scout-builder`, {
			prompt,
			scoutSdk: options?.scoutSdk || "claudeco",
			builderSdk: options?.builderSdk || "vercel-ai-agents",
		});
	}

	/**
	 * Execute using Parallel pattern
	 * Multiple agents work simultaneously
	 */
	async parallel(
		prompt: string,
		sdks: TAC12SDKType[],
		options?: { aggregation?: "first" | "best" | "all" },
	): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", `${TAC12_ENDPOINTS.patterns}/parallel`, {
			prompt,
			sdks,
			aggregation: options?.aggregation || "best",
		});
	}

	/**
	 * Get available patterns
	 */
	async getPatterns(): Promise<TAC12Pattern[]> {
		return this.request<TAC12Pattern[]>("GET", TAC12_ENDPOINTS.patterns);
	}

	/**
	 * Get available SDKs and their status
	 */
	async getSDKs(): Promise<Array<{ sdk: TAC12SDKType; available: boolean; description: string }>> {
		return this.request<Array<{ sdk: TAC12SDKType; available: boolean; description: string }>>(
			"GET",
			TAC12_ENDPOINTS.sdks,
		);
	}

	/**
	 * Get cost tracking data
	 */
	async getCosts(options?: {
		agentId?: string;
		since?: Date;
	}): Promise<{ total: number; breakdown: Record<string, number> }> {
		const params = new URLSearchParams();
		if (options?.agentId) params.set("agentId", options.agentId);
		if (options?.since) params.set("since", options.since.toISOString());
		return this.request("GET", `${TAC12_ENDPOINTS.costs}?${params.toString()}`);
	}

	// ========== Specialized Routers ==========

	/**
	 * VIBE API - Voice interaction and brainstorming
	 */
	async vibe(prompt: string): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", TAC12_ENDPOINTS.vibe, { prompt });
	}

	/**
	 * Parallel Compute API
	 */
	async parallelCompute(tasks: Array<{ prompt: string; sdk?: TAC12SDKType }>): Promise<TAC12Result[]> {
		return this.request<TAC12Result[]>("POST", TAC12_ENDPOINTS.parallel, { tasks });
	}

	/**
	 * ClaudeCO API - Agentic coding with Claude
	 */
	async claudeCO(prompt: string, options?: { workingDir?: string; tools?: string[] }): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", TAC12_ENDPOINTS.claudecode, {
			prompt,
			workingDir: options?.workingDir,
			tools: options?.tools,
		});
	}

	/**
	 * Pi-Mono API - Direct integration with pi-mono agents
	 */
	async piMono(prompt: string, options?: { agentType?: string }): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", TAC12_ENDPOINTS.pimono, {
			prompt,
			agentType: options?.agentType,
		});
	}

	/**
	 * FDSA API - Full-stack development with specialized agents
	 */
	async fdsa(prompt: string): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", TAC12_ENDPOINTS.fdsa, { prompt });
	}

	/**
	 * CUI API - Conversational UI interactions
	 */
	async cui(prompt: string): Promise<TAC12Result> {
		return this.request<TAC12Result>("POST", TAC12_ENDPOINTS.cui, { prompt });
	}

	// ========== Private Methods ==========

	private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
		const url = `${this.config.baseUrl}${endpoint}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.config.apiKey) {
			headers.Authorization = `Bearer ${this.config.apiKey}`;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeout);

		try {
			const response = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`TAC-12 API error: ${response.status} - ${error}`);
			}

			return response.json() as Promise<T>;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async connectWebSocket(): Promise<void> {
		const wsUrl = this.config.baseUrl.replace(/^http/, "ws") + TAC12_ENDPOINTS.websocket;

		return new Promise((resolve, reject) => {
			// Note: In Node.js, you'd use 'ws' package. This is browser WebSocket API.
			// For Discord bot, you may need to use the 'ws' package
			try {
				// Using dynamic import for ws in Node.js environment
				const WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : require("ws");
				const ws = new WebSocketImpl(wsUrl);
				this.ws = ws;

				ws.onopen = () => {
					this.emit("ws:connected");
					resolve();
				};

				ws.onmessage = (event: MessageEvent) => {
					try {
						const data = JSON.parse(event.data);
						this.handleWebSocketMessage(data);
					} catch (e) {
						this.emit("ws:error", e);
					}
				};

				ws.onerror = (error: Event) => {
					this.emit("ws:error", error);
					reject(error);
				};

				ws.onclose = () => {
					this.emit("ws:disconnected");
				};
			} catch (_error) {
				// WebSocket not available, continue without real-time updates
				resolve();
			}
		});
	}

	private handleWebSocketMessage(data: { type: string; payload: unknown }): void {
		switch (data.type) {
			case "agent:update": {
				const agent = data.payload as TAC12Agent;
				this.agents.set(agent.id, agent);
				this.emit("agent:update", agent);
				break;
			}
			case "task:progress":
				this.emit("task:progress", data.payload);
				break;
			case "cost:update":
				this.emit("cost:update", data.payload);
				break;
			case "broadcast":
				this.emit("broadcast", data.payload);
				break;
			default:
				this.emit("message", data);
		}
	}
}

// ========== Global Instance ==========

let tac12Client: TAC12Client | null = null;

/**
 * Get or create TAC-12 client instance
 */
export function getTAC12Client(config?: TAC12Config): TAC12Client {
	if (!tac12Client && config) {
		tac12Client = new TAC12Client(config);
	}
	if (!tac12Client) {
		throw new Error("TAC-12 client not initialized. Call getTAC12Client with config first.");
	}
	return tac12Client;
}

/**
 * Initialize TAC-12 client from environment
 */
export async function initTAC12FromEnv(): Promise<TAC12Client | null> {
	const baseUrl = process.env.TAC12_BASE_URL || "http://localhost:8000";
	const apiKey = process.env.TAC12_API_KEY;

	if (!baseUrl) {
		console.warn("TAC-12: No TAC12_BASE_URL set, skipping initialization");
		return null;
	}

	const client = getTAC12Client({
		baseUrl,
		apiKey,
		enableWebSocket: true,
	});

	try {
		await client.connect();
		console.log(`TAC-12: Connected to ${baseUrl}`);
		return client;
	} catch (error) {
		console.error("TAC-12: Failed to connect:", error);
		return null;
	}
}

// ========== Utility Functions ==========

/**
 * Get best SDK for a task type
 */
export function getBestSDKForTask(taskType: "coding" | "research" | "ml" | "edge" | "workflow"): TAC12SDKType {
	const mapping: Record<string, TAC12SDKType> = {
		coding: "claudeco",
		research: "vercel-ai-agents",
		ml: "lightning-ai",
		edge: "cloudflare-workers",
		workflow: "inngest",
	};
	return mapping[taskType] || "vercel-ai";
}

/**
 * Create a quick task execution helper
 */
export async function quickExecute(prompt: string, sdk?: TAC12SDKType): Promise<string> {
	const client = getTAC12Client();
	const result = await client.executeTask({
		id: `quick-${Date.now()}`,
		prompt,
		sdk: sdk || "vercel-ai",
	});
	return result.output || result.error || "No output";
}

// ========== Integration with CrossPlatformSwarm ==========

export interface TAC12SwarmIntegration {
	client: TAC12Client;
	executeWithBestSDK: (prompt: string, taskType: string) => Promise<TAC12Result>;
	getAvailableSDKs: () => Promise<TAC12SDKType[]>;
}

/**
 * Create TAC-12 integration for CrossPlatformSwarm
 */
export function createTAC12SwarmIntegration(client: TAC12Client): TAC12SwarmIntegration {
	return {
		client,
		async executeWithBestSDK(prompt: string, taskType: string): Promise<TAC12Result> {
			const sdk = getBestSDKForTask(taskType as "coding" | "research" | "ml" | "edge" | "workflow");
			return client.executeTask({
				id: `swarm-${Date.now()}`,
				prompt,
				sdk,
			});
		},
		async getAvailableSDKs(): Promise<TAC12SDKType[]> {
			const sdks = await client.getSDKs();
			return sdks.filter((s) => s.available).map((s) => s.sdk);
		},
	};
}
