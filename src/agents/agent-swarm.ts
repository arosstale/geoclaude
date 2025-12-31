/**
 * AGENT SWARM COMMUNICATION SYSTEM
 *
 * Learned from Agentis Framework - Multi-agent coordination
 * Enables agents to:
 * - Communicate with each other
 * - Delegate tasks dynamically
 * - Reach consensus on decisions
 * - Coordinate on complex workflows
 * - Share knowledge and state
 */

import { EventEmitter } from "events";
import type { AgentDomain } from "./agentic-properties.js";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type SwarmRole = "leader" | "worker" | "specialist" | "coordinator" | "observer";
export type MessagePriority = "critical" | "high" | "normal" | "low";
export type ConsensusStrategy = "majority" | "unanimous" | "weighted" | "leader_decides";

export interface SwarmAgent {
	id: string;
	name: string;
	role: SwarmRole;
	domain: AgentDomain;
	capabilities: string[];
	status: "idle" | "busy" | "offline" | "error";
	load: number; // 0-1, current workload
	reputation: number; // 0-1, reliability score
	lastSeen: number;
	metadata?: Record<string, unknown>;
}

export interface SwarmMessage {
	id: string;
	type: SwarmMessageType;
	from: string;
	to: string | string[] | "broadcast";
	priority: MessagePriority;
	payload: unknown;
	timestamp: number;
	ttl?: number; // Time to live in ms
	requiresAck?: boolean;
	replyTo?: string;
}

export type SwarmMessageType =
	| "task_request" // Request an agent to do something
	| "task_response" // Response to a task request
	| "status_update" // Agent status change
	| "knowledge_share" // Share learned information
	| "consensus_proposal" // Propose a decision
	| "consensus_vote" // Vote on a proposal
	| "heartbeat" // Keep-alive signal
	| "delegation" // Delegate task to another agent
	| "escalation" // Escalate to higher authority
	| "sync_request" // Request state synchronization
	| "sync_response"; // State sync data

export interface TaskRequest {
	taskId: string;
	description: string;
	requiredCapabilities: string[];
	priority: MessagePriority;
	deadline?: number;
	context?: Record<string, unknown>;
}

export interface TaskResponse {
	taskId: string;
	status: "accepted" | "rejected" | "completed" | "failed";
	result?: unknown;
	error?: string;
	duration?: number;
}

export interface ConsensusProposal {
	proposalId: string;
	question: string;
	options: string[];
	strategy: ConsensusStrategy;
	deadline: number;
	minimumParticipants?: number;
	weights?: Record<string, number>; // Agent ID -> weight
}

export interface ConsensusVote {
	proposalId: string;
	voterId: string;
	choice: string;
	confidence: number; // 0-1
	reasoning?: string;
}

export interface ConsensusResult {
	proposalId: string;
	winner: string;
	votes: ConsensusVote[];
	participation: number; // 0-1
	confidence: number;
	unanimous: boolean;
}

export interface SwarmConfig {
	maxAgents: number;
	heartbeatInterval: number; // ms
	messageTimeout: number; // ms
	consensusTimeout: number; // ms
	loadBalancing: boolean;
	autoFailover: boolean;
	persistState: boolean;
}

// ============================================================================
// SWARM COORDINATOR
// ============================================================================

export class SwarmCoordinator extends EventEmitter {
	private agents: Map<string, SwarmAgent> = new Map();
	private messages: Map<string, SwarmMessage> = new Map();
	private pendingAcks: Map<string, (ack: boolean) => void> = new Map();
	private consensusProposals: Map<string, ConsensusProposal> = new Map();
	private consensusVotes: Map<string, ConsensusVote[]> = new Map();
	private config: SwarmConfig;
	private heartbeatTimer?: NodeJS.Timeout;

	constructor(config: Partial<SwarmConfig> = {}) {
		super();
		this.config = {
			maxAgents: 20,
			heartbeatInterval: 30000, // 30s
			messageTimeout: 60000, // 1 minute
			consensusTimeout: 120000, // 2 minutes
			loadBalancing: true,
			autoFailover: true,
			persistState: false,
			...config,
		};
	}

