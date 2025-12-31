/**
 * CROSS-PLATFORM SWARM SYSTEM
 *
 * Unified multi-agent coordination across Discord, Slack, Telegram, WhatsApp
 * Integrates all 4 SDKs: Claude, OpenCode, OpenHands, Pi-Mono
 *
 * Architecture:
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │                      CROSS-PLATFORM SWARM                                  │
 * │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
 * │  │   Discord    │  │    Slack     │  │  Telegram    │  │  WhatsApp    │   │
 * │  │   Agent      │  │    Agent     │  │   Agent      │  │   Agent      │   │
 * │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
 * │         │                 │                 │                 │           │
 * │         ▼                 ▼                 ▼                 ▼           │
 * │  ┌────────────────────────────────────────────────────────────────────┐   │
 * │  │                    SWARM COORDINATOR                               │   │
 * │  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐   │   │
 * │  │  │ Claude SDK │  │OpenCode SDK│  │OpenHands   │  │ Pi-Mono    │   │   │
 * │  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘   │   │
 * │  └────────────────────────────────────────────────────────────────────┘   │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

import { EventEmitter } from "events";
import {
	type ConsensusResult,
	createConsensusProposal,
	createSwarmAgent,
	getSwarmCoordinator,
	type SwarmAgent,
	type SwarmCoordinator,
	type SwarmRole,
} from "./agent-swarm.js";
import type { AgentDomain } from "./agentic-properties.js";
import { checkAllSDKs, getBestSDK, runWithBestSDK, type SDKStatus, type UnifiedResult } from "./unified-sdk.js";

// ============================================================================
// TYPES
// ============================================================================

export type SwarmPlatform = "discord" | "slack" | "telegram" | "whatsapp";

export interface PlatformAgent extends SwarmAgent {
	platform: SwarmPlatform;
	platformUserId?: string;
	platformChannelId?: string;
	sdk: "claude" | "opencode" | "openhands" | "pi-mono" | "auto";
}

export interface CrossPlatformTask {
	id: string;
	description: string;
	sourcePlatform: SwarmPlatform;
	sourceUser: string;
	targetPlatforms?: SwarmPlatform[];
	priority: "critical" | "high" | "normal" | "low";
	requiresConsensus?: boolean;
	context?: Record<string, unknown>;
	createdAt: number;
	deadline?: number;
}

export interface SwarmExecutionResult {
	taskId: string;
	success: boolean;
	results: Map<string, UnifiedResult>;
	consensus?: ConsensusResult;
	duration: number;
	platformResponses: Map<SwarmPlatform, string>;
}

export interface CrossPlatformSwarmConfig {
	maxAgentsPerPlatform: number;
	defaultSdk: "claude" | "opencode" | "openhands" | "pi-mono" | "auto";
	consensusStrategy: "majority" | "unanimous" | "weighted" | "leader_decides";
	taskTimeout: number;
	enableAutoFailover: boolean;
	enableLoadBalancing: boolean;
}

// ============================================================================
// PLATFORM AGENT FACTORIES
// ============================================================================

const DEFAULT_CAPABILITIES: Record<SwarmPlatform, string[]> = {
	discord: ["chat", "slash_commands", "voice", "reactions", "threads", "embeds"],
	slack: ["chat", "slash_commands", "workflows", "blocks", "threads", "apps"],
	telegram: ["chat", "commands", "inline", "callbacks", "media", "groups"],
	whatsapp: ["chat", "media", "groups", "status", "voice", "location"],
};

/**
 * Create a platform-specific swarm agent
 */
export function createPlatformAgent(
	platform: SwarmPlatform,
	role: SwarmRole = "worker",
	domain: AgentDomain = "general",
	sdk: PlatformAgent["sdk"] = "auto",
): PlatformAgent {
	const platformCaps = DEFAULT_CAPABILITIES[platform];
	const baseAgent = createSwarmAgent(
		`${platform}-agent-${Date.now()}`,
		`${platform.charAt(0).toUpperCase() + platform.slice(1)} Agent`,
		role,
		domain,
		platformCaps,
	);

	return {
		...baseAgent,
		platform,
		sdk,
		capabilities: [...platformCaps, ...baseAgent.capabilities],
	};
}

/**
 * Create specialized agents for each platform
 */
export function createPlatformAgentSet(domain: AgentDomain = "coding"): Map<SwarmPlatform, PlatformAgent> {
	const agents = new Map<SwarmPlatform, PlatformAgent>();

	// Discord - leader (most full-featured)
	agents.set("discord", createPlatformAgent("discord", "leader", domain, "claude"));

	// Slack - coordinator (enterprise workflows)
	agents.set("slack", createPlatformAgent("slack", "coordinator", domain, "opencode"));

	// Telegram - specialist (fast, lightweight)
	agents.set("telegram", createPlatformAgent("telegram", "specialist", domain, "pi-mono"));

	// WhatsApp - worker (simple, reliable)
	agents.set("whatsapp", createPlatformAgent("whatsapp", "worker", domain, "pi-mono"));

	return agents;
}

