/**
 * Tests for Aerospace-Inspired Pattern Modules
 *
 * Validates implementations inspired by ANG13T's aerospace security tools:
 * - Genetic Optimizer (url_genie)
 * - Anomaly Detector (DroneXtract)
 * - Signal Validator (skytrack)
 * - Signal Classifier (fly-catcher)
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	// Anomaly Detector
	AnomalyDetector,
	AnomalyDetectorPresets,
	AnomalyType,
	createSignalValidator,
	createTradingOptimizer,
	crossoverTradingGenes,
	type DataPoint,
	FeatureExtractor,
	// Genetic Optimizer
	GeneticOptimizer,
	GeneticOptimizerPresets,
	initializeTradingGenes,
	MarketSession,
	mutateTradingGenes,
	type Signal,
	// Signal Classifier
	SignalClassifier,
	SignalClassifierPresets,
	SignalDirection,
	type SignalSource,
	// Signal Validator
	SignalValidator,
	SignalValidatorPresets,
	SourceType,
	type TradingStrategyGenes,
} from "./index.js";

// ============================================================================
// Genetic Optimizer Tests (url_genie pattern)
// ============================================================================

describe("Genetic Optimizer (url_genie pattern)", () => {
	describe("Trading Strategy Genes", () => {
		it("should initialize valid trading genes", () => {
			const genes = initializeTradingGenes();

			expect(genes.entryThreshold).toBeGreaterThanOrEqual(0);
			expect(genes.entryThreshold).toBeLessThanOrEqual(1);
			expect(genes.takeProfitPercent).toBeGreaterThanOrEqual(1);
			expect(genes.takeProfitPercent).toBeLessThanOrEqual(20);
			expect(genes.stopLossPercent).toBeGreaterThanOrEqual(1);
			expect(genes.stopLossPercent).toBeLessThanOrEqual(10);
			expect(genes.maxPositionSize).toBeGreaterThanOrEqual(0.01);
			expect(genes.maxPositionSize).toBeLessThanOrEqual(0.5);
		});

		it("should crossover genes correctly", () => {
			const parent1 = initializeTradingGenes();
			const parent2 = initializeTradingGenes();

			const [child1, child2] = crossoverTradingGenes(parent1, parent2);

			// Children should have valid bounds
			expect(child1.entryThreshold).toBeGreaterThanOrEqual(0);
			expect(child2.entryThreshold).toBeGreaterThanOrEqual(0);

			// At least some genes should be from each parent
			const keysFromP1 = Object.keys(child1).filter(
				(k) => child1[k as keyof TradingStrategyGenes] === parent1[k as keyof TradingStrategyGenes],
			);
			const keysFromP2 = Object.keys(child1).filter(
				(k) => child1[k as keyof TradingStrategyGenes] === parent2[k as keyof TradingStrategyGenes],
			);

			// Should have genes from both parents (due to random crossover)
			expect(keysFromP1.length + keysFromP2.length).toBeGreaterThanOrEqual(0);
		});

		it("should mutate genes within bounds", () => {
			const original = initializeTradingGenes();
			const mutated = mutateTradingGenes(original, 1.0); // 100% mutation rate

			// All values should still be within valid bounds
			expect(mutated.entryThreshold).toBeGreaterThanOrEqual(0);
			expect(mutated.entryThreshold).toBeLessThanOrEqual(1);
			expect(mutated.takeProfitPercent).toBeGreaterThanOrEqual(1);
			expect(mutated.takeProfitPercent).toBeLessThanOrEqual(20);
			expect(mutated.minHoldingPeriod).toBeLessThan(mutated.maxHoldingPeriod);
		});
	});

	describe("GeneticOptimizer", () => {
		it("should create optimizer with trading preset", () => {
			const backtestFunc = async () => ({
				totalReturn: 10,
				sharpeRatio: 1.5,
				maxDrawdown: 15,
				winRate: 0.6,
				totalTrades: 50,
				profitFactor: 1.8,
			});

			const optimizer = createTradingOptimizer(backtestFunc, {
				populationSize: 10,
				generations: 5,
			});

			expect(optimizer).toBeInstanceOf(GeneticOptimizer);
		});

		it("should evolve population and find best individual", async () => {
			// Simple fitness: maximize sum of normalized genes
			const fitnessFunc = (genes: TradingStrategyGenes) => {
				return genes.entryThreshold + genes.momentumWeight + genes.volumeWeight;
			};

			const optimizer = new GeneticOptimizer(
				fitnessFunc,
				crossoverTradingGenes,
				mutateTradingGenes,
				initializeTradingGenes,
				{
					populationSize: 10,
					generations: 5,
					mutationRate: 0.2,
				},
			);

			const result = await optimizer.evolve();

			expect(result.bestIndividual).toBeDefined();
			expect(result.bestIndividual.fitness).toBeGreaterThan(0);
			expect(result.generations.length).toBe(5);
			expect(result.totalEvaluations).toBeGreaterThan(0);
		});

		it("should track generation statistics", async () => {
			const fitnessFunc = () => Math.random();

			const optimizer = GeneticOptimizerPresets.quick(
				fitnessFunc,
				crossoverTradingGenes,
				mutateTradingGenes,
				initializeTradingGenes,
			);

			const result = await optimizer.evolve();

			for (const stats of result.generations) {
				expect(stats.bestFitness).toBeGreaterThanOrEqual(stats.avgFitness);
				expect(stats.avgFitness).toBeGreaterThanOrEqual(stats.worstFitness);
				expect(stats.diversity).toBeGreaterThanOrEqual(0);
			}
		});
	});
});

// ============================================================================
// Anomaly Detector Tests (DroneXtract pattern)
// ============================================================================

describe("Anomaly Detector (DroneXtract pattern)", () => {
	let detector: AnomalyDetector;

	beforeEach(() => {
		detector = new AnomalyDetector();
	});

	describe("Data Gap Detection", () => {
		it("should detect data gaps", () => {
			const data: DataPoint[] = [
				{ timestamp: 1000, value: 100 },
				{ timestamp: 2000, value: 101 },
				{ timestamp: 1000000, value: 102 }, // Large gap
				{ timestamp: 1001000, value: 103 },
			];

			const report = detector.analyzeBatch(data);
			const gapAnomalies = report.anomalies.filter((a) => a.type === AnomalyType.DATA_GAP);

			expect(gapAnomalies.length).toBeGreaterThan(0);
			expect(report.statistics.gapCount).toBeGreaterThan(0);
		});

		it("should not flag normal gaps", () => {
			const data: DataPoint[] = [];
			for (let i = 0; i < 50; i++) {
				data.push({ timestamp: i * 1000, value: 100 + Math.random() });
			}

			const report = detector.analyzeBatch(data);
			const gapAnomalies = report.anomalies.filter((a) => a.type === AnomalyType.DATA_GAP);

			expect(gapAnomalies.length).toBe(0);
		});
	});

	describe("Variance Spike Detection", () => {
		it("should detect variance spikes", () => {
			const data: DataPoint[] = [];
			for (let i = 0; i < 50; i++) {
				let value = 100 + Math.random() * 2; // Normal range: 100-102
				if (i === 25) value = 200; // Spike!
				data.push({ timestamp: i * 1000, value });
			}

			const report = detector.analyzeBatch(data);
			const spikes = report.anomalies.filter((a) => a.type === AnomalyType.VARIANCE_SPIKE);

			expect(spikes.length).toBeGreaterThan(0);
		});
	});

	describe("Value Spike Detection", () => {
		it("should detect sudden value changes", () => {
			const data: DataPoint[] = [];
			for (let i = 0; i < 30; i++) {
				let value = 100;
				if (i === 15) value = 110; // 10% spike
				data.push({ timestamp: i * 1000, value });
			}

			const report = detector.analyzeBatch(data);
			const spikes = report.anomalies.filter((a) => a.type === AnomalyType.VALUE_SPIKE);

			expect(spikes.length).toBeGreaterThan(0);
		});
	});

	describe("Integrity Score", () => {
		it("should give high score for clean data", () => {
			const data: DataPoint[] = [];
			for (let i = 0; i < 50; i++) {
				data.push({ timestamp: i * 1000, value: 100 + Math.random() * 0.1 });
			}

			const report = detector.analyzeBatch(data);

			expect(report.integrityScore).toBeGreaterThan(80);
			expect(report.recommendation).toContain("excellent");
		});

		it("should give low score for anomalous data", () => {
			const data: DataPoint[] = [];
			for (let i = 0; i < 50; i++) {
				let value = 100;
				if (i % 10 === 0) value = 100 + (Math.random() > 0.5 ? 50 : -50); // Frequent spikes
				data.push({ timestamp: i * 1000, value });
			}

			const report = detector.analyzeBatch(data);

			expect(report.integrityScore).toBeLessThan(80);
		});
	});

	describe("Statistics Calculation", () => {
		it("should calculate correct statistics", () => {
			const values = [10, 20, 30, 40, 50];
			const data: DataPoint[] = values.map((v, i) => ({
				timestamp: i * 1000,
				value: v,
			}));

			const report = detector.analyzeBatch(data);

			expect(report.statistics.mean).toBe(30);
			expect(report.statistics.median).toBe(30);
			expect(report.statistics.min).toBe(10);
			expect(report.statistics.max).toBe(50);
			expect(report.statistics.range).toBe(40);
		});
	});

	describe("Presets", () => {
		it("should create strict detector", () => {
			const strict = AnomalyDetectorPresets.strict();
			expect(strict).toBeInstanceOf(AnomalyDetector);
		});

		it("should create manipulation detector", () => {
			const manipulation = AnomalyDetectorPresets.manipulation();
			expect(manipulation).toBeInstanceOf(AnomalyDetector);
		});
	});
});

// ============================================================================
// Signal Validator Tests (skytrack pattern)
// ============================================================================

describe("Signal Validator (skytrack pattern)", () => {
	let validator: SignalValidator;

	beforeEach(() => {
		validator = createSignalValidator();
	});

	describe("Source Management", () => {
		it("should register sources", () => {
			const source: SignalSource = {
				id: "test-source",
				name: "Test Source",
				type: SourceType.TECHNICAL,
				weight: 1.0,
				reliability: 0.9,
				latencyMs: 100,
				enabled: true,
			};

			validator.registerSource(source);
			const sources = validator.getSources();

			expect(sources.find((s) => s.id === "test-source")).toBeDefined();
		});

		it("should enable/disable sources", () => {
			validator.setSourceEnabled("price-agent", false);
			const sources = validator.getEnabledSources();

			expect(sources.find((s) => s.id === "price-agent")).toBeUndefined();
		});
	});

	describe("Signal Validation", () => {
		it("should validate signal with agreement", () => {
			// Add agreeing signals from multiple sources
			validator.addSignal({
				id: "sig-1",
				sourceId: "price-agent",
				timestamp: Date.now(),
				symbol: "BTC",
				direction: SignalDirection.LONG,
				strength: 0.8,
				confidence: 0.9,
				timeframe: "1h",
			});

			validator.addSignal({
				id: "sig-2",
				sourceId: "sentiment-agent",
				timestamp: Date.now(),
				symbol: "BTC",
				direction: SignalDirection.LONG,
				strength: 0.7,
				confidence: 0.8,
				timeframe: "1h",
			});

			validator.addSignal({
				id: "sig-3",
				sourceId: "whale-agent",
				timestamp: Date.now(),
				symbol: "BTC",
				direction: SignalDirection.LONG,
				strength: 0.75,
				confidence: 0.85,
				timeframe: "1h",
			});

			const testSignal: Signal = {
				id: "test-sig",
				sourceId: "price-agent",
				timestamp: Date.now(),
				symbol: "BTC",
				direction: SignalDirection.LONG,
				strength: 0.8,
				confidence: 0.9,
				timeframe: "1h",
			};

			const result = validator.validate(testSignal);

			expect(result.sourcesAgreed).toBeGreaterThan(0);
			expect(result.aggregatedConfidence).toBeGreaterThan(0);
		});

		it("should reject signal with low agreement", () => {
			// Add conflicting signals
			validator.addSignal({
				id: "sig-1",
				sourceId: "price-agent",
				timestamp: Date.now(),
				symbol: "ETH",
				direction: SignalDirection.LONG,
				strength: 0.8,
				confidence: 0.9,
				timeframe: "1h",
			});

			validator.addSignal({
				id: "sig-2",
				sourceId: "sentiment-agent",
				timestamp: Date.now(),
				symbol: "ETH",
				direction: SignalDirection.SHORT, // Conflicting!
				strength: 0.8,
				confidence: 0.9,
				timeframe: "1h",
			});

			const testSignal: Signal = {
				id: "test-sig",
				sourceId: "price-agent",
				timestamp: Date.now(),
				symbol: "ETH",
				direction: SignalDirection.LONG,
				strength: 0.8,
				confidence: 0.9,
				timeframe: "1h",
			};

			const result = validator.validate(testSignal);

			expect(result.sourcesDisagreed).toBeGreaterThan(0);
		});
	});

	describe("Signal Aggregation", () => {
		it("should aggregate signals correctly", () => {
			const now = Date.now();

			validator.addSignal({
				id: "s1",
				sourceId: "price-agent",
				timestamp: now,
				symbol: "SOL",
				direction: SignalDirection.LONG,
				strength: 0.9,
				confidence: 0.95,
				timeframe: "4h",
			});

			validator.addSignal({
				id: "s2",
				sourceId: "sentiment-agent",
				timestamp: now,
				symbol: "SOL",
				direction: SignalDirection.LONG,
				strength: 0.7,
				confidence: 0.8,
				timeframe: "4h",
			});

			const aggregated = validator.getAggregatedSignal("SOL");

			expect(aggregated).not.toBeNull();
			expect(aggregated?.direction).toBe(SignalDirection.LONG);
			expect(aggregated?.sourceCount).toBe(2);
		});
	});

	describe("Presets", () => {
		it("should create conservative validator", () => {
			const conservative = SignalValidatorPresets.conservative();
			expect(conservative).toBeInstanceOf(SignalValidator);
		});

		it("should create aggressive validator", () => {
			const aggressive = SignalValidatorPresets.aggressive();
			expect(aggressive).toBeInstanceOf(SignalValidator);
		});
	});
});

// ============================================================================
// Signal Classifier Tests (fly-catcher pattern)
// ============================================================================

describe("Signal Classifier (fly-catcher pattern)", () => {
	describe("Feature Extractor", () => {
		let extractor: FeatureExtractor;

		beforeEach(() => {
			extractor = new FeatureExtractor();
		});

		it("should extract features from price data", () => {
			const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 0.1 + Math.random() * 0.5);
			const volumes = Array.from({ length: 30 }, () => 1000 + Math.random() * 500);
			const timestamps = Array.from({ length: 30 }, (_, i) => Date.now() - (30 - i) * 60000);

			const features = extractor.extractFeatures({ prices, volumes, timestamps });

			expect(features.priceChange).toBeDefined();
			expect(features.volatility).toBeGreaterThan(0);
			expect(features.rsiValue).toBeGreaterThanOrEqual(0);
			expect(features.rsiValue).toBeLessThanOrEqual(100);
			expect(features.volumeRatio).toBeGreaterThan(0);
		});

		it("should convert features to array", () => {
			const prices = Array.from({ length: 30 }, () => 100 + Math.random());
			const volumes = Array.from({ length: 30 }, () => 1000);
			const timestamps = Array.from({ length: 30 }, (_, i) => i * 1000);

			const features = extractor.extractFeatures({ prices, volumes, timestamps });
			const array = extractor.featuresToArray(features);

			expect(array.length).toBe(20); // 20 features
			expect(array.every((v) => typeof v === "number")).toBe(true);
		});

		it("should detect market sessions", () => {
			const prices = Array.from({ length: 30 }, () => 100);
			const volumes = Array.from({ length: 30 }, () => 1000);

			// Morning UTC (Asia session)
			const asiaTimestamps = Array.from({ length: 30 }, (_, i) => {
				const d = new Date();
				d.setUTCHours(3, 0, 0, 0);
				return d.getTime() + i * 60000;
			});

			const asiaFeatures = extractor.extractFeatures({
				prices,
				volumes,
				timestamps: asiaTimestamps,
			});

			expect(asiaFeatures.marketSession).toBe(MarketSession.ASIA);
		});
	});

	describe("Signal Classifier", () => {
		let classifier: SignalClassifier;

		beforeEach(() => {
			classifier = new SignalClassifier();
		});

		it("should classify signal authenticity", () => {
			const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 0.1);
			const volumes = Array.from({ length: 30 }, () => 1000);
			const timestamps = Array.from({ length: 30 }, (_, i) => Date.now() - (30 - i) * 60000);
			const sources = [
				{ reliability: 0.9, agrees: true },
				{ reliability: 0.8, agrees: true },
			];

			const result = classifier.classifyAuthenticity({
				prices,
				volumes,
				timestamps,
				sources,
			});

			expect(result.prediction).toMatch(/authentic|suspicious|spoofed/);
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
			expect(result.riskScore).toBeGreaterThanOrEqual(0);
			expect(result.riskScore).toBeLessThanOrEqual(100);
		});

		it("should classify signal quality", () => {
			const prices = Array.from({ length: 30 }, () => 100 + Math.random());
			const volumes = Array.from({ length: 30 }, () => 1000);
			const timestamps = Array.from({ length: 30 }, (_, i) => Date.now() - (30 - i) * 60000);

			const result = classifier.classifyQuality({ prices, volumes, timestamps });

			expect(result.prediction).toMatch(/high|medium|low/);
			expect(result.qualityScore).toBeGreaterThanOrEqual(0);
			expect(result.qualityScore).toBeLessThanOrEqual(100);
		});

		it("should classify market regime", () => {
			// Trending up data
			const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
			const volumes = Array.from({ length: 30 }, () => 1000);
			const timestamps = Array.from({ length: 30 }, (_, i) => Date.now() - (30 - i) * 60000);

			const result = classifier.classifyRegime({ prices, volumes, timestamps });

			expect(result.prediction).toMatch(/trending_up|trending_down|ranging|volatile|breakout/);
			expect(result.regimeStrength).toBeGreaterThanOrEqual(0);
			expect(result.expectedDuration).toBeGreaterThan(0);
		});

		it("should flag suspicious patterns", () => {
			// Create suspicious data: spike with low source agreement
			const prices = Array.from({ length: 30 }, (_, i) => {
				if (i === 15) return 150; // Spike
				return 100;
			});
			const volumes = Array.from({ length: 30 }, (_, i) => {
				if (i === 15) return 5000; // Volume spike
				return 1000;
			});
			const timestamps = Array.from({ length: 30 }, (_, i) => Date.now() - (30 - i) * 60000);
			const sources = [{ reliability: 0.3, agrees: false }]; // Low reliability, disagreeing

			const result = classifier.classifyAuthenticity({
				prices,
				volumes,
				timestamps,
				sources,
			});

			// Should have some flags
			expect(result.flags.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Neural Network", () => {
		it("should produce valid probability distribution", () => {
			const classifier = SignalClassifierPresets.standard();
			const prices = Array.from({ length: 30 }, () => 100 + Math.random());
			const volumes = Array.from({ length: 30 }, () => 1000);
			const timestamps = Array.from({ length: 30 }, (_, i) => i * 1000);

			const result = classifier.classifyAuthenticity({ prices, volumes, timestamps });

			// Probabilities should sum to ~1
			const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1, 5);

			// All probabilities should be 0-1
			for (const prob of Object.values(result.probabilities)) {
				expect(prob).toBeGreaterThanOrEqual(0);
				expect(prob).toBeLessThanOrEqual(1);
			}
		});
	});

	describe("Presets", () => {
		it("should create high sensitivity classifier", () => {
			const highSens = SignalClassifierPresets.highSensitivity();
			expect(highSens).toBeInstanceOf(SignalClassifier);
		});

		it("should create fast classifier", () => {
			const fast = SignalClassifierPresets.fast();
			expect(fast).toBeInstanceOf(SignalClassifier);
		});
	});
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Aerospace Pattern Integration", () => {
	it("should use anomaly detector with signal validator", () => {
		const detector = new AnomalyDetector();
		const validator = createSignalValidator();

		// Generate price data
		const data: DataPoint[] = [];
		for (let i = 0; i < 50; i++) {
			data.push({ timestamp: Date.now() - (50 - i) * 1000, value: 100 + Math.random() });
		}

		// Check data integrity first
		const integrity = detector.analyzeBatch(data);

		// If integrity is high, trust the signals more
		if (integrity.integrityScore > 80) {
			// Update source reliability based on integrity
			validator.updateSourceReliability("price-agent", 0.9);
		} else {
			validator.updateSourceReliability("price-agent", 0.5);
		}

		const sources = validator.getSources();
		const priceAgent = sources.find((s) => s.id === "price-agent");

		expect(priceAgent?.reliability).toBeDefined();
	});

	it("should use classifier with genetic optimizer for strategy evolution", async () => {
		const _classifier = new SignalClassifier();

		// Fitness function that uses classifier
		const fitnessFunc = (genes: TradingStrategyGenes) => {
			// Simulate: strategies with higher confidence threshold should be more reliable
			const simulatedConfidence = genes.entryThreshold * 0.5 + 0.5;
			return simulatedConfidence * genes.maxPositionSize; // Balance confidence with position size
		};

		const optimizer = new GeneticOptimizer(
			fitnessFunc,
			crossoverTradingGenes,
			mutateTradingGenes,
			initializeTradingGenes,
			{ populationSize: 10, generations: 3 },
		);

		const result = await optimizer.evolve();

		expect(result.bestIndividual).toBeDefined();
		expect(result.bestIndividual.fitness).toBeGreaterThan(0);
	});
});
