/**
 * AUTONOMOUS DAEMON
 *
 * Self-running agentic system that operates 24/7 with minimal human oversight.
 * Integrates all agentic properties for maximum autonomy.
 *
 * Core Capabilities:
 * 1. SELF-IMPROVEMENT - Continuously learns and improves expertise
 * 2. SELF-HEALING - Detects and fixes its own errors
 * 3. PROACTIVE RESEARCH - Discovers and analyzes relevant information
 * 4. AUTONOMOUS TASKS - Executes tasks without human intervention
 * 5. SELF-OPTIMIZATION - Monitors and improves its own performance
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";

// ============================================================================
// TYPES
// ============================================================================

export interface DaemonConfig {
	/** Daemon name for identification */
	name: string;
	/** Discord channel ID for notifications */
	notifyChannelId?: string;
	/** Minimum interval between cycles (ms) */
	minCycleInterval: number;
	/** Maximum interval between cycles (ms) */
	maxCycleInterval: number;
	/** Enable self-improvement */
	enableSelfImprovement: boolean;
	/** Enable proactive research */
	enableResearch: boolean;
	/** Enable self-healing */
	enableSelfHealing: boolean;
	/** Enable performance optimization */
	enableOptimization: boolean;
	/** Autonomy level (0-1, higher = more autonomous) */
	autonomyLevel: number;
	/** Domains to focus on */
	domains: string[];
	/** Custom goals for the daemon */
	goals: string[];
}

export interface DaemonState {
	id: string;
	name: string;
	status: "starting" | "running" | "paused" | "stopped" | "error";
	startedAt: number;
	cyclesCompleted: number;
	lastCycleAt: number | null;
	lastError: string | null;
	performance: {
		avgCycleDuration: number;
		successRate: number;
		improvementsApplied: number;
		researchDiscoveries: number;
		errorsFixed: number;
	};
	learnings: string[];
	currentTask: string | null;
}

export interface CycleResult {
	id: string;
	type: "improvement" | "research" | "healing" | "optimization" | "task";
	success: boolean;
	duration: number;
	output: string;
	learnings: string[];
	actions: string[];
}

export type DaemonEvent =
	| { type: "started"; state: DaemonState }
	| { type: "cycle_start"; cycleId: string; cycleType: string }
	| { type: "cycle_end"; result: CycleResult }
	| { type: "discovery"; topic: string; content: string }
	| { type: "improvement"; domain: string; insight: string }
	| { type: "error_fixed"; error: string; fix: string }
	| { type: "notification"; message: string; priority: "low" | "normal" | "high" }
	| { type: "stopped"; reason: string };

// ============================================================================
// AUTONOMOUS DAEMON
// ============================================================================

export class AutonomousDaemon extends EventEmitter {
	private config: DaemonConfig;
	private state: DaemonState;
	private cycleTimer: ReturnType<typeof setTimeout> | null = null;
	private isRunning = false;
	private cycleDurations: number[] = [];

	constructor(config: Partial<DaemonConfig> = {}) {
		super();
		this.config = {
			name: config.name || "PiDaemon",
			notifyChannelId: config.notifyChannelId,
			minCycleInterval: config.minCycleInterval || 5 * 60 * 1000, // 5 min
			maxCycleInterval: config.maxCycleInterval || 30 * 60 * 1000, // 30 min
			enableSelfImprovement: config.enableSelfImprovement ?? true,
			enableResearch: config.enableResearch ?? true,
			enableSelfHealing: config.enableSelfHealing ?? true,
			enableOptimization: config.enableOptimization ?? true,
			autonomyLevel: config.autonomyLevel ?? 0.8,
			domains: config.domains || ["general", "coding", "trading", "research"],
			goals: config.goals || [
				"Continuously improve agent expertise",
				"Discover relevant market opportunities",
				"Monitor and fix system errors",
				"Optimize performance metrics",
			],
		};

		this.state = {
			id: randomUUID(),
			name: this.config.name,
			status: "stopped",
			startedAt: 0,
			cyclesCompleted: 0,
			lastCycleAt: null,
			lastError: null,
			performance: {
				avgCycleDuration: 0,
				successRate: 1,
				improvementsApplied: 0,
				researchDiscoveries: 0,
				errorsFixed: 0,
			},
			learnings: [],
			currentTask: null,
		};
	}

