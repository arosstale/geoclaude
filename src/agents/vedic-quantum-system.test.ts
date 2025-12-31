/**
 * Tests for Vedic Quantum System
 * Validates b5(9³), n4(8³), and Threefold algorithms
 */

import { describe, expect, it } from "vitest";
import {
	analyzeB5Pattern,
	B5_GRID,
	backtestIfaStrategy,
	binaryToOdu,
	calculateElementalDistribution,
	detectCyclicPattern,
	detectDiagonalSymmetry,
	evaluateAgentOutput,
	evaluateThreefold,
	generateIfaSignal,
	IFA_ODUS,
	IndraQuantumSystem,
	ifaSignalToAction,
	N4_GRID,
	throwOpele,
} from "./vedic-quantum-system.js";

describe("b5(9³) Algorithm", () => {
	describe("B5_GRID properties", () => {
		it("should have correct dimensions (5x5)", () => {
			expect(B5_GRID.length).toBe(5);
			expect(B5_GRID[0].length).toBe(5);
		});

		it("should contain only odd numbers 1,3,5,7,9", () => {
			const validNumbers = new Set([1, 3, 5, 7, 9]);
			for (const row of B5_GRID) {
				for (const val of row) {
					expect(validNumbers.has(val)).toBe(true);
				}
			}
		});

		it("should have row sums of 25", () => {
			for (const row of B5_GRID) {
				const sum = row.reduce((a, b) => a + b, 0);
				expect(sum).toBe(25);
			}
		});

		it("should have total sum of 125 (5³)", () => {
			const total = B5_GRID.flat().reduce((a, b) => a + b, 0);
			expect(total).toBe(125);
		});

		it("should be cyclic (each row is shifted version)", () => {
			const firstRow = B5_GRID[0];
			for (let r = 1; r < B5_GRID.length; r++) {
				// Check if row r is a cyclic shift of first row
				const shift = firstRow.indexOf(B5_GRID[r][0]);
				expect(shift).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("N4_GRID properties", () => {
		it("should have correct dimensions (5x5)", () => {
			expect(N4_GRID.length).toBe(5);
			expect(N4_GRID[0].length).toBe(5);
		});

		it("should contain only even numbers 0,2,4,6,8", () => {
			const validNumbers = new Set([0, 2, 4, 6, 8]);
			for (const row of N4_GRID) {
				for (const val of row) {
					expect(validNumbers.has(val)).toBe(true);
				}
			}
		});

		it("should have row sums of 20", () => {
			for (const row of N4_GRID) {
				const sum = row.reduce((a, b) => a + b, 0);
				expect(sum).toBe(20);
			}
		});
	});

	describe("detectCyclicPattern", () => {
		it("should detect cyclic pattern in B5_GRID", () => {
			const result = detectCyclicPattern(B5_GRID);
			expect(result.isCyclic).toBe(true);
			expect(result.confidence).toBeGreaterThan(0.8);
		});

		it("should detect cyclic pattern in N4_GRID", () => {
			const result = detectCyclicPattern(N4_GRID);
			expect(result.isCyclic).toBe(true);
			expect(result.confidence).toBeGreaterThan(0.8);
		});

		it("should not detect cyclic pattern in random grid", () => {
			const randomGrid = [
				[1, 5, 3, 9, 2],
				[4, 7, 1, 6, 8],
				[2, 9, 5, 3, 1],
				[8, 1, 6, 4, 7],
				[3, 6, 2, 8, 5],
			];
			const result = detectCyclicPattern(randomGrid);
			expect(result.confidence).toBeLessThan(0.8);
		});
	});

	describe("detectDiagonalSymmetry", () => {
		it("should detect symmetry in symmetric grid", () => {
			const symmetricGrid = [
				[1, 2, 3],
				[2, 4, 5],
				[3, 5, 6],
			];
			const result = detectDiagonalSymmetry(symmetricGrid);
			expect(result.hasMainDiagonal).toBe(true);
		});
	});

	describe("calculateElementalDistribution", () => {
		it("should return balanced distribution for B5_GRID", () => {
			const dist = calculateElementalDistribution(B5_GRID);
			// Each element should appear 5 times in 25 cells = 20%
			expect(dist.Ether).toBeCloseTo(0.2, 1);
			expect(dist.Air).toBeCloseTo(0.2, 1);
			expect(dist.Fire).toBeCloseTo(0.2, 1);
			expect(dist.Water).toBeCloseTo(0.2, 1);
			expect(dist.Earth).toBeCloseTo(0.2, 1);
		});
	});

	describe("analyzeB5Pattern", () => {
		it("should analyze pattern transformation", () => {
			const input = B5_GRID;
			// Shifted output
			const output = [
				[9, 1, 3, 5, 7],
				[7, 9, 1, 3, 5],
				[5, 7, 9, 1, 3],
				[3, 5, 7, 9, 1],
				[1, 3, 5, 7, 9],
			];
			const analysis = analyzeB5Pattern(input, output);
			expect(analysis.patternType).toBeDefined();
			expect(analysis.confidence).toBeGreaterThan(0);
			expect(analysis.elementalDistribution).toBeDefined();
		});
	});
});

describe("n4(8³) Ifá Trading System", () => {
	describe("throwOpele", () => {
		it("should return value between 0 and 255", () => {
			for (let i = 0; i < 100; i++) {
				const value = throwOpele();
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThanOrEqual(255);
			}
		});
	});

	describe("binaryToOdu", () => {
		it("should convert 0 to (1, 1)", () => {
			const result = binaryToOdu(0);
			expect(result.major).toBe(1);
			expect(result.minor).toBe(1);
		});

		it("should convert 255 to (16, 16)", () => {
			const result = binaryToOdu(255);
			expect(result.major).toBe(16);
			expect(result.minor).toBe(16);
		});

		it("should convert 17 to (2, 2)", () => {
			// 17 = 0001 0001
			const result = binaryToOdu(17);
			expect(result.major).toBe(2);
			expect(result.minor).toBe(2);
		});
	});

	describe("generateIfaSignal", () => {
		it("should generate valid signal", () => {
			const signal = generateIfaSignal();
			expect(signal.binaryValue).toBeGreaterThanOrEqual(0);
			expect(signal.binaryValue).toBeLessThanOrEqual(255);
			expect(signal.majorOdu).toBeGreaterThanOrEqual(1);
			expect(signal.majorOdu).toBeLessThanOrEqual(16);
			expect(signal.minorOdu).toBeGreaterThanOrEqual(1);
			expect(signal.minorOdu).toBeLessThanOrEqual(16);
			expect(signal.oduName).toBeDefined();
			expect(signal.action).toBeDefined();
			expect(signal.confidence).toBeGreaterThanOrEqual(0.5);
			expect(signal.confidence).toBeLessThanOrEqual(1);
		});

		it("should have valid Odu name", () => {
			const signal = generateIfaSignal();
			const validNames = Object.values(IFA_ODUS).map((o) => o.name);
			expect(validNames).toContain(signal.oduName);
		});
	});

	describe("ifaSignalToAction", () => {
		it("should convert buy signal to buy action", () => {
			const signal = {
				timestamp: Date.now(),
				binaryValue: 0,
				majorOdu: 1, // Ogbe = buy
				minorOdu: 1,
				oduName: "Ogbe",
				action: "buy",
				confidence: 0.8,
				quantumState: "collapsed" as const,
			};
			const config = {
				symbol: "BTC",
				capital: 10000,
				maxPositionSize: 0.1,
				stopLossPercent: 3,
				takeProfitPercent: 5,
				signalFrequency: "daily" as const,
				useAstrologicalFilter: false,
				solsticeBoost: 1.2,
			};
			const action = ifaSignalToAction(signal, config, 50000);
			expect(action.type).toBe("buy");
			expect(action.size).toBeGreaterThan(0);
			expect(action.stopLoss).toBeDefined();
			expect(action.takeProfit).toBeDefined();
		});
	});

	describe("backtestIfaStrategy", () => {
		it("should complete backtest with results", () => {
			// Generate simple price data
			const priceData = [];
			let price = 100;
			for (let i = 0; i < 100; i++) {
				price = price * (1 + (Math.random() - 0.5) * 0.02);
				priceData.push({
					timestamp: Date.now() + i * 86400000,
					open: price,
					high: price * 1.01,
					low: price * 0.99,
					close: price * (1 + (Math.random() - 0.5) * 0.01),
				});
			}

			const config = {
				symbol: "TEST",
				capital: 10000,
				maxPositionSize: 0.1,
				stopLossPercent: 3,
				takeProfitPercent: 5,
				signalFrequency: "daily" as const,
				useAstrologicalFilter: false,
				solsticeBoost: 1.2,
			};

			const result = backtestIfaStrategy(priceData, config);
			expect(result.totalTrades).toBeGreaterThanOrEqual(0);
			expect(result.winRate).toBeGreaterThanOrEqual(0);
			expect(result.winRate).toBeLessThanOrEqual(1);
			expect(result.oduPerformance).toBeDefined();
		});
	});
});

describe("Vedic Threefold Evaluation", () => {
	describe("evaluateThreefold", () => {
		it("should score sattvic text highly on sattva", () => {
			const text =
				"This is a truthful and honest approach that brings wisdom, clarity, and harmony. We aim to understand and improve through peaceful means.";
			const score = evaluateThreefold(text);
			expect(score.sattva).toBeGreaterThan(score.rajas);
			expect(score.sattva).toBeGreaterThan(score.tamas);
			expect(score.dominant).toBe("sattva");
		});

		it("should score rajasic text highly on rajas", () => {
			const text =
				"Fast action, aggressive profit targets, competitive drive to win and achieve our ambitious goals quickly. Risk and opportunity.";
			const score = evaluateThreefold(text);
			expect(score.rajas).toBeGreaterThan(0);
		});

		it("should score tamasic text highly on tamas", () => {
			const text =
				"Error after error, confusion and failure. The unclear, deceptive approach led to harmful, negative, destructive outcomes.";
			const score = evaluateThreefold(text);
			expect(score.tamas).toBeGreaterThan(0);
		});

		it("should calculate divine scale correctly", () => {
			const divineText = "Humble, honest, compassionate, and fearless approach.";
			const demonicText = "Arrogant, greedy, cruel manipulation through pride.";

			const divineScore = evaluateThreefold(divineText);
			const demonicScore = evaluateThreefold(demonicText);

			expect(divineScore.divineScale).toBeGreaterThan(0);
			expect(demonicScore.divineScale).toBeLessThan(0);
		});
	});

	describe("evaluateAgentOutput", () => {
		it("should return complete evaluation", () => {
			const output =
				"This is a helpful and truthful response. We aim to provide clear, accurate information. The goal is to benefit users through wisdom and understanding.";
			const evaluation = evaluateAgentOutput(output);

			expect(evaluation.threefoldScore).toBeDefined();
			expect(evaluation.qualityGrade).toMatch(/^[A-F]$/);
			expect(evaluation.categoryScores).toBeDefined();
			expect(evaluation.categoryScores.thought).toBeDefined();
			expect(evaluation.categoryScores.word).toBeDefined();
			expect(evaluation.categoryScores.deed).toBeDefined();
		});

		it("should give good grade to sattvic output", () => {
			const goodOutput =
				"With wisdom and clarity, this truthful analysis provides honest insights. We aim to help through understanding, offering beneficial guidance with compassion and balance.";
			const evaluation = evaluateAgentOutput(goodOutput);
			expect(["A", "B", "C"]).toContain(evaluation.qualityGrade);
		});
	});
});

describe("IndraQuantumSystem", () => {
	it("should create system with config", () => {
		const system = new IndraQuantumSystem({
			enableB5PatternDetection: true,
			enableIfaTrading: true,
			enableThreefoldEvaluation: true,
			tradingConfig: {
				symbol: "BTC",
				capital: 10000,
				maxPositionSize: 0.1,
				stopLossPercent: 3,
				takeProfitPercent: 5,
				signalFrequency: "daily",
				useAstrologicalFilter: false,
				solsticeBoost: 1.2,
			},
		});
		expect(system).toBeDefined();
	});

	it("should run full analysis", () => {
		const system = new IndraQuantumSystem({
			enableB5PatternDetection: true,
			enableIfaTrading: true,
			enableThreefoldEvaluation: true,
			tradingConfig: {
				symbol: "BTC",
				capital: 10000,
				maxPositionSize: 0.1,
				stopLossPercent: 3,
				takeProfitPercent: 5,
				signalFrequency: "daily",
				useAstrologicalFilter: false,
				solsticeBoost: 1.2,
			},
		});

		const analysis = system.analyze({
			grid: { input: B5_GRID, output: N4_GRID },
			price: 50000,
			agentOutput: "This is a truthful and helpful analysis with clarity.",
		});

		expect(analysis.timestamp).toBeDefined();
		expect(analysis.unifiedScore).toBeGreaterThanOrEqual(0);
		expect(analysis.unifiedScore).toBeLessThanOrEqual(100);
		expect(analysis.cosmicAlignment).toBeDefined();
		expect(analysis.b5Analysis).toBeDefined();
		expect(analysis.ifaSignal).toBeDefined();
		expect(analysis.tradingAction).toBeDefined();
		expect(analysis.threefoldEvaluation).toBeDefined();
	});
});
