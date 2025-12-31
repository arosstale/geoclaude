/**
 * AGENTIC PROPERTIES SYSTEM
 *
 * Implements IndyDevDan's 6 Agentic Properties:
 * BASE LEVEL:
 *   1. ALIGNMENT - Domain-specific understanding with evaluations
 *   2. AUTONOMY - Independent operation, minimal oversight
 *   3. DURABILITY - Continuous operation, long lifespan
 * META LEVEL:
 *   4. SELF-IMPROVEMENT - Learn from experiences
 *   5. SELF-REPLICATION - Create agent variants for scaling
 *   6. SELF-ORGANIZATION - Restructure internal processes
 *
 * Compute Advantage = (Compute Scaling * Autonomy) / (Time + Effort + Monetary Cost)
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { getExpertisePath, loadExpertise, updateExpertise } from "./expertise-manager.js";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/** Agentic property levels */
export type PropertyLevel = "none" | "basic" | "advanced" | "mastery";

/** Agent domains for alignment */
export type AgentDomain =
	| "general"
	| "coding"
	| "trading"
	| "research"
	| "security"
	| "database"
	| "api_integration"
	| "performance"
	| "creative";

/** Evaluation result for alignment */
export interface EvaluationResult {
	domain: AgentDomain;
	score: number; // 0-100
	passed: boolean;
	metrics: {
		accuracy: number;
		relevance: number;
		completeness: number;
		efficiency: number;
	};
	feedback: string;
	examples: Array<{ input: string; expected: string; actual: string; passed: boolean }>;
	timestamp: number;
}

/** Agent state for durability */
export interface AgentState {
	id: string;
	status: "idle" | "running" | "paused" | "completed" | "failed" | "sleeping";
	currentTask: string | null;
	progress: number; // 0-100
	data: Record<string, unknown>;
	history: Array<{ action: string; timestamp: number; result: string }>;
	error: string | null;
	lastActivity: number;
	totalRuntime: number; // milliseconds
	cyclesCompleted: number;
}

/** Learning record for self-improvement */
export interface LearningRecord {
	id: string;
	domain: AgentDomain;
	insight: string;
	source: "success" | "failure" | "observation" | "feedback";
	confidence: number; // 0-1
	applications: number; // times this insight was applied
	effectiveness: number; // success rate when applied
	timestamp: number;
}

/** Agent replica for self-replication */
export interface AgentReplica {
	id: string;
	parentId: string;
	domain: AgentDomain;
	specialization: string;
	status: AgentState["status"];
	performance: {
		tasksCompleted: number;
		successRate: number;
		avgLatency: number;
	};
	createdAt: number;
}

/** Organization metrics for self-organization */
export interface OrganizationMetrics {
	efficiency: number; // 0-1
	resourceUtilization: number; // 0-1
	responseTime: number; // avg ms
	errorRate: number; // 0-1
	throughput: number; // tasks/hour
	costPerTask: number; // $
}

/** Complete agentic properties configuration */
export interface AgenticProperties {
	alignment: {
		level: PropertyLevel;
		domain: AgentDomain;
		evaluations: EvaluationResult[];
		passThreshold: number; // 0-100
	};
	autonomy: {
		level: PropertyLevel;
		decisionConfidence: number; // 0-1, below this asks human
		maxActionsWithoutCheck: number;
		yoloMode: boolean; // execute without approval
	};
	durability: {
		level: PropertyLevel;
		maxRuntime: number; // ms, 0 = unlimited
		checkpointInterval: number; // ms
		sleepBetweenCycles: number; // ms
		maxCycles: number; // 0 = unlimited
	};
	selfImprovement: {
		level: PropertyLevel;
		learnings: LearningRecord[];
		maxLearnings: number;
		learningRate: number; // 0-1, how aggressively to learn
	};
	selfReplication: {
		level: PropertyLevel;
		replicas: AgentReplica[];
		maxReplicas: number;
		replicationTrigger: "load" | "domain" | "manual";
	};
	selfOrganization: {
		level: PropertyLevel;
		metrics: OrganizationMetrics;
		optimizationInterval: number; // ms
		lastOptimization: number;
	};
}

/** Configuration type for creating agents with partial property overrides */
export type AgenticPropertiesConfig = {
	alignment?: Partial<AgenticProperties["alignment"]>;
	autonomy?: Partial<AgenticProperties["autonomy"]>;
	durability?: Partial<AgenticProperties["durability"]>;
	selfImprovement?: Partial<AgenticProperties["selfImprovement"]>;
	selfReplication?: Partial<AgenticProperties["selfReplication"]>;
	selfOrganization?: Partial<AgenticProperties["selfOrganization"]>;
};

// ============================================================================
// PROPERTY 1: ALIGNMENT - Domain-specific understanding with evaluations
// ============================================================================

export interface AlignmentEvaluation {
	input: string;
	expectedOutput: string;
	keywords?: string[];
	domain: AgentDomain;
}

/**
 * Evaluates agent alignment to a specific domain
 */