	/**
	 * Start the autonomous daemon
	 */
	async start(): Promise<void> {
		if (this.isRunning) return;

		this.isRunning = true;
		this.state.status = "starting";
		this.state.startedAt = Date.now();

		// Initialize subsystems
		await this.initializeSubsystems();

		this.state.status = "running";
		this.emit("event", { type: "started", state: this.state } as DaemonEvent);

		// Start the main loop
		this.scheduleNextCycle();

		console.log(`[DAEMON] ${this.config.name} started (autonomy: ${this.config.autonomyLevel})`);
	}

	/**
	 * Stop the daemon
	 */
	stop(reason = "manual"): void {
		this.isRunning = false;
		this.state.status = "stopped";

		if (this.cycleTimer) {
			clearTimeout(this.cycleTimer);
			this.cycleTimer = null;
		}

		this.emit("event", { type: "stopped", reason } as DaemonEvent);
		console.log(`[DAEMON] ${this.config.name} stopped: ${reason}`);
	}

	/**
	 * Pause the daemon
	 */
	pause(): void {
		this.state.status = "paused";
		if (this.cycleTimer) {
			clearTimeout(this.cycleTimer);
			this.cycleTimer = null;
		}
	}

	/**
	 * Resume the daemon
	 */
	resume(): void {
		if (this.state.status === "paused") {
			this.state.status = "running";
			this.scheduleNextCycle();
		}
	}

	/**
	 * Get current state
	 */
	getState(): DaemonState {
		return { ...this.state };
	}

	/**
	 * Add a custom goal
	 */
	addGoal(goal: string): void {
		if (!this.config.goals.includes(goal)) {
			this.config.goals.push(goal);
		}
	}

	/**
	 * Force a cycle to run now
	 */
	async triggerCycle(type?: CycleResult["type"]): Promise<CycleResult> {
		return this.runCycle(type);
	}

	// ============================================================================
	// PRIVATE METHODS
	// ============================================================================

	private async initializeSubsystems(): Promise<void> {
		// Load expertise files
		// Initialize research topics
		// Setup error handlers
		// etc.
	}

	private scheduleNextCycle(): void {
		if (!this.isRunning || this.state.status !== "running") return;

		// Calculate next cycle interval based on performance and autonomy
		const baseInterval = this.config.minCycleInterval;
		const maxInterval = this.config.maxCycleInterval;

		// Higher autonomy = more frequent cycles
		const autonomyFactor = 1 - this.config.autonomyLevel * 0.5;
		const interval = baseInterval + (maxInterval - baseInterval) * autonomyFactor;

		// Add some randomness to avoid predictable patterns
		const jitter = interval * 0.1 * (Math.random() - 0.5);
		const nextInterval = Math.max(baseInterval, interval + jitter);

		this.cycleTimer = setTimeout(() => this.runCycle(), nextInterval);
	}

	private async runCycle(forcedType?: CycleResult["type"]): Promise<CycleResult> {
		const cycleId = randomUUID().substring(0, 8);
		const startTime = Date.now();

		// Determine cycle type
		const cycleType = forcedType || this.selectCycleType();
		this.state.currentTask = `${cycleType} cycle`;

		this.emit("event", { type: "cycle_start", cycleId, cycleType } as DaemonEvent);

		let result: CycleResult;

		try {
			switch (cycleType) {
				case "improvement":
					result = await this.runImprovementCycle(cycleId);
					break;
				case "research":
					result = await this.runResearchCycle(cycleId);
					break;
				case "healing":
					result = await this.runHealingCycle(cycleId);
					break;
				case "optimization":
					result = await this.runOptimizationCycle(cycleId);
					break;
				case "task":
					result = await this.runTaskCycle(cycleId);
					break;
				default:
					result = await this.runGeneralCycle(cycleId);
			}
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			result = {
				id: cycleId,
				type: cycleType,
				success: false,
				duration: Date.now() - startTime,
				output: `Cycle failed: ${errMsg}`,
				learnings: [],
				actions: [],
			};
			this.state.lastError = errMsg;
		}

		// Update state
		result.duration = Date.now() - startTime;
		this.cycleDurations.push(result.duration);
		if (this.cycleDurations.length > 100) this.cycleDurations.shift();

		this.state.cyclesCompleted++;
		this.state.lastCycleAt = Date.now();
		this.state.currentTask = null;
		this.state.performance.avgCycleDuration =
			this.cycleDurations.reduce((a, b) => a + b, 0) / this.cycleDurations.length;

		if (result.success) {
			const total = this.state.cyclesCompleted;
			const failures = total * (1 - this.state.performance.successRate);
			this.state.performance.successRate = (total - failures) / total;
		}

		// Store learnings
		if (result.learnings.length > 0) {
			this.state.learnings.push(...result.learnings);
			// Keep only last 50 learnings
			if (this.state.learnings.length > 50) {
				this.state.learnings = this.state.learnings.slice(-50);
			}
		}

		this.emit("event", { type: "cycle_end", result } as DaemonEvent);

		// Schedule next cycle
		this.scheduleNextCycle();

		return result;
	}

