/**
 * Orchestrator Memory Bridge
 *
 * Connects the Class 3.1 Orchestrator with Class 3.3 Agent Memory System:
 * - Records all task delegations to memory
 * - Uses memory insights for smart routing
 * - Provides enhanced delegation with learning
 *
 * This closes the loop between orchestration and learning.
 */

import { EventEmitter } from "events";
import type { AgentMemorySystem, RoutingRecommendation, TaskRecord } from "./agent-memory-system.js";
import type { AgentDefinition, DelegationRequest, DelegationResult, Orchestrator } from "./orchestrator.js";

// =============================================================================
// Types
// =============================================================================

/** Enhanced delegation request with smart routing */
export interface SmartDelegationRequest extends DelegationRequest {
	/** Use memory for agent selection */
	useSmartRouting?: boolean;
	/** Quality rating after completion (0-1) */
	rateAfterCompletion?: boolean;
}

/** Enhanced delegation result with memory insights */
export interface SmartDelegationResult extends DelegationResult {
	/** Memory-based routing was used */
	smartRouted: boolean;
	/** Routing confidence */
	routingConfidence?: number;
	/** Alternative agents that were considered */
	alternativeAgents?: string[];
	/** Insights that influenced the decision */
	relevantInsights?: string[];
	/** Task ID for rating */
	taskRecordId?: string;
}

/** Bridge configuration */
export interface BridgeConfig {
	/** Enable smart routing by default */
	smartRoutingDefault: boolean;
	/** Minimum confidence for smart routing */
	minRoutingConfidence: number;
	/** Enable automatic task recording */
	autoRecord: boolean;
	/** Enable quality rating prompts */
	enableRating: boolean;
}

// =============================================================================
// Orchestrator Memory Bridge
// =============================================================================

export class OrchestratorMemoryBridge extends EventEmitter {
	private orchestrator: Orchestrator;
	private memory: AgentMemorySystem;
	private config: BridgeConfig;
	private pendingRatings: Map<string, { taskId: string; agentId: string; startTime: number }> = new Map();

	constructor(orchestrator: Orchestrator, memory: AgentMemorySystem, config: Partial<BridgeConfig> = {}) {
		super();
		this.orchestrator = orchestrator;
		this.memory = memory;
		this.config = {
			smartRoutingDefault: config.smartRoutingDefault ?? true,
			minRoutingConfidence: config.minRoutingConfidence ?? 0.3,
			autoRecord: config.autoRecord ?? true,
			enableRating: config.enableRating ?? true,
		};

		this.setupEventListeners();
	}

	// =========================================================================
	// Smart Delegation
	// =========================================================================

	/** Delegate task with smart routing and memory recording */
	async smartDelegate(request: SmartDelegationRequest): Promise<SmartDelegationResult> {
		const useSmartRouting = request.useSmartRouting ?? this.config.smartRoutingDefault;
		const startTime = Date.now();

		let selectedAgentId: string | undefined;
		let routingRecommendation: RoutingRecommendation | undefined;
		let smartRouted = false;

		// Try smart routing if enabled
		if (useSmartRouting && request.taskType) {
			routingRecommendation = this.memory.getRoutingRecommendation(request.taskType, request.prompt);

			if (routingRecommendation.confidence >= this.config.minRoutingConfidence) {
				const topRecommendation = routingRecommendation.recommendedAgents[0];
				if (topRecommendation) {
					selectedAgentId = topRecommendation.agentId;
					smartRouted = true;

					this.emit("smartRoute", {
						taskType: request.taskType,
						selectedAgent: selectedAgentId,
						confidence: routingRecommendation.confidence,
						alternatives: routingRecommendation.recommendedAgents.slice(1).map((a) => a.agentId),
					});
				}
			}
		}

		// Perform delegation
		const result = await this.orchestrator.delegate(request);
		const latencyMs = Date.now() - startTime;

		// Record to memory
		if (this.config.autoRecord) {
			const taskId = crypto.randomUUID();

			const taskRecord: Omit<TaskRecord, "promptHash"> = {
				id: taskId,
				agentId: result.agentId || "unknown",
				agentRole: request.requiredRole || "builder",
				taskType: request.taskType || "general",
				prompt: request.prompt,
				success: result.status === "success",
				latencyMs,
				errorType: result.error,
				timestamp: new Date(),
				metadata: {
					smartRouted,
					requestId: request.id,
					routingConfidence: routingRecommendation?.confidence,
				},
			};

			this.memory.recordTask(taskRecord);

			// Track for rating
			if (this.config.enableRating && request.rateAfterCompletion) {
				this.pendingRatings.set(request.id, {
					taskId,
					agentId: result.agentId || "unknown",
					startTime,
				});
			}

			this.emit("taskRecorded", { taskId, agentId: result.agentId, success: result.status === "success" });
		}

		return {
			...result,
			smartRouted,
			routingConfidence: routingRecommendation?.confidence,
			alternativeAgents: routingRecommendation?.recommendedAgents.slice(1).map((a) => a.agentId),
			relevantInsights: routingRecommendation?.basedOn,
			taskRecordId: this.pendingRatings.get(request.id)?.taskId,
		};
	}

