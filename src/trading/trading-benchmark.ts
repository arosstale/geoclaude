/**
 * Trading Benchmark System
 * Based on TradingAgents (UCLA/MIT), INVESTORBENCH, and LiveTradeBench
 *
 * Evaluates multi-agent trading systems on:
 * - Financial performance (returns, Sharpe, drawdown)
 * - Economic value (TEI, return-per-cost, cost-efficiency)
 * - Adaptability (performance during volatility)
 * - Consistency (variance vs risk budget)
 *
 * References:
 * - TradingAgents: https://arxiv.org/abs/2412.20138
 * - INVESTORBENCH: https://arxiv.org/abs/2412.18174
 * - LiveTradeBench: https://arxiv.org/abs/2511.03628
 */

import { EventEmitter } from "events";
import type { PoolType } from "./agent-pools.js";
import { type AgentCost, getAgentCostTracker } from "./cost-tracker.js";

// ============================================================================
// TYPES
// ============================================================================

/** Trade record for benchmark evaluation */
export interface TradeRecord {
	id: string;
	agentId: string;
	symbol: string;
	side: "buy" | "sell";
	entryPrice: number;
	exitPrice?: number;
	quantity: number;
	entryTime: number;
	exitTime?: number;
	pnl?: number;
	pnlPercent?: number;
	fees: number;
	slippage?: number;
	signalConfidence?: number;
	metadata?: Record<string, unknown>;
}

/** Portfolio snapshot */
export interface PortfolioSnapshot {
	timestamp: number;
	totalValue: number;
	cash: number;
	positions: Array<{
		symbol: string;
		quantity: number;
		avgPrice: number;
		currentPrice: number;
		pnl: number;
	}>;
	dailyReturn?: number;
}

/** Financial performance metrics */
export interface FinancialMetrics {
	/** Total return percentage */
	cumulativeReturn: number;
	/** Annualized return */
	annualizedReturn: number;
	/** Risk-adjusted return */
	sharpeRatio: number;
	/** Sortino ratio (downside risk) */
	sortinoRatio: number;
	/** Maximum drawdown */
	maxDrawdown: number;
	/** Win rate */
	winRate: number;
	/** Profit factor */
	profitFactor: number;
	/** Average trade PnL */
	avgTradePnl: number;
	/** Total trades */
	totalTrades: number;
	/** Calmar ratio (return / max drawdown) */
	calmarRatio: number;
}

/** Economic value metrics (FinGAIA / INVESTORBENCH style) */
export interface EconomicMetrics {
	/** Total Economic Impact = profit - costs */
	totalEconomicImpact: number;
	/** Cost to Complete = total cost for period */
	costToComplete: number;
	/** Return per cost = profit / cost */
	returnPerCost: number;
	/** Cost efficiency = return / tokens used */
	costEfficiency: number;
	/** Rework penalty = cost of failed trades */
	reworkPenalty: number;
	/** Salary Replacement Index = agent ROI vs human benchmark */
	salaryReplacementIndex: number;
	/** Net profit after all costs */
	netProfit: number;
	/** API cost */
	apiCost: number;
	/** Transaction fees */
	transactionFees: number;
}

/** LiveTradeBench-style adaptability metrics */
export interface AdaptabilityMetrics {
	/** Consistency score = 1 - (variance / risk budget) */
	consistencyScore: number;
	/** Adaptability = improvement after market shocks */
	adaptabilityScore: number;
	/** Recovery time from drawdowns */
	avgRecoveryTime: number;
	/** Performance during high volatility */
	volatilityPerformance: number;
	/** Regime change adaptation */
	regimeAdaptation: number;
}

/** Complete benchmark result */
export interface BenchmarkResult {
	id: string;
	name: string;
	startTime: number;
	endTime: number;
	durationMs: number;
	agentId: string;
	financial: FinancialMetrics;
	economic: EconomicMetrics;
	adaptability: AdaptabilityMetrics;
	/** Overall score (0-100) */
	overallScore: number;
	/** Grade (A-F) */
	grade: string;
	/** Comparison to baseline */
	vsBaseline: {
		buyAndHold: number;
		randomWalk: number;
	};
	/** Raw data */
	trades: TradeRecord[];
	snapshots: PortfolioSnapshot[];
}