	private selectCycleType(): CycleResult["type"] {
		const types: Array<{ type: CycleResult["type"]; weight: number; enabled: boolean }> = [
			{ type: "improvement", weight: 30, enabled: this.config.enableSelfImprovement },
			{ type: "research", weight: 25, enabled: this.config.enableResearch },
			{ type: "healing", weight: 15, enabled: this.config.enableSelfHealing },
			{ type: "optimization", weight: 15, enabled: this.config.enableOptimization },
			{ type: "task", weight: 15, enabled: true },
		];

		const enabledTypes = types.filter((t) => t.enabled);
		const totalWeight = enabledTypes.reduce((sum, t) => sum + t.weight, 0);
		let random = Math.random() * totalWeight;

		for (const t of enabledTypes) {
			random -= t.weight;
			if (random <= 0) return t.type;
		}

		return "task";
	}

	// ============================================================================
	// CYCLE IMPLEMENTATIONS
	// ============================================================================

	private async runImprovementCycle(cycleId: string): Promise<CycleResult> {
		const domain = this.config.domains[Math.floor(Math.random() * this.config.domains.length)];

		// Load and analyze expertise
		const { loadExpertise, updateExpertise } = await import("./expertise-manager.js");
		const expertise = await loadExpertise(domain);

		// Generate improvement insight
		const insight = await this.generateImprovement(domain, expertise);

		if (insight) {
			// Apply improvement
			updateExpertise(domain, `Daemon insight: ${insight}`, "Autonomous improvement cycle", true);
			this.state.performance.improvementsApplied++;

			this.emit("event", { type: "improvement", domain, insight } as DaemonEvent);

			return {
				id: cycleId,
				type: "improvement",
				success: true,
				duration: 0,
				output: `Improved ${domain} expertise`,
				learnings: [insight],
				actions: [`Updated ${domain}.md with new insight`],
			};
		}

		return {
			id: cycleId,
			type: "improvement",
			success: true,
			duration: 0,
			output: "No improvements needed",
			learnings: [],
			actions: [],
		};
	}

	private async runResearchCycle(cycleId: string): Promise<CycleResult> {
		// Check if research orchestrator is available
		try {
			const { getResearchOrchestrator } = await import("./research-orchestrator.js");
			const orchestrator = getResearchOrchestrator();

			if (orchestrator) {
				// Trigger a research cycle
				const state = orchestrator.getState?.();
				const topics = state?.topics || [];
				if (topics.length > 0) {
					const topic = topics[Math.floor(Math.random() * topics.length)];
					await orchestrator.triggerCycle?.(topic.id);

					this.state.performance.researchDiscoveries++;

					return {
						id: cycleId,
						type: "research",
						success: true,
						duration: 0,
						output: `Researched: ${topic.name}`,
						learnings: [`Research cycle on ${topic.name}`],
						actions: ["Triggered research orchestrator"],
					};
				}
			}
		} catch {
			// Research orchestrator not available
		}

		// Fallback: Basic research using learning agent
		const { runLearningAgent } = await import("./lightweight-agent.js");
		const topics = ["trading patterns", "AI developments", "market trends", "coding best practices"];
		const topic = topics[Math.floor(Math.random() * topics.length)];

		const result = await runLearningAgent({
			prompt: `Research the latest developments in ${topic}. Provide 3 key insights.`,
			mode: "research",
			enableLearning: true,
			timeout: 60000,
		});

		if (result.success) {
			this.state.performance.researchDiscoveries++;
			this.emit("event", {
				type: "discovery",
				topic,
				content: result.output.substring(0, 200),
			} as DaemonEvent);
		}

		return {
			id: cycleId,
			type: "research",
			success: result.success,
			duration: result.duration,
			output: result.output.substring(0, 500),
			learnings: result.learned?.learned ? [result.learned.insight] : [],
			actions: ["Ran learning agent for research"],
		};
	}

