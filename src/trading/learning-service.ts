/**
 * Trading Learning Service
 * Connects trading outcomes to expertise system for self-improvement
 *
 * FIX: Now uses database persistence to survive restarts (fixes 0% win rate issue)
 * - Pending signals are persisted to database
 * - Outcomes are tracked historically
 * - Crash recovery loads signals on startup
 */

import { appendFile, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDatabase } from "../database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPERTISE_FILE = join(__dirname, "expertise", "trading.md");

// ============================================================================
// Types
// ============================================================================

export interface TradingOutcome {
	timestamp: string;
	symbol: string;
	action: "BUY" | "SELL" | "HOLD";
	entryPrice: number;
	exitPrice?: number;
	pnl?: number;
	success: boolean;
	confidence: number;
	marketCondition: "bull" | "bear" | "sideways" | "volatile";
	agents: string[];
	reason: string;
}

/** Pending signal waiting to be evaluated for outcome */
export interface PendingSignal {
	id: string;
	timestamp: number;
	symbol: string;
	action: "BUY" | "SELL" | "HOLD";
	entryPrice: number;
	confidence: number;
	agents: string[];
	evaluateAfterMs: number;
}

export interface SessionSummary {
	timestamp: string;
	marketCondition: string;
	signalsGenerated: number;
	successfulSignals: number;
	learnings: string[];
	patterns: string[];
	mistakes: string[];
	improvements: string[];
}

// ============================================================================
// Learning Service
// ============================================================================

// Default evaluation time: 15 minutes to see if signal played out
const DEFAULT_EVALUATE_MS = 15 * 60 * 1000;

// Background check interval: 1 minute
const CHECK_INTERVAL_MS = 60 * 1000;

class TradingLearningService {
	private outcomes: TradingOutcome[] = [];
	private sessionStartTime: number = Date.now();
	private pendingSignals: Map<string, PendingSignal> = new Map();
	private checkInterval: ReturnType<typeof setInterval> | null = null;
	private priceProvider: ((symbol: string) => Promise<number | null>) | null = null;
	private _dbInitialized = false;

	constructor() {
		// Load persisted signals from database (crash recovery)
		this.loadPersistedSignals();
		// Start background checker
		this.startBackgroundChecker();
	}

	/**
	 * Load persisted signals from database (crash recovery)
	 */
	private loadPersistedSignals(): void {
		try {
			const db = getDatabase();
			const signals = db.getPendingTradingSignals();
			for (const sig of signals) {
				const pendingSignal: PendingSignal = {
					id: sig.id,
					timestamp: sig.timestamp,
					symbol: sig.symbol,
					action: sig.action,
					entryPrice: sig.entry_price,
					confidence: sig.confidence,
					agents: JSON.parse(sig.agents),
					evaluateAfterMs: sig.evaluate_after_ms,
				};
				this.pendingSignals.set(sig.id, pendingSignal);
			}
			if (signals.length > 0) {
				console.log(`[TRADING-LEARNING] Recovered ${signals.length} pending signals from database`);
			}
			this._dbInitialized = true;
		} catch {
			// Database may not be initialized yet (during import)
			console.log("[TRADING-LEARNING] Database not available yet, will persist when ready");
			this._dbInitialized = false;
		}
	}

	/**
	 * Set price provider for automatic outcome evaluation
	 */
	setPriceProvider(provider: (symbol: string) => Promise<number | null>): void {
		this.priceProvider = provider;
		console.log("[TRADING-LEARNING] Price provider set for auto-outcome recording");
	}

	/**
	 * Track a signal for auto-outcome recording
	 * Called when /trading analyze generates a signal
	 * Now persists to database for crash recovery (fixes 0% win rate)
	 */
	async trackSignal(
		signal: Omit<PendingSignal, "id" | "evaluateAfterMs"> & { evaluateAfterMs?: number },
	): Promise<string> {
		const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const pendingSignal: PendingSignal = {
			...signal,
			id,
			evaluateAfterMs: signal.evaluateAfterMs ?? DEFAULT_EVALUATE_MS,
		};

		this.pendingSignals.set(id, pendingSignal);

		// Persist to database for crash recovery
		try {
			const db = getDatabase();
			db.saveTradingSignal({
				id,
				timestamp: pendingSignal.timestamp,
				symbol: pendingSignal.symbol,
				action: pendingSignal.action,
				entry_price: pendingSignal.entryPrice,
				confidence: pendingSignal.confidence,
				agents: JSON.stringify(pendingSignal.agents),
				evaluate_after_ms: pendingSignal.evaluateAfterMs,
			});
			this._dbInitialized = true;
		} catch (error) {
			console.warn("[TRADING-LEARNING] Could not persist signal to database:", error);
		}

		console.log(
			`[TRADING-LEARNING] Tracking signal ${id}: ${signal.action} ${signal.symbol} @ $${signal.entryPrice}`,
		);

		return id;
	}

