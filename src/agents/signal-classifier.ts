/**
 * Signal Classifier
 *
 * Inspired by ANG13T's fly-catcher neural network classifier for ADS-B spoofing detection.
 * Applies ML classification patterns to trading signal validation.
 *
 * Architecture:
 * Signal Features → Feature Extraction → Classification Model → Prediction + Confidence
 *
 * Supports:
 * - Signal authenticity detection (spoof vs legitimate)
 * - Signal quality classification (high/medium/low)
 * - Market regime detection (trending/ranging/volatile)
 * - Manipulation pattern recognition
 *
 * @see https://github.com/ANG13T/fly-catcher
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export interface SignalFeatures {
	// Price-based features
	priceChange: number;
	priceVelocity: number;
	priceAcceleration: number;
	volatility: number;
	atr: number; // Average True Range

	// Volume features
	volumeRatio: number; // Current vs average
	volumeTrend: number;
	volumeSpike: boolean;

	// Technical indicators
	rsiValue: number;
	macdSignal: number;
	bollingerPosition: number; // -1 to 1 (lower to upper band)

	// Pattern features
	candlePattern: CandlePattern;
	trendDirection: TrendDirection;
	supportResistanceDistance: number;

	// Timing features
	hourOfDay: number;
	dayOfWeek: number;
	marketSession: MarketSession;

	// Source features
	sourceCount: number;
	sourceAgreement: number;
	avgSourceReliability: number;
}

export enum CandlePattern {
	NONE = 0,
	DOJI = 1,
	HAMMER = 2,
	ENGULFING_BULL = 3,
	ENGULFING_BEAR = 4,
	MORNING_STAR = 5,
	EVENING_STAR = 6,
	THREE_WHITE_SOLDIERS = 7,
	THREE_BLACK_CROWS = 8,
}

export enum TrendDirection {
	STRONG_UP = 2,
	UP = 1,
	NEUTRAL = 0,
	DOWN = -1,
	STRONG_DOWN = -2,
}

export enum MarketSession {
	ASIA = 0,
	EUROPE = 1,
	US = 2,
	OVERLAP_EU_US = 3,
	CLOSED = 4,
}

export interface ClassificationResult {
	prediction: string;
	confidence: number;
	probabilities: Record<string, number>;
	features: number[];
	timestamp: number;
}

export interface AuthenticityResult extends ClassificationResult {
	prediction: "authentic" | "suspicious" | "spoofed";
	riskScore: number; // 0-100
	flags: string[];
}

export interface QualityResult extends ClassificationResult {
	prediction: "high" | "medium" | "low";
	qualityScore: number; // 0-100
	issues: string[];
}

export interface RegimeResult extends ClassificationResult {
	prediction: "trending_up" | "trending_down" | "ranging" | "volatile" | "breakout";
	regimeStrength: number; // 0-1
	expectedDuration: number; // bars
}

export interface ClassifierConfig {
	// Model parameters
	inputSize: number;
	hiddenLayers: number[];
	outputSize: number;
	activationFunction: "relu" | "sigmoid" | "tanh";

	// Training parameters
	learningRate: number;
	epochs: number;
	batchSize: number;
	validationSplit: number;

	// Inference parameters
	confidenceThreshold: number;
	useEnsemble: boolean;
	ensembleSize: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
	inputSize: 20,
	hiddenLayers: [64, 32, 16],
	outputSize: 3,
	activationFunction: "relu",
	learningRate: 0.001,
	epochs: 100,
	batchSize: 32,
	validationSplit: 0.2,
	confidenceThreshold: 0.6,
	useEnsemble: true,
	ensembleSize: 5,
};

// ============================================================================
// Feature Extractor
// ============================================================================

export class FeatureExtractor {
	/**
	 * Extract features from raw signal data
	 */
	extractFeatures(data: {
		prices: number[];
		volumes: number[];
		timestamps: number[];
		sources?: Array<{ reliability: number; agrees: boolean }>;
	}): SignalFeatures {
		const { prices, volumes, timestamps, sources } = data;
		const n = prices.length;

		if (n < 20) {
			throw new Error("Insufficient data for feature extraction (need 20+ points)");
		}

		// Price-based features
		const priceChange = (prices[n - 1] - prices[n - 2]) / prices[n - 2];
		const priceVelocity = this.calculateVelocity(prices.slice(-10));
		const priceAcceleration = this.calculateAcceleration(prices.slice(-10));
		const volatility = this.calculateVolatility(prices.slice(-20));
		const atr = this.calculateATR(prices.slice(-14));

		// Volume features
		const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
		const avgVolume = volumes.reduce((a, b) => a + b, 0) / n;
		const volumeRatio = recentVolume / avgVolume;
		const volumeTrend = this.calculateTrend(volumes.slice(-10));
		const volumeSpike = volumeRatio > 2.0;

		// Technical indicators (simplified calculations)
		const rsiValue = this.calculateRSI(prices.slice(-14));
		const macdSignal = this.calculateMACDSignal(prices);
		const bollingerPosition = this.calculateBollingerPosition(prices.slice(-20));

		// Pattern features
		const candlePattern = this.detectCandlePattern(prices.slice(-5));
		const trendDirection = this.detectTrend(prices.slice(-20));
		const supportResistanceDistance = this.calculateSRDistance(prices);

		// Timing features
		const lastTimestamp = timestamps[n - 1];
		const date = new Date(lastTimestamp);
		const hourOfDay = date.getUTCHours();
		const dayOfWeek = date.getUTCDay();
		const marketSession = this.detectMarketSession(hourOfDay);

		// Source features
		let sourceCount = 0;
		let sourceAgreement = 0;
		let avgSourceReliability = 0;

		if (sources && sources.length > 0) {
			sourceCount = sources.length;
			sourceAgreement = sources.filter((s) => s.agrees).length / sources.length;
			avgSourceReliability = sources.reduce((sum, s) => sum + s.reliability, 0) / sources.length;
		}

		return {
			priceChange,
			priceVelocity,
			priceAcceleration,
			volatility,
			atr,
			volumeRatio,
			volumeTrend,
			volumeSpike,
			rsiValue,
			macdSignal,
			bollingerPosition,
			candlePattern,
			trendDirection,
			supportResistanceDistance,
			hourOfDay,
			dayOfWeek,
			marketSession,
			sourceCount,
			sourceAgreement,
			avgSourceReliability,
		};
	}

	/**
	 * Convert features to normalized array for model input
	 */
	featuresToArray(features: SignalFeatures): number[] {
		return [
			features.priceChange,
			features.priceVelocity,
			features.priceAcceleration,
			features.volatility,
			features.atr,
			features.volumeRatio,
			features.volumeTrend,
			features.volumeSpike ? 1 : 0,
			features.rsiValue / 100, // Normalize to 0-1
			features.macdSignal,
			features.bollingerPosition,
			features.candlePattern / 8, // Normalize
			features.trendDirection / 2, // Normalize to -1 to 1
			features.supportResistanceDistance,
			features.hourOfDay / 24,
			features.dayOfWeek / 6,
			features.marketSession / 4,
			features.sourceCount / 10, // Assume max 10 sources
			features.sourceAgreement,
			features.avgSourceReliability,
		];
	}

	// ============================================================================
	// Private Calculation Methods
	// ============================================================================

	private calculateVelocity(prices: number[]): number {
		if (prices.length < 2) return 0;
		const changes = [];
		for (let i = 1; i < prices.length; i++) {
			changes.push((prices[i] - prices[i - 1]) / prices[i - 1]);
		}
		return changes.reduce((a, b) => a + b, 0) / changes.length;
	}

	private calculateAcceleration(prices: number[]): number {
		if (prices.length < 3) return 0;
		const velocities = [];
		for (let i = 1; i < prices.length; i++) {
			velocities.push((prices[i] - prices[i - 1]) / prices[i - 1]);
		}
		const accelerations = [];
		for (let i = 1; i < velocities.length; i++) {
			accelerations.push(velocities[i] - velocities[i - 1]);
		}
		return accelerations.reduce((a, b) => a + b, 0) / accelerations.length;
	}

	private calculateVolatility(prices: number[]): number {
		const returns = [];
		for (let i = 1; i < prices.length; i++) {
			returns.push(Math.log(prices[i] / prices[i - 1]));
		}
		const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
		const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
		return Math.sqrt(variance);
	}

	private calculateATR(prices: number[]): number {
		// Simplified ATR using price range
		let atr = 0;
		for (let i = 1; i < prices.length; i++) {
			const tr = Math.abs(prices[i] - prices[i - 1]);
			atr += tr;
		}
		return atr / (prices.length - 1);
	}

	private calculateTrend(data: number[]): number {
		if (data.length < 2) return 0;
		const n = data.length;
		let sumX = 0,
			sumY = 0,
			sumXY = 0,
			sumX2 = 0;
		for (let i = 0; i < n; i++) {
			sumX += i;
			sumY += data[i];
			sumXY += i * data[i];
			sumX2 += i * i;
		}
		return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
	}

	private calculateRSI(prices: number[]): number {
		let gains = 0,
			losses = 0;
		for (let i = 1; i < prices.length; i++) {
			const change = prices[i] - prices[i - 1];
			if (change > 0) gains += change;
			else losses -= change;
		}
		if (losses === 0) return 100;
		const rs = gains / losses;
		return 100 - 100 / (1 + rs);
	}

	private calculateMACDSignal(prices: number[]): number {
		const ema12 = this.calculateEMA(prices, 12);
		const ema26 = this.calculateEMA(prices, 26);
		const macd = ema12 - ema26;
		const signalLine = this.calculateEMA(prices.slice(-9), 9);
		return (macd - signalLine) / prices[prices.length - 1]; // Normalize
	}

	private calculateEMA(data: number[], period: number): number {
		if (data.length < period) return data[data.length - 1];
		const k = 2 / (period + 1);
		let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
		for (let i = period; i < data.length; i++) {
			ema = data[i] * k + ema * (1 - k);
		}
		return ema;
	}

	private calculateBollingerPosition(prices: number[]): number {
		const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
		const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length);
		const upper = mean + 2 * stdDev;
		const lower = mean - 2 * stdDev;
		const current = prices[prices.length - 1];
		return ((current - lower) / (upper - lower)) * 2 - 1; // -1 to 1
	}

	private detectCandlePattern(prices: number[]): CandlePattern {
		// Simplified pattern detection
		const n = prices.length;
		if (n < 3) return CandlePattern.NONE;

		const body1 = prices[n - 2] - prices[n - 3];
		const body2 = prices[n - 1] - prices[n - 2];

		// Engulfing patterns
		if (body1 < 0 && body2 > 0 && Math.abs(body2) > Math.abs(body1) * 1.5) {
			return CandlePattern.ENGULFING_BULL;
		}
		if (body1 > 0 && body2 < 0 && Math.abs(body2) > Math.abs(body1) * 1.5) {
			return CandlePattern.ENGULFING_BEAR;
		}

		// Doji
		if (Math.abs(body2) < Math.abs(prices[n - 1] - prices[n - 2]) * 0.1) {
			return CandlePattern.DOJI;
		}

		return CandlePattern.NONE;
	}

	private detectTrend(prices: number[]): TrendDirection {
		const trend = this.calculateTrend(prices);
		const volatility = this.calculateVolatility(prices);
		const normalizedTrend = trend / volatility;

		if (normalizedTrend > 1) return TrendDirection.STRONG_UP;
		if (normalizedTrend > 0.3) return TrendDirection.UP;
		if (normalizedTrend < -1) return TrendDirection.STRONG_DOWN;
		if (normalizedTrend < -0.3) return TrendDirection.DOWN;
		return TrendDirection.NEUTRAL;
	}

	private calculateSRDistance(prices: number[]): number {
		const current = prices[prices.length - 1];
		const max = Math.max(...prices);
		const min = Math.min(...prices);
		const range = max - min;
		if (range === 0) return 0;

		const distToResistance = (max - current) / range;
		const distToSupport = (current - min) / range;

		return distToResistance - distToSupport; // -1 (at resistance) to 1 (at support)
	}

	private detectMarketSession(hourUTC: number): MarketSession {
		// Simplified session detection
		if (hourUTC >= 0 && hourUTC < 8) return MarketSession.ASIA;
		if (hourUTC >= 8 && hourUTC < 13) return MarketSession.EUROPE;
		if (hourUTC >= 13 && hourUTC < 17) return MarketSession.OVERLAP_EU_US;
		if (hourUTC >= 17 && hourUTC < 21) return MarketSession.US;
		return MarketSession.CLOSED;
	}
}

