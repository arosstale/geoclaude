/**
 * Class 3.2 Multi-Agent Coordinator
 *
 * Enables multiple agents to work together on complex tasks with:
 * - Agent-to-agent messaging
 * - Consensus mechanisms for decisions
 * - Parallel execution with result aggregation
 * - Supervisor/worker patterns
 * - Debate and critique workflows
 *
 * Based on: Google ADK patterns, Multi-Agent Debate, Generator-Critic
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { Orchestrator, type DelegationResult } from "./orchestrator.js";

// =============================================================================
// Types
// =============================================================================

/** Message between agents */
export interface AgentMessage {
	id: string;
	from: string; // Agent ID or "coordinator"
	to: string; // Agent ID or "broadcast"
	type: "request" | "response" | "critique" | "vote" | "consensus" | "info";
	content: string;
	metadata?: Record<string, unknown>;
	timestamp: Date;
	replyTo?: string; // Message ID this is replying to
}

/** Agent vote in consensus */
export interface AgentVote {
	agentId: string;
	choice: string;
	confidence: number; // 0-1
	reasoning: string;
	timestamp: Date;
}

/** Consensus result */
export interface ConsensusResult {
	id: string;
	question: string;
	votes: AgentVote[];
	winner: string;
	confidence: number;
	unanimous: boolean;
	method: "majority" | "weighted" | "unanimous" | "supervisor";
	timestamp: Date;
}

/** Coordination task */
export interface CoordinationTask {
	id: string;
	type: "parallel" | "sequential" | "debate" | "consensus" | "supervisor";
	prompt: string;
	agents: string[]; // Agent IDs or roles
	config: CoordinationConfig;
	timeout: number;
	priority: number;
}

/** Coordination configuration */
export interface CoordinationConfig {
	/** For debate: number of rounds */
	rounds?: number;
	/** For consensus: voting method */
	consensusMethod?: "majority" | "weighted" | "unanimous" | "supervisor";
	/** For supervisor: supervisor agent ID */
	supervisorId?: string;
	/** For parallel: aggregation strategy */
	aggregation?: "merge" | "best" | "vote" | "all";
	/** Max retries per agent */
	maxRetries?: number;
	/** Enable critique phase */
	enableCritique?: boolean;
	/** Custom system prompt for coordination */
	systemPrompt?: string;
}

/** Coordination result */
export interface CoordinationResult {
	taskId: string;
	status: "success" | "partial" | "failed";
	type: CoordinationTask["type"];
	agentResults: Map<string, DelegationResult>;
	messages: AgentMessage[];
	consensus?: ConsensusResult;
	finalOutput: string;
	metadata: {
		duration: number;
		agentsUsed: string[];
		totalTokens?: number;
	};
}

/** Coordinator events */
export interface CoordinatorEvents {
	"task:started": (task: CoordinationTask) => void;
	"task:completed": (result: CoordinationResult) => void;
	"message:sent": (message: AgentMessage) => void;
	"vote:received": (vote: AgentVote) => void;
	"consensus:reached": (result: ConsensusResult) => void;
	"agent:critique": (from: string, to: string, critique: string) => void;
}

// =============================================================================
// Multi-Agent Coordinator
// =============================================================================

export class MultiAgentCoordinator extends EventEmitter {
	private orchestrator: Orchestrator;
	private messageLog: AgentMessage[] = [];
	private activeCoordinations = new Map<string, CoordinationTask>();

	constructor(orchestrator: Orchestrator) {
		super();
		this.orchestrator = orchestrator;
	}

	// =========================================================================
	// Core Coordination Methods
	// =========================================================================