	/**
	 * Start background checker for pending signals
	 */
	private startBackgroundChecker(): void {
		if (this.checkInterval) return;

		this.checkInterval = setInterval(() => {
			this.evaluatePendingSignals();
		}, CHECK_INTERVAL_MS);

		console.log("[TRADING-LEARNING] Background signal checker started (1m interval)");
	}

	/**
	 * Evaluate pending signals and record outcomes
	 */
	private async evaluatePendingSignals(): Promise<void> {
		if (!this.priceProvider) return;

		const now = Date.now();
		const toEvaluate: PendingSignal[] = [];

		// Find signals ready for evaluation
		for (const [_id, signal] of this.pendingSignals) {
			if (now - signal.timestamp >= signal.evaluateAfterMs) {
				toEvaluate.push(signal);
			}
		}

		// Evaluate each ready signal
		for (const signal of toEvaluate) {
			try {
				const currentPrice = await this.priceProvider(signal.symbol);
				if (currentPrice === null) {
					console.log(`[TRADING-LEARNING] Could not get price for ${signal.symbol}, skipping evaluation`);
					continue;
				}

				// Determine success based on action and price movement
				const priceDelta = currentPrice - signal.entryPrice;
				const priceDeltaPct = (priceDelta / signal.entryPrice) * 100;
				let success = false;

				if (signal.action === "BUY") {
					success = priceDelta > 0; // Price went up
				} else if (signal.action === "SELL") {
					success = priceDelta < 0; // Price went down
				} else {
					// HOLD - success if price didn't move much (< 1%)
					success = Math.abs(priceDeltaPct) < 1;
				}

				// Determine market condition from price movement
				let marketCondition: "bull" | "bear" | "sideways" | "volatile";
				if (priceDeltaPct > 3) {
					marketCondition = "bull";
				} else if (priceDeltaPct < -3) {
					marketCondition = "bear";
				} else if (Math.abs(priceDeltaPct) < 1) {
					marketCondition = "sideways";
				} else {
					marketCondition = "volatile";
				}

				// Record the outcome
				await this.recordOutcome({
					timestamp: new Date(signal.timestamp).toISOString(),
					symbol: signal.symbol,
					action: signal.action,
					entryPrice: signal.entryPrice,
					exitPrice: currentPrice,
					pnl: priceDeltaPct,
					success,
					confidence: signal.confidence,
					marketCondition,
					agents: signal.agents,
					reason: `Auto-evaluated after ${Math.round(signal.evaluateAfterMs / 60000)}m: ${priceDeltaPct > 0 ? "+" : ""}${priceDeltaPct.toFixed(2)}%`,
				});

				console.log(
					`[TRADING-LEARNING] Auto-recorded: ${signal.symbol} ${signal.action} ${success ? "SUCCESS" : "FAIL"} (${priceDeltaPct > 0 ? "+" : ""}${priceDeltaPct.toFixed(2)}%)`,
				);

				// Remove from pending (memory + database)
				this.pendingSignals.delete(signal.id);
				try {
					const db = getDatabase();
					db.deleteTradingSignal(signal.id);
				} catch {
					// Database may not be available
				}
			} catch (error) {
				console.error(`[TRADING-LEARNING] Error evaluating signal ${signal.id}:`, error);
			}
		}
	}

	/**
	 * Get pending signals count
	 */
	getPendingCount(): number {
		return this.pendingSignals.size;
	}

	/**
	 * Get pending signals info
	 */
	getPendingSignals(): PendingSignal[] {
		return Array.from(this.pendingSignals.values());
	}

