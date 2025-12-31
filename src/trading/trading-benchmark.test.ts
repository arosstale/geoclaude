/**
 * Tests for Trading Benchmark System
 * Based on TradingAgents, INVESTORBENCH, and LiveTradeBench methodologies
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	type BenchmarkConfig,
	getTradingBenchmark,
	type PortfolioSnapshot,
	type TradeRecord,
	TradingBenchmark,
} from "./trading-benchmark.js";

describe("TradingBenchmark", () => {
	let benchmark: TradingBenchmark;

	beforeEach(() => {
		benchmark = new TradingBenchmark();
		benchmark.clear();
	});

	describe("Trade Recording", () => {
		it("should record a trade with auto-generated ID", () => {
			const trade = benchmark.recordTrade({
				agentId: "test-agent",
				symbol: "BTC",
				side: "buy",
				entryPrice: 50000,
				quantity: 0.1,
				entryTime: Date.now(),
				fees: 5,
			});

			expect(trade.id).toMatch(/^trade_/);
			expect(trade.agentId).toBe("test-agent");
			expect(trade.symbol).toBe("BTC");
		});

		it("should calculate PnL when exit price is provided", () => {
			const trade = benchmark.recordTrade({
				agentId: "test-agent",
				symbol: "ETH",
				side: "buy",
				entryPrice: 3000,
				exitPrice: 3300,
				quantity: 1,
				entryTime: Date.now() - 1000,
				exitTime: Date.now(),
				fees: 10,
			});

			expect(trade.pnl).toBe(290); // (3300 - 3000) * 1 - 10
			expect(trade.pnlPercent).toBeCloseTo(9.67, 1); // 290 / 3000 * 100
		});

		it("should calculate PnL for short trades", () => {
			const trade = benchmark.recordTrade({
				agentId: "test-agent",
				symbol: "SOL",
				side: "sell",
				entryPrice: 100,
				exitPrice: 90,
				quantity: 10,
				entryTime: Date.now(),
				fees: 5,
			});

			expect(trade.pnl).toBe(95); // (100 - 90) * 10 - 5
		});

		it("should close an open trade", () => {
			const trade = benchmark.recordTrade({
				agentId: "test-agent",
				symbol: "BTC",
				side: "buy",
				entryPrice: 50000,
				quantity: 0.1,
				entryTime: Date.now(),
				fees: 5,
			});

			const closed = benchmark.closeTrade(trade.id, 55000);

			expect(closed).not.toBeNull();
			expect(closed!.exitPrice).toBe(55000);
			expect(closed!.pnl).toBe(495); // (55000 - 50000) * 0.1 - 5
		});
	});

	describe("Portfolio Snapshots", () => {
		it("should record snapshots with daily return calculation", () => {
			benchmark.recordSnapshot({
				timestamp: Date.now() - 86400000,
				totalValue: 10000,
				cash: 5000,
				positions: [{ symbol: "BTC", quantity: 0.1, avgPrice: 50000, currentPrice: 50000, pnl: 0 }],
			});

			benchmark.recordSnapshot({
				timestamp: Date.now(),
				totalValue: 10500,
				cash: 5000,
				positions: [{ symbol: "BTC", quantity: 0.1, avgPrice: 50000, currentPrice: 55000, pnl: 500 }],
			});

			const snapshots = benchmark.getSnapshots();
			expect(snapshots).toHaveLength(2);
			expect(snapshots[1].dailyReturn).toBeCloseTo(0.05, 2); // 5% return
		});
	});

	describe("Financial Metrics", () => {
		it("should calculate win rate correctly", () => {
			const trades: TradeRecord[] = [
				createTrade("buy", 100, 110, 10, 1), // Win: +99
				createTrade("buy", 100, 105, 10, 1), // Win: +49
				createTrade("buy", 100, 95, 10, 1), // Loss: -51
				createTrade("buy", 100, 90, 10, 1), // Loss: -101
			];

			const snapshots = createSnapshots(10000, [0.01, 0.005, -0.005, -0.01]);
			const metrics = benchmark.calculateFinancialMetrics(trades, snapshots);

			expect(metrics.winRate).toBe(0.5);
			expect(metrics.totalTrades).toBe(4);
		});

		it("should calculate profit factor correctly", () => {
			const trades: TradeRecord[] = [
				createTrade("buy", 100, 120, 10, 1), // Win: +199
				createTrade("buy", 100, 80, 10, 1), // Loss: -201
			];

			const snapshots = createSnapshots(10000, [0.02, -0.02]);
			const metrics = benchmark.calculateFinancialMetrics(trades, snapshots);

			expect(metrics.profitFactor).toBeCloseTo(0.99, 1);
		});

		it("should calculate max drawdown", () => {
			const snapshots: PortfolioSnapshot[] = [
				{ timestamp: 1, totalValue: 10000, cash: 0, positions: [], dailyReturn: 0 },
				{ timestamp: 2, totalValue: 11000, cash: 0, positions: [], dailyReturn: 0.1 },
				{ timestamp: 3, totalValue: 9000, cash: 0, positions: [], dailyReturn: -0.18 },
				{ timestamp: 4, totalValue: 10500, cash: 0, positions: [], dailyReturn: 0.17 },
			];

			const metrics = benchmark.calculateFinancialMetrics([], snapshots);

			// Max drawdown from 11000 to 9000 = 18.18%
			expect(metrics.maxDrawdown).toBeCloseTo(0.1818, 2);
		});

		it("should calculate Sharpe ratio", () => {
			const snapshots = createSnapshots(10000, [0.01, 0.02, 0.015, -0.005, 0.01]);
			const metrics = benchmark.calculateFinancialMetrics([], snapshots);

			expect(metrics.sharpeRatio).toBeGreaterThan(0);
		});
	});

	describe("Economic Metrics", () => {
		it("should calculate return per cost", () => {
			const trades: TradeRecord[] = [
				createTrade("buy", 100, 150, 10, 1), // Profit: +499
			];

			const metrics = benchmark.calculateEconomicMetrics(trades, "test-agent", Date.now() - 100000, Date.now());

			// No API costs tracked in test, so based on transaction fees only
			expect(metrics.transactionFees).toBe(1);
		});

		it("should calculate rework penalty from failed trades", () => {
			const now = Date.now();
			const trades: TradeRecord[] = [
				{ ...createTrade("buy", 100, 90, 10, 1), exitTime: now }, // Loss
				{ ...createTrade("buy", 100, 110, 10, 1), exitTime: now }, // Win
			];

			const metrics = benchmark.calculateEconomicMetrics(trades, "test-agent", now - 100000, now);

			expect(metrics.reworkPenalty).toBe(101); // Loss from failed trade
		});
	});

	describe("Adaptability Metrics", () => {
		it("should calculate consistency score", () => {
			// Low variance returns = high consistency
			const snapshots = createSnapshots(10000, [0.01, 0.01, 0.01, 0.01, 0.01]);
			const metrics = benchmark.calculateAdaptabilityMetrics(snapshots);

			expect(metrics.consistencyScore).toBeGreaterThan(0.8);
		});

		it("should detect volatility shocks", () => {
			const returns = [0.01, 0.01, 0.01, -0.15, 0.02, 0.02, 0.02, 0.02, 0.02];
			const snapshots = createSnapshots(10000, returns);
			const metrics = benchmark.calculateAdaptabilityMetrics(snapshots);

			expect(metrics.adaptabilityScore).toBeDefined();
		});
	});

	describe("Full Benchmark", () => {
		it("should run complete benchmark", () => {
			// Create test data
			const trades: TradeRecord[] = [];
			const now = Date.now();

			for (let i = 0; i < 15; i++) {
				trades.push({
					id: `trade_${i}`,
					agentId: "benchmark-agent",
					symbol: "BTC",
					side: "buy",
					entryPrice: 50000,
					exitPrice: 50000 + (Math.random() - 0.4) * 2000,
					quantity: 0.1,
					entryTime: now - (15 - i) * 86400000,
					exitTime: now - (14 - i) * 86400000,
					fees: 5,
					pnl: 0,
					pnlPercent: 0,
				});
			}

			// Calculate PnL
			for (const trade of trades) {
				const gross = (trade.exitPrice! - trade.entryPrice) * trade.quantity;
				trade.pnl = gross - trade.fees;
				trade.pnlPercent = (trade.pnl / (trade.entryPrice * trade.quantity)) * 100;
			}

			const snapshots = createSnapshots(
				10000,
				trades.map((t) => t.pnlPercent! / 100),
			);

			const result = benchmark.runBenchmark("Test Benchmark", "benchmark-agent", trades, snapshots);

			expect(result.id).toMatch(/^bench_/);
			expect(result.name).toBe("Test Benchmark");
			expect(result.agentId).toBe("benchmark-agent");
			expect(result.financial.totalTrades).toBe(15);
			expect(result.overallScore).toBeGreaterThanOrEqual(0);
			expect(result.overallScore).toBeLessThanOrEqual(100);
			expect(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"]).toContain(result.grade);
		});

		it("should format benchmark result", () => {
			const trades = Array.from({ length: 10 }, (_, i) => ({
				...createTrade("buy", 100, 105 + Math.random() * 10, 10, 1),
				exitTime: Date.now(),
			}));
			const snapshots = createSnapshots(
				10000,
				trades.map(() => 0.01),
			);

			const result = benchmark.runBenchmark("Format Test", "test-agent", trades, snapshots);
			const formatted = benchmark.formatResult(result);

			expect(formatted).toContain("## Benchmark: Format Test");
			expect(formatted).toContain("Financial Metrics");
			expect(formatted).toContain("Economic Value");
			expect(formatted).toContain("Adaptability");
		});

		it("should throw if insufficient trades", () => {
			const trades = [createTrade("buy", 100, 110, 10, 1)];
			const snapshots = createSnapshots(10000, [0.01]);

			expect(() => benchmark.runBenchmark("Fail", "agent", trades, snapshots)).toThrow(/Insufficient trades/);
		});
	});

	describe("Singleton", () => {
		it("should return same instance", () => {
			const b1 = getTradingBenchmark();
			const b2 = getTradingBenchmark();

			expect(b1).toBe(b2);
		});
	});
});

// Helper functions
function createTrade(
	side: "buy" | "sell",
	entryPrice: number,
	exitPrice: number,
	quantity: number,
	fee: number,
): TradeRecord {
	const gross = side === "buy" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
	const pnl = gross - fee;

	return {
		id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		agentId: "test-agent",
		symbol: "TEST",
		side,
		entryPrice,
		exitPrice,
		quantity,
		entryTime: Date.now() - 1000,
		exitTime: Date.now(),
		fees: fee,
		pnl,
		pnlPercent: (pnl / (entryPrice * quantity)) * 100,
	};
}

function createSnapshots(initialValue: number, dailyReturns: number[]): PortfolioSnapshot[] {
	const snapshots: PortfolioSnapshot[] = [];
	let value = initialValue;
	const baseTime = Date.now() - dailyReturns.length * 86400000;

	for (let i = 0; i < dailyReturns.length; i++) {
		value = value * (1 + dailyReturns[i]);
		snapshots.push({
			timestamp: baseTime + i * 86400000,
			totalValue: value,
			cash: value * 0.5,
			positions: [],
			dailyReturn: dailyReturns[i],
		});
	}

	return snapshots;
}