	/** Rate a completed task */
	rateTask(requestId: string, quality: number): void {
		const pending = this.pendingRatings.get(requestId);
		if (!pending) {
			throw new Error(`No pending rating for request: ${requestId}`);
		}

		this.memory.rateTask(pending.taskId, quality);
		this.pendingRatings.delete(requestId);

		this.emit("taskRated", { taskId: pending.taskId, quality });
	}

	// =========================================================================
	// Enhanced Queries
	// =========================================================================

	/** Get best agent for a task type using memory */
	getBestAgent(taskType: string, excludeAgents: string[] = []): AgentDefinition | null {
		// First try memory-based recommendation
		const bestFromMemory = this.memory.getBestAgentForTask(taskType, excludeAgents);

		if (bestFromMemory) {
			const agents = this.orchestrator.listAgents();
			const agent = agents.find((a) => a.id === bestFromMemory && a.status === "active");
			if (agent) return agent;
		}

		// Fall back to orchestrator's own selection
		const agents = this.orchestrator.listAgents({ status: "active" });
		const available = agents.filter((a) => !excludeAgents.includes(a.id));

		if (available.length === 0) return null;

		// Sort by success rate
		return available.sort((a, b) => {
			const aRate = a.runCount > 0 ? a.successCount / a.runCount : 0;
			const bRate = b.runCount > 0 ? b.successCount / b.runCount : 0;
			return bRate - aRate;
		})[0];
	}

	/** Get routing recommendation with agent details */
	getDetailedRecommendation(
		taskType: string,
		prompt: string,
	): RoutingRecommendation & { agentDetails: Map<string, AgentDefinition> } {
		const recommendation = this.memory.getRoutingRecommendation(taskType, prompt);
		const agents = this.orchestrator.listAgents();

		const agentDetails = new Map<string, AgentDefinition>();
		for (const rec of recommendation.recommendedAgents) {
			const agent = agents.find((a) => a.id === rec.agentId);
			if (agent) {
				agentDetails.set(rec.agentId, agent);
			}
		}

		return {
			...recommendation,
			agentDetails,
		};
	}

	/** Get combined stats from orchestrator and memory */
	getCombinedStats(): {
		orchestrator: {
			totalAgents: number;
			activeAgents: number;
			totalDelegations: number;
		};
		memory: {
			totalTasks: number;
			agentCount: number;
			insightCount: number;
			globalSuccessRate: number;
		};
		bridge: {
			pendingRatings: number;
		};
	} {
		const agents = this.orchestrator.listAgents();
		const memoryStats = this.memory.getGlobalStats();

		return {
			orchestrator: {
				totalAgents: agents.length,
				activeAgents: agents.filter((a) => a.status === "active").length,
				totalDelegations: agents.reduce((sum, a) => sum + a.runCount, 0),
			},
			memory: memoryStats,
			bridge: {
				pendingRatings: this.pendingRatings.size,
			},
		};
	}

	// =========================================================================
	// Event Listeners
	// =========================================================================

	private setupEventListeners(): void {
		// Listen to orchestrator events
		this.orchestrator.on("agent:completed", ({ agentId, result }) => {
			this.emit("delegation:complete", { agentId, result });
		});

		this.orchestrator.on("agent:failed", ({ agentId, error }) => {
			this.emit("delegation:failed", { agentId, error });
		});

		// Listen to memory events
		this.memory.on("insight:created", (insight) => {
			this.emit("learning:newInsight", insight);
		});

		this.memory.on("quality:updated", ({ taskId, quality }) => {
			this.emit("learning:qualityUpdate", { taskId, quality });
		});
	}

	// =========================================================================
	// Accessors
	// =========================================================================

	getOrchestrator(): Orchestrator {
		return this.orchestrator;
	}

	getMemory(): AgentMemorySystem {
		return this.memory;
	}

	getConfig(): BridgeConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<BridgeConfig>): void {
		this.config = { ...this.config, ...updates };
	}
}

// =============================================================================
// Factory Function
// =============================================================================

let bridgeInstance: OrchestratorMemoryBridge | null = null;

/** Get or create bridge instance */
export function getOrchestratorMemoryBridge(
	orchestrator: Orchestrator,
	memory: AgentMemorySystem,
	config?: Partial<BridgeConfig>,
): OrchestratorMemoryBridge {
	if (!bridgeInstance) {
		bridgeInstance = new OrchestratorMemoryBridge(orchestrator, memory, config);
	}
	return bridgeInstance;
}

/** Reset bridge instance */
export function resetBridge(): void {
	bridgeInstance = null;
}