// ============================================================================
// CROSS-PLATFORM SWARM COORDINATOR
// ============================================================================

export class CrossPlatformSwarm extends EventEmitter {
	private swarm: SwarmCoordinator;
	private platformAgents: Map<SwarmPlatform, PlatformAgent[]> = new Map();
	private activeTasks: Map<string, CrossPlatformTask> = new Map();
	private taskResults: Map<string, SwarmExecutionResult> = new Map();
	private sdkStatus: SDKStatus | null = null;
	private config: CrossPlatformSwarmConfig;

	constructor(config: Partial<CrossPlatformSwarmConfig> = {}) {
		super();
		this.swarm = getSwarmCoordinator();
		this.config = {
			maxAgentsPerPlatform: 5,
			defaultSdk: "auto",
			consensusStrategy: "majority",
			taskTimeout: 120000, // 2 minutes
			enableAutoFailover: true,
			enableLoadBalancing: true,
			...config,
		};

		// Initialize platform agent maps
		for (const platform of ["discord", "slack", "telegram", "whatsapp"] as SwarmPlatform[]) {
			this.platformAgents.set(platform, []);
		}

		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		// Forward swarm events
		this.swarm.on("agentJoined", (agent) => this.emit("agentJoined", agent));
		this.swarm.on("agentLeft", (agent) => this.emit("agentLeft", agent));
		this.swarm.on("taskCompleted", (result) => this.emit("taskCompleted", result));
		this.swarm.on("consensusReached", (result) => this.emit("consensusReached", result));
	}

	// --------------------------------------------------------------------------
	// INITIALIZATION
	// --------------------------------------------------------------------------

	/**
	 * Initialize the cross-platform swarm
	 */
	async initialize(): Promise<void> {
		// Check SDK availability
		this.sdkStatus = await checkAllSDKs();

		console.log("[CrossPlatformSwarm] SDK Status:", this.sdkStatus);

		// Create default agents for each platform
		const defaultAgents = createPlatformAgentSet();
		for (const [_platform, agent] of defaultAgents) {
			await this.registerAgent(agent);
		}

		this.emit("initialized", { sdkStatus: this.sdkStatus, agentCount: this.getAgentCount() });
	}

	/**
	 * Register a platform agent
	 */
	async registerAgent(agent: PlatformAgent): Promise<boolean> {
		const platformAgents = this.platformAgents.get(agent.platform) || [];

		if (platformAgents.length >= this.config.maxAgentsPerPlatform) {
			this.emit("error", { type: "max_agents_reached", platform: agent.platform });
			return false;
		}

		// Register with base swarm
		const success = this.swarm.register(agent);
		if (success) {
			platformAgents.push(agent);
			this.platformAgents.set(agent.platform, platformAgents);
			this.emit("platformAgentRegistered", { platform: agent.platform, agent });
		}

		return success;
	}

	// --------------------------------------------------------------------------
	// TASK EXECUTION
	// --------------------------------------------------------------------------

	/**
	 * Submit a task to the cross-platform swarm
	 */
	async submitTask(task: Omit<CrossPlatformTask, "id" | "createdAt">): Promise<string> {
		const fullTask: CrossPlatformTask = {
			...task,
			id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			createdAt: Date.now(),
		};

		this.activeTasks.set(fullTask.id, fullTask);
		this.emit("taskSubmitted", fullTask);

		// Execute async
		this.executeTask(fullTask).catch((err) => {
			this.emit("error", { type: "task_execution_failed", taskId: fullTask.id, error: err });
		});

		return fullTask.id;
	}