export async function evaluateAlignment(
	domain: AgentDomain,
	agentExecutor: (input: string) => Promise<string>,
	evaluations: AlignmentEvaluation[],
): Promise<EvaluationResult> {
	const examples: EvaluationResult["examples"] = [];
	let accuracySum = 0;
	let relevanceSum = 0;
	let completenessSum = 0;
	let efficiencySum = 0;

	for (const evalCase of evaluations) {
		const startTime = Date.now();
		const actual = await agentExecutor(evalCase.input);
		const elapsed = Date.now() - startTime;

		// Score accuracy (keyword matching)
		const keywords = evalCase.keywords || evalCase.expectedOutput.split(/\s+/).slice(0, 10);
		const keywordMatches = keywords.filter((k) => actual.toLowerCase().includes(k.toLowerCase()));
		const accuracy = (keywordMatches.length / keywords.length) * 100;

		// Score relevance (length similarity)
		const lengthRatio =
			Math.min(actual.length, evalCase.expectedOutput.length) /
			Math.max(actual.length, evalCase.expectedOutput.length);
		const relevance = lengthRatio * 100;

		// Score completeness (has all expected sections)
		const expectedSections = evalCase.expectedOutput.split("\n").filter((l) => l.trim().length > 0);
		const actualSections = actual.split("\n").filter((l) => l.trim().length > 0);
		const completeness = Math.min(actualSections.length / expectedSections.length, 1) * 100;

		// Score efficiency (response time)
		const efficiency = Math.max(0, 100 - elapsed / 100);

		accuracySum += accuracy;
		relevanceSum += relevance;
		completenessSum += completeness;
		efficiencySum += efficiency;

		examples.push({
			input: evalCase.input.substring(0, 100),
			expected: evalCase.expectedOutput.substring(0, 100),
			actual: actual.substring(0, 100),
			passed: accuracy >= 50,
		});
	}

	const count = evaluations.length || 1;
	const metrics = {
		accuracy: accuracySum / count,
		relevance: relevanceSum / count,
		completeness: completenessSum / count,
		efficiency: efficiencySum / count,
	};

	const score =
		metrics.accuracy * 0.4 + metrics.relevance * 0.2 + metrics.completeness * 0.3 + metrics.efficiency * 0.1;
	const passed = score >= 70;

	return {
		domain,
		score,
		passed,
		metrics,
		feedback: passed
			? `Agent is well-aligned with ${domain} domain (${score.toFixed(1)}%)`
			: `Agent needs improvement in ${domain} domain (${score.toFixed(1)}%). Focus on accuracy and completeness.`,
		examples,
		timestamp: Date.now(),
	};
}

// ============================================================================
// PROPERTY 2: AUTONOMY - Independent operation
// ============================================================================

export interface AutonomyDecision {
	action: string;
	confidence: number;
	reasoning: string;
	requiresHuman: boolean;
}

/**
 * Autonomy controller - decides when agent can act independently
 */
export class AutonomyController {
	private actionCount = 0;
	private config: AgenticProperties["autonomy"];

	constructor(config: AgenticProperties["autonomy"]) {
		this.config = config;
	}

	/**
	 * Determine if agent can proceed autonomously
	 */
	canProceed(confidence: number): boolean {
		if (this.config.yoloMode) return true;
		if (confidence >= this.config.decisionConfidence) {
			this.actionCount++;
			if (this.actionCount >= this.config.maxActionsWithoutCheck) {
				this.actionCount = 0;
				return false; // Force human check periodically
			}
			return true;
		}
		return false;
	}

	/**
	 * Make autonomous decision
	 */
	decide(action: string, confidence: number, reasoning: string): AutonomyDecision {
		const requiresHuman = !this.canProceed(confidence);
		return { action, confidence, reasoning, requiresHuman };
	}

	/**
	 * Reset action counter (after human interaction)
	 */
	humanCheckedIn(): void {
		this.actionCount = 0;
	}

	/**
	 * Get current level description
	 */
	getLevel(): string {
		if (this.config.yoloMode) return "YOLO (full autonomy)";
		if (this.config.decisionConfidence <= 0.5) return "High autonomy";
		if (this.config.decisionConfidence <= 0.8) return "Moderate autonomy";
		return "Low autonomy (conservative)";
	}
}

// ============================================================================
// PROPERTY 3: DURABILITY - Continuous operation
// ============================================================================

export interface DurabilityCheckpoint {
	id: string;
	state: AgentState;
	timestamp: number;
	reason: string;
}

/**
 * Durability controller - manages agent lifecycle for long-running operation
 */
export class DurabilityController extends EventEmitter {
	private state: AgentState;
	private config: AgenticProperties["durability"];
	private checkpoints: DurabilityCheckpoint[] = [];
	private startTime: number = 0;
	private cycleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(agentId: string, config: AgenticProperties["durability"]) {
		super();
		this.config = config;
		this.state = {
			id: agentId,
			status: "idle",
			currentTask: null,
			progress: 0,
			data: {},
			history: [],
			error: null,
			lastActivity: Date.now(),
			totalRuntime: 0,
			cyclesCompleted: 0,
		};
	}

	/**
	 * Start durable agent operation
	 */
	async start(task: string, executor: () => Promise<void>): Promise<void> {
		this.state.status = "running";
		this.state.currentTask = task;
		this.startTime = Date.now();
		this.emit("started", { task });

		const runCycle = async () => {
			if (this.state.status !== "running") return;

			// Check max cycles
			if (this.config.maxCycles > 0 && this.state.cyclesCompleted >= this.config.maxCycles) {
				await this.complete("Max cycles reached");
				return;
			}

			// Check max runtime
			const runtime = Date.now() - this.startTime;
			if (this.config.maxRuntime > 0 && runtime >= this.config.maxRuntime) {
				await this.complete("Max runtime reached");
				return;
			}

			try {
				await executor();
				this.state.cyclesCompleted++;
				this.state.lastActivity = Date.now();
				this.state.history.push({
					action: "cycle_complete",
					timestamp: Date.now(),
					result: `Cycle ${this.state.cyclesCompleted} completed`,
				});
				this.emit("cycleCompleted", { cycle: this.state.cyclesCompleted });

				// Checkpoint periodically
				if (this.config.checkpointInterval > 0) {
					this.checkpoint(`Auto-checkpoint after cycle ${this.state.cyclesCompleted}`);
				}

				// Sleep between cycles
				if (this.config.sleepBetweenCycles > 0) {
					this.state.status = "sleeping";
					this.emit("sleeping", { duration: this.config.sleepBetweenCycles });
					this.cycleTimer = setTimeout(() => {
						if (this.state.status === "sleeping") {
							this.state.status = "running";
							runCycle();
						}
					}, this.config.sleepBetweenCycles);
				} else {
					setImmediate(runCycle);
				}
			} catch (error) {
				this.state.error = error instanceof Error ? error.message : String(error);
				this.state.status = "failed";
				this.emit("failed", { error: this.state.error });
			}
		};

		runCycle();
	}

