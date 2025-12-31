/**
 * Agent Cost Tracking System
 * Tracks API usage, token consumption, and cost per agent/pool
 *
 * Features:
 * - Per-agent cost tracking
 * - Pool-level cost aggregation
 * - ROI calculation
 * - Cost optimization insights
 * - Budget alerts
 */

import { EventEmitter } from "events";
import type { PoolType } from "./agent-pools.js";

export interface AgentCost {
	agentId: string;
	poolType: PoolType;
	timestamp: number;
	inputTokens: number;
	outputTokens: number;
	apiCalls: number;
	totalCost: number;
	modelUsed?: string;
	taskId?: string;
	roi?: number;
	metadata?: Record<string, unknown>;
}

export interface CostSummary {
	totalCost: number;
	totalTokens: number;
	totalApiCalls: number;
	avgCostPerCall: number;
	avgCostPerToken: number;
	periodStart: number;
	periodEnd: number;
}

export interface PoolCostSummary extends CostSummary {
	poolType: PoolType;
	agentCount: number;
	topAgents: Array<{
		agentId: string;
		cost: number;
		apiCalls: number;
		tokens: number;
	}>;
}

export interface CostAlert {
	id: string;
	type: "budget_exceeded" | "high_cost_agent" | "low_roi" | "anomaly";
	severity: "low" | "medium" | "high";
	message: string;
	agentId?: string;
	poolType?: PoolType;
	timestamp: number;
	threshold?: number;
	currentValue?: number;
}

export interface CostBudget {
	poolType: PoolType;
	dailyLimit: number;
	monthlyLimit: number;
	alertThreshold: number; // Percentage (0-1)
}

export interface ModelPricing {
	modelId: string;
	inputPricePerToken: number;
	outputPricePerToken: number;
}

export class AgentCostTracker extends EventEmitter {
	private costs: AgentCost[] = [];
	private readonly MAX_HISTORY = 10000;
	private budgets: Map<PoolType, CostBudget> = new Map();
	private alerts: CostAlert[] = [];
	private readonly MAX_ALERTS = 500;

	// Default model pricing (in USD per 1M tokens)
	private modelPricing: Map<string, ModelPricing> = new Map([
		["gpt-4", { modelId: "gpt-4", inputPricePerToken: 0.03 / 1000000, outputPricePerToken: 0.06 / 1000000 }],
		[
			"gpt-3.5-turbo",
			{ modelId: "gpt-3.5-turbo", inputPricePerToken: 0.0015 / 1000000, outputPricePerToken: 0.002 / 1000000 },
		],
		[
			"claude-opus-4-5",
			{ modelId: "claude-opus-4-5", inputPricePerToken: 0.015 / 1000000, outputPricePerToken: 0.075 / 1000000 },
		],
		[
			"claude-sonnet-4-5",
			{ modelId: "claude-sonnet-4-5", inputPricePerToken: 0.003 / 1000000, outputPricePerToken: 0.015 / 1000000 },
		],
		[
			"deepseek-chat",
			{ modelId: "deepseek-chat", inputPricePerToken: 0.0014 / 1000000, outputPricePerToken: 0.0028 / 1000000 },
		],
	]);

	/**
	 * Track a cost event for an agent
	 */
	track(agentId: string, poolType: PoolType, costData: Partial<AgentCost>): void {
		const cost: AgentCost = {
			agentId,
			poolType,
			timestamp: costData.timestamp || Date.now(),
			inputTokens: costData.inputTokens || 0,
			outputTokens: costData.outputTokens || 0,
			apiCalls: costData.apiCalls || 1,
			totalCost: costData.totalCost || this.calculateCost(costData),
			modelUsed: costData.modelUsed,
			taskId: costData.taskId,
			roi: costData.roi,
			metadata: costData.metadata,
		};

		this.costs.push(cost);

		// Trim history
		while (this.costs.length > this.MAX_HISTORY) {
			this.costs.shift();
		}

		// Emit cost event
		this.emit("cost", cost);

		// Check budget alerts
		this.checkBudgetAlerts(poolType);

		// Check for anomalies
		this.checkCostAnomalies(agentId, cost);
	}