	// --------------------------------------------------------------------------
	// AGENT MANAGEMENT
	// --------------------------------------------------------------------------

	/**
	 * Register an agent with the swarm
	 */
	register(agent: SwarmAgent): boolean {
		if (this.agents.size >= this.config.maxAgents) {
			this.emit("error", { type: "max_agents_reached", agentId: agent.id });
			return false;
		}

		if (this.agents.has(agent.id)) {
			// Update existing agent
			const existing = this.agents.get(agent.id)!;
			this.agents.set(agent.id, { ...existing, ...agent, lastSeen: Date.now() });
			this.emit("agentUpdated", agent);
		} else {
			// New agent
			this.agents.set(agent.id, { ...agent, lastSeen: Date.now() });
			this.emit("agentJoined", agent);
		}

		return true;
	}

	/**
	 * Remove an agent from the swarm
	 */
	unregister(agentId: string): boolean {
		const agent = this.agents.get(agentId);
		if (!agent) return false;

		this.agents.delete(agentId);
		this.emit("agentLeft", agent);
		return true;
	}

	/**
	 * Update agent status
	 */
	updateStatus(agentId: string, status: SwarmAgent["status"], load?: number): void {
		const agent = this.agents.get(agentId);
		if (!agent) return;

		agent.status = status;
		agent.lastSeen = Date.now();
		if (load !== undefined) agent.load = Math.max(0, Math.min(1, load));

		this.emit("statusChanged", { agentId, status, load });
	}

	/**
	 * Get all active agents
	 */
	getActiveAgents(): SwarmAgent[] {
		const now = Date.now();
		const timeout = this.config.heartbeatInterval * 3;
		return Array.from(this.agents.values()).filter((a) => a.status !== "offline" && now - a.lastSeen < timeout);
	}

	/**
	 * Get agents by capability
	 */
	getAgentsByCapability(capability: string): SwarmAgent[] {
		return this.getActiveAgents().filter((a) =>
			a.capabilities.some((c) => c.toLowerCase().includes(capability.toLowerCase())),
		);
	}

	/**
	 * Get agents by domain
	 */
	getAgentsByDomain(domain: AgentDomain): SwarmAgent[] {
		return this.getActiveAgents().filter((a) => a.domain === domain);
	}

	// --------------------------------------------------------------------------
	// MESSAGING
	// --------------------------------------------------------------------------

	/**
	 * Send a message to one or more agents
	 */
	async send(message: Omit<SwarmMessage, "id" | "timestamp">): Promise<string> {
		const fullMessage: SwarmMessage = {
			...message,
			id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
		};

		this.messages.set(fullMessage.id, fullMessage);

		// Route message
		if (fullMessage.to === "broadcast") {
			this.broadcast(fullMessage);
		} else if (Array.isArray(fullMessage.to)) {
			for (const agentId of fullMessage.to) {
				this.deliverToAgent(fullMessage, agentId);
			}
		} else {
			this.deliverToAgent(fullMessage, fullMessage.to);
		}

		// Handle acknowledgment requirement
		if (fullMessage.requiresAck) {
			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					this.pendingAcks.delete(fullMessage.id);
					reject(new Error(`Message ${fullMessage.id} not acknowledged`));
				}, this.config.messageTimeout);