/** Benchmark configuration */
export interface BenchmarkConfig {
	/** Risk-free rate for Sharpe calculation */
	riskFreeRate: number;
	/** Risk budget (target volatility) */
	riskBudget: number;
	/** Human benchmark salary (annual) for SRI */
	humanBenchmarkSalary: number;
	/** Volatility threshold for shock detection */
	volatilityThreshold: number;
	/** Minimum trades for valid benchmark */
	minTrades: number;
	/** Trading days per year */
	tradingDaysPerYear: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
	riskFreeRate: 0.05, // 5% annual
	riskBudget: 0.15, // 15% target volatility
	humanBenchmarkSalary: 150000, // $150k/year
	volatilityThreshold: 2.0, // 2 std dev for shock
	minTrades: 10,
	tradingDaysPerYear: 252,
};

// ============================================================================
// TRADING BENCHMARK
// ============================================================================

export class TradingBenchmark extends EventEmitter {
	private trades: TradeRecord[] = [];
	private snapshots: PortfolioSnapshot[] = [];
	private config: BenchmarkConfig;
	private costTracker = getAgentCostTracker();
	private benchmarkResults: BenchmarkResult[] = [];
	private readonly MAX_HISTORY = 10000;

	constructor(config: Partial<BenchmarkConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ==========================================================================
	// DATA COLLECTION
	// ==========================================================================

	/** Record a trade */
	recordTrade(trade: Omit<TradeRecord, "id">): TradeRecord {
		const fullTrade: TradeRecord = {
			id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			...trade,
		};

		// Calculate PnL if exit price is provided
		if (trade.exitPrice && !trade.pnl) {
			const grossPnl =
				trade.side === "buy"
					? (trade.exitPrice - trade.entryPrice) * trade.quantity
					: (trade.entryPrice - trade.exitPrice) * trade.quantity;
			fullTrade.pnl = grossPnl - trade.fees - (trade.slippage || 0);
			fullTrade.pnlPercent = (fullTrade.pnl / (trade.entryPrice * trade.quantity)) * 100;
		}

		this.trades.push(fullTrade);
		this.trimHistory();
		this.emit("trade", fullTrade);

		return fullTrade;
	}

	/** Close a trade */
	closeTrade(tradeId: string, exitPrice: number, exitTime?: number): TradeRecord | null {
		const trade = this.trades.find((t) => t.id === tradeId);
		if (!trade || trade.exitPrice) return null;

		trade.exitPrice = exitPrice;
		trade.exitTime = exitTime || Date.now();

		const grossPnl =
			trade.side === "buy"
				? (exitPrice - trade.entryPrice) * trade.quantity
				: (trade.entryPrice - exitPrice) * trade.quantity;
		trade.pnl = grossPnl - trade.fees - (trade.slippage || 0);
		trade.pnlPercent = (trade.pnl / (trade.entryPrice * trade.quantity)) * 100;

		this.emit("tradeClosed", trade);
		return trade;
	}

	/** Record portfolio snapshot */
	recordSnapshot(snapshot: Omit<PortfolioSnapshot, "dailyReturn">): void {
		const prevSnapshot = this.snapshots[this.snapshots.length - 1];
		const dailyReturn = prevSnapshot ? (snapshot.totalValue - prevSnapshot.totalValue) / prevSnapshot.totalValue : 0;

		const fullSnapshot: PortfolioSnapshot = {
			...snapshot,
			dailyReturn,
		};

		this.snapshots.push(fullSnapshot);
		this.trimHistory();
		this.emit("snapshot", fullSnapshot);
	}

	private trimHistory(): void {
		while (this.trades.length > this.MAX_HISTORY) {
			this.trades.shift();
		}
		while (this.snapshots.length > this.MAX_HISTORY) {
			this.snapshots.shift();
		}
	}

	// ==========================================================================
	// FINANCIAL METRICS
	// ==========================================================================

	/** Calculate financial performance metrics */
	calculateFinancialMetrics(trades: TradeRecord[], snapshots: PortfolioSnapshot[]): FinancialMetrics {
		const closedTrades = trades.filter((t) => t.pnl !== undefined);

		// Return empty if no data at all
		if (closedTrades.length === 0 && snapshots.length === 0) {
			return this.emptyFinancialMetrics();
		}

		// Trade-based metrics (can be empty)
		const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
		const losingTrades = closedTrades.filter((t) => (t.pnl || 0) <= 0);
		const winRate = closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0;

		const totalProfit = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
		const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
		const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

		const avgTradePnl =
			closedTrades.length > 0 ? closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / closedTrades.length : 0;

		// Returns from snapshots (calculate dailyReturn if not set)
		const returns: number[] = [];
		for (let i = 1; i < snapshots.length; i++) {
			const dailyReturn =
				snapshots[i].dailyReturn ??
				(snapshots[i].totalValue - snapshots[i - 1].totalValue) / snapshots[i - 1].totalValue;
			returns.push(dailyReturn);
		}
		const cumulativeReturn =
			snapshots.length >= 2
				? (snapshots[snapshots.length - 1].totalValue - snapshots[0].totalValue) / snapshots[0].totalValue
				: 0;

		// Sharpe ratio
		const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
		const stdDev =
			returns.length > 0 ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length) : 0;
		const dailyRiskFreeRate = this.config.riskFreeRate / this.config.tradingDaysPerYear;
		const sharpeRatio =
			stdDev > 0 ? ((avgReturn - dailyRiskFreeRate) / stdDev) * Math.sqrt(this.config.tradingDaysPerYear) : 0;

		// Sortino ratio (downside deviation)
		const downsideReturns = returns.filter((r) => r < dailyRiskFreeRate);
		const downsideDev = Math.sqrt(
			downsideReturns.reduce((sum, r) => sum + (r - dailyRiskFreeRate) ** 2, 0) / (downsideReturns.length || 1),
		);
		const sortinoRatio =
			downsideDev > 0
				? ((avgReturn - dailyRiskFreeRate) / downsideDev) * Math.sqrt(this.config.tradingDaysPerYear)
				: 0;

		// Max drawdown
		const maxDrawdown = this.calculateMaxDrawdown(snapshots);

		// Annualized return
		const tradingDays = snapshots.length;
		const annualizedReturn =
			tradingDays > 0 ? (1 + cumulativeReturn) ** (this.config.tradingDaysPerYear / tradingDays) - 1 : 0;

		// Calmar ratio
		const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

		return {
			cumulativeReturn,
			annualizedReturn,
			sharpeRatio,
			sortinoRatio,
			maxDrawdown,
			winRate,
			profitFactor,
			avgTradePnl,
			totalTrades: closedTrades.length,
			calmarRatio,
		};
	}

