/**
 * Multi-Source Signal Validator
 *
 * Inspired by ANG13T's skytrack multi-source OSINT aggregation pattern.
 * Validates trading signals by cross-referencing multiple data sources.
 *
 * Pattern:
 * Multiple Sources → Normalize → Aggregate → Cross-Validate → Confidence Score
 *
 * @see https://github.com/ANG13T/skytrack
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export interface SignalSource {
	id: string;
	name: string;
	type: SourceType;
	weight: number; // 0-1, relative importance
	reliability: number; // 0-1, historical accuracy
	latencyMs: number; // Expected latency
	enabled: boolean;
	lastUpdate?: number;
	metadata?: Record<string, unknown>;
}

export enum SourceType {
	PRICE_FEED = "price_feed",
	SENTIMENT = "sentiment",
	TECHNICAL = "technical",
	FUNDAMENTAL = "fundamental",
	ON_CHAIN = "on_chain",
	NEWS = "news",
	SOCIAL = "social",
	WHALE_TRACKING = "whale_tracking",
	ORDER_FLOW = "order_flow",
	EXPERT = "expert",
}

export interface Signal {
	id: string;
	sourceId: string;
	timestamp: number;
	symbol: string;
	direction: SignalDirection;
	strength: number; // 0-1
	confidence: number; // 0-1
	timeframe: string; // e.g., "1h", "4h", "1d"
	entryPrice?: number;
	targetPrice?: number;
	stopLoss?: number;
	expiresAt?: number;
	reasoning?: string;
	metadata?: Record<string, unknown>;
}

export enum SignalDirection {
	LONG = "long",
	SHORT = "short",
	NEUTRAL = "neutral",
}

export interface ValidationResult {
	signal: Signal;
	isValid: boolean;
	aggregatedConfidence: number;
	consensusDirection: SignalDirection;
	consensusStrength: number;
	sourcesAgreed: number;
	sourcesDisagreed: number;
	sourcesNeutral: number;
	warnings: ValidationWarning[];
	sourceBreakdown: SourceValidation[];
	recommendation: string;
	reportTimestamp: number;
}

export interface ValidationWarning {
	code: string;
	severity: "low" | "medium" | "high";
	message: string;
	sourceId?: string;
}

export interface SourceValidation {
	source: SignalSource;
	signal?: Signal;
	agrees: boolean;
	confidence: number;
	timeDelta: number; // ms since signal
	stale: boolean;
}

export interface ValidatorConfig {
	minSourcesRequired: number;
	minAgreementPercent: number;
	maxSignalAgeMs: number;
	staleThresholdMs: number;
	minConfidenceThreshold: number;
	weightByReliability: boolean;
	requireMultipleSourceTypes: boolean;
}

export interface AggregatedSignal {
	symbol: string;
	direction: SignalDirection;
	strength: number;
	confidence: number;
	sourceCount: number;
	agreementPercent: number;
	signals: Signal[];
	timestamp: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_VALIDATOR_CONFIG: ValidatorConfig = {
	minSourcesRequired: 2,
	minAgreementPercent: 60,
	maxSignalAgeMs: 300000, // 5 minutes
	staleThresholdMs: 60000, // 1 minute
	minConfidenceThreshold: 0.5,
	weightByReliability: true,
	requireMultipleSourceTypes: true,
};

// ============================================================================
// Signal Validator Class
// ============================================================================

export class SignalValidator extends EventEmitter {
	private config: ValidatorConfig;
	private sources: Map<string, SignalSource> = new Map();
	private signalBuffer: Map<string, Signal[]> = new Map(); // symbol -> signals
	private validationHistory: ValidationResult[] = [];

	constructor(config: Partial<ValidatorConfig> = {}) {
		super();
		this.config = { ...DEFAULT_VALIDATOR_CONFIG, ...config };
	}

	// ============================================================================
	// Source Management
	// ============================================================================

	/**
	 * Register a signal source
	 */
	registerSource(source: SignalSource): void {
		this.sources.set(source.id, source);
		this.emit("sourceRegistered", source);
	}

	/**
	 * Update source reliability based on performance
	 */
	updateSourceReliability(sourceId: string, newReliability: number): void {
		const source = this.sources.get(sourceId);
		if (source) {
			source.reliability = Math.max(0, Math.min(1, newReliability));
			this.emit("sourceUpdated", source);
		}
	}

	/**
	 * Enable/disable a source
	 */
	setSourceEnabled(sourceId: string, enabled: boolean): void {
		const source = this.sources.get(sourceId);
		if (source) {
			source.enabled = enabled;
			this.emit("sourceUpdated", source);
		}
	}

	/**
	 * Get all registered sources
	 */
	getSources(): SignalSource[] {
		return Array.from(this.sources.values());
	}

	/**
	 * Get enabled sources
	 */
	getEnabledSources(): SignalSource[] {
		return this.getSources().filter((s) => s.enabled);
	}

	// ============================================================================
	// Signal Processing
	// ============================================================================

	/**
	 * Add a signal from a source
	 */
	addSignal(signal: Signal): void {
		// Validate source exists
		if (!this.sources.has(signal.sourceId)) {
			this.emit("warning", {
				code: "UNKNOWN_SOURCE",
				message: `Signal from unknown source: ${signal.sourceId}`,
			});
			return;
		}

		// Get or create signal buffer for symbol
		if (!this.signalBuffer.has(signal.symbol)) {
			this.signalBuffer.set(signal.symbol, []);
		}

		const buffer = this.signalBuffer.get(signal.symbol)!;

		// Remove old signals from same source
		const filtered = buffer.filter((s) => s.sourceId !== signal.sourceId);
		filtered.push(signal);

		// Sort by timestamp
		filtered.sort((a, b) => b.timestamp - a.timestamp);

		// Keep only recent signals
		const now = Date.now();
		const recent = filtered.filter((s) => now - s.timestamp < this.config.maxSignalAgeMs);

		this.signalBuffer.set(signal.symbol, recent);

		// Update source last update time
		const source = this.sources.get(signal.sourceId);
		if (source) {
			source.lastUpdate = signal.timestamp;
		}

		this.emit("signalAdded", signal);
	}

	/**
	 * Validate a signal against other sources
	 */
	validate(signal: Signal): ValidationResult {
		const now = Date.now();
		const warnings: ValidationWarning[] = [];
		const sourceBreakdown: SourceValidation[] = [];

		// Get all recent signals for the symbol
		const allSignals = this.signalBuffer.get(signal.symbol) || [];

		// Get enabled sources
		const enabledSources = this.getEnabledSources();

		// Check minimum sources requirement
		if (enabledSources.length < this.config.minSourcesRequired) {
			warnings.push({
				code: "INSUFFICIENT_SOURCES",
				severity: "high",
				message: `Only ${enabledSources.length} sources available (required: ${this.config.minSourcesRequired})`,
			});
		}

		// Analyze each source
		let agreementSum = 0;
		let _disagreementSum = 0;
		let _neutralSum = 0;
		let totalWeight = 0;

		const sourceTypes = new Set<SourceType>();

		for (const source of enabledSources) {
			const sourceSignal = allSignals.find((s) => s.sourceId === source.id);
			const timeDelta = sourceSignal ? now - sourceSignal.timestamp : Infinity;
			const stale = timeDelta > this.config.staleThresholdMs;

			const weight = this.config.weightByReliability ? source.weight * source.reliability : source.weight;

			if (sourceSignal) {
				sourceTypes.add(source.type);

				const agrees = this.signalsAgree(signal, sourceSignal);
				const isNeutral = sourceSignal.direction === SignalDirection.NEUTRAL;

				if (isNeutral) {
					_neutralSum += weight;
				} else if (agrees) {
					agreementSum += weight;
				} else {
					_disagreementSum += weight;
				}

				totalWeight += weight;

				sourceBreakdown.push({
					source,
					signal: sourceSignal,
					agrees,
					confidence: sourceSignal.confidence,
					timeDelta,
					stale,
				});

				if (stale) {
					warnings.push({
						code: "STALE_SIGNAL",
						severity: "medium",
						message: `Signal from ${source.name} is ${Math.round(timeDelta / 1000)}s old`,
						sourceId: source.id,
					});
				}
			} else {
				sourceBreakdown.push({
					source,
					agrees: false,
					confidence: 0,
					timeDelta: Infinity,
					stale: true,
				});

				warnings.push({
					code: "MISSING_SIGNAL",
					severity: "low",
					message: `No recent signal from ${source.name}`,
					sourceId: source.id,
				});
			}
		}

		// Check source type diversity
		if (this.config.requireMultipleSourceTypes && sourceTypes.size < 2) {
			warnings.push({
				code: "LOW_SOURCE_DIVERSITY",
				severity: "medium",
				message: `Only ${sourceTypes.size} source type(s) represented`,
			});
		}

		// Calculate consensus
		const agreementPercent = totalWeight > 0 ? (agreementSum / totalWeight) * 100 : 0;
		const sourcesAgreed = sourceBreakdown.filter((s) => s.agrees && s.signal).length;
		const sourcesDisagreed = sourceBreakdown.filter(
			(s) => !s.agrees && s.signal && s.signal.direction !== SignalDirection.NEUTRAL,
		).length;
		const sourcesNeutral = sourceBreakdown.filter((s) => s.signal?.direction === SignalDirection.NEUTRAL).length;

		// Calculate aggregated confidence
		const aggregatedConfidence = this.calculateAggregatedConfidence(sourceBreakdown, agreementPercent);

		// Determine consensus direction and strength
		const { direction: consensusDirection, strength: consensusStrength } = this.calculateConsensus(sourceBreakdown);

		// Determine validity
		const isValid =
			agreementPercent >= this.config.minAgreementPercent &&
			sourcesAgreed >= this.config.minSourcesRequired &&
			aggregatedConfidence >= this.config.minConfidenceThreshold;

		// Generate recommendation
		const recommendation = this.generateRecommendation(
			isValid,
			agreementPercent,
			aggregatedConfidence,
			warnings,
			signal.direction,
			consensusDirection,
		);

		const result: ValidationResult = {
			signal,
			isValid,
			aggregatedConfidence,
			consensusDirection,
			consensusStrength,
			sourcesAgreed,
			sourcesDisagreed,
			sourcesNeutral,
			warnings,
			sourceBreakdown,
			recommendation,
			reportTimestamp: now,
		};

		this.validationHistory.push(result);
		this.emit("validated", result);

		return result;
	}

	/**
	 * Get aggregated signal for a symbol
	 */
	getAggregatedSignal(symbol: string): AggregatedSignal | null {
		const signals = this.signalBuffer.get(symbol);
		if (!signals || signals.length === 0) return null;

		const now = Date.now();
		const recentSignals = signals.filter((s) => now - s.timestamp < this.config.maxSignalAgeMs);

		if (recentSignals.length === 0) return null;

		// Weight by source reliability
		let totalWeight = 0;
		let directionScore = 0; // positive = long, negative = short
		let strengthSum = 0;
		let confidenceSum = 0;

		for (const signal of recentSignals) {
			const source = this.sources.get(signal.sourceId);
			if (!source?.enabled) continue;

			const weight = this.config.weightByReliability ? source.weight * source.reliability : source.weight;

			totalWeight += weight;
			strengthSum += signal.strength * weight;
			confidenceSum += signal.confidence * weight;

			if (signal.direction === SignalDirection.LONG) {
				directionScore += signal.strength * weight;
			} else if (signal.direction === SignalDirection.SHORT) {
				directionScore -= signal.strength * weight;
			}
		}

		if (totalWeight === 0) return null;

		const _avgStrength = strengthSum / totalWeight;
		const avgConfidence = confidenceSum / totalWeight;
		const normalizedDirection = directionScore / totalWeight;

		let direction: SignalDirection;
		if (normalizedDirection > 0.1) {
			direction = SignalDirection.LONG;
		} else if (normalizedDirection < -0.1) {
			direction = SignalDirection.SHORT;
		} else {
			direction = SignalDirection.NEUTRAL;
		}

		// Calculate agreement
		const agreeCount = recentSignals.filter((s) => {
			if (direction === SignalDirection.NEUTRAL) return s.direction === SignalDirection.NEUTRAL;
			return s.direction === direction;
		}).length;

		return {
			symbol,
			direction,
			strength: Math.abs(normalizedDirection),
			confidence: avgConfidence,
			sourceCount: recentSignals.length,
			agreementPercent: (agreeCount / recentSignals.length) * 100,
			signals: recentSignals,
			timestamp: now,
		};
	}

	/**
	 * Get validation history
	 */
	getValidationHistory(limit = 100): ValidationResult[] {
		return this.validationHistory.slice(-limit);
	}

	/**
	 * Clear old data
	 */
	cleanup(maxAgeMs: number = this.config.maxSignalAgeMs): void {
		const now = Date.now();

		// Clean signal buffers
		for (const [symbol, signals] of this.signalBuffer) {
			const recent = signals.filter((s) => now - s.timestamp < maxAgeMs);
			if (recent.length === 0) {
				this.signalBuffer.delete(symbol);
			} else {
				this.signalBuffer.set(symbol, recent);
			}
		}

		// Trim validation history
		if (this.validationHistory.length > 1000) {
			this.validationHistory = this.validationHistory.slice(-500);
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private signalsAgree(signal1: Signal, signal2: Signal): boolean {
		if (signal1.direction === SignalDirection.NEUTRAL || signal2.direction === SignalDirection.NEUTRAL) {
			return false;
		}
		return signal1.direction === signal2.direction;
	}

	private calculateAggregatedConfidence(breakdown: SourceValidation[], agreementPercent: number): number {
		if (breakdown.length === 0) return 0;

		// Base confidence from agreeing sources
		const agreeingSources = breakdown.filter((s) => s.agrees && s.signal);
		if (agreeingSources.length === 0) return 0;

		// Average confidence of agreeing sources, weighted by source reliability
		let totalWeight = 0;
		let weightedConfidence = 0;

		for (const sv of agreeingSources) {
			const source = sv.source;
			const weight = this.config.weightByReliability ? source.weight * source.reliability : source.weight;

			weightedConfidence += sv.confidence * weight;
			totalWeight += weight;
		}

		const avgConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

		// Adjust by agreement level
		const agreementFactor = agreementPercent / 100;

		// Penalize for stale signals
		const staleCount = breakdown.filter((s) => s.stale && s.signal).length;
		const stalePenalty = 1 - staleCount * 0.1;

		return Math.max(0, Math.min(1, avgConfidence * agreementFactor * stalePenalty));
	}

	private calculateConsensus(breakdown: SourceValidation[]): {
		direction: SignalDirection;
		strength: number;
	} {
		let longScore = 0;
		let shortScore = 0;
		let totalWeight = 0;

		for (const sv of breakdown) {
			if (!sv.signal) continue;

			const source = sv.source;
			const weight = this.config.weightByReliability ? source.weight * source.reliability : source.weight;

			if (sv.signal.direction === SignalDirection.LONG) {
				longScore += sv.signal.strength * sv.confidence * weight;
			} else if (sv.signal.direction === SignalDirection.SHORT) {
				shortScore += sv.signal.strength * sv.confidence * weight;
			}

			totalWeight += weight;
		}

		if (totalWeight === 0) {
			return { direction: SignalDirection.NEUTRAL, strength: 0 };
		}

		const netScore = (longScore - shortScore) / totalWeight;

		if (Math.abs(netScore) < 0.1) {
			return { direction: SignalDirection.NEUTRAL, strength: Math.abs(netScore) };
		}

		return {
			direction: netScore > 0 ? SignalDirection.LONG : SignalDirection.SHORT,
			strength: Math.abs(netScore),
		};
	}

	private generateRecommendation(
		isValid: boolean,
		agreementPercent: number,
		confidence: number,
		warnings: ValidationWarning[],
		signalDirection: SignalDirection,
		consensusDirection: SignalDirection,
	): string {
		const highSeverityWarnings = warnings.filter((w) => w.severity === "high").length;

		if (!isValid) {
			if (agreementPercent < this.config.minAgreementPercent) {
				return `REJECT: Low agreement (${agreementPercent.toFixed(1)}%). Sources are conflicting on direction.`;
			}
			if (confidence < this.config.minConfidenceThreshold) {
				return `REJECT: Low confidence (${(confidence * 100).toFixed(1)}%). Signal quality is insufficient.`;
			}
			if (highSeverityWarnings > 0) {
				return `REJECT: ${highSeverityWarnings} high-severity warning(s). Review source availability.`;
			}
			return "REJECT: Signal does not meet validation criteria.";
		}

		if (signalDirection !== consensusDirection && consensusDirection !== SignalDirection.NEUTRAL) {
			return `CAUTION: Signal direction (${signalDirection}) conflicts with consensus (${consensusDirection}).`;
		}

		if (warnings.length > 3) {
			return `PROCEED WITH CAUTION: Valid signal but ${warnings.length} warnings. Reduce position size.`;
		}

		if (confidence >= 0.8 && agreementPercent >= 80) {
			return `STRONG SIGNAL: High confidence (${(confidence * 100).toFixed(1)}%) and agreement (${agreementPercent.toFixed(1)}%).`;
		}

		return `VALID: Signal confirmed by ${agreementPercent.toFixed(1)}% of sources with ${(confidence * 100).toFixed(1)}% confidence.`;
	}
}

// ============================================================================
// Default Sources Templates
// ============================================================================

export const DEFAULT_SIGNAL_SOURCES: SignalSource[] = [
	{
		id: "price-agent",
		name: "Price Analysis Agent",
		type: SourceType.TECHNICAL,
		weight: 1.0,
		reliability: 0.8,
		latencyMs: 100,
		enabled: true,
	},
	{
		id: "sentiment-agent",
		name: "Sentiment Analysis Agent",
		type: SourceType.SENTIMENT,
		weight: 0.8,
		reliability: 0.7,
		latencyMs: 200,
		enabled: true,
	},
	{
		id: "whale-agent",
		name: "Whale Tracking Agent",
		type: SourceType.ON_CHAIN,
		weight: 0.9,
		reliability: 0.85,
		latencyMs: 500,
		enabled: true,
	},
	{
		id: "news-agent",
		name: "News Analysis Agent",
		type: SourceType.NEWS,
		weight: 0.6,
		reliability: 0.6,
		latencyMs: 1000,
		enabled: true,
	},
	{
		id: "social-agent",
		name: "Social Media Agent",
		type: SourceType.SOCIAL,
		weight: 0.5,
		reliability: 0.5,
		latencyMs: 500,
		enabled: true,
	},
	{
		id: "order-flow-agent",
		name: "Order Flow Agent",
		type: SourceType.ORDER_FLOW,
		weight: 0.9,
		reliability: 0.9,
		latencyMs: 50,
		enabled: true,
	},
];

// ============================================================================
// Factory and Presets
// ============================================================================

export function createSignalValidator(config?: Partial<ValidatorConfig>): SignalValidator {
	const validator = new SignalValidator(config);

	// Register default sources
	for (const source of DEFAULT_SIGNAL_SOURCES) {
		validator.registerSource(source);
	}

	return validator;
}

export const SignalValidatorPresets = {
	/**
	 * Conservative validation - requires strong consensus
	 */
	conservative: () =>
		new SignalValidator({
			minSourcesRequired: 4,
			minAgreementPercent: 75,
			minConfidenceThreshold: 0.7,
			requireMultipleSourceTypes: true,
		}),

	/**
	 * Standard validation
	 */
	standard: () => createSignalValidator(),

	/**
	 * Aggressive validation - lower requirements
	 */
	aggressive: () =>
		new SignalValidator({
			minSourcesRequired: 2,
			minAgreementPercent: 50,
			minConfidenceThreshold: 0.4,
			requireMultipleSourceTypes: false,
		}),

	/**
	 * Real-time validation - faster but less strict
	 */
	realtime: () =>
		new SignalValidator({
			minSourcesRequired: 2,
			minAgreementPercent: 60,
			maxSignalAgeMs: 60000,
			staleThresholdMs: 10000,
		}),
};

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultValidator: SignalValidator | null = null;

export function getSignalValidator(config?: Partial<ValidatorConfig>): SignalValidator {
	if (!defaultValidator) {
		defaultValidator = createSignalValidator(config);
	}
	return defaultValidator;
}