// ============================================================================
// Simple Neural Network (for demonstration - real implementation would use TensorFlow/ONNX)
// ============================================================================

export class SimpleNeuralNetwork {
	private weights: number[][][];
	private biases: number[][];
	private config: ClassifierConfig;

	constructor(config: Partial<ClassifierConfig> = {}) {
		this.config = { ...DEFAULT_CLASSIFIER_CONFIG, ...config };
		this.weights = [];
		this.biases = [];
		this.initializeWeights();
	}

	private initializeWeights(): void {
		const layers = [this.config.inputSize, ...this.config.hiddenLayers, this.config.outputSize];

		for (let i = 0; i < layers.length - 1; i++) {
			const layerWeights: number[][] = [];
			const layerBiases: number[] = [];

			for (let j = 0; j < layers[i + 1]; j++) {
				const neuronWeights: number[] = [];
				for (let k = 0; k < layers[i]; k++) {
					// Xavier initialization
					neuronWeights.push((Math.random() - 0.5) * 2 * Math.sqrt(6 / (layers[i] + layers[i + 1])));
				}
				layerWeights.push(neuronWeights);
				layerBiases.push(0);
			}

			this.weights.push(layerWeights);
			this.biases.push(layerBiases);
		}
	}

	/**
	 * Forward pass
	 */
	predict(input: number[]): number[] {
		let current = input;

		for (let layer = 0; layer < this.weights.length; layer++) {
			const next: number[] = [];

			for (let neuron = 0; neuron < this.weights[layer].length; neuron++) {
				let sum = this.biases[layer][neuron];
				for (let i = 0; i < current.length; i++) {
					sum += current[i] * this.weights[layer][neuron][i];
				}

				// Activation
				if (layer === this.weights.length - 1) {
					// Output layer - softmax applied later
					next.push(sum);
				} else {
					next.push(this.activate(sum));
				}
			}

			current = next;
		}

		// Apply softmax to output
		return this.softmax(current);
	}