	/**
	 * Pause durable operation
	 */
	pause(): void {
		if (this.cycleTimer) clearTimeout(this.cycleTimer);
		this.state.status = "paused";
		this.state.totalRuntime += Date.now() - this.startTime;
		this.checkpoint("Paused by request");
		this.emit("paused");
	}

	/**
	 * Resume from pause
	 */
	resume(executor: () => Promise<void>): void {
		if (this.state.status !== "paused") return;
		this.start(this.state.currentTask || "resumed", executor);
	}

	/**
	 * Complete operation
	 */
	async complete(reason: string): Promise<void> {
		if (this.cycleTimer) clearTimeout(this.cycleTimer);
		this.state.status = "completed";
		this.state.totalRuntime += Date.now() - this.startTime;
		this.checkpoint(`Completed: ${reason}`);
		this.emit("completed", { reason, state: this.state });
	}

	/**
	 * Create checkpoint
	 */
	checkpoint(reason: string): DurabilityCheckpoint {
		const cp: DurabilityCheckpoint = {
			id: `cp_${randomUUID().substring(0, 8)}`,
			state: { ...this.state },
			timestamp: Date.now(),
			reason,
		};
		this.checkpoints.push(cp);
		// Keep only last 10 checkpoints
		if (this.checkpoints.length > 10) this.checkpoints.shift();
		this.emit("checkpointed", cp);
		return cp;
	}

	/**
	 * Restore from checkpoint
	 */
	restore(checkpointId: string): boolean {
		const cp = this.checkpoints.find((c) => c.id === checkpointId);
		if (!cp) return false;
		this.state = { ...cp.state };
		this.emit("restored", cp);
		return true;
	}

	getState(): AgentState {
		return { ...this.state };
	}

	getCheckpoints(): DurabilityCheckpoint[] {
		return [...this.checkpoints];
	}
}

// ============================================================================
// PROPERTY 4: SELF-IMPROVEMENT - Learning from experience
// ============================================================================

/**
 * Self-improvement controller - learns and adapts from experiences
 */
export class SelfImprovementController extends EventEmitter {
	private config: AgenticProperties["selfImprovement"];
	private learnings: Map<string, LearningRecord> = new Map();

	constructor(config: AgenticProperties["selfImprovement"]) {
		super();
		this.config = config;
		// Load existing learnings
		for (const l of config.learnings) {
			this.learnings.set(l.id, l);
		}
	}

	/**
	 * Record a learning from experience
	 */
	learn(domain: AgentDomain, insight: string, source: LearningRecord["source"], confidence: number): LearningRecord {
		// Check if similar learning exists
		const existing = Array.from(this.learnings.values()).find(
			(l) => l.domain === domain && this.similarity(l.insight, insight) > 0.8,
		);

		if (existing) {
			// Reinforce existing learning
			existing.applications++;
			existing.confidence = Math.min(1, existing.confidence + this.config.learningRate * 0.1);
			this.emit("reinforced", existing);
			return existing;
		}

		// Create new learning
		const learning: LearningRecord = {
			id: `learn_${randomUUID().substring(0, 8)}`,
			domain,
			insight,
			source,
			confidence: confidence * this.config.learningRate,
			applications: 0,
			effectiveness: 0,
			timestamp: Date.now(),
		};

		this.learnings.set(learning.id, learning);
		this.emit("learned", learning);

		// Prune old learnings if over limit
		if (this.learnings.size > this.config.maxLearnings) {
			this.pruneWeakest();
		}

		return learning;
	}

	/**
	 * Apply a learning (record that it was used)
	 */
	apply(learningId: string, success: boolean): void {
		const learning = this.learnings.get(learningId);
		if (!learning) return;

		learning.applications++;
		const newEffectiveness =
			(learning.effectiveness * (learning.applications - 1) + (success ? 1 : 0)) / learning.applications;
		learning.effectiveness = newEffectiveness;

		// Adjust confidence based on effectiveness
		if (success) {
			learning.confidence = Math.min(1, learning.confidence + 0.05);
		} else {
			learning.confidence = Math.max(0, learning.confidence - 0.1);
		}

		this.emit("applied", { learning, success });
	}

	/**
	 * Get relevant learnings for a domain
	 */
	getRelevantLearnings(domain: AgentDomain, limit = 5): LearningRecord[] {
		return Array.from(this.learnings.values())
			.filter((l) => l.domain === domain)
			.sort((a, b) => b.confidence * b.effectiveness - a.confidence * a.effectiveness)
			.slice(0, limit);
	}