	/** Run a coordination task */
	async coordinate(task: CoordinationTask): Promise<CoordinationResult> {
		const startTime = Date.now();
		this.activeCoordinations.set(task.id, task);
		this.emit("task:started", task);

		try {
			let result: CoordinationResult;

			switch (task.type) {
				case "parallel":
					result = await this.runParallel(task);
					break;
				case "sequential":
					result = await this.runSequential(task);
					break;
				case "debate":
					result = await this.runDebate(task);
					break;
				case "consensus":
					result = await this.runConsensus(task);
					break;
				case "supervisor":
					result = await this.runSupervisor(task);
					break;
				default:
					throw new Error(`Unknown coordination type: ${task.type}`);
			}

			result.metadata.duration = Date.now() - startTime;
			this.emit("task:completed", result);
			return result;
		} finally {
			this.activeCoordinations.delete(task.id);
		}
	}

	// =========================================================================
	// Parallel Execution
	// =========================================================================

	/** Run agents in parallel, aggregate results */
	private async runParallel(task: CoordinationTask): Promise<CoordinationResult> {
		const agentResults = new Map<string, DelegationResult>();
		const messages: AgentMessage[] = [];

		// Delegate to all agents in parallel
		const promises = task.agents.map(async (agentIdOrRole) => {
			const msg = this.createMessage("coordinator", agentIdOrRole, "request", task.prompt);
			messages.push(msg);
			this.emit("message:sent", msg);

			const result = await this.orchestrator.delegate({
				id: randomUUID(),
				taskType: "parallel_coordination",
				prompt: task.prompt,
				requiredRole: this.isRole(agentIdOrRole) ? agentIdOrRole as any : undefined,
				timeout: task.timeout,
				priority: task.priority,
			});

			agentResults.set(result.agentId || agentIdOrRole, result);

			const responseMsg = this.createMessage(
				result.agentId || agentIdOrRole,
				"coordinator",
				"response",
				String(result.output),
			);
			messages.push(responseMsg);

			return result;
		});

		const results = await Promise.all(promises);

		// Aggregate results
		const finalOutput = this.aggregateResults(results, task.config.aggregation || "merge");

		return {
			taskId: task.id,
			status: results.every((r) => r.status === "success") ? "success" : "partial",
			type: "parallel",
			agentResults,
			messages,
			finalOutput,
			metadata: {
				duration: 0,
				agentsUsed: results.map((r) => r.agentId).filter(Boolean) as string[],
			},
		};
	}

	// =========================================================================
	// Sequential Execution
	// =========================================================================

	/** Run agents sequentially, each building on previous */
	private async runSequential(task: CoordinationTask): Promise<CoordinationResult> {
		const agentResults = new Map<string, DelegationResult>();
		const messages: AgentMessage[] = [];
		let currentPrompt = task.prompt;
		let lastOutput = "";

		for (const agentIdOrRole of task.agents) {
			// Include previous output in prompt
			const enhancedPrompt = lastOutput
				? `Previous agent output:\n${lastOutput}\n\nYour task:\n${currentPrompt}`
				: currentPrompt;

			const msg = this.createMessage("coordinator", agentIdOrRole, "request", enhancedPrompt);
			messages.push(msg);
			this.emit("message:sent", msg);

			const result = await this.orchestrator.delegate({
				id: randomUUID(),
				taskType: "sequential_coordination",
				prompt: enhancedPrompt,
				requiredRole: this.isRole(agentIdOrRole) ? agentIdOrRole as any : undefined,
				timeout: task.timeout,
				priority: task.priority,
			});

			agentResults.set(result.agentId || agentIdOrRole, result);
			lastOutput = String(result.output);

			const responseMsg = this.createMessage(
				result.agentId || agentIdOrRole,
				"coordinator",
				"response",
				lastOutput,
			);
			messages.push(responseMsg);

			if (result.status !== "success") {
				break;
			}
		}

		return {
			taskId: task.id,
			status: agentResults.size === task.agents.length ? "success" : "partial",
			type: "sequential",
			agentResults,
			messages,
			finalOutput: lastOutput,
			metadata: {
				duration: 0,
				agentsUsed: Array.from(agentResults.keys()),
			},
		};
	}

	// =========================================================================
	// Debate Pattern
	// =========================================================================