	/**
	 * Execute a cross-platform task
	 */
	private async executeTask(task: CrossPlatformTask): Promise<SwarmExecutionResult> {
		const startTime = Date.now();
		const results = new Map<string, UnifiedResult>();
		const platformResponses = new Map<SwarmPlatform, string>();

		try {
			// Determine target platforms
			const targetPlatforms =
				task.targetPlatforms || (["discord", "slack", "telegram", "whatsapp"] as SwarmPlatform[]);

			// If consensus required, run consensus first
			let consensus: ConsensusResult | undefined;
			if (task.requiresConsensus) {
				consensus = await this.runConsensus(task);
				if (!consensus) {
					throw new Error("Consensus failed");
				}
			}

			// Execute on each target platform
			const executions = targetPlatforms.map(async (platform) => {
				const agent = this.getBestAgentForPlatform(platform);
				if (!agent) {
					platformResponses.set(platform, `No agent available for ${platform}`);
					return;
				}

				try {
					// Select SDK based on agent preference or auto-select
					const _sdk = agent.sdk === "auto" ? await this.selectBestSdk(task) : agent.sdk;

					// Build platform-specific prompt
					const prompt = this.buildPlatformPrompt(task, platform, consensus);

					// Execute with selected SDK
					const result = await runWithBestSDK(prompt, this.mapDomainToTaskType(task));
					results.set(`${platform}-${agent.id}`, result);
					platformResponses.set(platform, result.output);

					// Update agent status
					this.swarm.updateStatus(agent.id, "idle", agent.load * 0.9);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					platformResponses.set(platform, `Error: ${errMsg}`);

					// Failover if enabled
					if (this.config.enableAutoFailover) {
						await this.attemptFailover(platform, task);
					}
				}
			});

			await Promise.all(executions);

			const executionResult: SwarmExecutionResult = {
				taskId: task.id,
				success: platformResponses.size > 0,
				results,
				consensus,
				duration: Date.now() - startTime,
				platformResponses,
			};

			this.taskResults.set(task.id, executionResult);
			this.activeTasks.delete(task.id);
			this.emit("taskCompleted", executionResult);

			return executionResult;
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const failedResult: SwarmExecutionResult = {
				taskId: task.id,
				success: false,
				results,
				duration: Date.now() - startTime,
				platformResponses: new Map([["error" as SwarmPlatform, errMsg]]),
			};

			this.taskResults.set(task.id, failedResult);
			this.activeTasks.delete(task.id);
			this.emit("taskFailed", { taskId: task.id, error: errMsg });

			return failedResult;
		}
	}