	private activate(x: number): number {
		switch (this.config.activationFunction) {
			case "relu":
				return Math.max(0, x);
			case "sigmoid":
				return 1 / (1 + Math.exp(-x));
			case "tanh":
				return Math.tanh(x);
			default:
				return Math.max(0, x);
		}
	}

	private softmax(x: number[]): number[] {
		const max = Math.max(...x);
		const exps = x.map((v) => Math.exp(v - max));
		const sum = exps.reduce((a, b) => a + b, 0);
		return exps.map((e) => e / sum);
	}

	/**
	 * Set weights from trained model
	 */
	setWeights(weights: number[][][], biases: number[][]): void {
		this.weights = weights;
		this.biases = biases;
	}

	/**
	 * Get model weights for saving
	 */
	getWeights(): { weights: number[][][]; biases: number[][] } {
		return { weights: this.weights, biases: this.biases };
	}
}

// ============================================================================
// Signal Classifier
// ============================================================================

export class SignalClassifier extends EventEmitter {
	private config: ClassifierConfig;
	private featureExtractor: FeatureExtractor;
	private authenticityModel: SimpleNeuralNetwork;
	private qualityModel: SimpleNeuralNetwork;
	private regimeModel: SimpleNeuralNetwork;
	private classificationHistory: ClassificationResult[] = [];