	/**
	 * Record a trading outcome for learning
	 * Now also persists to database for historical tracking
	 */
	async recordOutcome(outcome: TradingOutcome): Promise<void> {
		this.outcomes.push(outcome);

		// Persist outcome to database for historical tracking
		try {
			const db = getDatabase();
			db.saveTradingOutcome({
				signal_id: null, // Could be linked if we have the signal ID
				timestamp: outcome.timestamp,
				symbol: outcome.symbol,
				action: outcome.action,
				entry_price: outcome.entryPrice,
				exit_price: outcome.exitPrice ?? null,
				pnl: outcome.pnl ?? null,
				success: outcome.success ? 1 : 0,
				confidence: outcome.confidence,
				market_condition: outcome.marketCondition,
				agents: JSON.stringify(outcome.agents),
				reason: outcome.reason,
			});
		} catch {
			// Database may not be available
		}

		// If we have enough outcomes, trigger a learning update
		// LOWERED threshold from 5 to 3 for faster learning
		if (this.outcomes.length >= 3 || Date.now() - this.sessionStartTime > 1800000) {
			await this.updateExpertise();
		}
	}

	/**
	 * Update expertise file with learnings
	 */
	async updateExpertise(): Promise<void> {
		if (this.outcomes.length === 0) return;

		try {
			const expertise = await readFile(EXPERTISE_FILE, "utf-8");
			const summary = this.generateSessionSummary();
			const sessionEntry = this.formatSessionEntry(summary);

			// Find the Session Insights section and prepend new entry
			const sessionMarker = "## Session Insights";
			const markerIndex = expertise.indexOf(sessionMarker);

			if (markerIndex === -1) {
				// Append to end if section not found
				await appendFile(EXPERTISE_FILE, `\n${sessionEntry}`);
			} else {
				// Insert after marker
				const beforeMarker = expertise.slice(0, markerIndex + sessionMarker.length);
				const afterMarker = expertise.slice(markerIndex + sessionMarker.length);

				// Keep only last 10 sessions
				const sessionsMatch = afterMarker.match(/### Session:/g);
				let trimmedAfter = afterMarker;
				if (sessionsMatch && sessionsMatch.length >= 10) {
					// Remove oldest session
					const lastSessionIndex = afterMarker.lastIndexOf("### Session:");
					trimmedAfter = afterMarker.slice(0, lastSessionIndex);
				}

				const updatedContent = `${beforeMarker}\n${sessionEntry}${trimmedAfter}`;
				await writeFile(EXPERTISE_FILE, updatedContent);
			}

			// Reset for next session
			this.outcomes = [];
			this.sessionStartTime = Date.now();

			console.log(`[TRADING-LEARNING] Updated expertise with ${summary.signalsGenerated} signals`);
		} catch (error) {
			console.error("[TRADING-LEARNING] Failed to update expertise:", error);
		}
	}

	/**
	 * Generate summary from recorded outcomes
	 */
	private generateSessionSummary(): SessionSummary {
		const now = new Date().toISOString();
		const successful = this.outcomes.filter((o) => o.success).length;
		const total = this.outcomes.length;

		// Determine dominant market condition
		const conditions = this.outcomes.map((o) => o.marketCondition);
		const conditionCounts = conditions.reduce(
			(acc, c) => {
				acc[c] = (acc[c] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);
		const dominantCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

		// Extract patterns from successful trades
		const successfulOutcomes = this.outcomes.filter((o) => o.success);
		const patterns = successfulOutcomes
			.map((o) => `${o.action} at ${o.confidence.toFixed(2)} confidence worked`)
			.slice(0, 3);

		// Extract mistakes from failed trades
		const failedOutcomes = this.outcomes.filter((o) => !o.success);
		const mistakes = failedOutcomes
			.map((o) => `${o.action} ${o.symbol} failed despite ${o.confidence.toFixed(2)} confidence`)
			.slice(0, 3);

		// Generate learnings
		const learnings: string[] = [];
		const winRate = total > 0 ? (successful / total) * 100 : 0;

		if (winRate > 70) {
			learnings.push(
				`High win rate (${winRate.toFixed(1)}%) - current strategy is effective in ${dominantCondition} market`,
			);
		} else if (winRate < 30) {
			learnings.push(
				`Low win rate (${winRate.toFixed(1)}%) - need to adjust strategy for ${dominantCondition} market`,
			);
		}

		// Confidence calibration
		const avgSuccessConfidence =
			successfulOutcomes.length > 0
				? successfulOutcomes.reduce((sum, o) => sum + o.confidence, 0) / successfulOutcomes.length
				: 0;
		const avgFailConfidence =
			failedOutcomes.length > 0
				? failedOutcomes.reduce((sum, o) => sum + o.confidence, 0) / failedOutcomes.length
				: 0;

		if (avgFailConfidence > avgSuccessConfidence) {
			learnings.push("Confidence scores need recalibration - high confidence signals are underperforming");
		}

		// Generate improvements
		const improvements: string[] = [];
		if (winRate < 50) {
			improvements.push("Consider more conservative entry criteria");
		}
		if (failedOutcomes.some((o) => o.confidence > 0.8)) {
			improvements.push("Review high-confidence signal criteria - some are failing");
		}

		return {
			timestamp: now,
			marketCondition: dominantCondition,
			signalsGenerated: total,
			successfulSignals: successful,
			learnings,
			patterns,
			mistakes,
			improvements,
		};
	}

	/**
	 * Format session entry for markdown
	 */
	private formatSessionEntry(summary: SessionSummary): string {
		return `
### Session: ${summary.timestamp}
**Market Condition:** ${summary.marketCondition}
**Signals Generated:** ${summary.signalsGenerated}
**Successful Signals:** ${summary.successfulSignals}
**Win Rate:** ${summary.signalsGenerated > 0 ? ((summary.successfulSignals / summary.signalsGenerated) * 100).toFixed(1) : 0}%

**Learning:**
${summary.learnings.map((l) => `- ${l}`).join("\n") || "- No significant learnings this session"}

**Patterns Discovered:**
${summary.patterns.map((p) => `- ${p}`).join("\n") || "- No new patterns identified"}

**Mistakes Made:**
${summary.mistakes.map((m) => `- ${m}`).join("\n") || "- No notable mistakes"}

**Improvements for Next Session:**
${summary.improvements.map((i) => `- ${i}`).join("\n") || "- Continue current approach"}

---
`;
	}

	/**
	 * Load expertise for trading context
	 */
	async loadExpertise(): Promise<string> {
		try {
			return await readFile(EXPERTISE_FILE, "utf-8");
		} catch {
			return "No expertise file found - starting fresh";
		}
	}

	/**
	 * Get learning stats
	 */
	getStats(): TradingStats {
		const total = this.outcomes.length;
		const successful = this.outcomes.filter((o) => o.success).length;
		const winRate = total > 0 ? (successful / total) * 100 : 0;

		// Calculate accuracy by market condition
		const conditionStats = this.outcomes.reduce(
			(acc, o) => {
				if (!acc[o.marketCondition]) {
					acc[o.marketCondition] = { total: 0, correct: 0 };
				}
				acc[o.marketCondition].total++;
				if (o.success) acc[o.marketCondition].correct++;
				return acc;
			},
			{} as Record<string, { total: number; correct: number }>,
		);

		const conditionAccuracy = Object.entries(conditionStats).map(([condition, stats]) => ({
			condition,
			accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
			total: stats.total,
		}));

		// Calculate average confidence by outcome
		const avgConfidenceWin =
			successful > 0
				? this.outcomes.filter((o) => o.success).reduce((sum, o) => sum + o.confidence, 0) / successful
				: 0;
		const avgConfidenceLoss =
			total - successful > 0
				? this.outcomes.filter((o) => !o.success).reduce((sum, o) => sum + o.confidence, 0) / (total - successful)
				: 0;

		// Recent trend (last 10 vs previous 10)
		const recentOutcomes = this.outcomes.slice(-10);
		const previousOutcomes = this.outcomes.slice(-20, -10);
		const recentWinRate =
			recentOutcomes.length > 0 ? (recentOutcomes.filter((o) => o.success).length / recentOutcomes.length) * 100 : 0;
		const previousWinRate =
			previousOutcomes.length > 0
				? (previousOutcomes.filter((o) => o.success).length / previousOutcomes.length) * 100
				: 0;
		const trend = recentWinRate - previousWinRate;

		// Get historical stats from database if available
		let historical: TradingStats["historical"];
		try {
			const db = getDatabase();
			const dbStats = db.getTradingOutcomeStats();
			historical = {
				total: dbStats.total,
				successful: dbStats.successful,
				winRate: dbStats.winRate,
				avgPnl: dbStats.avgPnl,
			};
		} catch {
			historical = undefined;
		}

		return {
			outcomes: total,
			successful,
			winRate,
			sessionAge: Date.now() - this.sessionStartTime,
			conditionAccuracy,
			avgConfidenceWin,
			avgConfidenceLoss,
			recentWinRate,
			trend,
			isImproving: trend > 0,
			pendingSignals: this.pendingSignals.size,
			historical,
		};
	}

	/**
	 * Get formatted stats for Discord display
	 */
	getFormattedStats(): string {
		const stats = this.getStats();
		const sessionMinutes = Math.floor(stats.sessionAge / 60000);

		let output = `**Trading Learning Stats**\n\n`;

		// Session stats (in-memory)
		output += `**Current Session**\n`;
		output += `- Duration: ${sessionMinutes} minutes\n`;
		output += `- Total Signals: ${stats.outcomes}\n`;
		output += `- Successful: ${stats.successful}\n`;
		output += `- Win Rate: ${stats.winRate.toFixed(1)}%\n`;
		output += `- Pending Signals: ${stats.pendingSignals}\n\n`;

		// Historical stats (from database)
		if (stats.historical && stats.historical.total > 0) {
			output += `**Historical (All-Time)**\n`;
			output += `- Total Trades: ${stats.historical.total}\n`;
			output += `- Successful: ${stats.historical.successful}\n`;
			output += `- Win Rate: ${stats.historical.winRate.toFixed(1)}%\n`;
			output += `- Avg P&L: ${stats.historical.avgPnl > 0 ? "+" : ""}${stats.historical.avgPnl.toFixed(2)}%\n\n`;
		}

		output += `**Confidence Calibration**\n`;
		output += `- Avg Confidence (Wins): ${(stats.avgConfidenceWin * 100).toFixed(1)}%\n`;
		output += `- Avg Confidence (Losses): ${(stats.avgConfidenceLoss * 100).toFixed(1)}%\n`;
		output += `- Calibrated: ${stats.avgConfidenceWin > stats.avgConfidenceLoss ? "Yes" : "Needs work"}\n\n`;

		output += `**Market Condition Accuracy**\n`;
		for (const cond of stats.conditionAccuracy) {
			output += `- ${cond.condition}: ${cond.accuracy.toFixed(1)}% (${cond.total} signals)\n`;
		}

		output += `\n**Trend**\n`;
		output += `- Recent Win Rate: ${stats.recentWinRate.toFixed(1)}%\n`;
		output += `- Trend: ${stats.trend > 0 ? "+" : ""}${stats.trend.toFixed(1)}% ${stats.isImproving ? "(improving)" : "(declining)"}\n`;

		return output;
	}

	/**
	 * Check if database is initialized for persistence
	 */
	get isDatabaseReady(): boolean {
		return this._dbInitialized;
	}
}

// Stats type
export interface TradingStats {
	outcomes: number;
	successful: number;
	winRate: number;
	sessionAge: number;
	conditionAccuracy: Array<{ condition: string; accuracy: number; total: number }>;
	avgConfidenceWin: number;
	avgConfidenceLoss: number;
	recentWinRate: number;
	trend: number;
	isImproving: boolean;
	pendingSignals: number;
	// Historical stats from database (if available)
	historical?: {
		total: number;
		successful: number;
		winRate: number;
		avgPnl: number;
	};
}

/**
 * Get historical stats from database
 * This provides persistent stats across restarts
 */
export function getHistoricalStats(): {
	total: number;
	successful: number;
	winRate: number;
	avgPnl: number;
	byMarketCondition: Array<{ condition: string; total: number; successful: number; winRate: number }>;
} | null {
	try {
		const db = getDatabase();
		return db.getTradingOutcomeStats();
	} catch {
		return null;
	}
}

// Singleton instance
export const tradingLearning = new TradingLearningService();