	/**
	 * Run consensus across platform agents
	 */
	private async runConsensus(task: CrossPlatformTask): Promise<ConsensusResult | undefined> {
		const proposal = createConsensusProposal(
			`How should we handle: ${task.description}`,
			["execute_immediately", "delegate_to_specialist", "request_more_info", "decline"],
			this.config.consensusStrategy,
		);

		// Get votes from all platform leaders/coordinators
		const voters = this.getConsensusVoters();

		// Broadcast proposal
		await this.swarm.send({
			type: "consensus_proposal",
			from: "swarm_coordinator",
			to: voters.map((v) => v.id),
			priority: task.priority,
			payload: proposal,
		});

		// Wait for consensus (with timeout)
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				resolve(undefined);
			}, this.config.taskTimeout);

			this.swarm.once("consensusReached", (result: ConsensusResult) => {
				clearTimeout(timeout);
				if (result.proposalId === proposal.proposalId) {
					resolve(result);
				}
			});
		});
	}

	// --------------------------------------------------------------------------
	// HELPER METHODS
	// --------------------------------------------------------------------------

	/**
	 * Get the best available agent for a platform
	 */
	private getBestAgentForPlatform(platform: SwarmPlatform): PlatformAgent | undefined {
		const agents = this.platformAgents.get(platform) || [];
		const activeAgents = agents.filter((a) => a.status !== "offline" && a.status !== "error");

		if (activeAgents.length === 0) return undefined;

		if (this.config.enableLoadBalancing) {
			// Return agent with lowest load
			return activeAgents.sort((a, b) => a.load - b.load)[0];
		}

		// Return by role priority: leader > coordinator > specialist > worker
		const rolePriority: Record<SwarmRole, number> = {
			leader: 4,
			coordinator: 3,
			specialist: 2,
			worker: 1,
			observer: 0,
		};
		return activeAgents.sort((a, b) => rolePriority[b.role] - rolePriority[a.role])[0];
	}

	/**
	 * Select best SDK for task
	 */
	private async selectBestSdk(task: CrossPlatformTask): Promise<"claude" | "opencode" | "openhands" | "pi-mono"> {
		if (!this.sdkStatus) {
			this.sdkStatus = await checkAllSDKs();
		}

		const taskType = this.mapDomainToTaskType(task);
		const sdk = await getBestSDK(taskType);
		return sdk; // getBestSDK returns the SDK name directly
	}

	/**
	 * Map task to SDK task type
	 */
	private mapDomainToTaskType(task: CrossPlatformTask): "code" | "research" | "quick" | "security" | "free" {
		const context = task.context as { domain?: string } | undefined;
		switch (context?.domain) {
			case "coding":
				return "code";
			case "research":
				return "research";
			case "security":
				return "security";
			default:
				return task.priority === "low" ? "free" : "quick";
		}
	}

	/**
	 * Build platform-specific prompt
	 */
	private buildPlatformPrompt(task: CrossPlatformTask, platform: SwarmPlatform, consensus?: ConsensusResult): string {
		let prompt = `[${platform.toUpperCase()} AGENT]\n`;
		prompt += `Task: ${task.description}\n`;
		prompt += `Priority: ${task.priority}\n`;
		prompt += `Source: ${task.sourcePlatform} (${task.sourceUser})\n`;

		if (consensus) {
			prompt += `\nConsensus Decision: ${consensus.winner}\n`;
			prompt += `Confidence: ${(consensus.confidence * 100).toFixed(1)}%\n`;
		}

		// Platform-specific instructions
		switch (platform) {
			case "discord":
				prompt += "\nFormat response for Discord (markdown, embeds supported).";
				break;
			case "slack":
				prompt += "\nFormat response for Slack (blocks, mrkdwn supported).";
				break;
			case "telegram":
				prompt += "\nFormat response for Telegram (HTML/Markdown, inline keyboards).";
				break;
			case "whatsapp":
				prompt += "\nFormat response for WhatsApp (plain text, simple formatting).";
				break;
		}

		return prompt;
	}

	/**
	 * Get agents that participate in consensus
	 */
	private getConsensusVoters(): PlatformAgent[] {
		const voters: PlatformAgent[] = [];
		for (const agents of this.platformAgents.values()) {
			const eligibleAgents = agents.filter((a) => a.role === "leader" || a.role === "coordinator");
			voters.push(...eligibleAgents);
		}
		return voters;
	}

	/**
	 * Attempt failover to another agent
	 */
	private async attemptFailover(platform: SwarmPlatform, task: CrossPlatformTask): Promise<void> {
		const agents = this.platformAgents.get(platform) || [];
		const availableAgents = agents.filter((a) => a.status === "idle");

		if (availableAgents.length > 0) {
			this.emit("failover", { platform, taskId: task.id, newAgent: availableAgents[0].id });
		}
	}

	// --------------------------------------------------------------------------
	// PUBLIC API
	// --------------------------------------------------------------------------

	/**
	 * Get swarm status
	 */
	getStatus(): {
		sdkStatus: SDKStatus | null;
		agentCount: number;
		activeTasks: number;
		platformAgents: Record<SwarmPlatform, number>;
	} {
		const platformCounts: Record<SwarmPlatform, number> = {
			discord: 0,
			slack: 0,
			telegram: 0,
			whatsapp: 0,
		};

		for (const [platform, agents] of this.platformAgents) {
			platformCounts[platform] = agents.length;
		}

		return {
			sdkStatus: this.sdkStatus,
			agentCount: this.getAgentCount(),
			activeTasks: this.activeTasks.size,
			platformAgents: platformCounts,
		};
	}

	/**
	 * Get total agent count
	 */
	getAgentCount(): number {
		let count = 0;
		for (const agents of this.platformAgents.values()) {
			count += agents.length;
		}
		return count;
	}

	/**
	 * Get task result
	 */
	getTaskResult(taskId: string): SwarmExecutionResult | undefined {
		return this.taskResults.get(taskId);
	}

	/**
	 * Broadcast message to all platforms
	 */
	async broadcast(message: string, platforms?: SwarmPlatform[]): Promise<void> {
		const targetPlatforms = platforms || (["discord", "slack", "telegram", "whatsapp"] as SwarmPlatform[]);

		for (const platform of targetPlatforms) {
			const agent = this.getBestAgentForPlatform(platform);
			if (agent) {
				await this.swarm.send({
					type: "knowledge_share",
					from: "swarm_coordinator",
					to: agent.id,
					priority: "normal",
					payload: { message, platform },
				});
			}
		}

		this.emit("broadcast", { message, platforms: targetPlatforms });
	}
}

// ============================================================================
// SINGLETON & EXPORTS
// ============================================================================

let crossPlatformSwarm: CrossPlatformSwarm | null = null;

/**
 * Get or create the cross-platform swarm instance
 */
export function getCrossPlatformSwarm(config?: Partial<CrossPlatformSwarmConfig>): CrossPlatformSwarm {
	if (!crossPlatformSwarm) {
		crossPlatformSwarm = new CrossPlatformSwarm(config);
	}
	return crossPlatformSwarm;
}

/**
 * Quick task submission helper
 */
export async function submitCrossPlatformTask(
	description: string,
	sourcePlatform: SwarmPlatform,
	sourceUser: string,
	options: Partial<CrossPlatformTask> = {},
): Promise<string> {
	const swarm = getCrossPlatformSwarm();
	return swarm.submitTask({
		description,
		sourcePlatform,
		sourceUser,
		priority: "normal",
		...options,
	});
}

/**
 * Broadcast to all platforms helper
 */
export async function broadcastToAllPlatforms(message: string, platforms?: SwarmPlatform[]): Promise<void> {
	const swarm = getCrossPlatformSwarm();
	return swarm.broadcast(message, platforms);
}