	/** Run agents in debate format */
	private async runDebate(task: CoordinationTask): Promise<CoordinationResult> {
		const rounds = task.config.rounds || 3;
		const agentResults = new Map<string, DelegationResult>();
		const messages: AgentMessage[] = [];
		const positions: Map<string, string[]> = new Map();

		// Initialize positions
		for (const agent of task.agents) {
			positions.set(agent, []);
		}

		// Initial positions
		for (const agent of task.agents) {
			const msg = this.createMessage(
				"coordinator",
				agent,
				"request",
				`Topic: ${task.prompt}\n\nProvide your initial position on this topic. Be specific and provide reasoning.`,
			);
			messages.push(msg);

			const result = await this.orchestrator.delegate({
				id: randomUUID(),
				taskType: "debate_initial",
				prompt: msg.content,
				requiredRole: this.isRole(agent) ? agent as any : undefined,
				timeout: task.timeout,
				priority: task.priority,
			});

			const output = String(result.output);
			positions.get(agent)?.push(output);
			agentResults.set(result.agentId || agent, result);

			const responseMsg = this.createMessage(result.agentId || agent, "broadcast", "response", output);
			messages.push(responseMsg);
		}

		// Debate rounds
		for (let round = 1; round < rounds; round++) {
			for (const agent of task.agents) {
				// Get other agents' latest positions
				const otherPositions = Array.from(positions.entries())
					.filter(([a]) => a !== agent)
					.map(([a, pos]) => `${a}: ${pos[pos.length - 1]}`)
					.join("\n\n");

				const debatePrompt = `Round ${round + 1} of debate on: ${task.prompt}

Other participants' positions:
${otherPositions}

Your previous position: ${positions.get(agent)?.[positions.get(agent)!.length - 1]}

Respond to the other positions. You may refine your position, counter arguments, or find common ground.`;

				const msg = this.createMessage("coordinator", agent, "request", debatePrompt);
				messages.push(msg);

				const result = await this.orchestrator.delegate({
					id: randomUUID(),
					taskType: `debate_round_${round}`,
					prompt: debatePrompt,
					requiredRole: this.isRole(agent) ? agent as any : undefined,
					timeout: task.timeout,
					priority: task.priority,
				});

				const output = String(result.output);
				positions.get(agent)?.push(output);

				const responseMsg = this.createMessage(result.agentId || agent, "broadcast", "response", output);
				messages.push(responseMsg);
			}
		}

		// Synthesize final output
		const allPositions = Array.from(positions.entries())
			.map(([agent, pos]) => `${agent} final position:\n${pos[pos.length - 1]}`)
			.join("\n\n---\n\n");

		const finalOutput = `Debate Summary (${rounds} rounds, ${task.agents.length} participants):\n\n${allPositions}`;

		return {
			taskId: task.id,
			status: "success",
			type: "debate",
			agentResults,
			messages,
			finalOutput,
			metadata: {
				duration: 0,
				agentsUsed: task.agents,
			},
		};
	}

	// =========================================================================
	// Consensus Pattern
	// =========================================================================

