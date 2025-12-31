/**
 * Class 3.41: Metrics Collector
 * TAC Pattern: Comprehensive metrics and telemetry for agent operations
 *
 * Features:
 * - Counters (monotonically increasing values)
 * - Gauges (point-in-time values)
 * - Histograms (value distributions)
 * - Timing metrics (duration tracking)
 * - Labels/tags support for dimensional metrics
 * - Aggregation (sum, avg, min, max, percentiles)
 * - Export to Prometheus, JSON, StatsD formats
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export type MetricType = "counter" | "gauge" | "histogram" | "timing";
export type AggregationType = "sum" | "avg" | "min" | "max" | "count" | "p50" | "p90" | "p95" | "p99";
export type ExportFormat = "prometheus" | "json" | "statsd" | "influxdb";

export interface MetricLabels {
	[key: string]: string;
}

export interface MetricDefinition {
	name: string;
	type: MetricType;
	description: string;
	unit?: string;
	labels?: string[]; // Allowed label keys
	buckets?: number[]; // For histograms
}

export interface CounterValue {
	type: "counter";
	value: number;
	labels: MetricLabels;
	createdAt: Date;
	lastUpdated: Date;
}

export interface GaugeValue {
	type: "gauge";
	value: number;
	labels: MetricLabels;
	createdAt: Date;
	lastUpdated: Date;
}

export interface HistogramValue {
	type: "histogram";
	count: number;
	sum: number;
	buckets: Map<number, number>; // bucket upper bound -> count
	values: number[]; // For percentile calculation (limited buffer)
	labels: MetricLabels;
	createdAt: Date;
	lastUpdated: Date;
}

export interface TimingValue {
	type: "timing";
	count: number;
	totalMs: number;
	minMs: number;
	maxMs: number;
	values: number[]; // For percentile calculation (limited buffer)
	labels: MetricLabels;
	createdAt: Date;
	lastUpdated: Date;
}

export type MetricValue = CounterValue | GaugeValue | HistogramValue | TimingValue;

export interface MetricSnapshot {
	name: string;
	type: MetricType;
	description: string;
	unit?: string;
	values: {
		labels: MetricLabels;
		value: number;
		aggregations?: Record<AggregationType, number>;
		buckets?: Record<number, number>;
	}[];
	timestamp: Date;
}

export interface AggregatedMetric {
	name: string;
	type: MetricType;
	labels: MetricLabels;
	aggregations: Record<AggregationType, number>;
	period: {
		start: Date;
		end: Date;
	};
}

export interface MetricQuery {
	name?: string;
	namePattern?: RegExp;
	type?: MetricType;
	labels?: Partial<MetricLabels>;
	startTime?: Date;
	endTime?: Date;
}

export interface TimerHandle {
	stop: () => number;
	cancel: () => void;
}

export interface MetricExportOptions {
	format: ExportFormat;
	prefix?: string;
	includeTimestamp?: boolean;
	includeHelp?: boolean;
	includeType?: boolean;
	globalLabels?: MetricLabels;
}

export interface MetricStats {
	totalMetrics: number;
	totalSeries: number;
	byType: Record<MetricType, number>;
	oldestMetric: Date | null;
	newestMetric: Date | null;
	memoryUsageBytes: number;
}

export interface MetricsCollectorConfig {
	maxValuesPerHistogram: number; // Max values to keep for percentile calc
	maxValuesPerTiming: number;
	defaultBuckets: number[];
	flushIntervalMs: number;
	retentionMs: number;
	enableAutoCleanup: boolean;
	globalLabels?: MetricLabels;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MetricsCollectorConfig = {
	maxValuesPerHistogram: 1000,
	maxValuesPerTiming: 1000,
	defaultBuckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
	flushIntervalMs: 60000, // 1 minute
	retentionMs: 24 * 60 * 60 * 1000, // 24 hours
	enableAutoCleanup: true,
};

// ============================================================================
// Metrics Collector
// ============================================================================

export class MetricsCollector extends EventEmitter {
	private config: MetricsCollectorConfig;
	private definitions: Map<string, MetricDefinition> = new Map();
	private metrics: Map<string, Map<string, MetricValue>> = new Map(); // name -> labelKey -> value
	private cleanupInterval: NodeJS.Timeout | null = null;
	private flushInterval: NodeJS.Timeout | null = null;

	constructor(config: Partial<MetricsCollectorConfig> = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };

		if (this.config.enableAutoCleanup) {
			this.startCleanupScheduler();
		}
		this.startFlushScheduler();
	}

	private startCleanupScheduler(): void {
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, this.config.retentionMs / 4); // Clean up 4x per retention period
	}

	private startFlushScheduler(): void {
		this.flushInterval = setInterval(() => {
			this.emit("flush", this.getAllSnapshots());
		}, this.config.flushIntervalMs);
	}

	private cleanup(): void {
		const cutoff = new Date(Date.now() - this.config.retentionMs);
		let cleaned = 0;

		for (const [name, labelMap] of this.metrics) {
			for (const [labelKey, value] of labelMap) {
				if (value.lastUpdated < cutoff) {
					labelMap.delete(labelKey);
					cleaned++;
				}
			}
			if (labelMap.size === 0) {
				this.metrics.delete(name);
			}
		}

		if (cleaned > 0) {
			this.emit("cleanup", { cleaned });
		}
	}

	// ============================================================================
	// Metric Definition
	// ============================================================================

	define(definition: MetricDefinition): void {
		if (this.definitions.has(definition.name)) {
			throw new Error(`Metric ${definition.name} is already defined`);
		}
		this.definitions.set(definition.name, definition);
		this.metrics.set(definition.name, new Map());
		this.emit("metric:defined", definition);
	}

	getDefinition(name: string): MetricDefinition | null {
		return this.definitions.get(name) ?? null;
	}

	getAllDefinitions(): MetricDefinition[] {
		return Array.from(this.definitions.values());
	}

	// ============================================================================
	// Label Key Generation
	// ============================================================================

	private buildLabelKey(labels: MetricLabels): string {
		const sortedKeys = Object.keys(labels).sort();
		if (sortedKeys.length === 0) return "";
		return sortedKeys.map((k) => `${k}="${labels[k]}"`).join(",");
	}

	private mergeLabels(labels: MetricLabels): MetricLabels {
		return { ...this.config.globalLabels, ...labels };
	}

	// ============================================================================
	// Counter Operations
	// ============================================================================

	counter(
		name: string,
		labels: MetricLabels = {},
	): {
		inc: (value?: number) => void;
		get: () => number;
	} {
		const mergedLabels = this.mergeLabels(labels);

		return {
			inc: (value: number = 1) => this.incrementCounter(name, mergedLabels, value),
			get: () => this.getCounterValue(name, mergedLabels),
		};
	}

	incrementCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
		if (value < 0) {
			throw new Error("Counter values can only be incremented");
		}

		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const now = new Date();

		let metricMap = this.metrics.get(name);
		if (!metricMap) {
			metricMap = new Map();
			this.metrics.set(name, metricMap);
		}

		let counter = metricMap.get(labelKey) as CounterValue | undefined;
		if (!counter) {
			counter = {
				type: "counter",
				value: 0,
				labels: mergedLabels,
				createdAt: now,
				lastUpdated: now,
			};
			metricMap.set(labelKey, counter);
		}

		counter.value += value;
		counter.lastUpdated = now;

		this.emit("counter:incremented", { name, labels: mergedLabels, value: counter.value, increment: value });
	}

	getCounterValue(name: string, labels: MetricLabels = {}): number {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const metricMap = this.metrics.get(name);

		if (!metricMap) return 0;

		const counter = metricMap.get(labelKey) as CounterValue | undefined;
		return counter?.value ?? 0;
	}

	// ============================================================================
	// Gauge Operations
	// ============================================================================

	gauge(
		name: string,
		labels: MetricLabels = {},
	): {
		set: (value: number) => void;
		inc: (value?: number) => void;
		dec: (value?: number) => void;
		get: () => number;
	} {
		const mergedLabels = this.mergeLabels(labels);

		return {
			set: (value: number) => this.setGauge(name, mergedLabels, value),
			inc: (value: number = 1) => this.incGauge(name, mergedLabels, value),
			dec: (value: number = 1) => this.decGauge(name, mergedLabels, value),
			get: () => this.getGaugeValue(name, mergedLabels),
		};
	}

	setGauge(name: string, labels: MetricLabels = {}, value: number): void {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const now = new Date();

		let metricMap = this.metrics.get(name);
		if (!metricMap) {
			metricMap = new Map();
			this.metrics.set(name, metricMap);
		}

		let gauge = metricMap.get(labelKey) as GaugeValue | undefined;
		if (!gauge) {
			gauge = {
				type: "gauge",
				value: 0,
				labels: mergedLabels,
				createdAt: now,
				lastUpdated: now,
			};
			metricMap.set(labelKey, gauge);
		}

		gauge.value = value;
		gauge.lastUpdated = now;

		this.emit("gauge:set", { name, labels: mergedLabels, value });
	}

	incGauge(name: string, labels: MetricLabels = {}, value: number = 1): void {
		const current = this.getGaugeValue(name, labels);
		this.setGauge(name, labels, current + value);
	}

	decGauge(name: string, labels: MetricLabels = {}, value: number = 1): void {
		const current = this.getGaugeValue(name, labels);
		this.setGauge(name, labels, current - value);
	}

	getGaugeValue(name: string, labels: MetricLabels = {}): number {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const metricMap = this.metrics.get(name);

		if (!metricMap) return 0;

		const gauge = metricMap.get(labelKey) as GaugeValue | undefined;
		return gauge?.value ?? 0;
	}

	// ============================================================================
	// Histogram Operations
	// ============================================================================

	histogram(
		name: string,
		labels: MetricLabels = {},
	): {
		observe: (value: number) => void;
		get: () => { count: number; sum: number; buckets: Record<number, number> };
	} {
		const mergedLabels = this.mergeLabels(labels);

		return {
			observe: (value: number) => this.observeHistogram(name, mergedLabels, value),
			get: () => this.getHistogramValue(name, mergedLabels),
		};
	}

	observeHistogram(name: string, labels: MetricLabels = {}, value: number): void {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const now = new Date();

		let metricMap = this.metrics.get(name);
		if (!metricMap) {
			metricMap = new Map();
			this.metrics.set(name, metricMap);
		}

		let histogram = metricMap.get(labelKey) as HistogramValue | undefined;
		if (!histogram) {
			const definition = this.definitions.get(name);
			const buckets = definition?.buckets ?? this.config.defaultBuckets;

			histogram = {
				type: "histogram",
				count: 0,
				sum: 0,
				buckets: new Map(buckets.map((b) => [b, 0])),
				values: [],
				labels: mergedLabels,
				createdAt: now,
				lastUpdated: now,
			};
			metricMap.set(labelKey, histogram);
		}

		histogram.count++;
		histogram.sum += value;

		// Update bucket counts
		for (const [bound, count] of histogram.buckets) {
			if (value <= bound) {
				histogram.buckets.set(bound, count + 1);
			}
		}

		// Store value for percentile calculation (with limit)
		if (histogram.values.length < this.config.maxValuesPerHistogram) {
			histogram.values.push(value);
		} else {
			// Reservoir sampling for large datasets
			const idx = Math.floor(Math.random() * (histogram.count + 1));
			if (idx < this.config.maxValuesPerHistogram) {
				histogram.values[idx] = value;
			}
		}

		histogram.lastUpdated = now;

		this.emit("histogram:observed", { name, labels: mergedLabels, value });
	}

	getHistogramValue(
		name: string,
		labels: MetricLabels = {},
	): {
		count: number;
		sum: number;
		buckets: Record<number, number>;
	} {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const metricMap = this.metrics.get(name);

		if (!metricMap) {
			return { count: 0, sum: 0, buckets: {} };
		}

		const histogram = metricMap.get(labelKey) as HistogramValue | undefined;
		if (!histogram) {
			return { count: 0, sum: 0, buckets: {} };
		}

		const buckets: Record<number, number> = {};
		for (const [bound, count] of histogram.buckets) {
			buckets[bound] = count;
		}

		return {
			count: histogram.count,
			sum: histogram.sum,
			buckets,
		};
	}

	// ============================================================================
	// Timing Operations
	// ============================================================================

	timing(
		name: string,
		labels: MetricLabels = {},
	): {
		record: (durationMs: number) => void;
		start: () => TimerHandle;
		get: () => { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number };
	} {
		const mergedLabels = this.mergeLabels(labels);

		return {
			record: (durationMs: number) => this.recordTiming(name, mergedLabels, durationMs),
			start: () => this.startTimer(name, mergedLabels),
			get: () => this.getTimingValue(name, mergedLabels),
		};
	}

	recordTiming(name: string, labels: MetricLabels = {}, durationMs: number): void {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const now = new Date();

		let metricMap = this.metrics.get(name);
		if (!metricMap) {
			metricMap = new Map();
			this.metrics.set(name, metricMap);
		}

		let timing = metricMap.get(labelKey) as TimingValue | undefined;
		if (!timing) {
			timing = {
				type: "timing",
				count: 0,
				totalMs: 0,
				minMs: Infinity,
				maxMs: -Infinity,
				values: [],
				labels: mergedLabels,
				createdAt: now,
				lastUpdated: now,
			};
			metricMap.set(labelKey, timing);
		}

		timing.count++;
		timing.totalMs += durationMs;
		timing.minMs = Math.min(timing.minMs, durationMs);
		timing.maxMs = Math.max(timing.maxMs, durationMs);

		// Store value for percentile calculation (with limit)
		if (timing.values.length < this.config.maxValuesPerTiming) {
			timing.values.push(durationMs);
		} else {
			// Reservoir sampling
			const idx = Math.floor(Math.random() * (timing.count + 1));
			if (idx < this.config.maxValuesPerTiming) {
				timing.values[idx] = durationMs;
			}
		}

		timing.lastUpdated = now;

		this.emit("timing:recorded", { name, labels: mergedLabels, durationMs });
	}

	startTimer(name: string, labels: MetricLabels = {}): TimerHandle {
		const start = process.hrtime.bigint();
		let stopped = false;

		return {
			stop: () => {
				if (stopped) return 0;
				stopped = true;
				const end = process.hrtime.bigint();
				const durationMs = Number(end - start) / 1_000_000;
				this.recordTiming(name, labels, durationMs);
				return durationMs;
			},
			cancel: () => {
				stopped = true;
			},
		};
	}

	getTimingValue(
		name: string,
		labels: MetricLabels = {},
	): {
		count: number;
		totalMs: number;
		avgMs: number;
		minMs: number;
		maxMs: number;
	} {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const metricMap = this.metrics.get(name);

		if (!metricMap) {
			return { count: 0, totalMs: 0, avgMs: 0, minMs: 0, maxMs: 0 };
		}

		const timing = metricMap.get(labelKey) as TimingValue | undefined;
		if (!timing) {
			return { count: 0, totalMs: 0, avgMs: 0, minMs: 0, maxMs: 0 };
		}

		return {
			count: timing.count,
			totalMs: timing.totalMs,
			avgMs: timing.count > 0 ? timing.totalMs / timing.count : 0,
			minMs: timing.count > 0 ? timing.minMs : 0,
			maxMs: timing.count > 0 ? timing.maxMs : 0,
		};
	}

	// ============================================================================
	// Aggregation
	// ============================================================================

	aggregate(name: string, labels: MetricLabels = {}): Record<AggregationType, number> {
		const mergedLabels = this.mergeLabels(labels);
		const labelKey = this.buildLabelKey(mergedLabels);
		const metricMap = this.metrics.get(name);

		if (!metricMap) {
			return this.emptyAggregation();
		}

		const metric = metricMap.get(labelKey);
		if (!metric) {
			return this.emptyAggregation();
		}

		return this.calculateAggregations(metric);
	}

	private emptyAggregation(): Record<AggregationType, number> {
		return { sum: 0, avg: 0, min: 0, max: 0, count: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
	}

	private calculateAggregations(metric: MetricValue): Record<AggregationType, number> {
		switch (metric.type) {
			case "counter":
				return {
					sum: metric.value,
					avg: metric.value,
					min: metric.value,
					max: metric.value,
					count: 1,
					p50: metric.value,
					p90: metric.value,
					p95: metric.value,
					p99: metric.value,
				};

			case "gauge":
				return {
					sum: metric.value,
					avg: metric.value,
					min: metric.value,
					max: metric.value,
					count: 1,
					p50: metric.value,
					p90: metric.value,
					p95: metric.value,
					p99: metric.value,
				};

			case "histogram": {
				const hValues = [...metric.values].sort((a, b) => a - b);
				return {
					sum: metric.sum,
					avg: metric.count > 0 ? metric.sum / metric.count : 0,
					min: hValues.length > 0 ? hValues[0] : 0,
					max: hValues.length > 0 ? hValues[hValues.length - 1] : 0,
					count: metric.count,
					p50: this.percentile(hValues, 50),
					p90: this.percentile(hValues, 90),
					p95: this.percentile(hValues, 95),
					p99: this.percentile(hValues, 99),
				};
			}

			case "timing": {
				const tValues = [...metric.values].sort((a, b) => a - b);
				return {
					sum: metric.totalMs,
					avg: metric.count > 0 ? metric.totalMs / metric.count : 0,
					min: metric.count > 0 ? metric.minMs : 0,
					max: metric.count > 0 ? metric.maxMs : 0,
					count: metric.count,
					p50: this.percentile(tValues, 50),
					p90: this.percentile(tValues, 90),
					p95: this.percentile(tValues, 95),
					p99: this.percentile(tValues, 99),
				};
			}
		}
	}

	private percentile(sortedValues: number[], p: number): number {
		if (sortedValues.length === 0) return 0;
		const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
		return sortedValues[Math.max(0, Math.min(idx, sortedValues.length - 1))];
	}

	// ============================================================================
	// Snapshots and Queries
	// ============================================================================

	getSnapshot(name: string): MetricSnapshot | null {
		const definition = this.definitions.get(name);
		const metricMap = this.metrics.get(name);

		if (!metricMap || metricMap.size === 0) return null;

		const values: MetricSnapshot["values"] = [];

		for (const [, metric] of metricMap) {
			const aggregations = this.calculateAggregations(metric);

			let value: number;
			let buckets: Record<number, number> | undefined;

			switch (metric.type) {
				case "counter":
					value = metric.value;
					break;
				case "gauge":
					value = metric.value;
					break;
				case "histogram":
					value = metric.sum;
					buckets = {};
					for (const [bound, count] of metric.buckets) {
						buckets[bound] = count;
					}
					break;
				case "timing":
					value = metric.count > 0 ? metric.totalMs / metric.count : 0;
					break;
			}

			values.push({
				labels: metric.labels,
				value,
				aggregations,
				buckets,
			});
		}

		return {
			name,
			type: definition?.type ?? "gauge",
			description: definition?.description ?? "",
			unit: definition?.unit,
			values,
			timestamp: new Date(),
		};
	}

	getAllSnapshots(): MetricSnapshot[] {
		const snapshots: MetricSnapshot[] = [];

		for (const name of this.metrics.keys()) {
			const snapshot = this.getSnapshot(name);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}

		return snapshots;
	}

	query(params: MetricQuery): MetricSnapshot[] {
		const snapshots: MetricSnapshot[] = [];

		for (const name of this.metrics.keys()) {
			// Filter by name
			if (params.name && name !== params.name) continue;
			if (params.namePattern && !params.namePattern.test(name)) continue;

			// Filter by type
			const definition = this.definitions.get(name);
			if (params.type && definition?.type !== params.type) continue;

			const snapshot = this.getSnapshot(name);
			if (!snapshot) continue;

			// Filter by labels
			if (params.labels) {
				snapshot.values = snapshot.values.filter((v) => {
					for (const [key, val] of Object.entries(params.labels!)) {
						if (v.labels[key] !== val) return false;
					}
					return true;
				});
				if (snapshot.values.length === 0) continue;
			}

			snapshots.push(snapshot);
		}

		return snapshots;
	}

	// ============================================================================
	// Export Formats
	// ============================================================================

	export(options: MetricExportOptions): string {
		switch (options.format) {
			case "prometheus":
				return this.exportPrometheus(options);
			case "json":
				return this.exportJson(options);
			case "statsd":
				return this.exportStatsd(options);
			case "influxdb":
				return this.exportInfluxdb(options);
			default:
				throw new Error(`Unknown export format: ${options.format}`);
		}
	}

	private exportPrometheus(options: MetricExportOptions): string {
		const lines: string[] = [];
		const prefix = options.prefix ? `${options.prefix}_` : "";
		const globalLabels = options.globalLabels ?? {};

		for (const snapshot of this.getAllSnapshots()) {
			const metricName = this.sanitizePrometheusName(`${prefix}${snapshot.name}`);

			// Add help and type
			if (options.includeHelp !== false) {
				lines.push(`# HELP ${metricName} ${snapshot.description}`);
			}
			if (options.includeType !== false) {
				const promType = snapshot.type === "timing" ? "histogram" : snapshot.type;
				lines.push(`# TYPE ${metricName} ${promType}`);
			}

			for (const value of snapshot.values) {
				const allLabels = { ...globalLabels, ...value.labels };
				const labelStr = this.formatPrometheusLabels(allLabels);

				switch (snapshot.type) {
					case "counter":
					case "gauge":
						lines.push(`${metricName}${labelStr} ${value.value}`);
						break;

					case "histogram":
						if (value.buckets) {
							for (const [bound, count] of Object.entries(value.buckets)) {
								const bucketLabels = { ...allLabels, le: bound };
								lines.push(`${metricName}_bucket${this.formatPrometheusLabels(bucketLabels)} ${count}`);
							}
							// Add +Inf bucket
							const infLabels = { ...allLabels, le: "+Inf" };
							lines.push(
								`${metricName}_bucket${this.formatPrometheusLabels(infLabels)} ${value.aggregations?.count ?? 0}`,
							);
						}
						lines.push(`${metricName}_sum${labelStr} ${value.aggregations?.sum ?? 0}`);
						lines.push(`${metricName}_count${labelStr} ${value.aggregations?.count ?? 0}`);
						break;

					case "timing": {
						// Export timing as histogram with seconds
						const sumSec = (value.aggregations?.sum ?? 0) / 1000;
						lines.push(`${metricName}_seconds_sum${labelStr} ${sumSec}`);
						lines.push(`${metricName}_seconds_count${labelStr} ${value.aggregations?.count ?? 0}`);
						break;
					}
				}
			}

			lines.push("");
		}

		return lines.join("\n");
	}

	private sanitizePrometheusName(name: string): string {
		return name.replace(/[^a-zA-Z0-9_:]/g, "_");
	}

	private formatPrometheusLabels(labels: MetricLabels): string {
		const entries = Object.entries(labels);
		if (entries.length === 0) return "";

		const labelParts = entries.map(([k, v]) => {
			const sanitizedKey = k.replace(/[^a-zA-Z0-9_]/g, "_");
			const escapedValue = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
			return `${sanitizedKey}="${escapedValue}"`;
		});

		return `{${labelParts.join(",")}}`;
	}

	private exportJson(options: MetricExportOptions): string {
		const snapshots = this.getAllSnapshots();
		const prefix = options.prefix ?? "";
		const globalLabels = options.globalLabels ?? {};

		const output = snapshots.map((snapshot) => ({
			name: `${prefix}${snapshot.name}`,
			type: snapshot.type,
			description: snapshot.description,
			unit: snapshot.unit,
			timestamp: options.includeTimestamp !== false ? snapshot.timestamp.toISOString() : undefined,
			values: snapshot.values.map((v) => ({
				labels: { ...globalLabels, ...v.labels },
				value: v.value,
				aggregations: v.aggregations,
				buckets: v.buckets,
			})),
		}));

		return JSON.stringify(output, null, 2);
	}

	private exportStatsd(options: MetricExportOptions): string {
		const lines: string[] = [];
		const prefix = options.prefix ? `${options.prefix}.` : "";

		for (const snapshot of this.getAllSnapshots()) {
			for (const value of snapshot.values) {
				const labelTags = Object.entries(value.labels)
					.map(([k, v]) => `${k}:${v}`)
					.join(",");
				const tags = labelTags ? `|#${labelTags}` : "";
				const metricName = `${prefix}${snapshot.name}`.replace(/[^a-zA-Z0-9_.]/g, "_");

				switch (snapshot.type) {
					case "counter":
						lines.push(`${metricName}:${value.value}|c${tags}`);
						break;
					case "gauge":
						lines.push(`${metricName}:${value.value}|g${tags}`);
						break;
					case "histogram":
						lines.push(`${metricName}:${value.value}|h${tags}`);
						break;
					case "timing":
						lines.push(`${metricName}:${value.value}|ms${tags}`);
						break;
				}
			}
		}

		return lines.join("\n");
	}

	private exportInfluxdb(options: MetricExportOptions): string {
		const lines: string[] = [];
		const prefix = options.prefix ?? "";
		const globalLabels = options.globalLabels ?? {};
		const timestamp = Date.now() * 1000000; // Nanoseconds

		for (const snapshot of this.getAllSnapshots()) {
			for (const value of snapshot.values) {
				const allLabels = { ...globalLabels, ...value.labels };
				const tagSet = Object.entries(allLabels)
					.filter(([, v]) => v !== "")
					.map(([k, v]) => `${this.escapeInfluxTag(k)}=${this.escapeInfluxTag(v)}`)
					.join(",");

				const measurement = `${prefix}${snapshot.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
				const tags = tagSet ? `,${tagSet}` : "";

				let fieldSet: string;
				switch (snapshot.type) {
					case "counter":
					case "gauge":
						fieldSet = `value=${value.value}`;
						break;
					case "histogram":
					case "timing": {
						const agg: Partial<Record<AggregationType, number>> = value.aggregations ?? {};
						fieldSet = [
							`sum=${agg.sum ?? 0}`,
							`count=${agg.count ?? 0}i`,
							`avg=${agg.avg ?? 0}`,
							`min=${agg.min ?? 0}`,
							`max=${agg.max ?? 0}`,
							`p50=${agg.p50 ?? 0}`,
							`p90=${agg.p90 ?? 0}`,
							`p95=${agg.p95 ?? 0}`,
							`p99=${agg.p99 ?? 0}`,
						].join(",");
						break;
					}
					default:
						fieldSet = `value=${value.value}`;
				}

				lines.push(`${measurement}${tags} ${fieldSet} ${timestamp}`);
			}
		}

		return lines.join("\n");
	}

	private escapeInfluxTag(value: string): string {
		return value.replace(/[,= ]/g, "\\$&");
	}

	// ============================================================================
	// Utility Methods
	// ============================================================================

	reset(name?: string): void {
		if (name) {
			this.metrics.delete(name);
			this.emit("metric:reset", { name });
		} else {
			this.metrics.clear();
			this.emit("metrics:reset");
		}
	}

	getStats(): MetricStats {
		let totalSeries = 0;
		let oldestMetric: Date | null = null;
		let newestMetric: Date | null = null;
		const byType: Record<MetricType, number> = { counter: 0, gauge: 0, histogram: 0, timing: 0 };

		for (const [name, labelMap] of this.metrics) {
			const definition = this.definitions.get(name);
			const type = definition?.type ?? "gauge";
			byType[type] += labelMap.size;
			totalSeries += labelMap.size;

			for (const [, metric] of labelMap) {
				if (!oldestMetric || metric.createdAt < oldestMetric) {
					oldestMetric = metric.createdAt;
				}
				if (!newestMetric || metric.lastUpdated > newestMetric) {
					newestMetric = metric.lastUpdated;
				}
			}
		}

		// Rough memory estimation
		let memoryUsageBytes = 0;
		for (const [, labelMap] of this.metrics) {
			for (const [, metric] of labelMap) {
				memoryUsageBytes += 200; // Base object overhead
				if (metric.type === "histogram" || metric.type === "timing") {
					memoryUsageBytes += (metric as HistogramValue | TimingValue).values.length * 8;
				}
			}
		}

		return {
			totalMetrics: this.definitions.size,
			totalSeries,
			byType,
			oldestMetric,
			newestMetric,
			memoryUsageBytes,
		};
	}

	// ============================================================================
	// Pre-defined Metric Helpers
	// ============================================================================

	/**
	 * Track HTTP request metrics
	 */
	httpRequest(method: string, path: string, statusCode: number, durationMs: number): void {
		const labels = { method, path, status: String(statusCode) };

		this.incrementCounter("http_requests_total", labels);
		this.recordTiming("http_request_duration_ms", labels, durationMs);
	}

	/**
	 * Track agent operation metrics
	 */
	agentOperation(agentId: string, operation: string, success: boolean, durationMs: number): void {
		const labels = { agent_id: agentId, operation, success: String(success) };

		this.incrementCounter("agent_operations_total", labels);
		this.recordTiming("agent_operation_duration_ms", labels, durationMs);
	}

	/**
	 * Track message processing metrics
	 */
	messageProcessed(channelId: string, userId: string, type: string, durationMs: number): void {
		const labels = { channel_id: channelId, user_id: userId, type };

		this.incrementCounter("messages_processed_total", labels);
		this.recordTiming("message_processing_duration_ms", labels, durationMs);
	}

	/**
	 * Track API call metrics
	 */
	apiCall(provider: string, model: string, success: boolean, tokens: number, durationMs: number): void {
		const labels = { provider, model, success: String(success) };

		this.incrementCounter("api_calls_total", labels);
		this.incrementCounter("api_tokens_total", labels, tokens);
		this.recordTiming("api_call_duration_ms", labels, durationMs);
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	shutdown(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		if (this.flushInterval) {
			clearInterval(this.flushInterval);
			this.flushInterval = null;
		}
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let metricsCollectorInstance: MetricsCollector | null = null;

export function getMetricsCollector(config?: Partial<MetricsCollectorConfig>): MetricsCollector {
	if (!metricsCollectorInstance) {
		metricsCollectorInstance = new MetricsCollector(config);
	}
	return metricsCollectorInstance;
}

export function resetMetricsCollector(): void {
	if (metricsCollectorInstance) {
		metricsCollectorInstance.shutdown();
		metricsCollectorInstance = null;
	}
}