	private calculateMaxDrawdown(snapshots: PortfolioSnapshot[]): number {
		if (snapshots.length === 0) return 0;

		let maxValue = snapshots[0].totalValue;
		let maxDrawdown = 0;

		for (const snapshot of snapshots) {
			if (snapshot.totalValue > maxValue) {
				maxValue = snapshot.totalValue;
			}
			const drawdown = (maxValue - snapshot.totalValue) / maxValue;
			if (drawdown > maxDrawdown) {
				maxDrawdown = drawdown;
			}
		}

		return maxDrawdown;
	}

	private emptyFinancialMetrics(): FinancialMetrics {
		return {
			cumulativeReturn: 0,
			annualizedReturn: 0,
			sharpeRatio: 0,
			sortinoRatio: 0,
			maxDrawdown: 0,
			winRate: 0,
			profitFactor: 0,
			avgTradePnl: 0,
			totalTrades: 0,
			calmarRatio: 0,
		};
	}

	// ==========================================================================
	// ECONOMIC METRICS
	// ==========================================================================

	/** Calculate economic value metrics */
	calculateEconomicMetrics(
		trades: TradeRecord[],
		agentId: string,
		periodStart: number,
		periodEnd: number,
	): EconomicMetrics {
		// Get costs from tracker
		const costs = this.costTracker.getAgentCosts(agentId, periodStart);
		const periodCosts = costs.filter((c) => c.timestamp <= periodEnd);

		const apiCost = periodCosts.reduce((sum, c) => sum + c.totalCost, 0);
		const totalTokens = periodCosts.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0);