	/**
	 * Calculate cost from token usage and model
	 */
	private calculateCost(costData: Partial<AgentCost>): number {
		if (costData.totalCost) return costData.totalCost;

		const modelId = costData.modelUsed || "gpt-3.5-turbo";
		const pricing = this.modelPricing.get(modelId);

		if (!pricing) {
			console.warn(`[CostTracker] Unknown model pricing: ${modelId}, using default`);
			return 0.0001; // Fallback minimal cost
		}

		const inputCost = (costData.inputTokens || 0) * pricing.inputPricePerToken;
		const outputCost = (costData.outputTokens || 0) * pricing.outputPricePerToken;

		return inputCost + outputCost;
	}

	/**
	 * Set model pricing
	 */
	setModelPricing(modelId: string, inputPricePerToken: number, outputPricePerToken: number): void {
		this.modelPricing.set(modelId, {
			modelId,
			inputPricePerToken,
			outputPricePerToken,
		});
	}

	/**
	 * Get all costs for an agent
	 */
	getAgentCosts(agentId: string, since?: number): AgentCost[] {
		return this.costs.filter((c) => c.agentId === agentId && (!since || c.timestamp >= since));
	}

	/**
	 * Get all costs for a pool
	 */
	getPoolCosts(poolType: PoolType, since?: number): AgentCost[] {
		return this.costs.filter((c) => c.poolType === poolType && (!since || c.timestamp >= since));
	}

	/**
	 * Get total cost since a timestamp
	 */
	getTotalCost(since?: number): number {
		const relevantCosts = since ? this.costs.filter((c) => c.timestamp >= since) : this.costs;
		return relevantCosts.reduce((sum, c) => sum + c.totalCost, 0);
	}

	/**
	 * Get agent cost summary
	 */
	getAgentCostSummary(agentId: string, since?: number): CostSummary {
		const costs = this.getAgentCosts(agentId, since);

		return this.calculateSummary(costs);
	}

	/**
	 * Get pool cost summary
	 */
	getPoolCostSummary(poolType: PoolType, since?: number): PoolCostSummary {
		const costs = this.getPoolCosts(poolType, since);
		const summary = this.calculateSummary(costs);

		// Get unique agents
		const agentCosts = new Map<string, { cost: number; apiCalls: number; tokens: number }>();

		for (const cost of costs) {
			const existing = agentCosts.get(cost.agentId) || { cost: 0, apiCalls: 0, tokens: 0 };
			agentCosts.set(cost.agentId, {
				cost: existing.cost + cost.totalCost,
				apiCalls: existing.apiCalls + cost.apiCalls,
				tokens: existing.tokens + cost.inputTokens + cost.outputTokens,
			});
		}

		// Sort by cost and get top agents
		const topAgents = Array.from(agentCosts.entries())
			.sort((a, b) => b[1].cost - a[1].cost)
			.slice(0, 10)
			.map(([agentId, data]) => ({ agentId, ...data }));

		return {
			...summary,
			poolType,
			agentCount: agentCosts.size,
			topAgents,
		};
	}

	/**
	 * Calculate summary from cost array
	 */
	private calculateSummary(costs: AgentCost[]): CostSummary {
		if (costs.length === 0) {
			return {
				totalCost: 0,
				totalTokens: 0,
				totalApiCalls: 0,
				avgCostPerCall: 0,
				avgCostPerToken: 0,
				periodStart: Date.now(),
				periodEnd: Date.now(),
			};
		}

		const totalCost = costs.reduce((sum, c) => sum + c.totalCost, 0);
		const totalTokens = costs.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0);
		const totalApiCalls = costs.reduce((sum, c) => sum + c.apiCalls, 0);

