/**
 * RBI Framework Agent
 * Implements Moon Dev's systematic approach: Research → Backtest → Implement
 *
 * Key Principles:
 * - Never build a trading bot without thorough research and backtesting
 * - Document all strategies with clear entry/exit rules
 * - Start with minimal positions ($10) and scale gradually
 *
 * @see https://github.com/moondevonyt/moon-dev-trading-bots
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradeSignal } from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface ResearchItem {
	id: string;
	title: string;
	source: "academic" | "trading_book" | "podcast" | "video" | "expert";
	url?: string;
	summary: string;
	keyInsights: string[];
	potentialStrategies: string[];
	createdAt: number;
	tags: string[];
}

export interface BacktestResult {
	id: string;
	strategyId: string;
	strategyName: string;
	symbol: string;
	timeframe: string;
	startDate: number;
	endDate: number;
	// Performance metrics
	totalReturn: number;
	totalReturnPercent: number;
	sharpeRatio: number;
	sortinoRatio: number;
	maxDrawdown: number;
	maxDrawdownPercent: number;
	winRate: number;
	profitFactor: number;
	// Trade stats
	totalTrades: number;
	winningTrades: number;
	losingTrades: number;
	avgWin: number;
	avgLoss: number;
	avgHoldingPeriod: number; // in hours
	// Risk metrics
	var95: number; // Value at Risk 95%
	cvar95: number; // Conditional VaR
	calmarRatio: number;
	// Validation
	isValid: boolean;
	validationNotes: string[];
	createdAt: number;
}

export interface TradingStrategy {
	id: string;
	name: string;
	description: string;
	// Research phase
	researchItems: string[]; // Research item IDs
	hypothesis: string;
	// Rules
	entryRules: StrategyRule[];
	exitRules: StrategyRule[];
	riskRules: StrategyRule[];
	// Parameters
	parameters: Record<string, number | string | boolean>;
	// Status
	phase: "research" | "backtest" | "paper" | "live" | "archived";
	backtestResults: string[]; // Backtest result IDs
	// Paper trading
	paperTradingStartDate?: number;
	paperTradingResults?: {
		trades: number;
		pnl: number;
		winRate: number;
	};
	// Live trading
	liveStartDate?: number;
	positionSize: number; // $ amount
	maxPositions: number;
	// Metadata
	createdAt: number;
	updatedAt: number;
	tags: string[];
}

export interface StrategyRule {
	id: string;
	type: "entry" | "exit" | "risk";
	condition: string;
	description: string;
	priority: number;
}

interface RBIConfig extends AgentConfig {
	minBacktestPeriod: number; // Minimum days of backtesting
	minWinRate: number; // Minimum win rate to pass validation
	minSharpeRatio: number; // Minimum Sharpe ratio
	maxDrawdown: number; // Maximum acceptable drawdown %
	paperTradingPeriod: number; // Days of paper trading before live
	initialPositionSize: number; // Starting position size ($)
}

// ============================================================================
// RBI Framework Agent
// ============================================================================

export class RBIFrameworkAgent extends BaseAgent {
	private research: Map<string, ResearchItem> = new Map();
	private backtests: Map<string, BacktestResult> = new Map();
	private strategies: Map<string, TradingStrategy> = new Map();
	private rbiConfig: RBIConfig;

	constructor(config: Partial<RBIConfig> = {}) {
		const fullConfig: RBIConfig = {
			name: "RBIFrameworkAgent",
			enabled: true,
			interval: 3600000, // 1 hour
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			minBacktestPeriod: 90, // 90 days minimum
			minWinRate: 0.45, // 45% minimum
			minSharpeRatio: 1.0, // Sharpe > 1
			maxDrawdown: 0.25, // 25% max drawdown
			paperTradingPeriod: 14, // 2 weeks paper
			initialPositionSize: 10, // Start with $10
			...config,
		};
		super(fullConfig);
		this.rbiConfig = fullConfig;
	}

	/**
	 * Main agent loop - checks strategies and generates signals
	 */
	protected async run(): Promise<void> {
		const liveStrategies = this.getStrategies("live");

		for (const strategy of liveStrategies) {
			// Check if any entry rules are triggered
			const signals = await this.checkStrategySignals(strategy);
			for (const signal of signals) {
				await this.emitSignal(signal);
			}
		}
	}

	/**
	 * Check strategy rules and generate signals
	 */
	private async checkStrategySignals(strategy: TradingStrategy): Promise<TradeSignal[]> {
		const signals: TradeSignal[] = [];
		const _now = Date.now(); // Reserved for timing checks

		// This is a placeholder - in production, you'd connect to market data
		// and evaluate the strategy rules against live data
		for (const symbol of this.config.symbols) {
			// Log that we're checking (actual rule evaluation would go here)
			console.log(`[RBI] Checking ${strategy.name} for ${symbol}`);
		}

		return signals;
	}

	// ========================================================================
	// Research Phase
	// ========================================================================

	/**
	 * Add research item to the backlog
	 */
	addResearch(item: Omit<ResearchItem, "id" | "createdAt">): ResearchItem {
		const research: ResearchItem = {
			...item,
			id: `research-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			createdAt: Date.now(),
		};

		this.research.set(research.id, research);
		console.log(`[RBI] Added research: ${research.title}`);

		return research;
	}

	/**
	 * Get all research items
	 */
	getResearch(filter?: { source?: string; tag?: string }): ResearchItem[] {
		let items = Array.from(this.research.values());

		if (filter?.source) {
			const source = filter.source;
			items = items.filter((r) => r.source === source);
		}
		if (filter?.tag) {
			const tag = filter.tag;
			items = items.filter((r) => r.tags.includes(tag));
		}

		return items.sort((a, b) => b.createdAt - a.createdAt);
	}

	/**
	 * Create strategy from research
	 */
	createStrategy(name: string, description: string, hypothesis: string, researchIds: string[]): TradingStrategy {
		const strategy: TradingStrategy = {
			id: `strategy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			name,
			description,
			researchItems: researchIds,
			hypothesis,
			entryRules: [],
			exitRules: [],
			riskRules: [],
			parameters: {},
			phase: "research",
			backtestResults: [],
			positionSize: this.rbiConfig.initialPositionSize,
			maxPositions: 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			tags: [],
		};

		this.strategies.set(strategy.id, strategy);
		console.log(`[RBI] Created strategy: ${name} (${strategy.id})`);

		return strategy;
	}

	/**
	 * Add rule to strategy
	 */
	addRule(strategyId: string, rule: Omit<StrategyRule, "id">): StrategyRule | null {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return null;

		const newRule: StrategyRule = {
			...rule,
			id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
		};

		switch (rule.type) {
			case "entry":
				strategy.entryRules.push(newRule);
				break;
			case "exit":
				strategy.exitRules.push(newRule);
				break;
			case "risk":
				strategy.riskRules.push(newRule);
				break;
		}

		strategy.updatedAt = Date.now();
		return newRule;
	}

	// ========================================================================
	// Backtest Phase
	// ========================================================================

	/**
	 * Record backtest result
	 */
	recordBacktest(
		strategyId: string,
		result: Omit<BacktestResult, "id" | "createdAt" | "isValid" | "validationNotes">,
	): BacktestResult | null {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return null;

		// Validate the backtest
		const validationNotes: string[] = [];
		let isValid = true;

		// Check minimum period
		const periodDays = (result.endDate - result.startDate) / (1000 * 60 * 60 * 24);
		if (periodDays < this.rbiConfig.minBacktestPeriod) {
			validationNotes.push(
				`Period too short: ${periodDays.toFixed(0)} days (min: ${this.rbiConfig.minBacktestPeriod})`,
			);
			isValid = false;
		}

		// Check win rate
		if (result.winRate < this.rbiConfig.minWinRate) {
			validationNotes.push(
				`Win rate too low: ${(result.winRate * 100).toFixed(1)}% (min: ${this.rbiConfig.minWinRate * 100}%)`,
			);
			isValid = false;
		}

		// Check Sharpe ratio
		if (result.sharpeRatio < this.rbiConfig.minSharpeRatio) {
			validationNotes.push(
				`Sharpe ratio too low: ${result.sharpeRatio.toFixed(2)} (min: ${this.rbiConfig.minSharpeRatio})`,
			);
			isValid = false;
		}

		// Check max drawdown
		if (result.maxDrawdownPercent > this.rbiConfig.maxDrawdown) {
			validationNotes.push(
				`Drawdown too high: ${(result.maxDrawdownPercent * 100).toFixed(1)}% (max: ${this.rbiConfig.maxDrawdown * 100}%)`,
			);
			isValid = false;
		}

		// Check minimum trades
		if (result.totalTrades < 30) {
			validationNotes.push(`Insufficient trades: ${result.totalTrades} (min: 30 for statistical significance)`);
			isValid = false;
		}

		// Check profit factor
		if (result.profitFactor < 1.2) {
			validationNotes.push(`Profit factor too low: ${result.profitFactor.toFixed(2)} (min: 1.2)`);
			// Warning but not invalid
		}

		if (isValid) {
			validationNotes.push("Backtest PASSED all validation criteria");
		}

		const backtest: BacktestResult = {
			...result,
			id: `backtest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			isValid,
			validationNotes,
			createdAt: Date.now(),
		};

		this.backtests.set(backtest.id, backtest);
		strategy.backtestResults.push(backtest.id);

		// Auto-advance to paper trading if valid
		if (isValid && strategy.phase === "research") {
			strategy.phase = "backtest";
			console.log(`[RBI] Strategy ${strategy.name} advanced to backtest phase`);
		}

		return backtest;
	}

	/**
	 * Get backtest results for strategy
	 */
	getBacktestResults(strategyId: string): BacktestResult[] {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return [];

		return strategy.backtestResults
			.map((id) => this.backtests.get(id))
			.filter((b): b is BacktestResult => b !== undefined);
	}

	// ========================================================================
	// Implementation Phase
	// ========================================================================

	/**
	 * Promote strategy to paper trading
	 */
	startPaperTrading(strategyId: string): boolean {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return false;

		// Check if has valid backtest
		const backtests = this.getBacktestResults(strategyId);
		const hasValidBacktest = backtests.some((b) => b.isValid);

		if (!hasValidBacktest) {
			console.warn(`[RBI] Cannot start paper trading: no valid backtest for ${strategy.name}`);
			return false;
		}

		strategy.phase = "paper";
		strategy.paperTradingStartDate = Date.now();
		strategy.paperTradingResults = {
			trades: 0,
			pnl: 0,
			winRate: 0,
		};
		strategy.updatedAt = Date.now();

		console.log(`[RBI] Started paper trading for ${strategy.name}`);
		return true;
	}

	/**
	 * Update paper trading results
	 */
	updatePaperResults(strategyId: string, trades: number, pnl: number, winRate: number): void {
		const strategy = this.strategies.get(strategyId);
		if (!strategy || strategy.phase !== "paper") return;

		strategy.paperTradingResults = { trades, pnl, winRate };
		strategy.updatedAt = Date.now();
	}

	/**
	 * Promote strategy to live trading
	 */
	goLive(strategyId: string): boolean {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return false;

		if (strategy.phase !== "paper") {
			console.warn(`[RBI] Cannot go live: strategy ${strategy.name} not in paper phase`);
			return false;
		}

		// Check paper trading period
		if (!strategy.paperTradingStartDate) return false;

		const paperDays = (Date.now() - strategy.paperTradingStartDate) / (1000 * 60 * 60 * 24);
		if (paperDays < this.rbiConfig.paperTradingPeriod) {
			console.warn(
				`[RBI] Cannot go live: only ${paperDays.toFixed(0)} days of paper trading (min: ${this.rbiConfig.paperTradingPeriod})`,
			);
			return false;
		}

		// Check paper trading performance
		const results = strategy.paperTradingResults;
		if (!results || results.trades < 10) {
			console.warn(`[RBI] Cannot go live: insufficient paper trades (${results?.trades || 0})`);
			return false;
		}

		if (results.winRate < this.rbiConfig.minWinRate) {
			console.warn(`[RBI] Cannot go live: paper win rate too low (${(results.winRate * 100).toFixed(1)}%)`);
			return false;
		}

		strategy.phase = "live";
		strategy.liveStartDate = Date.now();
		strategy.positionSize = this.rbiConfig.initialPositionSize; // Start with min
		strategy.updatedAt = Date.now();

		console.log(`[RBI] Strategy ${strategy.name} is now LIVE with $${strategy.positionSize} position size`);
		return true;
	}

	/**
	 * Scale up position size
	 */
	scalePosition(strategyId: string, newSize: number): boolean {
		const strategy = this.strategies.get(strategyId);
		if (!strategy || strategy.phase !== "live") return false;

		// Only allow gradual scaling (max 2x per scale)
		if (newSize > strategy.positionSize * 2) {
			console.warn(`[RBI] Scaling too aggressive: max 2x per scale operation`);
			return false;
		}

		strategy.positionSize = newSize;
		strategy.updatedAt = Date.now();

		console.log(`[RBI] Scaled ${strategy.name} position to $${newSize}`);
		return true;
	}

	/**
	 * Archive a strategy
	 */
	archiveStrategy(strategyId: string, reason: string): void {
		const strategy = this.strategies.get(strategyId);
		if (!strategy) return;

		strategy.phase = "archived";
		strategy.tags.push(`archived:${reason}`);
		strategy.updatedAt = Date.now();

		console.log(`[RBI] Archived strategy ${strategy.name}: ${reason}`);
	}

	// ========================================================================
	// BaseAgent Implementation
	// ========================================================================

	async analyze(): Promise<TradeSignal[]> {
		const signals: TradeSignal[] = [];

		// Get live strategies
		const liveStrategies = Array.from(this.strategies.values()).filter((s) => s.phase === "live");

		for (const strategy of liveStrategies) {
			// This would integrate with actual strategy execution
			// For now, we just track strategy status
			console.log(`[RBI] Monitoring live strategy: ${strategy.name} ($${strategy.positionSize})`);
		}

		return signals;
	}

	// ========================================================================
	// Stats & Reporting
	// ========================================================================

	getStats(): {
		research: number;
		strategies: { total: number; byPhase: Record<string, number> };
		backtests: { total: number; valid: number };
	} {
		const byPhase: Record<string, number> = {
			research: 0,
			backtest: 0,
			paper: 0,
			live: 0,
			archived: 0,
		};

		for (const s of this.strategies.values()) {
			byPhase[s.phase] = (byPhase[s.phase] || 0) + 1;
		}

		const backtestArray = Array.from(this.backtests.values());

		return {
			research: this.research.size,
			strategies: {
				total: this.strategies.size,
				byPhase,
			},
			backtests: {
				total: this.backtests.size,
				valid: backtestArray.filter((b) => b.isValid).length,
			},
		};
	}

	getFormattedStats(): string {
		const stats = this.getStats();

		return [
			"**RBI Framework Stats**",
			"",
			"**Research**",
			`Items: ${stats.research}`,
			"",
			"**Strategies**",
			`Total: ${stats.strategies.total}`,
			`Research: ${stats.strategies.byPhase.research}`,
			`Backtest: ${stats.strategies.byPhase.backtest}`,
			`Paper: ${stats.strategies.byPhase.paper}`,
			`Live: ${stats.strategies.byPhase.live}`,
			`Archived: ${stats.strategies.byPhase.archived}`,
			"",
			"**Backtests**",
			`Total: ${stats.backtests.total}`,
			`Valid: ${stats.backtests.valid}`,
			"",
			"**Validation Criteria**",
			`Min Period: ${this.rbiConfig.minBacktestPeriod} days`,
			`Min Win Rate: ${this.rbiConfig.minWinRate * 100}%`,
			`Min Sharpe: ${this.rbiConfig.minSharpeRatio}`,
			`Max Drawdown: ${this.rbiConfig.maxDrawdown * 100}%`,
		].join("\n");
	}

	/**
	 * Get all strategies
	 */
	getStrategies(phase?: string): TradingStrategy[] {
		let strategies = Array.from(this.strategies.values());

		if (phase) {
			strategies = strategies.filter((s) => s.phase === phase);
		}

		return strategies.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/**
	 * Get strategy by ID
	 */
	getStrategy(id: string): TradingStrategy | undefined {
		return this.strategies.get(id);
	}
}