				this.pendingAcks.set(fullMessage.id, (acked) => {
					clearTimeout(timeout);
					if (acked) {
						resolve(fullMessage.id);
					} else {
						reject(new Error(`Message ${fullMessage.id} rejected`));
					}
				});
			});
		}

		return fullMessage.id;
	}

	/**
	 * Acknowledge a message
	 */
	acknowledge(messageId: string, accepted: boolean = true): void {
		const resolver = this.pendingAcks.get(messageId);
		if (resolver) {
			resolver(accepted);
			this.pendingAcks.delete(messageId);
		}
	}

	/**
	 * Reply to a message
	 */
	async reply(originalMessageId: string, payload: unknown): Promise<string> {
		const original = this.messages.get(originalMessageId);
		if (!original) {
			throw new Error(`Original message ${originalMessageId} not found`);
		}

		return this.send({
			type: "task_response",
			from: original.to as string,
			to: original.from,
			priority: original.priority,
			payload,
			replyTo: originalMessageId,
		});
	}

	private broadcast(message: SwarmMessage): void {
		for (const agent of this.getActiveAgents()) {
			if (agent.id !== message.from) {
				this.deliverToAgent(message, agent.id);
			}
		}
	}

	private deliverToAgent(message: SwarmMessage, agentId: string): void {
		const agent = this.agents.get(agentId);
		if (!agent) {
			this.emit("deliveryFailed", { messageId: message.id, agentId, reason: "agent_not_found" });
			return;
		}

		if (agent.status === "offline") {
			this.emit("deliveryFailed", { messageId: message.id, agentId, reason: "agent_offline" });
			return;
		}

		this.emit("messageDelivered", { message, agentId });
	}

	// --------------------------------------------------------------------------
	// TASK DELEGATION
	// --------------------------------------------------------------------------

	/**
	 * Find the best agent for a task
	 */
	findBestAgent(request: TaskRequest): SwarmAgent | null {
		const candidates = this.getActiveAgents().filter((agent) => {
			// Check capabilities
			const hasCapabilities = request.requiredCapabilities.every((cap) =>
				agent.capabilities.some((c) => c.toLowerCase().includes(cap.toLowerCase())),
			);
			if (!hasCapabilities) return false;

			// Skip overloaded agents
			if (agent.status === "busy" && agent.load > 0.8) return false;

			return true;
		});

		if (candidates.length === 0) return null;

		// Score and sort candidates
		const scored = candidates.map((agent) => ({
			agent,
			score: this.scoreAgent(agent, request),
		}));

		scored.sort((a, b) => b.score - a.score);
		return scored[0].agent;
	}

	private scoreAgent(agent: SwarmAgent, request: TaskRequest): number {
		let score = 0;

		// Reputation (0-40 points)
		score += agent.reputation * 40;

		// Availability (0-30 points)
		score += (1 - agent.load) * 30;

		// Capability match (0-20 points)
		const matchedCaps = request.requiredCapabilities.filter((cap) =>
			agent.capabilities.some((c) => c.toLowerCase() === cap.toLowerCase()),
		);
		score += (matchedCaps.length / request.requiredCapabilities.length) * 20;

		// Role bonus (0-10 points)
		if (agent.role === "specialist") score += 10;
		else if (agent.role === "worker") score += 5;

		return score;
	}

	/**
	 * Delegate a task to the best available agent
	 */
	async delegateTask(request: TaskRequest, fromAgentId: string): Promise<TaskResponse> {
		const targetAgent = this.findBestAgent(request);

		if (!targetAgent) {
			return {
				taskId: request.taskId,
				status: "rejected",
				error: "No suitable agent found",
			};
		}

		// Send task request
		const messageId = await this.send({
			type: "task_request",
			from: fromAgentId,
			to: targetAgent.id,
			priority: request.priority,
			payload: request,
			requiresAck: true,
		});

		this.emit("taskDelegated", {
			taskId: request.taskId,
			from: fromAgentId,
			to: targetAgent.id,
			messageId,
		});

		// Wait for response
		return new Promise((resolve) => {
			const handler = (event: { message: SwarmMessage; agentId: string }) => {
				if (event.message.replyTo === messageId && event.message.type === "task_response") {
					this.off("messageDelivered", handler);
					resolve(event.message.payload as TaskResponse);
				}
			};
			this.on("messageDelivered", handler);

			// Timeout
			setTimeout(() => {
				this.off("messageDelivered", handler);
				resolve({
					taskId: request.taskId,
					status: "failed",
					error: "Task timeout",
				});
			}, this.config.messageTimeout);
		});
	}

	/**
	 * Escalate a task to a higher authority (leader/coordinator)
	 */
	async escalate(taskId: string, reason: string, fromAgentId: string): Promise<boolean> {
		const leaders = this.getActiveAgents().filter((a) => a.role === "leader" || a.role === "coordinator");

		if (leaders.length === 0) {
			this.emit("escalationFailed", { taskId, reason: "no_leader_available" });
			return false;
		}

		// Send to first available leader
		const leader = leaders.sort((a, b) => a.load - b.load)[0];

		await this.send({
			type: "escalation",
			from: fromAgentId,
			to: leader.id,
			priority: "high",
			payload: { taskId, reason },
			requiresAck: true,
		});

		this.emit("taskEscalated", { taskId, from: fromAgentId, to: leader.id, reason });
		return true;
	}

	// --------------------------------------------------------------------------
	// CONSENSUS
	// --------------------------------------------------------------------------

	/**
	 * Start a consensus proposal
	 */
	async proposeConsensus(proposal: ConsensusProposal, fromAgentId: string): Promise<ConsensusResult> {
		this.consensusProposals.set(proposal.proposalId, proposal);
		this.consensusVotes.set(proposal.proposalId, []);

		// Broadcast proposal
		await this.send({
			type: "consensus_proposal",
			from: fromAgentId,
			to: "broadcast",
			priority: "high",
			payload: proposal,
		});

		// Wait for votes
		return new Promise((resolve) => {
			const checkVotes = () => {
				const votes = this.consensusVotes.get(proposal.proposalId) || [];
				const activeAgents = this.getActiveAgents().filter((a) => a.id !== fromAgentId);
				const minParticipants = proposal.minimumParticipants || Math.ceil(activeAgents.length / 2);

				if (votes.length >= minParticipants) {
					const result = this.tallyVotes(proposal, votes);
					this.consensusProposals.delete(proposal.proposalId);
					this.consensusVotes.delete(proposal.proposalId);
					resolve(result);
				}
			};

			// Listen for votes
			const voteHandler = (event: { message: SwarmMessage }) => {
				if (
					event.message.type === "consensus_vote" &&
					(event.message.payload as ConsensusVote).proposalId === proposal.proposalId
				) {
					const vote = event.message.payload as ConsensusVote;
					const votes = this.consensusVotes.get(proposal.proposalId) || [];
					votes.push(vote);
					this.consensusVotes.set(proposal.proposalId, votes);
					checkVotes();
				}
			};

			this.on("messageDelivered", voteHandler);

			// Timeout
			setTimeout(() => {
				this.off("messageDelivered", voteHandler);
				const votes = this.consensusVotes.get(proposal.proposalId) || [];
				const result = this.tallyVotes(proposal, votes);
				this.consensusProposals.delete(proposal.proposalId);
				this.consensusVotes.delete(proposal.proposalId);
				resolve(result);
			}, proposal.deadline - Date.now());
		});
	}

	/**
	 * Submit a vote for a consensus proposal
	 */
	async vote(vote: ConsensusVote): Promise<void> {
		const proposal = this.consensusProposals.get(vote.proposalId);
		if (!proposal) {
			throw new Error(`Proposal ${vote.proposalId} not found`);
		}

		if (!proposal.options.includes(vote.choice)) {
			throw new Error(`Invalid choice: ${vote.choice}`);
		}

		await this.send({
			type: "consensus_vote",
			from: vote.voterId,
			to: "broadcast",
			priority: "normal",
			payload: vote,
		});
	}

	private tallyVotes(proposal: ConsensusProposal, votes: ConsensusVote[]): ConsensusResult {
		const activeAgents = this.getActiveAgents();
		const participation = votes.length / Math.max(1, activeAgents.length);

		// Count votes per option
		const voteCounts: Record<string, number> = {};
		for (const option of proposal.options) {
			voteCounts[option] = 0;
		}

		for (const vote of votes) {
			let weight = 1;
			if (proposal.strategy === "weighted" && proposal.weights) {
				weight = proposal.weights[vote.voterId] || 1;
			}
			voteCounts[vote.choice] = (voteCounts[vote.choice] || 0) + weight * vote.confidence;
		}

		// Determine winner based on strategy
		let winner: string;
		let unanimous = false;

		switch (proposal.strategy) {
			case "unanimous": {
				const uniqueChoices = new Set(votes.map((v) => v.choice));
				if (uniqueChoices.size === 1) {
					winner = votes[0].choice;
					unanimous = true;
				} else {
					winner = "NO_CONSENSUS";
				}
				break;
			}

			case "leader_decides": {
				const leaderVote = votes.find((v) => {
					const agent = this.agents.get(v.voterId);
					return agent?.role === "leader";
				});
				winner =
					leaderVote?.choice || Object.keys(voteCounts).reduce((a, b) => (voteCounts[a] > voteCounts[b] ? a : b));
				break;
			}
			default:
				winner = Object.keys(voteCounts).reduce((a, b) => (voteCounts[a] > voteCounts[b] ? a : b));
				unanimous = votes.every((v) => v.choice === winner);
		}

		// Calculate confidence
		const totalWeight = Object.values(voteCounts).reduce((a, b) => a + b, 0);
		const winnerWeight = voteCounts[winner] || 0;
		const confidence = totalWeight > 0 ? winnerWeight / totalWeight : 0;

		return {
			proposalId: proposal.proposalId,
			winner,
			votes,
			participation,
			confidence,
			unanimous,
		};
	}

	// --------------------------------------------------------------------------
	// KNOWLEDGE SHARING
	// --------------------------------------------------------------------------

	/**
	 * Share knowledge with the swarm
	 */
	async shareKnowledge(
		fromAgentId: string,
		topic: string,
		knowledge: unknown,
		targetAgents?: string[],
	): Promise<void> {
		await this.send({
			type: "knowledge_share",
			from: fromAgentId,
			to: targetAgents || "broadcast",
			priority: "normal",
			payload: { topic, knowledge, sharedAt: Date.now() },
		});

		this.emit("knowledgeShared", { from: fromAgentId, topic });
	}

	/**
	 * Request state synchronization
	 */
	async requestSync(agentId: string, targetAgentId: string): Promise<unknown> {
		const messageId = await this.send({
			type: "sync_request",
			from: agentId,
			to: targetAgentId,
			priority: "normal",
			payload: { requestedAt: Date.now() },
			requiresAck: true,
		});

		return new Promise((resolve, reject) => {
			const handler = (event: { message: SwarmMessage }) => {
				if (event.message.replyTo === messageId && event.message.type === "sync_response") {
					this.off("messageDelivered", handler);
					resolve(event.message.payload);
				}
			};
			this.on("messageDelivered", handler);

			setTimeout(() => {
				this.off("messageDelivered", handler);
				reject(new Error("Sync timeout"));
			}, this.config.messageTimeout);
		});
	}

	// --------------------------------------------------------------------------
	// LIFECYCLE
	// --------------------------------------------------------------------------

	/**
	 * Start the swarm coordinator
	 */
	start(): void {
		if (this.heartbeatTimer) return;

		this.heartbeatTimer = setInterval(() => {
			this.checkHeartbeats();
		}, this.config.heartbeatInterval);

		this.emit("started");
	}

	/**
	 * Stop the swarm coordinator
	 */
	stop(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}

		this.emit("stopped");
	}

	private checkHeartbeats(): void {
		const now = Date.now();
		const timeout = this.config.heartbeatInterval * 3;

		for (const agent of this.agents.values()) {
			if (agent.status !== "offline" && now - agent.lastSeen > timeout) {
				agent.status = "offline";
				this.emit("agentTimeout", agent);

				// Auto-failover if enabled
				if (this.config.autoFailover && agent.role === "leader") {
					this.electNewLeader();
				}
			}
		}
	}

	private electNewLeader(): void {
		const candidates = this.getActiveAgents().filter((a) => a.role === "coordinator" || a.role === "worker");

		if (candidates.length === 0) {
			this.emit("error", { type: "no_leader_candidates" });
			return;
		}

		// Elect based on reputation
		const newLeader = candidates.sort((a, b) => b.reputation - a.reputation)[0];
		newLeader.role = "leader";

		this.emit("leaderElected", newLeader);
	}

	// --------------------------------------------------------------------------
	// UTILITIES
	// --------------------------------------------------------------------------

	/**
	 * Get swarm statistics
	 */
	getStats(): {
		totalAgents: number;
		activeAgents: number;
		byRole: Record<SwarmRole, number>;
		averageLoad: number;
		messageCount: number;
	} {
		const active = this.getActiveAgents();
		const byRole: Record<SwarmRole, number> = {
			leader: 0,
			worker: 0,
			specialist: 0,
			coordinator: 0,
			observer: 0,
		};

		for (const agent of this.agents.values()) {
			byRole[agent.role] = (byRole[agent.role] || 0) + 1;
		}

		const avgLoad = active.length > 0 ? active.reduce((sum, a) => sum + a.load, 0) / active.length : 0;

		return {
			totalAgents: this.agents.size,
			activeAgents: active.length,
			byRole,
			averageLoad: avgLoad,
			messageCount: this.messages.size,
		};
	}

	/**
	 * Get agent by ID
	 */
	getAgent(agentId: string): SwarmAgent | undefined {
		return this.agents.get(agentId);
	}

	/**
	 * List all agents
	 */
	listAgents(): SwarmAgent[] {
		return Array.from(this.agents.values());
	}

	/**
	 * Visualize swarm topology
	 */
	visualize(): string {
		const lines: string[] = ["```", "SWARM TOPOLOGY", "==============", ""];

		const byRole = new Map<SwarmRole, SwarmAgent[]>();
		for (const agent of this.agents.values()) {
			const list = byRole.get(agent.role) || [];
			list.push(agent);
			byRole.set(agent.role, list);
		}

		const roleOrder: SwarmRole[] = ["leader", "coordinator", "specialist", "worker", "observer"];
		for (const role of roleOrder) {
			const agents = byRole.get(role) || [];
			if (agents.length === 0) continue;

			lines.push(`[${role.toUpperCase()}]`);
			for (const agent of agents) {
				const statusIcon =
					agent.status === "idle" ? "○" : agent.status === "busy" ? "●" : agent.status === "error" ? "✗" : "◌";
				const loadBar = "█".repeat(Math.floor(agent.load * 5)) + "░".repeat(5 - Math.floor(agent.load * 5));
				lines.push(
					`  ${statusIcon} ${agent.name} (${agent.domain}) [${loadBar}] rep:${(agent.reputation * 100).toFixed(0)}%`,
				);
			}
			lines.push("");
		}

		lines.push("```");
		return lines.join("\n");
	}
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

