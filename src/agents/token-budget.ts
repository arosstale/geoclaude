/**
 * Class 3.28: Token Budget Manager
 *
 * Adaptive token budget allocation for agent phases.
 * Prevents context overflow and optimizes token usage.
 *
 * Features:
 * - Phase-based budget allocation
 * - Dynamic reallocation based on usage
 * - Context window optimization
 * - Usage analytics and predictions
 *
 * @module token-budget
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type BudgetPhase =
	| "observe"
	| "orient"
	| "decide"
	| "act"
	| "reflect"
	| "plan"
	| "execute"
	| "verify"
	| "custom";

export interface PhaseBudget {
	phase: BudgetPhase;
	allocated: number;
	used: number;
	remaining: number;
	priority: number;
	canBorrow: boolean;
	borrowLimit: number;
}

export interface BudgetAllocation {
	taskId: string;
	totalBudget: number;
	phases: Map<BudgetPhase, PhaseBudget>;
	createdAt: number;
	updatedAt: number;
	exhausted: boolean;
}

export interface TokenUsage {
	phase: BudgetPhase;
	input: number;
	output: number;
	total: number;
	timestamp: number;
	model?: string;
}

export interface BudgetStats {
	totalAllocated: number;
	totalUsed: number;
	utilizationRate: number;
	phaseBreakdown: Map<BudgetPhase, { allocated: number; used: number }>;
	peakUsagePhase: BudgetPhase | null;
	estimatedRemaining: number;
}

export interface TokenBudgetConfig {
	defaultTotalBudget: number;
	contextWindowSize: number;
	reserveBuffer: number; // percentage to reserve
	enableBorrowing: boolean;
	defaultPhaseWeights: Map<BudgetPhase, number>;
}

export interface TokenBudgetEvents {
	"budget:allocated": { allocation: BudgetAllocation };
	"budget:used": { taskId: string; usage: TokenUsage; remaining: number };
	"budget:borrowed": { taskId: string; from: BudgetPhase; to: BudgetPhase; amount: number };
	"budget:exhausted": { taskId: string; phase: BudgetPhase };
	"budget:warning": { taskId: string; phase: BudgetPhase; remainingPercent: number };
}

export interface BudgetPrediction {
	phase: BudgetPhase;
	estimatedUsage: number;
	confidence: number;
	recommendation: string;
}

// =============================================================================
// Default Phase Weights
// =============================================================================

const DEFAULT_PHASE_WEIGHTS = new Map<BudgetPhase, number>([
	["observe", 0.15],
	["orient", 0.1],
	["decide", 0.1],
	["act", 0.3],
	["reflect", 0.1],
	["plan", 0.1],
	["execute", 0.3],
	["verify", 0.1],
	["custom", 0.2],
]);

// =============================================================================
// Token Budget Manager
// =============================================================================

export class TokenBudgetManager extends EventEmitter {
	private config: TokenBudgetConfig;
	private allocations: Map<string, BudgetAllocation> = new Map();
	private usageHistory: Map<string, TokenUsage[]> = new Map();
	private globalUsageByPhase: Map<BudgetPhase, { total: number; count: number }> = new Map();

	constructor(config: Partial<TokenBudgetConfig> = {}) {
		super();
		this.config = {
			defaultTotalBudget: 100000,
			contextWindowSize: 128000,
			reserveBuffer: 0.1,
			enableBorrowing: true,
			defaultPhaseWeights: DEFAULT_PHASE_WEIGHTS,
			...config,
		};

		// Initialize global usage tracking
		for (const phase of DEFAULT_PHASE_WEIGHTS.keys()) {
			this.globalUsageByPhase.set(phase, { total: 0, count: 0 });
		}
	}

	// ---------------------------------------------------------------------------
	// Budget Allocation
	// ---------------------------------------------------------------------------

	allocate(taskId: string, options: {
		totalBudget?: number;
		phases?: BudgetPhase[];
		weights?: Map<BudgetPhase, number>;
	} = {}): BudgetAllocation {
		const totalBudget = options.totalBudget || this.config.defaultTotalBudget;
		const phases = options.phases || ["observe", "orient", "decide", "act"];
		const weights = options.weights || this.config.defaultPhaseWeights;

		// Calculate allocation per phase
		const totalWeight = phases.reduce((sum, phase) => sum + (weights.get(phase) || 0.1), 0);
		const effectiveBudget = totalBudget * (1 - this.config.reserveBuffer);

		const phaseBudgets = new Map<BudgetPhase, PhaseBudget>();
		for (const phase of phases) {
			const weight = weights.get(phase) || 0.1;
			const allocated = Math.floor((weight / totalWeight) * effectiveBudget);

			phaseBudgets.set(phase, {
				phase,
				allocated,
				used: 0,
				remaining: allocated,
				priority: this.getPhasePriority(phase),
				canBorrow: this.config.enableBorrowing,
				borrowLimit: Math.floor(allocated * 0.5), // Can borrow up to 50% from others
			});
		}

		const allocation: BudgetAllocation = {
			taskId,
			totalBudget,
			phases: phaseBudgets,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			exhausted: false,
		};

		this.allocations.set(taskId, allocation);
		this.usageHistory.set(taskId, []);

		this.emit("budget:allocated", { allocation });
		return allocation;
	}

	// ---------------------------------------------------------------------------
	// Token Consumption
	// ---------------------------------------------------------------------------

	consume(taskId: string, phase: BudgetPhase, tokens: number, model?: string): {
		success: boolean;
		remaining: number;
		borrowed: number;
		warning?: string;
	} {
		const allocation = this.allocations.get(taskId);
		if (!allocation) {
			throw new Error(`No allocation found for task ${taskId}`);
		}

		let phaseBudget = allocation.phases.get(phase);
		if (!phaseBudget) {
			// Create phase budget on the fly
			phaseBudget = {
				phase,
				allocated: Math.floor(allocation.totalBudget * 0.1),
				used: 0,
				remaining: Math.floor(allocation.totalBudget * 0.1),
				priority: this.getPhasePriority(phase),
				canBorrow: this.config.enableBorrowing,
				borrowLimit: Math.floor(allocation.totalBudget * 0.05),
			};
			allocation.phases.set(phase, phaseBudget);
		}

		let borrowed = 0;
		let warning: string | undefined;

		// Check if we need to borrow
		if (tokens > phaseBudget.remaining) {
			if (phaseBudget.canBorrow) {
				const needed = tokens - phaseBudget.remaining;
				borrowed = this.borrowTokens(allocation, phase, needed);
				phaseBudget.remaining += borrowed;
			}
		}

		// Check if we can consume
		if (tokens > phaseBudget.remaining) {
			// Partial consumption
			const consumed = phaseBudget.remaining;
			phaseBudget.used += consumed;
			phaseBudget.remaining = 0;

			allocation.exhausted = true;
			this.emit("budget:exhausted", { taskId, phase });

			return {
				success: false,
				remaining: 0,
				borrowed,
				warning: `Budget exhausted for phase ${phase}, consumed ${consumed} of ${tokens} requested`,
			};
		}

		// Full consumption
		phaseBudget.used += tokens;
		phaseBudget.remaining -= tokens;
		allocation.updatedAt = Date.now();

		// Record usage
		const usage: TokenUsage = {
			phase,
			input: Math.floor(tokens * 0.7), // Estimate
			output: Math.floor(tokens * 0.3),
			total: tokens,
			timestamp: Date.now(),
			model,
		};
		this.usageHistory.get(taskId)!.push(usage);
		this.updateGlobalUsage(phase, tokens);

		this.emit("budget:used", { taskId, usage, remaining: phaseBudget.remaining });

		// Warn if low
		const remainingPercent = phaseBudget.remaining / phaseBudget.allocated;
		if (remainingPercent < 0.2) {
			warning = `Low budget warning: ${(remainingPercent * 100).toFixed(1)}% remaining for phase ${phase}`;
			this.emit("budget:warning", { taskId, phase, remainingPercent });
		}

		return {
			success: true,
			remaining: phaseBudget.remaining,
			borrowed,
			warning,
		};
	}

	// ---------------------------------------------------------------------------
	// Token Borrowing
	// ---------------------------------------------------------------------------

	private borrowTokens(allocation: BudgetAllocation, borrower: BudgetPhase, needed: number): number {
		let borrowed = 0;

		// Sort phases by priority (lower priority can lend to higher priority)
		const sortedPhases = Array.from(allocation.phases.entries())
			.filter(([phase]) => phase !== borrower)
			.sort((a, b) => a[1].priority - b[1].priority);

		for (const [phase, budget] of sortedPhases) {
			if (borrowed >= needed) break;

			const available = Math.min(
				budget.remaining,
				budget.borrowLimit,
				needed - borrowed
			);

			if (available > 0) {
				budget.remaining -= available;
				borrowed += available;

				this.emit("budget:borrowed", {
					taskId: allocation.taskId,
					from: phase,
					to: borrower,
					amount: available,
				});
			}
		}

		return borrowed;
	}

	// ---------------------------------------------------------------------------
	// Budget Queries
	// ---------------------------------------------------------------------------

	getRemaining(taskId: string, phase?: BudgetPhase): number {
		const allocation = this.allocations.get(taskId);
		if (!allocation) return 0;

		if (phase) {
			return allocation.phases.get(phase)?.remaining || 0;
		}

		// Total remaining
		let total = 0;
		for (const budget of allocation.phases.values()) {
			total += budget.remaining;
		}
		return total;
	}

	getStats(taskId: string): BudgetStats | null {
		const allocation = this.allocations.get(taskId);
		if (!allocation) return null;

		let totalAllocated = 0;
		let totalUsed = 0;
		let peakUsage = 0;
		let peakPhase: BudgetPhase | null = null;
		const phaseBreakdown = new Map<BudgetPhase, { allocated: number; used: number }>();

		for (const [phase, budget] of allocation.phases) {
			totalAllocated += budget.allocated;
			totalUsed += budget.used;
			phaseBreakdown.set(phase, { allocated: budget.allocated, used: budget.used });

			if (budget.used > peakUsage) {
				peakUsage = budget.used;
				peakPhase = phase;
			}
		}

		return {
			totalAllocated,
			totalUsed,
			utilizationRate: totalAllocated > 0 ? totalUsed / totalAllocated : 0,
			phaseBreakdown,
			peakUsagePhase: peakPhase,
			estimatedRemaining: totalAllocated - totalUsed,
		};
	}

	getAllocation(taskId: string): BudgetAllocation | null {
		return this.allocations.get(taskId) || null;
	}

	// ---------------------------------------------------------------------------
	// Predictions
	// ---------------------------------------------------------------------------

	predictUsage(phase: BudgetPhase): BudgetPrediction {
		const stats = this.globalUsageByPhase.get(phase);
		if (!stats || stats.count === 0) {
			return {
				phase,
				estimatedUsage: this.config.defaultTotalBudget * (DEFAULT_PHASE_WEIGHTS.get(phase) || 0.1),
				confidence: 0.1,
				recommendation: "Insufficient data for accurate prediction",
			};
		}

		const avgUsage = stats.total / stats.count;
		const confidence = Math.min(0.95, stats.count / 100); // More samples = higher confidence

		let recommendation: string;
		if (avgUsage > this.config.defaultTotalBudget * 0.3) {
			recommendation = `High usage phase - consider allocating more tokens`;
		} else if (avgUsage < this.config.defaultTotalBudget * 0.05) {
			recommendation = `Low usage phase - can reduce allocation`;
		} else {
			recommendation = `Normal usage - current allocation is appropriate`;
		}

		return {
			phase,
			estimatedUsage: avgUsage,
			confidence,
			recommendation,
		};
	}

	getOptimalAllocation(phases: BudgetPhase[], totalBudget: number): Map<BudgetPhase, number> {
		const allocation = new Map<BudgetPhase, number>();
		const predictions = phases.map((phase) => this.predictUsage(phase));

		// Calculate total estimated usage
		const totalEstimated = predictions.reduce((sum, p) => sum + p.estimatedUsage, 0);

		// Allocate proportionally
		for (const prediction of predictions) {
			const proportion = totalEstimated > 0 ? prediction.estimatedUsage / totalEstimated : 1 / phases.length;
			allocation.set(prediction.phase, Math.floor(proportion * totalBudget));
		}

		return allocation;
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private getPhasePriority(phase: BudgetPhase): number {
		const priorities: Record<BudgetPhase, number> = {
			observe: 3,
			orient: 2,
			decide: 4,
			act: 5,
			reflect: 1,
			plan: 3,
			execute: 5,
			verify: 4,
			custom: 2,
		};
		return priorities[phase];
	}

	private updateGlobalUsage(phase: BudgetPhase, tokens: number): void {
		const stats = this.globalUsageByPhase.get(phase) || { total: 0, count: 0 };
		stats.total += tokens;
		stats.count++;
		this.globalUsageByPhase.set(phase, stats);
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	release(taskId: string): boolean {
		const allocation = this.allocations.get(taskId);
		if (!allocation) return false;

		this.allocations.delete(taskId);
		this.usageHistory.delete(taskId);
		return true;
	}

	clear(): void {
		this.allocations.clear();
		this.usageHistory.clear();
		// Keep global usage for predictions
	}

	resetStats(): void {
		for (const phase of this.globalUsageByPhase.keys()) {
			this.globalUsageByPhase.set(phase, { total: 0, count: 0 });
		}
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: TokenBudgetManager | null = null;

export function getTokenBudget(config?: Partial<TokenBudgetConfig>): TokenBudgetManager {
	if (!instance) {
		instance = new TokenBudgetManager(config);
	}
	return instance;
}

export function resetTokenBudget(): void {
	if (instance) {
		instance.clear();
		instance.resetStats();
	}
	instance = null;
}
