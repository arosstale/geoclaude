/**
 * Anomaly Detection Service
 *
 * Inspired by ANG13T's DroneXtract flight integrity analysis.
 * Applies variance analysis and data gap detection to market data
 * for identifying manipulation, spoofing, and suspicious patterns.
 *
 * Patterns:
 * - Variance analysis across time windows
 * - Suspicious data gap detection
 * - Value spike detection
 * - Pattern correlation analysis
 *
 * @see https://github.com/ANG13T/DroneXtract
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export interface DataPoint {
	timestamp: number;
	value: number;
	volume?: number;
	source?: string;
	metadata?: Record<string, unknown>;
}

export interface AnomalyConfig {
	// Variance thresholds
	maxVarianceMultiplier: number; // How many std devs is anomalous
	minDataPoints: number; // Minimum points for analysis

	// Gap detection
	maxGapSeconds: number; // Maximum allowed gap between points
	gapSeverityThreshold: number; // 0-1, when gap becomes severe

	// Spike detection
	spikeThresholdPercent: number; // % change that's a spike
	spikeWindowSize: number; // Number of points to compare

	// Pattern detection
	patternWindowSize: number; // Window for pattern analysis
	correlationThreshold: number; // Min correlation to flag

	// Rolling analysis
	rollingWindowSize: number; // Points in rolling window
	updateIntervalMs: number; // How often to recalculate
}

export interface AnomalyResult {
	type: AnomalyType;
	severity: AnomalySeverity;
	timestamp: number;
	value: number;
	expectedRange: { min: number; max: number };
	deviation: number;
	description: string;
	confidence: number;
	relatedPoints?: DataPoint[];
}

export enum AnomalyType {
	VARIANCE_SPIKE = "variance_spike",
	DATA_GAP = "data_gap",
	VALUE_SPIKE = "value_spike",
	PATTERN_BREAK = "pattern_break",
	CORRELATION_ANOMALY = "correlation_anomaly",
	VOLUME_ANOMALY = "volume_anomaly",
	SOURCE_MISMATCH = "source_mismatch",
	MANIPULATION_SUSPECTED = "manipulation_suspected",
}

export enum AnomalySeverity {
	LOW = "low",
	MEDIUM = "medium",
	HIGH = "high",
	CRITICAL = "critical",
}

export interface IntegrityReport {
	timestamp: number;
	dataPoints: number;
	timeRange: { start: number; end: number };
	anomalies: AnomalyResult[];
	statistics: DataStatistics;
	integrityScore: number; // 0-100
	recommendation: string;
}

export interface DataStatistics {
	mean: number;
	median: number;
	stdDev: number;
	variance: number;
	min: number;
	max: number;
	range: number;
	skewness: number;
	kurtosis: number;
	gapCount: number;
	avgGapSeconds: number;
	maxGapSeconds: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
	maxVarianceMultiplier: 3.0,
	minDataPoints: 20,
	maxGapSeconds: 300, // 5 minutes
	gapSeverityThreshold: 0.7,
	spikeThresholdPercent: 5.0,
	spikeWindowSize: 5,
	patternWindowSize: 20,
	correlationThreshold: 0.8,
	rollingWindowSize: 100,
	updateIntervalMs: 1000,
};

// ============================================================================
// Anomaly Detector Class
// ============================================================================

export class AnomalyDetector extends EventEmitter {
	private config: AnomalyConfig;
	private dataBuffer: DataPoint[] = [];
	private anomalyHistory: AnomalyResult[] = [];
	private statistics: DataStatistics | null = null;
	private rollingInterval: NodeJS.Timeout | null = null;
	private isRunning = false;

	constructor(config: Partial<AnomalyConfig> = {}) {
		super();
		this.config = { ...DEFAULT_ANOMALY_CONFIG, ...config };
	}

	/**
	 * Start real-time anomaly detection
	 */
	start(): void {
		if (this.isRunning) return;
		this.isRunning = true;

		this.rollingInterval = setInterval(() => {
			if (this.dataBuffer.length >= this.config.minDataPoints) {
				this.runAnalysis();
			}
		}, this.config.updateIntervalMs);

		this.emit("started");
	}

	/**
	 * Stop real-time detection
	 */
	stop(): void {
		this.isRunning = false;
		if (this.rollingInterval) {
			clearInterval(this.rollingInterval);
			this.rollingInterval = null;
		}
		this.emit("stopped");
	}

	/**
	 * Add a data point for analysis
	 */
	addDataPoint(point: DataPoint): AnomalyResult[] {
		this.dataBuffer.push(point);

		// Trim buffer to rolling window size
		while (this.dataBuffer.length > this.config.rollingWindowSize) {
			this.dataBuffer.shift();
		}

		// Run immediate checks
		const anomalies = this.checkImmediate(point);

		if (anomalies.length > 0) {
			this.anomalyHistory.push(...anomalies);
			for (const anomaly of anomalies) {
				this.emit("anomaly", anomaly);
			}
		}

		return anomalies;
	}

	/**
	 * Analyze a batch of data points
	 */
	analyzeBatch(data: DataPoint[]): IntegrityReport {
		// Sort by timestamp
		const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

		// Calculate statistics
		const stats = this.calculateStatistics(sorted);
		this.statistics = stats;

		// Detect all anomaly types
		const anomalies: AnomalyResult[] = [];

		anomalies.push(...this.detectVarianceAnomalies(sorted, stats));
		anomalies.push(...this.detectDataGaps(sorted));
		anomalies.push(...this.detectValueSpikes(sorted, stats));
		anomalies.push(...this.detectPatternBreaks(sorted, stats));
		anomalies.push(...this.detectVolumeAnomalies(sorted));
		anomalies.push(...this.detectManipulation(sorted, stats, anomalies));

		// Calculate integrity score
		const integrityScore = this.calculateIntegrityScore(sorted, anomalies, stats);

		// Generate recommendation
		const recommendation = this.generateRecommendation(integrityScore, anomalies);

		return {
			timestamp: Date.now(),
			dataPoints: sorted.length,
			timeRange: {
				start: sorted[0]?.timestamp ?? 0,
				end: sorted[sorted.length - 1]?.timestamp ?? 0,
			},
			anomalies,
			statistics: stats,
			integrityScore,
			recommendation,
		};
	}

	/**
	 * Get current statistics
	 */
	getStatistics(): DataStatistics | null {
		return this.statistics;
	}

	/**
	 * Get anomaly history
	 */
	getAnomalyHistory(): AnomalyResult[] {
		return [...this.anomalyHistory];
	}

	/**
	 * Clear buffers
	 */
	clear(): void {
		this.dataBuffer = [];
		this.anomalyHistory = [];
		this.statistics = null;
	}

	// ============================================================================
	// Private Methods - Analysis
	// ============================================================================

	private runAnalysis(): void {
		if (this.dataBuffer.length < this.config.minDataPoints) return;

		const report = this.analyzeBatch(this.dataBuffer);
		this.emit("analysis", report);

		if (report.integrityScore < 50) {
			this.emit("alert", {
				type: "low_integrity",
				score: report.integrityScore,
				anomalies: report.anomalies.length,
			});
		}
	}

	private checkImmediate(point: DataPoint): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];

		if (this.dataBuffer.length < 2) return anomalies;

		const prevPoint = this.dataBuffer[this.dataBuffer.length - 2];

		// Check for gap
		const gapSeconds = (point.timestamp - prevPoint.timestamp) / 1000;
		if (gapSeconds > this.config.maxGapSeconds) {
			anomalies.push({
				type: AnomalyType.DATA_GAP,
				severity: gapSeconds > this.config.maxGapSeconds * 2 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
				timestamp: point.timestamp,
				value: gapSeconds,
				expectedRange: { min: 0, max: this.config.maxGapSeconds },
				deviation: gapSeconds - this.config.maxGapSeconds,
				description: `Data gap of ${gapSeconds.toFixed(1)}s detected (max: ${this.config.maxGapSeconds}s)`,
				confidence: 1.0,
			});
		}

		// Check for spike
		const changePercent = Math.abs(((point.value - prevPoint.value) / prevPoint.value) * 100);
		if (changePercent > this.config.spikeThresholdPercent) {
			anomalies.push({
				type: AnomalyType.VALUE_SPIKE,
				severity:
					changePercent > this.config.spikeThresholdPercent * 2 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
				timestamp: point.timestamp,
				value: point.value,
				expectedRange: {
					min: prevPoint.value * (1 - this.config.spikeThresholdPercent / 100),
					max: prevPoint.value * (1 + this.config.spikeThresholdPercent / 100),
				},
				deviation: changePercent,
				description: `Value spike of ${changePercent.toFixed(2)}% (threshold: ${this.config.spikeThresholdPercent}%)`,
				confidence: 0.9,
				relatedPoints: [prevPoint],
			});
		}

		return anomalies;
	}

	// ============================================================================
	// Private Methods - Detection Algorithms
	// ============================================================================

	private detectVarianceAnomalies(data: DataPoint[], stats: DataStatistics): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];
		const threshold = stats.stdDev * this.config.maxVarianceMultiplier;

		for (const point of data) {
			const deviation = Math.abs(point.value - stats.mean);
			if (deviation > threshold) {
				const zScore = deviation / stats.stdDev;
				anomalies.push({
					type: AnomalyType.VARIANCE_SPIKE,
					severity: this.zScoreToSeverity(zScore),
					timestamp: point.timestamp,
					value: point.value,
					expectedRange: {
						min: stats.mean - threshold,
						max: stats.mean + threshold,
					},
					deviation: zScore,
					description: `Value ${point.value.toFixed(4)} is ${zScore.toFixed(1)} std devs from mean`,
					confidence: Math.min(0.99, 0.5 + zScore * 0.1),
				});
			}
		}

		return anomalies;
	}

	private detectDataGaps(data: DataPoint[]): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];

		for (let i = 1; i < data.length; i++) {
			const gapSeconds = (data[i].timestamp - data[i - 1].timestamp) / 1000;

			if (gapSeconds > this.config.maxGapSeconds) {
				const severity =
					gapSeconds > this.config.maxGapSeconds * 3
						? AnomalySeverity.CRITICAL
						: gapSeconds > this.config.maxGapSeconds * 2
							? AnomalySeverity.HIGH
							: AnomalySeverity.MEDIUM;

				anomalies.push({
					type: AnomalyType.DATA_GAP,
					severity,
					timestamp: data[i].timestamp,
					value: gapSeconds,
					expectedRange: { min: 0, max: this.config.maxGapSeconds },
					deviation: gapSeconds / this.config.maxGapSeconds,
					description: `Gap of ${this.formatDuration(gapSeconds)} between points`,
					confidence: 1.0,
					relatedPoints: [data[i - 1], data[i]],
				});
			}
		}

		return anomalies;
	}

	private detectValueSpikes(data: DataPoint[], _stats: DataStatistics): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];
		const windowSize = this.config.spikeWindowSize;

		for (let i = windowSize; i < data.length; i++) {
			const window = data.slice(i - windowSize, i);
			const windowMean = window.reduce((sum, p) => sum + p.value, 0) / windowSize;
			const current = data[i].value;

			const changePercent = Math.abs(((current - windowMean) / windowMean) * 100);

			if (changePercent > this.config.spikeThresholdPercent) {
				anomalies.push({
					type: AnomalyType.VALUE_SPIKE,
					severity: this.percentToSeverity(changePercent),
					timestamp: data[i].timestamp,
					value: current,
					expectedRange: {
						min: windowMean * (1 - this.config.spikeThresholdPercent / 100),
						max: windowMean * (1 + this.config.spikeThresholdPercent / 100),
					},
					deviation: changePercent,
					description: `${changePercent.toFixed(2)}% change from ${windowSize}-point moving average`,
					confidence: 0.85,
					relatedPoints: window,
				});
			}
		}

		return anomalies;
	}

	private detectPatternBreaks(data: DataPoint[], _stats: DataStatistics): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];
		const windowSize = this.config.patternWindowSize;

		if (data.length < windowSize * 2) return anomalies;

		// Compare consecutive windows
		for (let i = windowSize; i < data.length - windowSize; i += windowSize) {
			const window1 = data.slice(i - windowSize, i).map((p) => p.value);
			const window2 = data.slice(i, i + windowSize).map((p) => p.value);

			const correlation = this.pearsonCorrelation(window1, window2);

			if (Math.abs(correlation) < this.config.correlationThreshold) {
				anomalies.push({
					type: AnomalyType.PATTERN_BREAK,
					severity: correlation < 0 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
					timestamp: data[i].timestamp,
					value: correlation,
					expectedRange: { min: this.config.correlationThreshold, max: 1.0 },
					deviation: this.config.correlationThreshold - Math.abs(correlation),
					description: `Pattern correlation dropped to ${correlation.toFixed(3)} (threshold: ${this.config.correlationThreshold})`,
					confidence: 0.75,
				});
			}
		}

		return anomalies;
	}

	private detectVolumeAnomalies(data: DataPoint[]): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];

		// Only analyze if volume data exists
		const volumeData = data.filter((p) => p.volume !== undefined);
		if (volumeData.length < this.config.minDataPoints) return anomalies;

		const volumes = volumeData.map((p) => p.volume!);
		const volumeStats = this.calculateBasicStats(volumes);

		for (const point of volumeData) {
			const zScore = (point.volume! - volumeStats.mean) / volumeStats.stdDev;

			if (Math.abs(zScore) > this.config.maxVarianceMultiplier) {
				anomalies.push({
					type: AnomalyType.VOLUME_ANOMALY,
					severity: this.zScoreToSeverity(Math.abs(zScore)),
					timestamp: point.timestamp,
					value: point.volume!,
					expectedRange: {
						min: volumeStats.mean - volumeStats.stdDev * this.config.maxVarianceMultiplier,
						max: volumeStats.mean + volumeStats.stdDev * this.config.maxVarianceMultiplier,
					},
					deviation: zScore,
					description: `Volume ${point.volume!.toFixed(0)} is ${zScore.toFixed(1)} std devs from mean`,
					confidence: 0.8,
				});
			}
		}

		return anomalies;
	}

	private detectManipulation(
		data: DataPoint[],
		_stats: DataStatistics,
		existingAnomalies: AnomalyResult[],
	): AnomalyResult[] {
		const anomalies: AnomalyResult[] = [];

		// Look for manipulation patterns: coordinated spikes + volume anomalies + gaps
		const timeWindow = 60000; // 1 minute windows
		const anomalyGroups = new Map<number, AnomalyResult[]>();

		for (const anomaly of existingAnomalies) {
			const windowKey = Math.floor(anomaly.timestamp / timeWindow);
			if (!anomalyGroups.has(windowKey)) {
				anomalyGroups.set(windowKey, []);
			}
			anomalyGroups.get(windowKey)!.push(anomaly);
		}

		// Flag windows with multiple anomaly types as potential manipulation
		for (const [windowKey, windowAnomalies] of anomalyGroups) {
			const types = new Set(windowAnomalies.map((a) => a.type));

			if (types.size >= 3) {
				// Multiple anomaly types in same window
				anomalies.push({
					type: AnomalyType.MANIPULATION_SUSPECTED,
					severity: AnomalySeverity.CRITICAL,
					timestamp: windowKey * timeWindow,
					value: types.size,
					expectedRange: { min: 0, max: 1 },
					deviation: types.size - 1,
					description: `${types.size} different anomaly types detected in 1-minute window (${Array.from(types).join(", ")})`,
					confidence: 0.7 + types.size * 0.05,
					relatedPoints: data.filter((p) => Math.floor(p.timestamp / timeWindow) === windowKey),
				});
			}
		}

		return anomalies;
	}

	// ============================================================================
	// Private Methods - Statistics
	// ============================================================================

	private calculateStatistics(data: DataPoint[]): DataStatistics {
		const values = data.map((p) => p.value);
		const basic = this.calculateBasicStats(values);

		// Calculate gaps
		const gaps: number[] = [];
		for (let i = 1; i < data.length; i++) {
			gaps.push((data[i].timestamp - data[i - 1].timestamp) / 1000);
		}
		const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
		const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;
		const gapCount = gaps.filter((g) => g > this.config.maxGapSeconds).length;

		// Calculate skewness and kurtosis
		const n = values.length;
		const m3 = values.reduce((sum, v) => sum + (v - basic.mean) ** 3, 0) / n;
		const m4 = values.reduce((sum, v) => sum + (v - basic.mean) ** 4, 0) / n;
		const skewness = m3 / basic.stdDev ** 3;
		const kurtosis = m4 / basic.stdDev ** 4 - 3; // Excess kurtosis

		return {
			mean: basic.mean,
			median: this.calculateMedian(values),
			stdDev: basic.stdDev,
			variance: basic.stdDev ** 2,
			min: basic.min,
			max: basic.max,
			range: basic.max - basic.min,
			skewness,
			kurtosis,
			gapCount,
			avgGapSeconds: avgGap,
			maxGapSeconds: maxGap,
		};
	}

	private calculateBasicStats(values: number[]): {
		mean: number;
		stdDev: number;
		min: number;
		max: number;
	} {
		const n = values.length;
		const mean = values.reduce((a, b) => a + b, 0) / n;
		const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;

		return {
			mean,
			stdDev: Math.sqrt(variance),
			min: Math.min(...values),
			max: Math.max(...values),
		};
	}

	private calculateMedian(values: number[]): number {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	private pearsonCorrelation(x: number[], y: number[]): number {
		const n = Math.min(x.length, y.length);
		if (n === 0) return 0;

		const meanX = x.reduce((a, b) => a + b, 0) / n;
		const meanY = y.reduce((a, b) => a + b, 0) / n;

		let num = 0;
		let denomX = 0;
		let denomY = 0;

		for (let i = 0; i < n; i++) {
			const dx = x[i] - meanX;
			const dy = y[i] - meanY;
			num += dx * dy;
			denomX += dx * dx;
			denomY += dy * dy;
		}

		const denom = Math.sqrt(denomX * denomY);
		return denom === 0 ? 0 : num / denom;
	}

	// ============================================================================
	// Private Methods - Utilities
	// ============================================================================

	private zScoreToSeverity(zScore: number): AnomalySeverity {
		const absZ = Math.abs(zScore);
		if (absZ >= 4) return AnomalySeverity.CRITICAL;
		if (absZ >= 3) return AnomalySeverity.HIGH;
		if (absZ >= 2) return AnomalySeverity.MEDIUM;
		return AnomalySeverity.LOW;
	}

	private percentToSeverity(percent: number): AnomalySeverity {
		if (percent >= 20) return AnomalySeverity.CRITICAL;
		if (percent >= 10) return AnomalySeverity.HIGH;
		if (percent >= 5) return AnomalySeverity.MEDIUM;
		return AnomalySeverity.LOW;
	}

	private formatDuration(seconds: number): string {
		if (seconds < 60) return `${seconds.toFixed(0)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	}

	private calculateIntegrityScore(_data: DataPoint[], anomalies: AnomalyResult[], stats: DataStatistics): number {
		let score = 100;

		// Deduct for anomalies based on severity
		for (const anomaly of anomalies) {
			switch (anomaly.severity) {
				case AnomalySeverity.CRITICAL:
					score -= 15;
					break;
				case AnomalySeverity.HIGH:
					score -= 10;
					break;
				case AnomalySeverity.MEDIUM:
					score -= 5;
					break;
				case AnomalySeverity.LOW:
					score -= 2;
					break;
			}
		}

		// Deduct for data gaps
		score -= stats.gapCount * 3;

		// Deduct for high variance
		const cv = stats.stdDev / stats.mean; // Coefficient of variation
		if (cv > 0.5) score -= 10;

		// Bonus for consistent data
		if (anomalies.length === 0 && stats.gapCount === 0) score += 5;

		return Math.max(0, Math.min(100, score));
	}

	private generateRecommendation(score: number, anomalies: AnomalyResult[]): string {
		if (score >= 90) {
			return "Data integrity is excellent. No significant anomalies detected.";
		}
		if (score >= 70) {
			return `Minor anomalies detected (${anomalies.length}). Data is generally reliable but verify flagged points.`;
		}
		if (score >= 50) {
			const critical = anomalies.filter((a) => a.severity === AnomalySeverity.CRITICAL).length;
			return `Significant anomalies detected (${anomalies.length}, ${critical} critical). Review data source and timing.`;
		}
		return "Data integrity is compromised. Multiple severe anomalies detected. Do not rely on this data for critical decisions.";
	}
}

// ============================================================================
// Presets
// ============================================================================

export const AnomalyDetectorPresets = {
	/**
	 * Strict detection for high-stakes trading
	 */
	strict: () =>
		new AnomalyDetector({
			maxVarianceMultiplier: 2.0,
			maxGapSeconds: 60,
			spikeThresholdPercent: 2.0,
			correlationThreshold: 0.9,
		}),

	/**
	 * Standard detection for general use
	 */
	standard: () => new AnomalyDetector(),

	/**
	 * Relaxed detection for volatile markets
	 */
	relaxed: () =>
		new AnomalyDetector({
			maxVarianceMultiplier: 4.0,
			maxGapSeconds: 600,
			spikeThresholdPercent: 10.0,
			correlationThreshold: 0.6,
		}),

	/**
	 * Real-time monitoring preset
	 */
	realtime: () =>
		new AnomalyDetector({
			rollingWindowSize: 50,
			updateIntervalMs: 100,
			minDataPoints: 10,
		}),

	/**
	 * Market manipulation detection preset
	 */
	manipulation: () =>
		new AnomalyDetector({
			maxVarianceMultiplier: 2.5,
			spikeThresholdPercent: 3.0,
			patternWindowSize: 30,
			correlationThreshold: 0.85,
		}),
};

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultDetector: AnomalyDetector | null = null;

export function getAnomalyDetector(config?: Partial<AnomalyConfig>): AnomalyDetector {
	if (!defaultDetector) {
		defaultDetector = new AnomalyDetector(config);
	}
	return defaultDetector;
}