let globalSwarm: SwarmCoordinator | null = null;

/**
 * Get or create the global swarm coordinator
 */
export function getSwarmCoordinator(config?: Partial<SwarmConfig>): SwarmCoordinator {
	if (!globalSwarm) {
		globalSwarm = new SwarmCoordinator(config);
	}
	return globalSwarm;
}

/**
 * Create a new swarm coordinator
 */
export function createSwarmCoordinator(config?: Partial<SwarmConfig>): SwarmCoordinator {
	return new SwarmCoordinator(config);
}

/**
 * Create a swarm agent
 */
export function createSwarmAgent(
	id: string,
	name: string,
	role: SwarmRole,
	domain: AgentDomain,
	capabilities: string[],
): SwarmAgent {
	return {
		id,
		name,
		role,
		domain,
		capabilities,
		status: "idle",
		load: 0,
		reputation: 0.5, // Start neutral
		lastSeen: Date.now(),
	};
}

/**
 * Create a task request
 */
export function createTaskRequest(
	description: string,
	requiredCapabilities: string[],
	priority: MessagePriority = "normal",
	deadline?: number,
): TaskRequest {
	return {
		taskId: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		description,
		requiredCapabilities,
		priority,
		deadline,
	};
}

/**
 * Create a consensus proposal
 */
export function createConsensusProposal(
	question: string,
	options: string[],
	strategy: ConsensusStrategy = "majority",
	timeoutMs: number = 60000,
): ConsensusProposal {
	return {
		proposalId: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		question,
		options,
		strategy,
		deadline: Date.now() + timeoutMs,
	};
}

export default SwarmCoordinator;