		// Calculate trading profit
		const closedTrades = trades.filter(
			(t) => t.pnl !== undefined && t.exitTime && t.exitTime >= periodStart && t.exitTime <= periodEnd,
		);
		const grossProfit = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
		const transactionFees = closedTrades.reduce((sum, t) => sum + t.fees, 0);

		// Failed trades (rework penalty)
		const failedTrades = closedTrades.filter((t) => (t.pnl || 0) < 0);
		const reworkPenalty = Math.abs(failedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

		// Net profit
		const netProfit = grossProfit - apiCost;

		// Total Economic Impact
		const totalEconomicImpact = netProfit - reworkPenalty;

		// Cost to Complete
		const costToComplete = apiCost + transactionFees;

		// Return per cost
		const returnPerCost = costToComplete > 0 ? grossProfit / costToComplete : 0;

		// Cost efficiency (return per token)
		const costEfficiency = totalTokens > 0 ? grossProfit / totalTokens : 0;

		// Salary Replacement Index
		const periodDays = (periodEnd - periodStart) / (24 * 60 * 60 * 1000);
		const humanDailyCost = this.config.humanBenchmarkSalary / this.config.tradingDaysPerYear;
		const humanCostForPeriod = humanDailyCost * periodDays;
		const salaryReplacementIndex = humanCostForPeriod > 0 ? (netProfit / humanCostForPeriod) * 100 : 0;

		return {
			totalEconomicImpact,
			costToComplete,
			returnPerCost,
			costEfficiency,
			reworkPenalty,
			salaryReplacementIndex,
			netProfit,
			apiCost,
			transactionFees,
		};
	}

	// ==========================================================================
	// ADAPTABILITY METRICS
	// ==========================================================================

	/** Calculate adaptability metrics */
	calculateAdaptabilityMetrics(snapshots: PortfolioSnapshot[]): AdaptabilityMetrics {
		if (snapshots.length < 5) {
			return this.emptyAdaptabilityMetrics();
		}

		const returns = snapshots.map((s) => s.dailyReturn || 0);

		// Consistency score
		const variance = this.calculateVariance(returns);
		const consistencyScore = Math.max(0, 1 - variance / this.config.riskBudget ** 2);

		// Detect volatility shocks
		const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
		const stdDev = Math.sqrt(variance);
		const shockIndices = returns
			.map((r, i) => ({ index: i, isShock: Math.abs(r - avgReturn) > this.config.volatilityThreshold * stdDev }))
			.filter((x) => x.isShock)
			.map((x) => x.index);

		// Adaptability score: improvement after shocks
		let adaptabilityScore = 0.5; // Default neutral
		if (shockIndices.length > 0) {
			const postShockReturns = shockIndices
				.filter((i) => i + 5 < returns.length)
				.map((i) => returns.slice(i + 1, i + 6).reduce((a, b) => a + b, 0) / 5);

			if (postShockReturns.length > 0) {
				const avgPostShock = postShockReturns.reduce((a, b) => a + b, 0) / postShockReturns.length;
				adaptabilityScore =
					avgPostShock > avgReturn
						? Math.min(1, 0.5 + avgPostShock / avgReturn)
						: Math.max(0, 0.5 + avgPostShock / avgReturn);
			}
		}

		// Average recovery time from drawdowns
		const avgRecoveryTime = this.calculateAvgRecoveryTime(snapshots);

		// Volatility performance
		const volatilityPerformance = this.calculateVolatilityPerformance(snapshots);

		// Regime adaptation (simplified)
		const regimeAdaptation = this.calculateRegimeAdaptation(snapshots);

		return {
			consistencyScore,
			adaptabilityScore,
			avgRecoveryTime,
			volatilityPerformance,
			regimeAdaptation,
		};
	}