	/** Run consensus voting among agents */
	private async runConsensus(task: CoordinationTask): Promise<CoordinationResult> {
		const agentResults = new Map<string, DelegationResult>();
		const messages: AgentMessage[] = [];
		const votes: AgentVote[] = [];

		// Request votes from all agents
		const votePrompt = `Question requiring consensus: ${task.prompt}

You must vote on this question. Provide:
1. Your choice/answer
2. Your confidence level (0-100%)
3. Brief reasoning

Format your response as:
CHOICE: [your choice]
CONFIDENCE: [0-100]
REASONING: [your reasoning]`;

		for (const agent of task.agents) {
			const msg = this.createMessage("coordinator", agent, "request", votePrompt);
			messages.push(msg);

			const result = await this.orchestrator.delegate({
				id: randomUUID(),
				taskType: "consensus_vote",
				prompt: votePrompt,
				requiredRole: this.isRole(agent) ? agent as any : undefined,
				timeout: task.timeout,
				priority: task.priority,
			});

			agentResults.set(result.agentId || agent, result);

			// Parse vote from output
			const output = String(result.output);
			const vote = this.parseVote(result.agentId || agent, output);
			votes.push(vote);
			this.emit("vote:received", vote);

			const voteMsg = this.createMessage(result.agentId || agent, "coordinator", "vote", output);
			messages.push(voteMsg);
		}

		// Calculate consensus
		const consensusResult = this.calculateConsensus(
			task.id,
			task.prompt,
			votes,
			task.config.consensusMethod || "majority",
		);
		this.emit("consensus:reached", consensusResult);

		// Broadcast consensus
		const consensusMsg = this.createMessage(
			"coordinator",
			"broadcast",
			"consensus",
			`Consensus reached: ${consensusResult.winner} (confidence: ${(consensusResult.confidence * 100).toFixed(0)}%)`,
		);
		messages.push(consensusMsg);

		return {
			taskId: task.id,
			status: "success",
			type: "consensus",
			agentResults,
			messages,
			consensus: consensusResult,
			finalOutput: `Consensus: ${consensusResult.winner}\nMethod: ${consensusResult.method}\nConfidence: ${(consensusResult.confidence * 100).toFixed(0)}%\nUnanimous: ${consensusResult.unanimous}`,
			metadata: {
				duration: 0,
				agentsUsed: task.agents,
			},
		};
	}

	// =========================================================================
	// Supervisor Pattern
	// =========================================================================

	/** Run with supervisor agent overseeing workers */
	private async runSupervisor(task: CoordinationTask): Promise<CoordinationResult> {
		const supervisorId = task.config.supervisorId || task.agents[0];
		const workers = task.agents.filter((a) => a !== supervisorId);
		const agentResults = new Map<string, DelegationResult>();
		const messages: AgentMessage[] = [];

		// Supervisor creates subtasks
		const planPrompt = `You are the supervisor for this task: ${task.prompt}

Available workers: ${workers.join(", ")}

Create a plan that assigns subtasks to each worker. For each worker, specify:
1. The subtask they should handle
2. Any specific instructions

Format as:
WORKER: [worker name]
SUBTASK: [subtask description]
---`;

		const planMsg = this.createMessage("coordinator", supervisorId, "request", planPrompt);
		messages.push(planMsg);

		const planResult = await this.orchestrator.delegate({
			id: randomUUID(),
			taskType: "supervisor_plan",
			prompt: planPrompt,
			requiredRole: this.isRole(supervisorId) ? supervisorId as any : undefined,
			timeout: task.timeout,
			priority: task.priority,
		});

		agentResults.set(supervisorId, planResult);

		// Parse subtasks and delegate to workers
		const subtasks = this.parseSubtasks(String(planResult.output), workers);
		const workerOutputs: string[] = [];

		for (const [worker, subtask] of subtasks) {
			const workerMsg = this.createMessage(supervisorId, worker, "request", subtask);
			messages.push(workerMsg);

			const workerResult = await this.orchestrator.delegate({
				id: randomUUID(),
				taskType: "supervisor_worker",
				prompt: subtask,
				requiredRole: this.isRole(worker) ? worker as any : undefined,
				timeout: task.timeout,
				priority: task.priority,
			});

			agentResults.set(worker, workerResult);
			workerOutputs.push(`${worker}:\n${workerResult.output}`);

			const responseMsg = this.createMessage(worker, supervisorId, "response", String(workerResult.output));
			messages.push(responseMsg);
		}

		// Supervisor synthesizes final output
		const synthesizePrompt = `You are the supervisor. Your workers have completed their subtasks.

Original task: ${task.prompt}

Worker outputs:
${workerOutputs.join("\n\n---\n\n")}

Synthesize these outputs into a final, coherent result.`;

		const synthesizeMsg = this.createMessage("coordinator", supervisorId, "request", synthesizePrompt);
		messages.push(synthesizeMsg);

		const finalResult = await this.orchestrator.delegate({
			id: randomUUID(),
			taskType: "supervisor_synthesize",
			prompt: synthesizePrompt,
			requiredRole: this.isRole(supervisorId) ? supervisorId as any : undefined,
			timeout: task.timeout,
			priority: task.priority,
		});

		return {
			taskId: task.id,
			status: "success",
			type: "supervisor",
			agentResults,
			messages,
			finalOutput: String(finalResult.output),
			metadata: {
				duration: 0,
				agentsUsed: [supervisorId, ...workers],
			},
		};
	}