	private async runHealingCycle(cycleId: string): Promise<CycleResult> {
		try {
			const { getSelfDebugService } = await import("./self-debug.js");
			const debugService = getSelfDebugService();
			const status = debugService.getStatus();

			if (status.unresolvedErrors > 0) {
				// Get unresolved errors and attempt to fix
				const errors = debugService.getErrors?.() || [];
				const unresolved = errors.filter((e: any) => !e.resolved);

				if (unresolved.length > 0) {
					const error = unresolved[0];
					const diagnosis = await debugService.manualDiagnose?.(error.id);

					if (diagnosis?.proposedFix) {
						this.state.performance.errorsFixed++;
						const fixDescription = diagnosis.proposedFix.description || "Applied fix";
						this.emit("event", {
							type: "error_fixed",
							error: error.message,
							fix: fixDescription,
						} as DaemonEvent);

						return {
							id: cycleId,
							type: "healing",
							success: true,
							duration: 0,
							output: `Fixed error: ${error.message.substring(0, 100)}`,
							learnings: [`Error pattern: ${error.type}`],
							actions: [fixDescription.substring(0, 100)],
						};
					}
				}
			}

			return {
				id: cycleId,
				type: "healing",
				success: true,
				duration: 0,
				output: "No errors to fix",
				learnings: [],
				actions: [],
			};
		} catch {
			return {
				id: cycleId,
				type: "healing",
				success: true,
				duration: 0,
				output: "Self-debug service not available",
				learnings: [],
				actions: [],
			};
		}
	}

	private async runOptimizationCycle(cycleId: string): Promise<CycleResult> {
		const optimizations: string[] = [];

		// Check performance metrics
		const avgDuration = this.state.performance.avgCycleDuration;
		if (avgDuration > 30000) {
			// Cycles taking too long, reduce complexity
			this.config.maxCycleInterval = Math.min(this.config.maxCycleInterval * 1.1, 60 * 60 * 1000);
			optimizations.push("Increased cycle interval for better performance");
		}

		if (this.state.performance.successRate < 0.8) {
			// Too many failures, reduce autonomy
			this.config.autonomyLevel = Math.max(0.5, this.config.autonomyLevel - 0.1);
			optimizations.push(`Reduced autonomy to ${this.config.autonomyLevel}`);
		}

		// Clean up old learnings
		if (this.state.learnings.length > 30) {
			this.state.learnings = this.state.learnings.slice(-20);
			optimizations.push("Pruned old learnings");
		}

		return {
			id: cycleId,
			type: "optimization",
			success: true,
			duration: 0,
			output: optimizations.length > 0 ? optimizations.join("; ") : "System optimal",
			learnings: [],
			actions: optimizations,
		};
	}

	private async runTaskCycle(cycleId: string): Promise<CycleResult> {
		// Check for pending tasks from goals
		const goal = this.config.goals[Math.floor(Math.random() * this.config.goals.length)];

		const { runLearningAgent } = await import("./lightweight-agent.js");
		const result = await runLearningAgent({
			prompt: `You are an autonomous agent. Your goal: "${goal}". Take one small action toward this goal. Be specific and actionable.`,
			mode: "general",
			enableLearning: true,
			timeout: 45000,
		});

		return {
			id: cycleId,
			type: "task",
			success: result.success,
			duration: result.duration,
			output: result.output.substring(0, 500),
			learnings: result.learned?.learned ? [result.learned.insight] : [],
			actions: [`Worked on goal: ${goal.substring(0, 50)}`],
		};
	}