	private calculateVariance(values: number[]): number {
		if (values.length === 0) return 0;
		const mean = values.reduce((a, b) => a + b, 0) / values.length;
		return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	}

	private calculateAvgRecoveryTime(snapshots: PortfolioSnapshot[]): number {
		if (snapshots.length < 2) return 0;

		const recoveryTimes: number[] = [];
		let peak = snapshots[0].totalValue;
		let drawdownStart: number | null = null;

		for (let i = 1; i < snapshots.length; i++) {
			const value = snapshots[i].totalValue;

			if (value < peak) {
				if (drawdownStart === null) {
					drawdownStart = i;
				}
			} else {
				if (drawdownStart !== null) {
					recoveryTimes.push(i - drawdownStart);
					drawdownStart = null;
				}
				peak = value;
			}
		}

		return recoveryTimes.length > 0 ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length : 0;
	}

	private calculateVolatilityPerformance(snapshots: PortfolioSnapshot[]): number {
		if (snapshots.length < 10) return 0.5;

		const returns = snapshots.map((s) => s.dailyReturn || 0);
		const windowSize = 5;

		// Calculate rolling volatility
		const volatilities: number[] = [];
		for (let i = windowSize; i < returns.length; i++) {
			const window = returns.slice(i - windowSize, i);
			volatilities.push(Math.sqrt(this.calculateVariance(window)));
		}

		if (volatilities.length === 0) return 0.5;

		const avgVol = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
		const highVolIndices = volatilities.map((v, i) => ({ i, isHigh: v > avgVol * 1.5 })).filter((x) => x.isHigh);

		if (highVolIndices.length === 0) return 0.5;

		// Performance during high volatility periods
		const highVolReturns = highVolIndices.map((x) => returns[x.i + windowSize] || 0);
		const avgHighVolReturn = highVolReturns.reduce((a, b) => a + b, 0) / highVolReturns.length;
		const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

		return avgHighVolReturn >= avgReturn
			? Math.min(1, 0.5 + avgHighVolReturn * 10)
			: Math.max(0, 0.5 + avgHighVolReturn * 10);
	}

	private calculateRegimeAdaptation(snapshots: PortfolioSnapshot[]): number {
		// Simplified: compare first half vs second half performance
		if (snapshots.length < 20) return 0.5;

		const mid = Math.floor(snapshots.length / 2);
		const firstHalf = snapshots.slice(0, mid);
		const secondHalf = snapshots.slice(mid);

		const firstReturn =
			firstHalf.length > 1
				? (firstHalf[firstHalf.length - 1].totalValue - firstHalf[0].totalValue) / firstHalf[0].totalValue
				: 0;
		const secondReturn =
			secondHalf.length > 1
				? (secondHalf[secondHalf.length - 1].totalValue - secondHalf[0].totalValue) / secondHalf[0].totalValue
				: 0;

		// Higher score if second half improves
		if (secondReturn > firstReturn) {
			return Math.min(1, 0.5 + (secondReturn - firstReturn) * 5);
		}
		return Math.max(0, 0.5 + (secondReturn - firstReturn) * 5);
	}

	private emptyAdaptabilityMetrics(): AdaptabilityMetrics {
		return {
			consistencyScore: 0,
			adaptabilityScore: 0.5,
			avgRecoveryTime: 0,
			volatilityPerformance: 0.5,
			regimeAdaptation: 0.5,
		};
	}

	// ==========================================================================
	// BENCHMARK EXECUTION
	// ==========================================================================