	constructor(config: Partial<ClassifierConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CLASSIFIER_CONFIG, ...config };
		this.featureExtractor = new FeatureExtractor();

		// Initialize models for different classification tasks
		this.authenticityModel = new SimpleNeuralNetwork({
			...this.config,
			outputSize: 3, // authentic, suspicious, spoofed
		});

		this.qualityModel = new SimpleNeuralNetwork({
			...this.config,
			outputSize: 3, // high, medium, low
		});

		this.regimeModel = new SimpleNeuralNetwork({
			...this.config,
			outputSize: 5, // trending_up, trending_down, ranging, volatile, breakout
		});
	}

	/**
	 * Classify signal authenticity (detect spoofed/fake signals)
	 */
	classifyAuthenticity(data: {
		prices: number[];
		volumes: number[];
		timestamps: number[];
		sources?: Array<{ reliability: number; agrees: boolean }>;
	}): AuthenticityResult {
		const features = this.featureExtractor.extractFeatures(data);
		const featureArray = this.featureExtractor.featuresToArray(features);

		const probs = this.authenticityModel.predict(featureArray);
		const labels = ["authentic", "suspicious", "spoofed"] as const;
		const maxIdx = probs.indexOf(Math.max(...probs));

		const flags: string[] = [];

		// Heuristic flags (like fly-catcher's approach)
		if (features.volumeSpike && features.sourceAgreement < 0.5) {
			flags.push("Volume spike with low source agreement");
		}
		if (features.priceAcceleration > 0.1 && features.sourceCount < 2) {
			flags.push("Rapid price movement from single source");
		}
		if (features.volatility > 0.05 && features.avgSourceReliability < 0.5) {
			flags.push("High volatility with unreliable sources");
		}

		// Risk score (0-100)
		const riskScore = Math.round(
			(1 - probs[0]) * 50 + // inverse of authentic probability
				(flags.length / 5) * 30 + // flag penalty
				(1 - features.sourceAgreement) * 20, // source disagreement
		);

		const result: AuthenticityResult = {
			prediction: labels[maxIdx],
			confidence: probs[maxIdx],
			probabilities: {
				authentic: probs[0],
				suspicious: probs[1],
				spoofed: probs[2],
			},
			features: featureArray,
			timestamp: Date.now(),
			riskScore: Math.min(100, riskScore),
			flags,
		};

		this.classificationHistory.push(result);
		this.emit("authenticity", result);

		return result;
	}

	/**
	 * Classify signal quality
	 */
	classifyQuality(data: {
		prices: number[];
		volumes: number[];
		timestamps: number[];
		sources?: Array<{ reliability: number; agrees: boolean }>;
	}): QualityResult {
		const features = this.featureExtractor.extractFeatures(data);
		const featureArray = this.featureExtractor.featuresToArray(features);

		const probs = this.qualityModel.predict(featureArray);
		const labels = ["high", "medium", "low"] as const;
		const maxIdx = probs.indexOf(Math.max(...probs));

		const issues: string[] = [];

		// Quality issues
		if (features.sourceCount < 3) {
			issues.push("Limited source coverage");
		}
		if (features.avgSourceReliability < 0.6) {
			issues.push("Low average source reliability");
		}
		if (features.volatility > 0.03) {
			issues.push("High volatility may affect accuracy");
		}
		if (features.rsiValue > 80 || features.rsiValue < 20) {
			issues.push("Extreme RSI conditions");
		}

		const qualityScore = Math.round(probs[0] * 100 - issues.length * 10);

		const result: QualityResult = {
			prediction: labels[maxIdx],
			confidence: probs[maxIdx],
			probabilities: {
				high: probs[0],
				medium: probs[1],
				low: probs[2],
			},
			features: featureArray,
			timestamp: Date.now(),
			qualityScore: Math.max(0, Math.min(100, qualityScore)),
			issues,
		};

		this.classificationHistory.push(result);
		this.emit("quality", result);

		return result;
	}

	/**
	 * Classify market regime
	 */
	classifyRegime(data: { prices: number[]; volumes: number[]; timestamps: number[] }): RegimeResult {
		const features = this.featureExtractor.extractFeatures(data);
		const featureArray = this.featureExtractor.featuresToArray(features);

		const probs = this.regimeModel.predict(featureArray);
		const labels = ["trending_up", "trending_down", "ranging", "volatile", "breakout"] as const;
		const maxIdx = probs.indexOf(Math.max(...probs));

		// Estimate regime strength and duration
		let regimeStrength = probs[maxIdx];
		let expectedDuration = 10; // Default bars

		// Adjust based on features
		if (labels[maxIdx].startsWith("trending")) {
			regimeStrength *= 1 + Math.abs(features.trendDirection) * 0.2;
			expectedDuration = Math.round(20 / (features.volatility * 100 + 0.1));
		} else if (labels[maxIdx] === "ranging") {
			regimeStrength *= 1 - Math.abs(features.trendDirection) * 0.3;
			expectedDuration = Math.round(30 / (features.volatility * 100 + 0.1));
		} else if (labels[maxIdx] === "volatile") {
			regimeStrength *= features.volatility * 10;
			expectedDuration = Math.round(5 / (features.volatility * 100 + 0.1));
		}

		const result: RegimeResult = {
			prediction: labels[maxIdx],
			confidence: probs[maxIdx],
			probabilities: {
				trending_up: probs[0],
				trending_down: probs[1],
				ranging: probs[2],
				volatile: probs[3],
				breakout: probs[4],
			},
			features: featureArray,
			timestamp: Date.now(),
			regimeStrength: Math.min(1, regimeStrength),
			expectedDuration: Math.max(1, expectedDuration),
		};

		this.classificationHistory.push(result);
		this.emit("regime", result);

		return result;
	}

	/**
	 * Get classification history
	 */
	getHistory(limit = 100): ClassificationResult[] {
		return this.classificationHistory.slice(-limit);
	}

	/**
	 * Load trained model weights
	 */
	loadModel(
		modelType: "authenticity" | "quality" | "regime",
		weights: { weights: number[][][]; biases: number[][] },
	): void {
		const model = {
			authenticity: this.authenticityModel,
			quality: this.qualityModel,
			regime: this.regimeModel,
		}[modelType];

		model.setWeights(weights.weights, weights.biases);
		this.emit("modelLoaded", { type: modelType });
	}
}

// ============================================================================
// Presets
// ============================================================================

export const SignalClassifierPresets = {
	/**
	 * Standard classifier
	 */
	standard: () => new SignalClassifier(),

	/**
	 * High sensitivity for spoof detection
	 */
	highSensitivity: () =>
		new SignalClassifier({
			confidenceThreshold: 0.4,
			useEnsemble: true,
			ensembleSize: 7,
		}),

	/**
	 * Fast classification for real-time use
	 */
	fast: () =>
		new SignalClassifier({
			hiddenLayers: [32, 16],
			useEnsemble: false,
		}),
};

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultClassifier: SignalClassifier | null = null;

export function getSignalClassifier(config?: Partial<ClassifierConfig>): SignalClassifier {
	if (!defaultClassifier) {
		defaultClassifier = new SignalClassifier(config);
	}
	return defaultClassifier;
}

// ============================================================================
// Feature Extractor Singleton
// ============================================================================

let defaultFeatureExtractor: FeatureExtractor | null = null;

export function getFeatureExtractor(): FeatureExtractor {
	if (!defaultFeatureExtractor) {
		defaultFeatureExtractor = new FeatureExtractor();
	}
	return defaultFeatureExtractor;
}