		return {
			totalCost,
			totalTokens,
			totalApiCalls,
			avgCostPerCall: totalApiCalls > 0 ? totalCost / totalApiCalls : 0,
			avgCostPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
			periodStart: Math.min(...costs.map((c) => c.timestamp)),
			periodEnd: Math.max(...costs.map((c) => c.timestamp)),
		};
	}

	/**
	 * Get all pool summaries
	 */
	getAllPoolSummaries(since?: number): Map<PoolType, PoolCostSummary> {
		const pools: PoolType[] = ["scouts", "analysts", "traders", "riskManagers", "executors"];
		const summaries = new Map<PoolType, PoolCostSummary>();

		for (const pool of pools) {
			summaries.set(pool, this.getPoolCostSummary(pool, since));
		}

		return summaries;
	}

	/**
	 * Set budget for a pool
	 */
	setBudget(poolType: PoolType, dailyLimit: number, monthlyLimit: number, alertThreshold: number = 0.8): void {
		this.budgets.set(poolType, {
			poolType,
			dailyLimit,
			monthlyLimit,
			alertThreshold,
		});
	}

	/**
	 * Check budget alerts
	 */
	private checkBudgetAlerts(poolType: PoolType): void {
		const budget = this.budgets.get(poolType);
		if (!budget) return;

		const now = Date.now();
		const dayStart = now - 24 * 60 * 60 * 1000;
		const monthStart = now - 30 * 24 * 60 * 60 * 1000;

		const dailyCost = this.getTotalCost(dayStart);
		const monthlyCost = this.getTotalCost(monthStart);

		// Check daily budget
		if (dailyCost >= budget.dailyLimit) {
			this.createAlert({
				type: "budget_exceeded",
				severity: "high",
				message: `Daily budget exceeded for ${poolType} pool: $${dailyCost.toFixed(2)} / $${budget.dailyLimit}`,
				poolType,
				threshold: budget.dailyLimit,
				currentValue: dailyCost,
			});
		} else if (dailyCost >= budget.dailyLimit * budget.alertThreshold) {
			this.createAlert({
				type: "budget_exceeded",
				severity: "medium",
				message: `Daily budget ${(budget.alertThreshold * 100).toFixed(0)}% reached for ${poolType} pool: $${dailyCost.toFixed(2)} / $${budget.dailyLimit}`,
				poolType,
				threshold: budget.dailyLimit * budget.alertThreshold,
				currentValue: dailyCost,
			});
		}

		// Check monthly budget
		if (monthlyCost >= budget.monthlyLimit) {
			this.createAlert({
				type: "budget_exceeded",
				severity: "high",
				message: `Monthly budget exceeded for ${poolType} pool: $${monthlyCost.toFixed(2)} / $${budget.monthlyLimit}`,
				poolType,
				threshold: budget.monthlyLimit,
				currentValue: monthlyCost,
			});
		}
	}

	/**
	 * Check for cost anomalies
	 */
	private checkCostAnomalies(agentId: string, currentCost: AgentCost): void {
		const recentCosts = this.getAgentCosts(agentId, Date.now() - 60 * 60 * 1000); // Last hour
		if (recentCosts.length < 5) return; // Need baseline

		const avgCost = recentCosts.reduce((sum, c) => sum + c.totalCost, 0) / recentCosts.length;
		const stdDev = Math.sqrt(
			recentCosts.reduce((sum, c) => sum + (c.totalCost - avgCost) ** 2, 0) / recentCosts.length,
		);

		// Alert if current cost is > 3 standard deviations
		if (currentCost.totalCost > avgCost + 3 * stdDev) {
			this.createAlert({
				type: "anomaly",
				severity: "medium",
				message: `Cost anomaly detected for ${agentId}: $${currentCost.totalCost.toFixed(4)} (avg: $${avgCost.toFixed(4)})`,
				agentId,
				poolType: currentCost.poolType,
				threshold: avgCost + 3 * stdDev,
				currentValue: currentCost.totalCost,
			});
		}
	}

	/**
	 * Create cost alert
	 */
	private createAlert(alertData: Omit<CostAlert, "id" | "timestamp">): void {
		const alert: CostAlert = {
			id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			timestamp: Date.now(),
			...alertData,
		};

		this.alerts.push(alert);

		// Trim alerts
		while (this.alerts.length > this.MAX_ALERTS) {
			this.alerts.shift();
		}

		// Emit alert
		this.emit("alert", alert);
	}

	/**
	 * Get recent alerts
	 */
	getAlerts(limit?: number, severity?: "low" | "medium" | "high"): CostAlert[] {
		let filtered = [...this.alerts].reverse();

		if (severity) {
			filtered = filtered.filter((a) => a.severity === severity);
		}

		return limit ? filtered.slice(0, limit) : filtered;
	}

	/**
	 * Get top cost agents
	 */
	getTopCostAgents(
		limit: number = 10,
		since?: number,
	): Array<{
		agentId: string;
		poolType: PoolType;
		totalCost: number;
		apiCalls: number;
		tokens: number;
		avgCostPerCall: number;
	}> {
		const relevantCosts = since ? this.costs.filter((c) => c.timestamp >= since) : this.costs;

		const agentMap = new Map<
			string,
			{
				poolType: PoolType;
				totalCost: number;
				apiCalls: number;
				tokens: number;
			}
		>();

		for (const cost of relevantCosts) {
			const existing = agentMap.get(cost.agentId) || {
				poolType: cost.poolType,
				totalCost: 0,
				apiCalls: 0,
				tokens: 0,
			};

			agentMap.set(cost.agentId, {
				poolType: cost.poolType,
				totalCost: existing.totalCost + cost.totalCost,
				apiCalls: existing.apiCalls + cost.apiCalls,
				tokens: existing.tokens + cost.inputTokens + cost.outputTokens,
			});
		}

		return Array.from(agentMap.entries())
			.sort((a, b) => b[1].totalCost - a[1].totalCost)
			.slice(0, limit)
			.map(([agentId, data]) => ({
				agentId,
				poolType: data.poolType,
				totalCost: data.totalCost,
				apiCalls: data.apiCalls,
				tokens: data.tokens,
				avgCostPerCall: data.apiCalls > 0 ? data.totalCost / data.apiCalls : 0,
			}));
	}

	/**
	 * Calculate ROI for an agent
	 */
	calculateROI(agentId: string, profit: number, since?: number): number {
		const costs = this.getAgentCosts(agentId, since);
		const totalCost = costs.reduce((sum, c) => sum + c.totalCost, 0);

		if (totalCost === 0) return 0;

		return ((profit - totalCost) / totalCost) * 100;
	}

	/**
	 * Update ROI for a cost entry
	 */
	updateROI(agentId: string, taskId: string, roi: number): void {
		const cost = this.costs.find((c) => c.agentId === agentId && c.taskId === taskId);
		if (cost) {
			cost.roi = roi;
		}
	}

	/**
	 * Get cost optimization insights
	 */
	getOptimizationInsights(): Array<{
		type: "high_cost_low_usage" | "low_roi" | "inefficient_model" | "excessive_tokens";
		message: string;
		recommendation: string;
		agentId?: string;
		poolType?: PoolType;
		potentialSavings?: number;
	}> {
		const insights: Array<{
			type: "high_cost_low_usage" | "low_roi" | "inefficient_model" | "excessive_tokens";
			message: string;
			recommendation: string;
			agentId?: string;
			poolType?: PoolType;
			potentialSavings?: number;
		}> = [];

		// Find agents with low ROI
		const agentsWithROI = this.costs.filter((c) => c.roi !== undefined);
		const lowROIAgents = new Map<string, number>();

		for (const cost of agentsWithROI) {
			if (cost.roi !== undefined && cost.roi < 0) {
				const existing = lowROIAgents.get(cost.agentId) || 0;
				lowROIAgents.set(cost.agentId, existing + 1);
			}
		}

		for (const [agentId, count] of lowROIAgents) {
			if (count > 5) {
				const agentCosts = this.getAgentCosts(agentId);
				const avgCost = agentCosts.reduce((sum, c) => sum + c.totalCost, 0) / agentCosts.length;

				insights.push({
					type: "low_roi",
					message: `Agent ${agentId} has negative ROI in ${count} tasks`,
					recommendation: "Consider disabling or optimizing this agent",
					agentId,
					potentialSavings: avgCost * count,
				});
			}
		}

		return insights;
	}

	/**
	 * Export cost data for analysis
	 */
	exportCosts(since?: number, format: "json" | "csv" = "json"): string {
		const relevantCosts = since ? this.costs.filter((c) => c.timestamp >= since) : this.costs;

		if (format === "csv") {
			const headers = [
				"agentId",
				"poolType",
				"timestamp",
				"inputTokens",
				"outputTokens",
				"apiCalls",
				"totalCost",
				"modelUsed",
				"taskId",
				"roi",
			];
			const rows = relevantCosts.map((c) =>
				[
					c.agentId,
					c.poolType,
					c.timestamp,
					c.inputTokens,
					c.outputTokens,
					c.apiCalls,
					c.totalCost,
					c.modelUsed || "",
					c.taskId || "",
					c.roi || "",
				].join(","),
			);

			return [headers.join(","), ...rows].join("\n");
		}

		return JSON.stringify(relevantCosts, null, 2);
	}

	/**
	 * Clear all cost data
	 */
	clear(): void {
		this.costs = [];
		this.alerts = [];
		console.log("[CostTracker] All cost data cleared");
	}
}

// Singleton instance
let costTrackerInstance: AgentCostTracker | null = null;

export function getAgentCostTracker(): AgentCostTracker {
	if (!costTrackerInstance) {
		costTrackerInstance = new AgentCostTracker();
	}
	return costTrackerInstance;
}