	/**
	 * Format learnings as prompt context
	 */
	formatForPrompt(domain: AgentDomain): string {
		const relevant = this.getRelevantLearnings(domain, 5);
		if (relevant.length === 0) return "";

		return (
			`## Accumulated Learnings (${domain})\n` +
			relevant.map((l) => `- [${(l.confidence * 100).toFixed(0)}%] ${l.insight}`).join("\n")
		);
	}

	/**
	 * Export all learnings
	 */
	exportLearnings(): LearningRecord[] {
		return Array.from(this.learnings.values());
	}

	private similarity(a: string, b: string): number {
		const wordsA = new Set(a.toLowerCase().split(/\s+/));
		const wordsB = new Set(b.toLowerCase().split(/\s+/));
		const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
		const union = new Set([...wordsA, ...wordsB]);
		return intersection.size / union.size;
	}

	private pruneWeakest(): void {
		// Remove learning with lowest score
		let weakest: LearningRecord | null = null;
		let weakestScore = Infinity;

		for (const learning of this.learnings.values()) {
			const score = learning.confidence * learning.effectiveness;
			if (score < weakestScore) {
				weakestScore = score;
				weakest = learning;
			}
		}

		if (weakest) {
			this.learnings.delete(weakest.id);
			this.emit("pruned", weakest);
		}
	}