	/** Run full benchmark */
	runBenchmark(
		name: string,
		agentId: string,
		trades?: TradeRecord[],
		snapshots?: PortfolioSnapshot[],
	): BenchmarkResult {
		const benchmarkTrades = trades || this.trades.filter((t) => t.agentId === agentId);
		const benchmarkSnapshots = snapshots || this.snapshots;

		if (benchmarkTrades.length < this.config.minTrades) {
			throw new Error(`Insufficient trades for benchmark: ${benchmarkTrades.length} < ${this.config.minTrades}`);
		}

		const startTime = Math.min(
			...benchmarkTrades.map((t) => t.entryTime),
			...benchmarkSnapshots.map((s) => s.timestamp),
		);
		const endTime = Math.max(
			...benchmarkTrades.map((t) => t.exitTime || t.entryTime),
			...benchmarkSnapshots.map((s) => s.timestamp),
		);

		// Calculate all metrics
		const financial = this.calculateFinancialMetrics(benchmarkTrades, benchmarkSnapshots);
		const economic = this.calculateEconomicMetrics(benchmarkTrades, agentId, startTime, endTime);
		const adaptability = this.calculateAdaptabilityMetrics(benchmarkSnapshots);

		// Calculate overall score (weighted average)
		const overallScore = this.calculateOverallScore(financial, economic, adaptability);
		const grade = this.getGrade(overallScore);

		// Baseline comparison
		const vsBaseline = this.calculateBaselineComparison(benchmarkSnapshots, financial.cumulativeReturn);

		const result: BenchmarkResult = {
			id: `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			name,
			startTime,
			endTime,
			durationMs: endTime - startTime,
			agentId,
			financial,
			economic,
			adaptability,
			overallScore,
			grade,
			vsBaseline,
			trades: benchmarkTrades,
			snapshots: benchmarkSnapshots,
		};

		this.benchmarkResults.push(result);
		this.emit("benchmarkComplete", result);

		return result;
	}

	private calculateOverallScore(
		financial: FinancialMetrics,
		economic: EconomicMetrics,
		adaptability: AdaptabilityMetrics,
	): number {
		// Weights for different metric categories
		const weights = {
			financial: 0.4,
			economic: 0.35,
			adaptability: 0.25,
		};

		// Normalize financial metrics (0-100)
		const financialScore =
			Math.min(100, Math.max(0, financial.sharpeRatio * 25)) * 0.3 +
			Math.min(100, financial.winRate * 100) * 0.25 +
			Math.min(100, Math.max(0, (1 - financial.maxDrawdown) * 100)) * 0.25 +
			Math.min(100, Math.max(0, financial.calmarRatio * 20)) * 0.2;

		// Normalize economic metrics (0-100)
		const economicScore =
			Math.min(100, Math.max(0, economic.returnPerCost * 10)) * 0.4 +
			Math.min(100, Math.max(0, economic.salaryReplacementIndex)) * 0.3 +
			Math.min(
				100,
				Math.max(0, economic.netProfit > 0 ? 50 + economic.netProfit / 100 : economic.netProfit / 100 + 50),
			) *
				0.3;

		// Normalize adaptability metrics (0-100)
		const adaptabilityScore =
			adaptability.consistencyScore * 100 * 0.3 +
			adaptability.adaptabilityScore * 100 * 0.3 +
			adaptability.volatilityPerformance * 100 * 0.2 +
			adaptability.regimeAdaptation * 100 * 0.2;

		return (
			weights.financial * financialScore +
			weights.economic * economicScore +
			weights.adaptability * adaptabilityScore
		);
	}

	private getGrade(score: number): string {
		if (score >= 90) return "A+";
		if (score >= 85) return "A";
		if (score >= 80) return "A-";
		if (score >= 75) return "B+";
		if (score >= 70) return "B";
		if (score >= 65) return "B-";
		if (score >= 60) return "C+";
		if (score >= 55) return "C";
		if (score >= 50) return "C-";
		if (score >= 45) return "D+";
		if (score >= 40) return "D";
		return "F";
	}

	private calculateBaselineComparison(
		snapshots: PortfolioSnapshot[],
		agentReturn: number,
	): { buyAndHold: number; randomWalk: number } {
		if (snapshots.length < 2) {
			return { buyAndHold: 0, randomWalk: 0 };
		}

		// Buy and hold baseline
		const buyAndHoldReturn =
			(snapshots[snapshots.length - 1].totalValue - snapshots[0].totalValue) / snapshots[0].totalValue;

		// Random walk baseline (average of random trades simulation)
		// Simplified: assume random walk returns ~0
		const randomWalkReturn = 0;

		return {
			buyAndHold: agentReturn - buyAndHoldReturn,
			randomWalk: agentReturn - randomWalkReturn,
		};
	}

	// ==========================================================================
	// GETTERS
	// ==========================================================================

	getTrades(agentId?: string, since?: number): TradeRecord[] {
		let filtered = this.trades;
		if (agentId) filtered = filtered.filter((t) => t.agentId === agentId);
		if (since) filtered = filtered.filter((t) => t.entryTime >= since);
		return filtered;
	}

	getSnapshots(since?: number): PortfolioSnapshot[] {
		return since ? this.snapshots.filter((s) => s.timestamp >= since) : this.snapshots;
	}

	getBenchmarkResults(limit?: number): BenchmarkResult[] {
		const results = [...this.benchmarkResults].reverse();
		return limit ? results.slice(0, limit) : results;
	}

	/** Format benchmark result as string */
	formatResult(result: BenchmarkResult): string {
		return `
## Benchmark: ${result.name}
**Agent:** ${result.agentId}
**Period:** ${new Date(result.startTime).toISOString()} - ${new Date(result.endTime).toISOString()}
**Overall Score:** ${result.overallScore.toFixed(1)}/100 (${result.grade})

### Financial Metrics
| Metric | Value |
|--------|-------|
| Cumulative Return | ${(result.financial.cumulativeReturn * 100).toFixed(2)}% |
| Sharpe Ratio | ${result.financial.sharpeRatio.toFixed(2)} |
| Max Drawdown | ${(result.financial.maxDrawdown * 100).toFixed(2)}% |
| Win Rate | ${(result.financial.winRate * 100).toFixed(1)}% |
| Profit Factor | ${result.financial.profitFactor.toFixed(2)} |
| Total Trades | ${result.financial.totalTrades} |

### Economic Value (TEI)
| Metric | Value |
|--------|-------|
| Total Economic Impact | $${result.economic.totalEconomicImpact.toFixed(2)} |
| Return per Cost | ${result.economic.returnPerCost.toFixed(2)}x |
| Net Profit | $${result.economic.netProfit.toFixed(2)} |
| API Cost | $${result.economic.apiCost.toFixed(4)} |
| Salary Replacement Index | ${result.economic.salaryReplacementIndex.toFixed(1)}% |

### Adaptability
| Metric | Value |
|--------|-------|
| Consistency Score | ${(result.adaptability.consistencyScore * 100).toFixed(1)}% |
| Adaptability Score | ${(result.adaptability.adaptabilityScore * 100).toFixed(1)}% |
| Volatility Performance | ${(result.adaptability.volatilityPerformance * 100).toFixed(1)}% |

### vs Baseline
- vs Buy & Hold: ${result.vsBaseline.buyAndHold >= 0 ? "+" : ""}${(result.vsBaseline.buyAndHold * 100).toFixed(2)}%
`.trim();
	}

	/** Clear all data */
	clear(): void {
		this.trades = [];
		this.snapshots = [];
		this.benchmarkResults = [];
	}
}

// Singleton
let benchmarkInstance: TradingBenchmark | null = null;

export function getTradingBenchmark(config?: Partial<BenchmarkConfig>): TradingBenchmark {
	if (!benchmarkInstance) {
		benchmarkInstance = new TradingBenchmark(config);
	}
	return benchmarkInstance;
}

// Convenience exports
export { getTradingBenchmark as getBenchmark };