	// =========================================================================
	// Helper Methods
	// =========================================================================

	private createMessage(
		from: string,
		to: string,
		type: AgentMessage["type"],
		content: string,
		replyTo?: string,
	): AgentMessage {
		const msg: AgentMessage = {
			id: randomUUID(),
			from,
			to,
			type,
			content,
			timestamp: new Date(),
			replyTo,
		};
		this.messageLog.push(msg);
		return msg;
	}

	private isRole(value: string): boolean {
		return ["architect", "builder", "tester", "reviewer", "expert", "scout", "executor"].includes(value);
	}

	private aggregateResults(results: DelegationResult[], strategy: string): string {
		switch (strategy) {
			case "merge":
				return results.map((r, i) => `[Agent ${i + 1}]:\n${r.output}`).join("\n\n");
			case "best":
				// Return result with highest success rate (simplified: first success)
				const success = results.find((r) => r.status === "success");
				return success ? String(success.output) : String(results[0]?.output || "No results");
			case "all":
				return JSON.stringify(results.map((r) => ({ agent: r.agentId, output: r.output })), null, 2);
			default:
				return results.map((r) => r.output).join("\n\n---\n\n");
		}
	}

	private parseVote(agentId: string, output: string): AgentVote {
		const choiceMatch = output.match(/CHOICE:\s*(.+)/i);
		const confidenceMatch = output.match(/CONFIDENCE:\s*(\d+)/i);
		const reasoningMatch = output.match(/REASONING:\s*(.+)/is);

		return {
			agentId,
			choice: choiceMatch?.[1]?.trim() || output.slice(0, 100),
			confidence: confidenceMatch ? parseInt(confidenceMatch[1]) / 100 : 0.5,
			reasoning: reasoningMatch?.[1]?.trim() || "No reasoning provided",
			timestamp: new Date(),
		};
	}

	private calculateConsensus(
		id: string,
		question: string,
		votes: AgentVote[],
		method: ConsensusResult["method"],
	): ConsensusResult {
		// Count votes by choice
		const voteCounts = new Map<string, { count: number; totalConfidence: number }>();
		for (const vote of votes) {
			const existing = voteCounts.get(vote.choice) || { count: 0, totalConfidence: 0 };
			voteCounts.set(vote.choice, {
				count: existing.count + 1,
				totalConfidence: existing.totalConfidence + vote.confidence,
			});
		}

		let winner: string;
		let confidence: number;

		switch (method) {
			case "weighted":
				// Weighted by confidence
				let maxWeighted = 0;
				winner = "";
				for (const [choice, data] of voteCounts) {
					if (data.totalConfidence > maxWeighted) {
						maxWeighted = data.totalConfidence;
						winner = choice;
					}
				}
				confidence = maxWeighted / votes.length;
				break;

			case "unanimous":
				// All must agree
				if (voteCounts.size === 1) {
					winner = votes[0].choice;
					confidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;
				} else {
					winner = "NO CONSENSUS";
					confidence = 0;
				}
				break;

			case "majority":
			default:
				// Simple majority
				let maxCount = 0;
				winner = "";
				for (const [choice, data] of voteCounts) {
					if (data.count > maxCount) {
						maxCount = data.count;
						winner = choice;
					}
				}
				confidence = maxCount / votes.length;
				break;
		}

		return {
			id,
			question,
			votes,
			winner,
			confidence,
			unanimous: voteCounts.size === 1,
			method,
			timestamp: new Date(),
		};
	}