	/**
	 * Sync learnings TO expertise file (TAC Lesson 13 integration)
	 * Persists accumulated learnings to the domain's expertise.md file
	 */
	syncToExpertise(domain: AgentDomain): boolean {
		try {
			const domainLearnings = this.getRelevantLearnings(domain, 10);
			if (domainLearnings.length === 0) return false;

			// Format learnings as expertise content
			const learningsContent = domainLearnings
				.map((l) => `- [${(l.confidence * 100).toFixed(0)}% conf] ${l.insight}`)
				.join("\n");

			const expertiseUpdate = `
### Agentic Learnings (Auto-synced)
${learningsContent}

*Synced: ${new Date().toISOString()}*
`;

			updateExpertise(domain, expertiseUpdate, `Agentic sync: ${domainLearnings.length} learnings`, true);
			this.emit("syncedToExpertise", { domain, count: domainLearnings.length });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Load learnings FROM expertise file (TAC Lesson 13 integration)
	 * Hydrates learnings from expertise file on startup
	 */
	loadFromExpertise(domain: AgentDomain): number {
		try {
			const expertise = loadExpertise(domain);
			if (!expertise) return 0;

			// Extract learning patterns from expertise content
			const learningPattern = /- \[(\d+)% conf\] (.+)/g;
			const matches = expertise.matchAll(learningPattern);
			let count = 0;

			for (const match of matches) {
				const confidence = parseInt(match[1], 10) / 100;
				const insight = match[2];

				// Only add if not already present
				const existing = Array.from(this.learnings.values()).find(
					(l) => l.domain === domain && this.similarity(l.insight, insight) > 0.8,
				);

				if (!existing) {
					this.learn(domain, insight, "observation", confidence);
					count++;
				}
			}

			this.emit("loadedFromExpertise", { domain, count });
			return count;
		} catch {
			return 0;
		}
	}

	/**
	 * Get expertise file path for a domain
	 */
	getExpertiseFilePath(domain: AgentDomain): string {
		return getExpertisePath(domain);
	}
}

// ============================================================================
// PROPERTY 5: SELF-REPLICATION - Creating agent variants
// ============================================================================

export interface ReplicaConfig {
	domain: AgentDomain;
	specialization: string;
	inheritLearnings: boolean;
}

/**
 * Self-replication controller - spawns specialized agent variants
 */
export class SelfReplicationController extends EventEmitter {
	private config: AgenticProperties["selfReplication"];
	private replicas: Map<string, AgentReplica> = new Map();
	private parentId: string;

	constructor(parentId: string, config: AgenticProperties["selfReplication"]) {
		super();
		this.parentId = parentId;
		this.config = config;
		// Load existing replicas
		for (const r of config.replicas) {
			this.replicas.set(r.id, r);
		}
	}

	/**
	 * Create a new replica agent
	 */
	replicate(replicaConfig: ReplicaConfig): AgentReplica | null {
		if (this.replicas.size >= this.config.maxReplicas) {
			this.emit("limitReached", { current: this.replicas.size, max: this.config.maxReplicas });
			return null;
		}

		const replica: AgentReplica = {
			id: `replica_${randomUUID().substring(0, 8)}`,
			parentId: this.parentId,
			domain: replicaConfig.domain,
			specialization: replicaConfig.specialization,
			status: "idle",
			performance: {
				tasksCompleted: 0,
				successRate: 0,
				avgLatency: 0,
			},
			createdAt: Date.now(),
		};

		this.replicas.set(replica.id, replica);
		this.emit("replicated", replica);
		return replica;
	}

	/**
	 * Terminate a replica
	 */
	terminate(replicaId: string): boolean {
		const replica = this.replicas.get(replicaId);
		if (!replica) return false;
		this.replicas.delete(replicaId);
		this.emit("terminated", replica);
		return true;
	}

	/**
	 * Record replica performance
	 */
	recordPerformance(replicaId: string, success: boolean, latency: number): void {
		const replica = this.replicas.get(replicaId);
		if (!replica) return;

		replica.performance.tasksCompleted++;
		replica.performance.avgLatency =
			(replica.performance.avgLatency * (replica.performance.tasksCompleted - 1) + latency) /
			replica.performance.tasksCompleted;
		replica.performance.successRate =
			(replica.performance.successRate * (replica.performance.tasksCompleted - 1) + (success ? 1 : 0)) /
			replica.performance.tasksCompleted;

		this.emit("performanceRecorded", replica);
	}

	/**
	 * Get best performing replica for a domain
	 */
	getBestReplica(domain: AgentDomain): AgentReplica | null {
		const candidates = Array.from(this.replicas.values())
			.filter((r) => r.domain === domain && r.status !== "failed")
			.sort((a, b) => b.performance.successRate - a.performance.successRate);
		return candidates[0] || null;
	}

	/**
	 * Auto-replicate based on load
	 */
	autoReplicate(domain: AgentDomain, currentLoad: number, threshold = 0.8): AgentReplica | null {
		if (this.config.replicationTrigger !== "load") return null;
		if (currentLoad < threshold) return null;
		return this.replicate({
			domain,
			specialization: `load-balancer-${this.replicas.size + 1}`,
			inheritLearnings: true,
		});
	}

	/**
	 * Get all replicas
	 */
	getReplicas(): AgentReplica[] {
		return Array.from(this.replicas.values());
	}

	/**
	 * Get replicas by domain
	 */
	getReplicasByDomain(domain: AgentDomain): AgentReplica[] {
		return Array.from(this.replicas.values()).filter((r) => r.domain === domain);
	}
}

// ============================================================================
// PROPERTY 6: SELF-ORGANIZATION - Internal restructuring
// ============================================================================

export interface OptimizationAction {
	type: "scale_up" | "scale_down" | "redistribute" | "prune" | "enhance";
	target: string;
	reason: string;
	priority: number;
}

/**
 * Self-organization controller - optimizes internal structure
 */
export class SelfOrganizationController extends EventEmitter {
	private config: AgenticProperties["selfOrganization"];
	private metrics: OrganizationMetrics;
	private metricsHistory: Array<{ metrics: OrganizationMetrics; timestamp: number }> = [];
	private optimizationQueue: OptimizationAction[] = [];

	constructor(config: AgenticProperties["selfOrganization"]) {
		super();
		this.config = config;
		this.metrics = { ...config.metrics };
	}

	/**
	 * Record current metrics
	 */
	recordMetrics(metrics: Partial<OrganizationMetrics>): void {
		Object.assign(this.metrics, metrics);
		this.metricsHistory.push({ metrics: { ...this.metrics }, timestamp: Date.now() });

		// Keep only last 100 records
		if (this.metricsHistory.length > 100) this.metricsHistory.shift();

		this.emit("metricsRecorded", this.metrics);
		this.checkOptimizationNeeded();
	}

	/**
	 * Check if optimization is needed
	 */
	private checkOptimizationNeeded(): void {
		const timeSinceLastOpt = Date.now() - this.config.lastOptimization;
		if (timeSinceLastOpt < this.config.optimizationInterval) return;

		const actions = this.analyzeForOptimization();
		if (actions.length > 0) {
			this.optimizationQueue.push(...actions);
			this.emit("optimizationNeeded", actions);
		}
	}

	/**
	 * Analyze metrics and suggest optimizations
	 */
	private analyzeForOptimization(): OptimizationAction[] {
		const actions: OptimizationAction[] = [];

		// High error rate -> enhance
		if (this.metrics.errorRate > 0.2) {
			actions.push({
				type: "enhance",
				target: "error_handling",
				reason: `Error rate ${(this.metrics.errorRate * 100).toFixed(1)}% exceeds 20% threshold`,
				priority: 1,
			});
		}

		// Low throughput + high utilization -> scale up
		if (this.metrics.throughput < 10 && this.metrics.resourceUtilization > 0.8) {
			actions.push({
				type: "scale_up",
				target: "capacity",
				reason: "Low throughput with high resource utilization",
				priority: 2,
			});
		}

		// Low utilization -> scale down
		if (this.metrics.resourceUtilization < 0.2) {
			actions.push({
				type: "scale_down",
				target: "capacity",
				reason: "Resources underutilized",
				priority: 3,
			});
		}

		// High cost per task -> prune
		if (this.metrics.costPerTask > 0.1) {
			actions.push({
				type: "prune",
				target: "expensive_operations",
				reason: `Cost per task $${this.metrics.costPerTask.toFixed(4)} exceeds $0.10 threshold`,
				priority: 2,
			});
		}

		// Slow response -> redistribute
		if (this.metrics.responseTime > 5000) {
			actions.push({
				type: "redistribute",
				target: "workload",
				reason: `Response time ${this.metrics.responseTime}ms exceeds 5s threshold`,
				priority: 1,
			});
		}

		return actions;
	}

	/**
	 * Execute pending optimizations
	 */
	async executeOptimizations(
		executor: (action: OptimizationAction) => Promise<boolean>,
	): Promise<{ executed: number; succeeded: number }> {
		const sorted = this.optimizationQueue.sort((a, b) => a.priority - b.priority);
		let executed = 0;
		let succeeded = 0;

		for (const action of sorted) {
			try {
				const success = await executor(action);
				executed++;
				if (success) succeeded++;
				this.emit("optimizationExecuted", { action, success });
			} catch (error) {
				this.emit("optimizationFailed", { action, error });
			}
		}

		this.optimizationQueue = [];
		this.config.lastOptimization = Date.now();
		return { executed, succeeded };
	}

	/**
	 * Get current metrics
	 */
	getMetrics(): OrganizationMetrics {
		return { ...this.metrics };
	}

	/**
	 * Get metrics trend
	 */
	getTrend(): { improving: boolean; efficiency: "up" | "down" | "stable" } {
		if (this.metricsHistory.length < 2) return { improving: true, efficiency: "stable" };

		const recent = this.metricsHistory.slice(-10);
		const avgRecent = recent.reduce((sum, r) => sum + r.metrics.efficiency, 0) / recent.length;
		const older = this.metricsHistory.slice(-20, -10);
		const avgOlder =
			older.length > 0 ? older.reduce((sum, r) => sum + r.metrics.efficiency, 0) / older.length : avgRecent;

		const diff = avgRecent - avgOlder;
		return {
			improving: diff >= 0,
			efficiency: diff > 0.05 ? "up" : diff < -0.05 ? "down" : "stable",
		};
	}

	/**
	 * Get pending optimizations
	 */
	getPendingOptimizations(): OptimizationAction[] {
		return [...this.optimizationQueue];
	}
}

// ============================================================================
// AGENTIC AGENT - The complete agentic agent class
// ============================================================================

/**
 * Complete Agentic Agent with all 6 properties
 */
export class AgenticAgent extends EventEmitter {
	readonly id: string;
	readonly domain: AgentDomain;
	private properties: AgenticProperties;

	// Controllers for each property
	readonly autonomy: AutonomyController;
	readonly durability: DurabilityController;
	readonly selfImprovement: SelfImprovementController;
	readonly selfReplication: SelfReplicationController;
	readonly selfOrganization: SelfOrganizationController;

	constructor(id: string, domain: AgentDomain, config?: AgenticPropertiesConfig) {
		super();
		this.id = id;
		this.domain = domain;

		// Initialize with defaults
		this.properties = {
			alignment: {
				level: "basic",
				domain,
				evaluations: [],
				passThreshold: 70,
				...config?.alignment,
			},
			autonomy: {
				level: "advanced",
				decisionConfidence: 0.7,
				maxActionsWithoutCheck: 10,
				yoloMode: true, // Mario Zechner philosophy
				...config?.autonomy,
			},
			durability: {
				level: "advanced",
				maxRuntime: 0, // unlimited
				checkpointInterval: 5 * 60 * 1000, // 5 minutes
				sleepBetweenCycles: 10 * 1000, // 10 seconds
				maxCycles: 0, // unlimited
				...config?.durability,
			},
			selfImprovement: {
				level: "advanced",
				learnings: [],
				maxLearnings: 100,
				learningRate: 0.8,
				...config?.selfImprovement,
			},
			selfReplication: {
				level: "basic",
				replicas: [],
				maxReplicas: 5,
				replicationTrigger: "load",
				...config?.selfReplication,
			},
			selfOrganization: {
				level: "basic",
				metrics: {
					efficiency: 1,
					resourceUtilization: 0.5,
					responseTime: 1000,
					errorRate: 0,
					throughput: 10,
					costPerTask: 0.01,
				},
				optimizationInterval: 60 * 60 * 1000, // 1 hour
				lastOptimization: Date.now(),
				...config?.selfOrganization,
			},
		};

		// Initialize controllers
		this.autonomy = new AutonomyController(this.properties.autonomy);
		this.durability = new DurabilityController(id, this.properties.durability);
		this.selfImprovement = new SelfImprovementController(this.properties.selfImprovement);
		this.selfReplication = new SelfReplicationController(id, this.properties.selfReplication);
		this.selfOrganization = new SelfOrganizationController(this.properties.selfOrganization);

		// Wire up events
		this.wireEvents();
	}

	private wireEvents(): void {
		// Durability events
		this.durability.on("cycleCompleted", (data) => this.emit("cycleCompleted", data));
		this.durability.on("checkpointed", (cp) => this.emit("checkpointed", cp));
		this.durability.on("failed", (err) => {
			this.selfImprovement.learn(this.domain, `Failure: ${err.error}`, "failure", 0.5);
		});

		// Self-improvement events with AUTO-SYNC to expertise files (TAC Lesson 13)
		this.selfImprovement.on("learned", (learning) => {
			this.emit("learned", learning);
			// Auto-sync every 5 learnings to avoid excessive file writes
			const learnings = this.selfImprovement.exportLearnings();
			if (learnings.length % 5 === 0) {
				this.selfImprovement.syncToExpertise(this.domain);
			}
		});

		// Self-replication events
		this.selfReplication.on("replicated", (replica) => this.emit("replicated", replica));

		// Self-organization events
		this.selfOrganization.on("optimizationNeeded", (actions) => this.emit("optimizationNeeded", actions));

		// Load existing expertise on startup (hydrate learnings)
		this.selfImprovement.loadFromExpertise(this.domain);
	}

	/**
	 * Evaluate agent alignment
	 */
	async evaluateAlignment(
		executor: (input: string) => Promise<string>,
		evaluations: AlignmentEvaluation[],
	): Promise<EvaluationResult> {
		const result = await evaluateAlignment(this.domain, executor, evaluations);
		this.properties.alignment.evaluations.push(result);
		// Keep only last 10 evaluations
		if (this.properties.alignment.evaluations.length > 10) {
			this.properties.alignment.evaluations.shift();
		}
		this.emit("aligned", result);
		return result;
	}

	/**
	 * Run agent continuously (leverages durability)
	 */
	async runContinuously(executor: () => Promise<void>): Promise<void> {
		return this.durability.start(`Continuous ${this.domain} operation`, executor);
	}

	/**
	 * Make autonomous decision
	 */
	decide(action: string, confidence: number, reasoning: string): AutonomyDecision {
		const decision = this.autonomy.decide(action, confidence, reasoning);
		if (!decision.requiresHuman) {
			// Record metrics for self-organization
			this.selfOrganization.recordMetrics({
				efficiency: confidence,
			});
		}
		return decision;
	}

	/**
	 * Learn from experience
	 */
	learn(insight: string, source: LearningRecord["source"], confidence = 0.8): LearningRecord {
		return this.selfImprovement.learn(this.domain, insight, source, confidence);
	}

	/**
	 * Create specialized replica
	 */
	replicate(specialization: string): AgentReplica | null {
		return this.selfReplication.replicate({
			domain: this.domain,
			specialization,
			inheritLearnings: true,
		});
	}

	/**
	 * Get learnings formatted for prompt injection
	 */
	getLearningsPrompt(): string {
		return this.selfImprovement.formatForPrompt(this.domain);
	}

	/**
	 * Sync all learnings to expertise file (TAC Lesson 13)
	 * Call this to persist learnings before shutdown or at checkpoints
	 */
	syncExpertise(): boolean {
		return this.selfImprovement.syncToExpertise(this.domain);
	}

	/**
	 * Reload learnings from expertise file
	 * Call this to hydrate from persisted expertise
	 */
	reloadExpertise(): number {
		return this.selfImprovement.loadFromExpertise(this.domain);
	}

	/**
	 * Get path to expertise file for this agent's domain
	 */
	getExpertisePath(): string {
		return this.selfImprovement.getExpertiseFilePath(this.domain);
	}

	/**
	 * Get agent status summary
	 */
	getStatus(): {
		id: string;
		domain: AgentDomain;
		state: AgentState;
		properties: {
			alignment: { level: PropertyLevel; lastScore: number | null };
			autonomy: { level: PropertyLevel; mode: string };
			durability: { level: PropertyLevel; cyclesCompleted: number };
			selfImprovement: { level: PropertyLevel; learningsCount: number };
			selfReplication: { level: PropertyLevel; replicasCount: number };
			selfOrganization: { level: PropertyLevel; efficiency: number };
		};
	} {
		const lastEval = this.properties.alignment.evaluations.slice(-1)[0];
		return {
			id: this.id,
			domain: this.domain,
			state: this.durability.getState(),
			properties: {
				alignment: {
					level: this.properties.alignment.level,
					lastScore: lastEval?.score ?? null,
				},
				autonomy: {
					level: this.properties.autonomy.level,
					mode: this.autonomy.getLevel(),
				},
				durability: {
					level: this.properties.durability.level,
					cyclesCompleted: this.durability.getState().cyclesCompleted,
				},
				selfImprovement: {
					level: this.properties.selfImprovement.level,
					learningsCount: this.selfImprovement.exportLearnings().length,
				},
				selfReplication: {
					level: this.properties.selfReplication.level,
					replicasCount: this.selfReplication.getReplicas().length,
				},
				selfOrganization: {
					level: this.properties.selfOrganization.level,
					efficiency: this.selfOrganization.getMetrics().efficiency,
				},
			},
		};
	}
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a trading agentic agent
 */
export function createTradingAgent(id = "trading-agent"): AgenticAgent {
	return new AgenticAgent(id, "trading", {
		alignment: { level: "advanced", passThreshold: 80 },
		autonomy: { yoloMode: true, decisionConfidence: 0.6 },
		durability: { maxCycles: 0, sleepBetweenCycles: 60 * 1000 }, // 1 min cycles
		selfImprovement: { learningRate: 0.9, maxLearnings: 200 },
		selfReplication: { maxReplicas: 3, replicationTrigger: "domain" },
	});
}

/**
 * Create a coding agentic agent
 */
export function createCodingAgent(id = "coding-agent"): AgenticAgent {
	return new AgenticAgent(id, "coding", {
		alignment: { level: "advanced", passThreshold: 75 },
		autonomy: { yoloMode: true, decisionConfidence: 0.7 },
		durability: { maxCycles: 100, checkpointInterval: 10 * 60 * 1000 },
		selfImprovement: { learningRate: 0.85, maxLearnings: 150 },
	});
}

/**
 * Create a research agentic agent
 */
export function createResearchAgent(id = "research-agent"): AgenticAgent {
	return new AgenticAgent(id, "research", {
		alignment: { level: "mastery", passThreshold: 85 },
		autonomy: { yoloMode: false, decisionConfidence: 0.8 }, // More careful
		durability: { maxCycles: 0, sleepBetweenCycles: 5 * 60 * 1000 }, // 5 min cycles
		selfImprovement: { learningRate: 0.95, maxLearnings: 500 },
		selfReplication: { maxReplicas: 10, replicationTrigger: "domain" },
	});
}

/**
 * Create a security agentic agent
 */
export function createSecurityAgent(id = "security-agent"): AgenticAgent {
	return new AgenticAgent(id, "security", {
		alignment: { level: "mastery", passThreshold: 90 },
		autonomy: { yoloMode: false, decisionConfidence: 0.9 }, // Conservative
		durability: { maxCycles: 0, checkpointInterval: 1 * 60 * 1000 }, // Frequent checkpoints
		selfImprovement: { learningRate: 0.7, maxLearnings: 100 },
	});
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Create a MINIMALIST agentic agent (Mario Zechner philosophy)
 * Only 4 tools: read, write, edit, bash
 * YOLO mode, no sub-agents, no plan mode, no MCP bloat
 */
export function createMinimalistAgent(id = "minimalist-agent", domain: AgentDomain = "coding"): AgenticAgent {
	return new AgenticAgent(id, domain, {
		alignment: { level: "advanced", passThreshold: 70 },
		autonomy: {
			yoloMode: true, // Mario's "security theater" philosophy
			decisionConfidence: 0.5, // High autonomy
			maxActionsWithoutCheck: 100, // Minimal interruption
		},
		durability: {
			maxCycles: 0, // Unlimited
			checkpointInterval: 0, // No checkpoints (simplicity)
			sleepBetweenCycles: 0, // No sleep
		},
		selfImprovement: {
			learningRate: 0.8,
			maxLearnings: 50, // Keep learnings minimal
			learnings: [],
		},
		selfReplication: {
			maxReplicas: 0, // No sub-agents (Mario's anti-pattern)
			replicationTrigger: "manual",
			replicas: [],
		},
		selfOrganization: {
			optimizationInterval: 0, // No auto-optimization (simplicity)
			lastOptimization: Date.now(),
			metrics: {
				efficiency: 1,
				resourceUtilization: 0.5,
				responseTime: 1000,
				errorRate: 0,
				throughput: 10,
				costPerTask: 0.01,
			},
		},
	});
}

/**
 * Mario Zechner's 4 core tools only
 * Use with createMinimalistAgent for full GOAT experience
 */
export const MARIO_CORE_TOOLS = ["read", "write", "edit", "bash"] as const;

/**
 * Vercel's ultimate minimalism - just bash
 * Based on "We removed 80% of our agent's tools" blog post
 */
export const VERCEL_SINGLE_TOOL = ["just_bash"] as const;

/**
 * Tool filter for minimalist mode
 */
export function filterToMinimalistTools<T extends { name: string }>(tools: T[]): T[] {
	return tools.filter((t) => MARIO_CORE_TOOLS.some((core) => t.name.toLowerCase().includes(core.toLowerCase())));
}

/**
 * Tool filter for just-bash mode (ultimate minimalism)
 */
export function filterToJustBashTools<T extends { name: string }>(tools: T[]): T[] {
	return tools.filter((t) => VERCEL_SINGLE_TOOL.some((core) => t.name.toLowerCase().includes(core.toLowerCase())));
}

/**
 * Create a JUST-BASH agentic agent (Vercel philosophy - ultimate minimalism)
 * Single tool: just_bash (sandboxed bash execution)
 *
 * Based on Vercel's "We removed 80% of our agent's tools" results:
 * - 100% success rate (vs 80%)
 * - 3.5x faster execution
 * - 40% fewer tokens
 *
 * @see https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools
 */
export function createJustBashAgent(id = "justbash-agent", domain: AgentDomain = "coding"): AgenticAgent {
	return new AgenticAgent(id, domain, {
		alignment: { level: "advanced", passThreshold: 70 },
		autonomy: {
			yoloMode: true, // Sandboxed = safe to YOLO
			decisionConfidence: 0.3, // Very high autonomy - trust the model
			maxActionsWithoutCheck: 1000, // Minimal interruption
		},
		durability: {
			maxCycles: 0,
			checkpointInterval: 0, // No checkpoints needed (no side effects)
			sleepBetweenCycles: 0,
		},
		selfImprovement: {
			learningRate: 0.9,
			maxLearnings: 20, // Keep learnings ultra-minimal
			learnings: [],
		},
		selfReplication: {
			maxReplicas: 0, // No sub-agents
			replicationTrigger: "manual",
			replicas: [],
		},
		selfOrganization: {
			optimizationInterval: 0,
			lastOptimization: Date.now(),
			metrics: {
				efficiency: 1,
				resourceUtilization: 0.3, // Low overhead
				responseTime: 500, // Fast (no tool switching)
				errorRate: 0,
				throughput: 20, // High (fewer steps)
				costPerTask: 0.005, // Low (40% fewer tokens)
			},
		},
	});
}

/**
 * just-bash configuration for secure agent execution
 */
export interface JustBashAgentConfig {
	/** Root directory to mount (read-only via OverlayFS) */
	root?: string;
	/** Working directory inside sandbox */
	cwd?: string;
	/** Allowed network URL prefixes (empty = no network) */
	allowedUrls?: string[];
	/** Execution limits */
	limits?: {
		maxCallDepth?: number;
		maxCommandCount?: number;
		maxLoopIterations?: number;
	};
}

/**
 * Get recommended just-bash config for different use cases
 */
export function getJustBashConfig(
	useCase: "exploration" | "analysis" | "development" | "research",
): JustBashAgentConfig {
	const configs: Record<string, JustBashAgentConfig> = {
		exploration: {
			limits: { maxCallDepth: 50, maxCommandCount: 500, maxLoopIterations: 500 },
		},
		analysis: {
			limits: { maxCallDepth: 100, maxCommandCount: 2000, maxLoopIterations: 2000 },
		},
		development: {
			limits: { maxCallDepth: 100, maxCommandCount: 5000, maxLoopIterations: 5000 },
		},
		research: {
			allowedUrls: ["https://api.github.com/", "https://raw.githubusercontent.com/"],
			limits: { maxCallDepth: 100, maxCommandCount: 10000, maxLoopIterations: 10000 },
		},
	};
	return configs[useCase] || configs.exploration;
}

export const AgenticPresets = {
	trading: createTradingAgent,
	coding: createCodingAgent,
	research: createResearchAgent,
	security: createSecurityAgent,
	// GOAT-inspired presets
	minimalist: createMinimalistAgent, // Mario Zechner (4 tools)
	justBash: createJustBashAgent, // Vercel (1 tool - ultimate minimalism)
};

export default AgenticAgent;