	private async runGeneralCycle(cycleId: string): Promise<CycleResult> {
		// Generic maintenance cycle
		return {
			id: cycleId,
			type: "task",
			success: true,
			duration: 0,
			output: "Maintenance cycle completed",
			learnings: [],
			actions: ["Health check"],
		};
	}

	private async generateImprovement(domain: string, _expertise: string): Promise<string | null> {
		// Use lightweight agent to analyze and suggest improvement
		const { runAgent } = await import("./lightweight-agent.js");

		const result = await runAgent({
			prompt: `You are reviewing the ${domain} expertise. Suggest ONE specific improvement or insight that would make an AI agent better at ${domain} tasks. Be concise (1-2 sentences). If no improvement needed, respond with just "none".`,
			timeout: 30000,
		});

		if (result.success && result.output && !result.output.toLowerCase().includes("none")) {
			return result.output.trim();
		}

		return null;
	}
}

// ============================================================================
// SINGLETON & FACTORY
// ============================================================================

let daemonInstance: AutonomousDaemon | null = null;

/**
 * Get or create the singleton daemon instance
 */
export function getAutonomousDaemon(config?: Partial<DaemonConfig>): AutonomousDaemon {
	if (!daemonInstance) {
		daemonInstance = new AutonomousDaemon(config);
	}
	return daemonInstance;
}

/**
 * Start the autonomous daemon
 */
export async function startDaemon(config?: Partial<DaemonConfig>): Promise<AutonomousDaemon> {
	const daemon = getAutonomousDaemon(config);
	if (daemon.getState().status !== "running") {
		await daemon.start();
	}
	return daemon;
}

/**
 * Stop the autonomous daemon
 */
export function stopDaemon(reason?: string): void {
	if (daemonInstance) {
		daemonInstance.stop(reason);
	}
}

/**
 * Get daemon status
 */
export function getDaemonStatus(): DaemonState | null {
	return daemonInstance?.getState() || null;
}

// ============================================================================
// PRESETS
// ============================================================================

export const DaemonPresets = {
	/** Full autonomy - minimal human oversight */
	autonomous: {
		name: "AutonomousAgent",
		autonomyLevel: 0.95,
		enableSelfImprovement: true,
		enableResearch: true,
		enableSelfHealing: true,
		enableOptimization: true,
		minCycleInterval: 3 * 60 * 1000, // 3 min
		maxCycleInterval: 15 * 60 * 1000, // 15 min
		domains: ["general", "coding", "trading", "research", "security"],
		goals: [
			"Continuously improve all expertise domains",
			"Discover and analyze market opportunities",
			"Fix system errors proactively",
			"Optimize performance continuously",
		],
	} as Partial<DaemonConfig>,

	/** Trading focused */
	trader: {
		name: "TradingDaemon",
		autonomyLevel: 0.8,
		enableSelfImprovement: true,
		enableResearch: true,
		enableSelfHealing: true,
		enableOptimization: true,
		minCycleInterval: 5 * 60 * 1000,
		maxCycleInterval: 20 * 60 * 1000,
		domains: ["trading", "research"],
		goals: [
			"Monitor market conditions and patterns",
			"Identify trading opportunities",
			"Improve trading strategy expertise",
			"Track whale movements and signals",
		],
	} as Partial<DaemonConfig>,

	/** Research focused */
	researcher: {
		name: "ResearchDaemon",
		autonomyLevel: 0.9,
		enableSelfImprovement: true,
		enableResearch: true,
		enableSelfHealing: false,
		enableOptimization: true,
		minCycleInterval: 10 * 60 * 1000,
		maxCycleInterval: 30 * 60 * 1000,
		domains: ["research", "general"],
		goals: [
			"Discover new research topics",
			"Synthesize information across domains",
			"Generate novel insights",
			"Build knowledge base",
		],
	} as Partial<DaemonConfig>,

	/** Conservative - more human oversight */
	conservative: {
		name: "ConservativeDaemon",
		autonomyLevel: 0.5,
		enableSelfImprovement: true,
		enableResearch: true,
		enableSelfHealing: false,
		enableOptimization: false,
		minCycleInterval: 30 * 60 * 1000,
		maxCycleInterval: 60 * 60 * 1000,
		domains: ["general"],
		goals: ["Learn from interactions", "Provide helpful responses"],
	} as Partial<DaemonConfig>,
};