	private parseSubtasks(planOutput: string, workers: string[]): Map<string, string> {
		const subtasks = new Map<string, string>();
		const sections = planOutput.split("---").filter(Boolean);

		for (const section of sections) {
			const workerMatch = section.match(/WORKER:\s*(.+)/i);
			const subtaskMatch = section.match(/SUBTASK:\s*(.+)/is);

			if (workerMatch && subtaskMatch) {
				const worker = workerMatch[1].trim();
				const matchedWorker = workers.find(
					(w) => w.toLowerCase().includes(worker.toLowerCase()) || worker.toLowerCase().includes(w.toLowerCase()),
				);
				if (matchedWorker) {
					subtasks.set(matchedWorker, subtaskMatch[1].trim());
				}
			}
		}

		// If parsing failed, distribute equally
		if (subtasks.size === 0) {
			workers.forEach((w, i) => {
				subtasks.set(w, `Part ${i + 1} of: ${planOutput.slice(0, 500)}`);
			});
		}

		return subtasks;
	}

	// =========================================================================
	// Public Getters
	// =========================================================================

	getMessageLog(): AgentMessage[] {
		return [...this.messageLog];
	}

	getActiveCoordinations(): CoordinationTask[] {
		return Array.from(this.activeCoordinations.values());
	}

	clearMessageLog(): void {
		this.messageLog = [];
	}
}

// =============================================================================
// Singleton & Factory
// =============================================================================

let coordinatorInstance: MultiAgentCoordinator | null = null;

export function getCoordinator(orchestrator: Orchestrator): MultiAgentCoordinator {
	if (!coordinatorInstance) {
		coordinatorInstance = new MultiAgentCoordinator(orchestrator);
	}
	return coordinatorInstance;
}

export function resetCoordinator(): void {
	coordinatorInstance = null;
}

// =============================================================================
// Quick Coordination Helpers
// =============================================================================

/** Quick parallel execution */
export async function runParallel(
	orchestrator: Orchestrator,
	prompt: string,
	roles: string[],
): Promise<CoordinationResult> {
	const coordinator = getCoordinator(orchestrator);
	return coordinator.coordinate({
		id: randomUUID(),
		type: "parallel",
		prompt,
		agents: roles,
		config: { aggregation: "merge" },
		timeout: 60000,
		priority: 5,
	});
}

/** Quick debate */
export async function runDebate(
	orchestrator: Orchestrator,
	topic: string,
	roles: string[],
	rounds = 3,
): Promise<CoordinationResult> {
	const coordinator = getCoordinator(orchestrator);
	return coordinator.coordinate({
		id: randomUUID(),
		type: "debate",
		prompt: topic,
		agents: roles,
		config: { rounds },
		timeout: 120000,
		priority: 5,
	});
}

/** Quick consensus */
export async function runConsensusVote(
	orchestrator: Orchestrator,
	question: string,
	roles: string[],
	method: ConsensusResult["method"] = "majority",
): Promise<CoordinationResult> {
	const coordinator = getCoordinator(orchestrator);
	return coordinator.coordinate({
		id: randomUUID(),
		type: "consensus",
		prompt: question,
		agents: roles,
		config: { consensusMethod: method },
		timeout: 60000,
		priority: 5,
	});
}

/** Quick supervisor pattern */
export async function runWithSupervisor(
	orchestrator: Orchestrator,
	task: string,
	supervisorRole: string,
	workerRoles: string[],
): Promise<CoordinationResult> {
	const coordinator = getCoordinator(orchestrator);
	return coordinator.coordinate({
		id: randomUUID(),
		type: "supervisor",
		prompt: task,
		agents: [supervisorRole, ...workerRoles],
		config: { supervisorId: supervisorRole },
		timeout: 120000,
		priority: 5,
	});
}
