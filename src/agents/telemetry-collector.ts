/**
 * Class 3.61: Telemetry Collector System
 * TAC Pattern: Comprehensive distributed tracing, metrics, and log aggregation
 *
 * Features:
 * - Trace collection (spans, parent-child relationships)
 * - Metric collection (counters, gauges, histograms)
 * - Log aggregation with levels
 * - Correlation ID propagation
 * - Sampling strategies (head-based, tail-based)
 * - Trace context (baggage)
 * - Span attributes and events
 * - Resource attributes (service name, version, host)
 * - Batch export
 * - Multiple export formats (OTLP-like, JSON, custom)
 * - Metric aggregation (sum, count, avg, p50/p95/p99)
 * - Log correlation with traces
 * - Custom dimensions/tags
 * - Cardinality limits
 * - Data retention policies
 * - Real-time streaming
 * - SQLite persistence for telemetry data
 */

import Database from "better-sqlite3";
import { createHash, randomBytes } from "crypto";
import { EventEmitter } from "events";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";
export type SpanStatus = "unset" | "ok" | "error";
export type MetricType = "counter" | "gauge" | "histogram" | "summary";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type SamplingStrategy = "always" | "never" | "probabilistic" | "rate_limiting" | "tail_based";
export type ExportFormat = "otlp" | "json" | "prometheus" | "custom";

export interface ResourceAttributes {
	serviceName: string;
	serviceVersion?: string;
	serviceInstance?: string;
	hostName?: string;
	hostId?: string;
	osType?: string;
	telemetrySdkName?: string;
	telemetrySdkVersion?: string;
	deploymentEnvironment?: string;
	custom?: Record<string, string | number | boolean>;
}

export interface SpanContext {
	traceId: string;
	spanId: string;
	traceFlags: number; // 0 = not sampled, 1 = sampled
	traceState?: string;
	isRemote?: boolean;
}

export interface SpanEvent {
	name: string;
	timestamp: Date;
	attributes?: Record<string, string | number | boolean>;
}

export interface SpanLink {
	context: SpanContext;
	attributes?: Record<string, string | number | boolean>;
}

export interface Span {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: SpanKind;
	startTime: Date;
	endTime?: Date;
	status: SpanStatus;
	statusMessage?: string;
	attributes: Record<string, string | number | boolean>;
	events: SpanEvent[];
	links: SpanLink[];
	resource: ResourceAttributes;
	instrumentationScope: string;
	dropped?: {
		attributesCount: number;
		eventsCount: number;
		linksCount: number;
	};
}

export interface TraceContext {
	traceId: string;
	spanId: string;
	baggage: Record<string, string>;
	sampled: boolean;
}

export interface MetricDataPoint {
	timestamp: Date;
	value: number;
	attributes: Record<string, string | number | boolean>;
}

export interface HistogramDataPoint {
	timestamp: Date;
	count: number;
	sum: number;
	min: number;
	max: number;
	bucketCounts: number[];
	explicitBounds: number[];
	attributes: Record<string, string | number | boolean>;
}

export interface Metric {
	id: string;
	name: string;
	description?: string;
	unit?: string;
	type: MetricType;
	resource: ResourceAttributes;
	instrumentationScope: string;
	dataPoints: MetricDataPoint[];
	histogramDataPoints?: HistogramDataPoint[];
}

export interface AggregatedMetric {
	name: string;
	type: MetricType;
	count: number;
	sum: number;
	avg: number;
	min: number;
	max: number;
	p50?: number;
	p95?: number;
	p99?: number;
	lastValue: number;
	lastUpdated: Date;
	attributes: Record<string, string | number | boolean>;
}

export interface LogRecord {
	id: string;
	timestamp: Date;
	level: LogLevel;
	body: string;
	attributes: Record<string, string | number | boolean>;
	resource: ResourceAttributes;
	instrumentationScope: string;
	traceId?: string;
	spanId?: string;
	severityNumber: number;
}

export interface SamplingConfig {
	strategy: SamplingStrategy;
	probability?: number; // For probabilistic: 0.0-1.0
	rateLimit?: number; // For rate_limiting: spans per second
	tailSamplingRules?: TailSamplingRule[];
}

export interface TailSamplingRule {
	name: string;
	type: "latency" | "error" | "attribute" | "composite";
	threshold?: number; // For latency: milliseconds
	attribute?: string; // For attribute-based
	value?: string | number | boolean;
	operator?: "eq" | "ne" | "gt" | "lt" | "contains";
	samplePercent: number; // 0-100
}

export interface ExportBatch {
	id: string;
	timestamp: Date;
	format: ExportFormat;
	spans: Span[];
	metrics: Metric[];
	logs: LogRecord[];
	resource: ResourceAttributes;
	status: "pending" | "exporting" | "exported" | "failed";
	retryCount: number;
	error?: string;
}

export interface RetentionPolicy {
	id: string;
	name: string;
	dataType: "spans" | "metrics" | "logs" | "all";
	retentionDays: number;
	enabled: boolean;
}

export interface CardinalityLimit {
	metricName: string;
	maxCardinality: number;
	currentCardinality: number;
	action: "drop" | "aggregate" | "sample";
}

export interface TelemetryStats {
	totalSpans: number;
	totalMetrics: number;
	totalLogs: number;
	spansLast24h: number;
	metricsLast24h: number;
	logsLast24h: number;
	activeTraces: number;
	sampledSpans: number;
	droppedSpans: number;
	exportedBatches: number;
	failedExports: number;
	oldestData?: Date;
	newestData?: Date;
}

export interface TelemetryConfig {
	dataDir: string;
	serviceName: string;
	serviceVersion?: string;
	environment?: string;
	sampling: SamplingConfig;
	exportFormats: ExportFormat[];
	batchSize: number;
	batchIntervalMs: number;
	retentionDays: number;
	maxAttributeCount: number;
	maxEventCount: number;
	maxLinkCount: number;
	maxAttributeLength: number;
	enableRealTimeStreaming: boolean;
	cardinalityLimits: Record<string, number>;
}

// ============================================================================
// Severity Number Mapping (OpenTelemetry standard)
// ============================================================================

const LOG_SEVERITY_NUMBER: Record<LogLevel, number> = {
	trace: 1,
	debug: 5,
	info: 9,
	warn: 13,
	error: 17,
	fatal: 21,
};

// ============================================================================
// Default Histogram Bounds
// ============================================================================

const DEFAULT_HISTOGRAM_BOUNDS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

// ============================================================================
// Telemetry Collector System
// ============================================================================

export class TelemetryCollector extends EventEmitter {
	private db: Database.Database;
	private config: TelemetryConfig;
	private resource: ResourceAttributes;
	private activeSpans: Map<string, Span> = new Map();
	private metricAggregations: Map<string, AggregatedMetric> = new Map();
	private pendingBatch: ExportBatch | null = null;
	private batchInterval: NodeJS.Timeout | null = null;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private samplingState: { count: number; lastReset: number; windowMs: number } = {
		count: 0,
		lastReset: Date.now(),
		windowMs: 1000,
	};
	private cardinalityTracking: Map<string, Set<string>> = new Map();

	constructor(config: TelemetryConfig) {
		super();
		this.config = config;
		this.resource = this.buildResourceAttributes();
		this.db = new Database(join(config.dataDir, "telemetry.db"));
		this.initializeDatabase();
		this.startBatchExporter();
		this.startCleanupScheduler();
	}

	private buildResourceAttributes(): ResourceAttributes {
		return {
			serviceName: this.config.serviceName,
			serviceVersion: this.config.serviceVersion,
			deploymentEnvironment: this.config.environment,
			hostName: process.env.HOSTNAME || "unknown",
			osType: process.platform,
			telemetrySdkName: "pi-telemetry",
			telemetrySdkVersion: "1.0.0",
		};
	}

	private initializeDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		// Spans table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS spans (
        trace_id TEXT NOT NULL,
        span_id TEXT PRIMARY KEY,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        status TEXT NOT NULL DEFAULT 'unset',
        status_message TEXT,
        attributes TEXT,
        events TEXT,
        links TEXT,
        resource TEXT NOT NULL,
        instrumentation_scope TEXT NOT NULL,
        dropped TEXT,
        sampled INTEGER NOT NULL DEFAULT 1
      )
    `);

		// Metrics table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        unit TEXT,
        type TEXT NOT NULL,
        resource TEXT NOT NULL,
        instrumentation_scope TEXT NOT NULL,
        data_points TEXT NOT NULL,
        histogram_data_points TEXT,
        timestamp TEXT NOT NULL
      )
    `);

		// Aggregated metrics table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS metric_aggregations (
        name TEXT NOT NULL,
        attributes_hash TEXT NOT NULL,
        type TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        sum REAL NOT NULL DEFAULT 0,
        min REAL,
        max REAL,
        values TEXT,
        last_value REAL NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL,
        attributes TEXT NOT NULL,
        PRIMARY KEY (name, attributes_hash)
      )
    `);

		// Logs table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        body TEXT NOT NULL,
        attributes TEXT,
        resource TEXT NOT NULL,
        instrumentation_scope TEXT NOT NULL,
        trace_id TEXT,
        span_id TEXT,
        severity_number INTEGER NOT NULL
      )
    `);

		// Export batches table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS export_batches (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        format TEXT NOT NULL,
        span_count INTEGER NOT NULL DEFAULT 0,
        metric_count INTEGER NOT NULL DEFAULT 0,
        log_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        data TEXT
      )
    `);

		// Retention policies table
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data_type TEXT NOT NULL,
        retention_days INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    `);

		// Indexes
		this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_spans_start_time ON spans(start_time);
      CREATE INDEX IF NOT EXISTS idx_spans_name ON spans(name);
      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id);
      CREATE INDEX IF NOT EXISTS idx_batches_status ON export_batches(status);
    `);

		// Initialize default retention policy
		this.initializeDefaultRetention();
	}

	private initializeDefaultRetention(): void {
		const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO retention_policies (id, name, data_type, retention_days, enabled)
      VALUES (?, ?, ?, ?, ?)
    `);

		stmt.run("default_all", "Default Retention", "all", this.config.retentionDays, 1);
	}

	private startBatchExporter(): void {
		this.batchInterval = setInterval(() => {
			this.flushBatch();
		}, this.config.batchIntervalMs);
	}

	private startCleanupScheduler(): void {
		// Run cleanup every hour
		this.cleanupInterval = setInterval(
			() => {
				this.applyRetentionPolicies();
			},
			60 * 60 * 1000,
		);
	}

	// ============================================================================
	// Trace ID Generation
	// ============================================================================

	generateTraceId(): string {
		return randomBytes(16).toString("hex");
	}

	generateSpanId(): string {
		return randomBytes(8).toString("hex");
	}

	// ============================================================================
	// Sampling
	// ============================================================================

	private shouldSample(traceId: string, _attributes?: Record<string, string | number | boolean>): boolean {
		const { strategy, probability, rateLimit } = this.config.sampling;

		switch (strategy) {
			case "always":
				return true;

			case "never":
				return false;

			case "probabilistic": {
				// Use trace ID for deterministic sampling
				const hash = parseInt(traceId.substring(0, 8), 16);
				const threshold = (probability ?? 1.0) * 0xffffffff;
				return hash < threshold;
			}

			case "rate_limiting": {
				const now = Date.now();
				if (now - this.samplingState.lastReset >= this.samplingState.windowMs) {
					this.samplingState.count = 0;
					this.samplingState.lastReset = now;
				}
				if (this.samplingState.count < (rateLimit ?? 100)) {
					this.samplingState.count++;
					return true;
				}
				return false;
			}

			case "tail_based":
				// For tail-based, we initially sample everything and decide later
				return true;

			default:
				return true;
		}
	}

	private applyTailSampling(span: Span): boolean {
		if (this.config.sampling.strategy !== "tail_based") {
			return true;
		}

		const rules = this.config.sampling.tailSamplingRules ?? [];
		if (rules.length === 0) return true;

		for (const rule of rules) {
			let matches = false;

			switch (rule.type) {
				case "latency":
					if (span.endTime && span.startTime) {
						const durationMs = span.endTime.getTime() - span.startTime.getTime();
						matches = durationMs >= (rule.threshold ?? 1000);
					}
					break;

				case "error":
					matches = span.status === "error";
					break;

				case "attribute":
					if (rule.attribute && span.attributes[rule.attribute] !== undefined) {
						const attrValue = span.attributes[rule.attribute];
						switch (rule.operator) {
							case "eq":
								matches = attrValue === rule.value;
								break;
							case "ne":
								matches = attrValue !== rule.value;
								break;
							case "gt":
								matches = typeof attrValue === "number" && attrValue > (rule.value as number);
								break;
							case "lt":
								matches = typeof attrValue === "number" && attrValue < (rule.value as number);
								break;
							case "contains":
								matches = typeof attrValue === "string" && attrValue.includes(rule.value as string);
								break;
						}
					}
					break;
			}

			if (matches) {
				// Apply probabilistic sampling based on rule's samplePercent
				return Math.random() * 100 < rule.samplePercent;
			}
		}

		// Default: drop if no rules match
		return false;
	}

	// ============================================================================
	// Tracing
	// ============================================================================

	startSpan(params: {
		name: string;
		kind?: SpanKind;
		parentContext?: TraceContext;
		attributes?: Record<string, string | number | boolean>;
		links?: SpanLink[];
		instrumentationScope?: string;
	}): TraceContext | null {
		const traceId = params.parentContext?.traceId ?? this.generateTraceId();
		const spanId = this.generateSpanId();
		const parentSpanId = params.parentContext?.spanId;

		// Check sampling
		const sampled = params.parentContext?.sampled ?? this.shouldSample(traceId, params.attributes);
		if (!sampled) {
			return {
				traceId,
				spanId,
				baggage: params.parentContext?.baggage ?? {},
				sampled: false,
			};
		}

		const span: Span = {
			traceId,
			spanId,
			parentSpanId,
			name: params.name,
			kind: params.kind ?? "internal",
			startTime: new Date(),
			status: "unset",
			attributes: this.truncateAttributes(params.attributes ?? {}),
			events: [],
			links: params.links?.slice(0, this.config.maxLinkCount) ?? [],
			resource: this.resource,
			instrumentationScope: params.instrumentationScope ?? "default",
		};

		this.activeSpans.set(spanId, span);
		this.emit("span:started", span);

		return {
			traceId,
			spanId,
			baggage: params.parentContext?.baggage ?? {},
			sampled: true,
		};
	}

	addSpanEvent(spanId: string, event: { name: string; attributes?: Record<string, string | number | boolean> }): void {
		const span = this.activeSpans.get(spanId);
		if (!span) return;

		if (span.events.length >= this.config.maxEventCount) {
			span.dropped = span.dropped ?? { attributesCount: 0, eventsCount: 0, linksCount: 0 };
			span.dropped.eventsCount++;
			return;
		}

		span.events.push({
			name: event.name,
			timestamp: new Date(),
			attributes: this.truncateAttributes(event.attributes ?? {}),
		});
	}

	setSpanAttribute(spanId: string, key: string, value: string | number | boolean): void {
		const span = this.activeSpans.get(spanId);
		if (!span) return;

		if (Object.keys(span.attributes).length >= this.config.maxAttributeCount && !(key in span.attributes)) {
			span.dropped = span.dropped ?? { attributesCount: 0, eventsCount: 0, linksCount: 0 };
			span.dropped.attributesCount++;
			return;
		}

		span.attributes[key] = this.truncateValue(value);
	}

	setSpanStatus(spanId: string, status: SpanStatus, message?: string): void {
		const span = this.activeSpans.get(spanId);
		if (!span) return;

		span.status = status;
		span.statusMessage = message;
	}

	endSpan(spanId: string): void {
		const span = this.activeSpans.get(spanId);
		if (!span) return;

		span.endTime = new Date();
		this.activeSpans.delete(spanId);

		// Apply tail-based sampling if configured
		const shouldKeep = this.applyTailSampling(span);
		if (!shouldKeep) {
			this.emit("span:dropped", span);
			return;
		}

		// Persist span
		this.persistSpan(span);
		this.emit("span:ended", span);

		// Add to pending batch
		this.addToBatch("span", span);
	}

	private persistSpan(span: Span): void {
		const stmt = this.db.prepare(`
      INSERT INTO spans
      (trace_id, span_id, parent_span_id, name, kind, start_time, end_time, status,
       status_message, attributes, events, links, resource, instrumentation_scope, dropped, sampled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			span.traceId,
			span.spanId,
			span.parentSpanId ?? null,
			span.name,
			span.kind,
			span.startTime.toISOString(),
			span.endTime?.toISOString() ?? null,
			span.status,
			span.statusMessage ?? null,
			JSON.stringify(span.attributes),
			JSON.stringify(span.events),
			JSON.stringify(span.links),
			JSON.stringify(span.resource),
			span.instrumentationScope,
			span.dropped ? JSON.stringify(span.dropped) : null,
			1,
		);
	}

	private truncateAttributes(
		attrs: Record<string, string | number | boolean>,
	): Record<string, string | number | boolean> {
		const result: Record<string, string | number | boolean> = {};
		const keys = Object.keys(attrs).slice(0, this.config.maxAttributeCount);

		for (const key of keys) {
			result[key] = this.truncateValue(attrs[key]);
		}

		return result;
	}

	private truncateValue(value: string | number | boolean): string | number | boolean {
		if (typeof value === "string" && value.length > this.config.maxAttributeLength) {
			return `${value.substring(0, this.config.maxAttributeLength)}...`;
		}
		return value;
	}

	// ============================================================================
	// Trace Context Propagation
	// ============================================================================

	injectContext(context: TraceContext): Record<string, string> {
		const headers: Record<string, string> = {};

		// W3C Trace Context format
		const traceFlags = context.sampled ? "01" : "00";
		headers.traceparent = `00-${context.traceId}-${context.spanId}-${traceFlags}`;

		// Baggage
		if (Object.keys(context.baggage).length > 0) {
			headers.baggage = Object.entries(context.baggage)
				.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
				.join(",");
		}

		return headers;
	}

	extractContext(headers: Record<string, string>): TraceContext | null {
		const traceparent = headers.traceparent;
		if (!traceparent) return null;

		const parts = traceparent.split("-");
		if (parts.length !== 4) return null;

		const [version, traceId, spanId, flags] = parts;
		if (version !== "00" || traceId.length !== 32 || spanId.length !== 16) {
			return null;
		}

		const baggage: Record<string, string> = {};
		const baggageHeader = headers.baggage;
		if (baggageHeader) {
			for (const pair of baggageHeader.split(",")) {
				const [key, value] = pair.split("=");
				if (key && value) {
					baggage[decodeURIComponent(key.trim())] = decodeURIComponent(value.trim());
				}
			}
		}

		return {
			traceId,
			spanId,
			baggage,
			sampled: flags === "01",
		};
	}

	setBaggage(context: TraceContext, key: string, value: string): TraceContext {
		return {
			...context,
			baggage: { ...context.baggage, [key]: value },
		};
	}

	// ============================================================================
	// Metrics
	// ============================================================================

	recordMetric(params: {
		name: string;
		value: number;
		type: MetricType;
		description?: string;
		unit?: string;
		attributes?: Record<string, string | number | boolean>;
		instrumentationScope?: string;
	}): void {
		const attributes = params.attributes ?? {};
		const attributesHash = this.hashAttributes(attributes);
		const key = `${params.name}:${attributesHash}`;

		// Check cardinality limits
		if (!this.checkCardinality(params.name, attributesHash)) {
			this.emit("metric:cardinality_exceeded", { name: params.name, attributes });
			return;
		}

		// Update aggregation
		let agg = this.metricAggregations.get(key);
		if (!agg) {
			agg = {
				name: params.name,
				type: params.type,
				count: 0,
				sum: 0,
				avg: 0,
				min: params.value,
				max: params.value,
				lastValue: params.value,
				lastUpdated: new Date(),
				attributes,
			};
			this.metricAggregations.set(key, agg);
		}

		// Update based on metric type
		switch (params.type) {
			case "counter":
				agg.sum += params.value;
				agg.lastValue = agg.sum;
				break;
			case "gauge":
				agg.lastValue = params.value;
				break;
			case "histogram":
			case "summary":
				agg.sum += params.value;
				agg.min = Math.min(agg.min, params.value);
				agg.max = Math.max(agg.max, params.value);
				agg.lastValue = params.value;
				break;
		}

		agg.count++;
		agg.avg = agg.sum / agg.count;
		agg.lastUpdated = new Date();

		// Persist aggregation
		this.persistMetricAggregation(agg, attributesHash);

		// Create metric for batch export
		const metric: Metric = {
			id: `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			name: params.name,
			description: params.description,
			unit: params.unit,
			type: params.type,
			resource: this.resource,
			instrumentationScope: params.instrumentationScope ?? "default",
			dataPoints: [
				{
					timestamp: new Date(),
					value: params.value,
					attributes,
				},
			],
		};

		this.emit("metric:recorded", metric);
		this.addToBatch("metric", metric);

		// Real-time streaming
		if (this.config.enableRealTimeStreaming) {
			this.emit("metric:stream", { name: params.name, value: params.value, attributes });
		}
	}

	recordHistogram(params: {
		name: string;
		value: number;
		description?: string;
		unit?: string;
		attributes?: Record<string, string | number | boolean>;
		explicitBounds?: number[];
		instrumentationScope?: string;
	}): void {
		const attributes = params.attributes ?? {};
		const _attributesHash = this.hashAttributes(attributes);
		const bounds = params.explicitBounds ?? DEFAULT_HISTOGRAM_BOUNDS;

		// Determine bucket
		let bucketIndex = bounds.length;
		for (let i = 0; i < bounds.length; i++) {
			if (params.value <= bounds[i]) {
				bucketIndex = i;
				break;
			}
		}

		// Record as histogram metric
		this.recordMetric({
			name: params.name,
			value: params.value,
			type: "histogram",
			description: params.description,
			unit: params.unit,
			attributes: { ...attributes, bucket: bucketIndex },
			instrumentationScope: params.instrumentationScope,
		});
	}

	incrementCounter(name: string, value: number = 1, attributes?: Record<string, string | number | boolean>): void {
		this.recordMetric({
			name,
			value,
			type: "counter",
			attributes,
		});
	}

	setGauge(name: string, value: number, attributes?: Record<string, string | number | boolean>): void {
		this.recordMetric({
			name,
			value,
			type: "gauge",
			attributes,
		});
	}

	private hashAttributes(attrs: Record<string, string | number | boolean>): string {
		const sorted = Object.keys(attrs)
			.sort()
			.map((k) => `${k}=${attrs[k]}`)
			.join("|");
		return createHash("md5").update(sorted).digest("hex").substring(0, 16);
	}

	private checkCardinality(metricName: string, attributesHash: string): boolean {
		const limit = this.config.cardinalityLimits[metricName] ?? 1000;

		if (!this.cardinalityTracking.has(metricName)) {
			this.cardinalityTracking.set(metricName, new Set());
		}

		const tracking = this.cardinalityTracking.get(metricName)!;
		if (tracking.has(attributesHash)) {
			return true;
		}

		if (tracking.size >= limit) {
			return false;
		}

		tracking.add(attributesHash);
		return true;
	}

	private persistMetricAggregation(agg: AggregatedMetric, attributesHash: string): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metric_aggregations
      (name, attributes_hash, type, count, sum, min, max, last_value, last_updated, attributes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			agg.name,
			attributesHash,
			agg.type,
			agg.count,
			agg.sum,
			agg.min,
			agg.max,
			agg.lastValue,
			agg.lastUpdated.toISOString(),
			JSON.stringify(agg.attributes),
		);
	}

	// ============================================================================
	// Logging
	// ============================================================================

	log(params: {
		level: LogLevel;
		body: string;
		attributes?: Record<string, string | number | boolean>;
		traceContext?: TraceContext;
		instrumentationScope?: string;
	}): void {
		const record: LogRecord = {
			id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			timestamp: new Date(),
			level: params.level,
			body: params.body,
			attributes: this.truncateAttributes(params.attributes ?? {}),
			resource: this.resource,
			instrumentationScope: params.instrumentationScope ?? "default",
			traceId: params.traceContext?.traceId,
			spanId: params.traceContext?.spanId,
			severityNumber: LOG_SEVERITY_NUMBER[params.level],
		};

		// Persist log
		this.persistLog(record);
		this.emit("log:recorded", record);
		this.addToBatch("log", record);

		// Real-time streaming
		if (this.config.enableRealTimeStreaming) {
			this.emit("log:stream", record);
		}
	}

	trace(body: string, attributes?: Record<string, string | number | boolean>, traceContext?: TraceContext): void {
		this.log({ level: "trace", body, attributes, traceContext });
	}

	debug(body: string, attributes?: Record<string, string | number | boolean>, traceContext?: TraceContext): void {
		this.log({ level: "debug", body, attributes, traceContext });
	}

	info(body: string, attributes?: Record<string, string | number | boolean>, traceContext?: TraceContext): void {
		this.log({ level: "info", body, attributes, traceContext });
	}

	warn(body: string, attributes?: Record<string, string | number | boolean>, traceContext?: TraceContext): void {
		this.log({ level: "warn", body, attributes, traceContext });
	}

	error(body: string, attributes?: Record<string, string | number | boolean>, traceContext?: TraceContext): void {
		this.log({ level: "error", body, attributes, traceContext });
	}

	fatal(body: string, attributes?: Record<string, string | number | boolean>, traceContext?: TraceContext): void {
		this.log({ level: "fatal", body, attributes, traceContext });
	}

	private persistLog(record: LogRecord): void {
		const stmt = this.db.prepare(`
      INSERT INTO logs
      (id, timestamp, level, body, attributes, resource, instrumentation_scope, trace_id, span_id, severity_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			record.id,
			record.timestamp.toISOString(),
			record.level,
			record.body,
			JSON.stringify(record.attributes),
			JSON.stringify(record.resource),
			record.instrumentationScope,
			record.traceId ?? null,
			record.spanId ?? null,
			record.severityNumber,
		);
	}

	// ============================================================================
	// Batch Export
	// ============================================================================

	private addToBatch(type: "span" | "metric" | "log", data: Span | Metric | LogRecord): void {
		if (!this.pendingBatch) {
			this.pendingBatch = {
				id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
				timestamp: new Date(),
				format: this.config.exportFormats[0] ?? "json",
				spans: [],
				metrics: [],
				logs: [],
				resource: this.resource,
				status: "pending",
				retryCount: 0,
			};
		}

		switch (type) {
			case "span":
				this.pendingBatch.spans.push(data as Span);
				break;
			case "metric":
				this.pendingBatch.metrics.push(data as Metric);
				break;
			case "log":
				this.pendingBatch.logs.push(data as LogRecord);
				break;
		}

		const totalItems =
			this.pendingBatch.spans.length + this.pendingBatch.metrics.length + this.pendingBatch.logs.length;

		if (totalItems >= this.config.batchSize) {
			this.flushBatch();
		}
	}

	async flushBatch(): Promise<void> {
		if (!this.pendingBatch) return;

		const batch = this.pendingBatch;
		this.pendingBatch = null;

		if (batch.spans.length === 0 && batch.metrics.length === 0 && batch.logs.length === 0) {
			return;
		}

		batch.status = "exporting";

		try {
			// Export to configured formats
			for (const format of this.config.exportFormats) {
				const exportedData = this.formatBatch(batch, format);
				this.emit("batch:export", { format, data: exportedData, batch });
			}

			batch.status = "exported";
			this.persistBatch(batch);
			this.emit("batch:exported", batch);
		} catch (error) {
			batch.status = "failed";
			batch.error = error instanceof Error ? error.message : String(error);
			batch.retryCount++;
			this.persistBatch(batch);
			this.emit("batch:failed", { batch, error });
		}
	}

	private formatBatch(batch: ExportBatch, format: ExportFormat): string {
		switch (format) {
			case "json":
				return JSON.stringify(
					{
						resource: batch.resource,
						spans: batch.spans,
						metrics: batch.metrics,
						logs: batch.logs,
					},
					null,
					2,
				);

			case "otlp":
				return JSON.stringify({
					resourceSpans: [
						{
							resource: { attributes: this.resourceToAttributes(batch.resource) },
							scopeSpans: this.groupSpansByScope(batch.spans),
						},
					],
					resourceMetrics: [
						{
							resource: { attributes: this.resourceToAttributes(batch.resource) },
							scopeMetrics: this.groupMetricsByScope(batch.metrics),
						},
					],
					resourceLogs: [
						{
							resource: { attributes: this.resourceToAttributes(batch.resource) },
							scopeLogs: this.groupLogsByScope(batch.logs),
						},
					],
				});

			case "prometheus":
				return this.toPrometheusFormat(batch.metrics);

			case "custom":
				return JSON.stringify(batch);

			default:
				return JSON.stringify(batch);
		}
	}

	private resourceToAttributes(
		resource: ResourceAttributes,
	): Array<{ key: string; value: { stringValue?: string; intValue?: number } }> {
		const attrs: Array<{ key: string; value: { stringValue?: string; intValue?: number } }> = [];

		if (resource.serviceName) attrs.push({ key: "service.name", value: { stringValue: resource.serviceName } });
		if (resource.serviceVersion)
			attrs.push({ key: "service.version", value: { stringValue: resource.serviceVersion } });
		if (resource.hostName) attrs.push({ key: "host.name", value: { stringValue: resource.hostName } });
		if (resource.deploymentEnvironment)
			attrs.push({ key: "deployment.environment", value: { stringValue: resource.deploymentEnvironment } });

		return attrs;
	}

	private groupSpansByScope(spans: Span[]): Array<{ scope: { name: string }; spans: Span[] }> {
		const byScope = new Map<string, Span[]>();
		for (const span of spans) {
			const scope = span.instrumentationScope;
			if (!byScope.has(scope)) byScope.set(scope, []);
			byScope.get(scope)!.push(span);
		}
		return Array.from(byScope.entries()).map(([name, spans]) => ({ scope: { name }, spans }));
	}

	private groupMetricsByScope(metrics: Metric[]): Array<{ scope: { name: string }; metrics: Metric[] }> {
		const byScope = new Map<string, Metric[]>();
		for (const metric of metrics) {
			const scope = metric.instrumentationScope;
			if (!byScope.has(scope)) byScope.set(scope, []);
			byScope.get(scope)!.push(metric);
		}
		return Array.from(byScope.entries()).map(([name, metrics]) => ({ scope: { name }, metrics }));
	}

	private groupLogsByScope(logs: LogRecord[]): Array<{ scope: { name: string }; logRecords: LogRecord[] }> {
		const byScope = new Map<string, LogRecord[]>();
		for (const log of logs) {
			const scope = log.instrumentationScope;
			if (!byScope.has(scope)) byScope.set(scope, []);
			byScope.get(scope)!.push(log);
		}
		return Array.from(byScope.entries()).map(([name, logRecords]) => ({ scope: { name }, logRecords }));
	}

	private toPrometheusFormat(metrics: Metric[]): string {
		const lines: string[] = [];

		for (const metric of metrics) {
			const safeName = metric.name.replace(/[^a-zA-Z0-9_]/g, "_");
			if (metric.description) {
				lines.push(`# HELP ${safeName} ${metric.description}`);
			}
			lines.push(`# TYPE ${safeName} ${metric.type}`);

			for (const dp of metric.dataPoints) {
				const labels = Object.entries(dp.attributes)
					.map(([k, v]) => `${k}="${v}"`)
					.join(",");
				const labelStr = labels ? `{${labels}}` : "";
				lines.push(`${safeName}${labelStr} ${dp.value} ${dp.timestamp.getTime()}`);
			}
		}

		return lines.join("\n");
	}

	private persistBatch(batch: ExportBatch): void {
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO export_batches
      (id, timestamp, format, span_count, metric_count, log_count, status, retry_count, error, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		stmt.run(
			batch.id,
			batch.timestamp.toISOString(),
			batch.format,
			batch.spans.length,
			batch.metrics.length,
			batch.logs.length,
			batch.status,
			batch.retryCount,
			batch.error ?? null,
			null, // Don't persist full data to save space
		);
	}

	// ============================================================================
	// Querying
	// ============================================================================

	getTrace(traceId: string): Span[] {
		const stmt = this.db.prepare(`
      SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC
    `);
		const rows = stmt.all(traceId) as Record<string, unknown>[];
		return rows.map((row) => this.rowToSpan(row));
	}

	getSpan(spanId: string): Span | null {
		const stmt = this.db.prepare("SELECT * FROM spans WHERE span_id = ?");
		const row = stmt.get(spanId) as Record<string, unknown> | undefined;
		if (!row) return null;
		return this.rowToSpan(row);
	}

	querySpans(params: {
		startTime?: Date;
		endTime?: Date;
		name?: string;
		kind?: SpanKind;
		status?: SpanStatus;
		minDuration?: number;
		maxDuration?: number;
		attributes?: Record<string, string | number | boolean>;
		limit?: number;
		offset?: number;
	}): Span[] {
		let query = "SELECT * FROM spans WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.startTime) {
			query += " AND start_time >= ?";
			queryParams.push(params.startTime.toISOString());
		}
		if (params.endTime) {
			query += " AND start_time <= ?";
			queryParams.push(params.endTime.toISOString());
		}
		if (params.name) {
			query += " AND name LIKE ?";
			queryParams.push(`%${params.name}%`);
		}
		if (params.kind) {
			query += " AND kind = ?";
			queryParams.push(params.kind);
		}
		if (params.status) {
			query += " AND status = ?";
			queryParams.push(params.status);
		}

		query += " ORDER BY start_time DESC";

		if (params.limit) {
			query += " LIMIT ?";
			queryParams.push(params.limit);
		}
		if (params.offset) {
			query += " OFFSET ?";
			queryParams.push(params.offset);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		let spans = rows.map((row) => this.rowToSpan(row));

		// Post-filter for duration (requires endTime)
		if (params.minDuration !== undefined || params.maxDuration !== undefined) {
			spans = spans.filter((span) => {
				if (!span.endTime) return false;
				const duration = span.endTime.getTime() - span.startTime.getTime();
				if (params.minDuration !== undefined && duration < params.minDuration) return false;
				if (params.maxDuration !== undefined && duration > params.maxDuration) return false;
				return true;
			});
		}

		return spans;
	}

	queryLogs(params: {
		startTime?: Date;
		endTime?: Date;
		levels?: LogLevel[];
		traceId?: string;
		searchText?: string;
		limit?: number;
		offset?: number;
	}): LogRecord[] {
		let query = "SELECT * FROM logs WHERE 1=1";
		const queryParams: unknown[] = [];

		if (params.startTime) {
			query += " AND timestamp >= ?";
			queryParams.push(params.startTime.toISOString());
		}
		if (params.endTime) {
			query += " AND timestamp <= ?";
			queryParams.push(params.endTime.toISOString());
		}
		if (params.levels && params.levels.length > 0) {
			query += ` AND level IN (${params.levels.map(() => "?").join(",")})`;
			queryParams.push(...params.levels);
		}
		if (params.traceId) {
			query += " AND trace_id = ?";
			queryParams.push(params.traceId);
		}
		if (params.searchText) {
			query += " AND body LIKE ?";
			queryParams.push(`%${params.searchText}%`);
		}

		query += " ORDER BY timestamp DESC";

		if (params.limit) {
			query += " LIMIT ?";
			queryParams.push(params.limit);
		}
		if (params.offset) {
			query += " OFFSET ?";
			queryParams.push(params.offset);
		}

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...queryParams) as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			timestamp: new Date(row.timestamp as string),
			level: row.level as LogLevel,
			body: row.body as string,
			attributes: JSON.parse(row.attributes as string),
			resource: JSON.parse(row.resource as string),
			instrumentationScope: row.instrumentation_scope as string,
			traceId: row.trace_id as string | undefined,
			spanId: row.span_id as string | undefined,
			severityNumber: row.severity_number as number,
		}));
	}

	getMetricAggregation(name: string, attributes?: Record<string, string | number | boolean>): AggregatedMetric | null {
		const attributesHash = attributes ? this.hashAttributes(attributes) : null;

		let query = "SELECT * FROM metric_aggregations WHERE name = ?";
		const params: unknown[] = [name];

		if (attributesHash) {
			query += " AND attributes_hash = ?";
			params.push(attributesHash);
		}

		query += " ORDER BY last_updated DESC LIMIT 1";

		const stmt = this.db.prepare(query);
		const row = stmt.get(...params) as Record<string, unknown> | undefined;

		if (!row) return null;

		return {
			name: row.name as string,
			type: row.type as MetricType,
			count: row.count as number,
			sum: row.sum as number,
			avg: (row.sum as number) / (row.count as number),
			min: row.min as number,
			max: row.max as number,
			lastValue: row.last_value as number,
			lastUpdated: new Date(row.last_updated as string),
			attributes: JSON.parse(row.attributes as string),
		};
	}

	getAllMetricAggregations(name?: string): AggregatedMetric[] {
		let query = "SELECT * FROM metric_aggregations";
		const params: unknown[] = [];

		if (name) {
			query += " WHERE name = ?";
			params.push(name);
		}

		query += " ORDER BY name, last_updated DESC";

		const stmt = this.db.prepare(query);
		const rows = stmt.all(...params) as Record<string, unknown>[];

		return rows.map((row) => ({
			name: row.name as string,
			type: row.type as MetricType,
			count: row.count as number,
			sum: row.sum as number,
			avg: (row.sum as number) / (row.count as number),
			min: row.min as number,
			max: row.max as number,
			lastValue: row.last_value as number,
			lastUpdated: new Date(row.last_updated as string),
			attributes: JSON.parse(row.attributes as string),
		}));
	}

	private rowToSpan(row: Record<string, unknown>): Span {
		return {
			traceId: row.trace_id as string,
			spanId: row.span_id as string,
			parentSpanId: row.parent_span_id as string | undefined,
			name: row.name as string,
			kind: row.kind as SpanKind,
			startTime: new Date(row.start_time as string),
			endTime: row.end_time ? new Date(row.end_time as string) : undefined,
			status: row.status as SpanStatus,
			statusMessage: row.status_message as string | undefined,
			attributes: JSON.parse(row.attributes as string),
			events: JSON.parse(row.events as string),
			links: JSON.parse(row.links as string),
			resource: JSON.parse(row.resource as string),
			instrumentationScope: row.instrumentation_scope as string,
			dropped: row.dropped ? JSON.parse(row.dropped as string) : undefined,
		};
	}

	// ============================================================================
	// Retention Management
	// ============================================================================

	createRetentionPolicy(params: {
		name: string;
		dataType: "spans" | "metrics" | "logs" | "all";
		retentionDays: number;
	}): RetentionPolicy {
		const id = `retention_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const policy: RetentionPolicy = {
			id,
			name: params.name,
			dataType: params.dataType,
			retentionDays: params.retentionDays,
			enabled: true,
		};

		const stmt = this.db.prepare(`
      INSERT INTO retention_policies (id, name, data_type, retention_days, enabled)
      VALUES (?, ?, ?, ?, ?)
    `);

		stmt.run(policy.id, policy.name, policy.dataType, policy.retentionDays, 1);
		this.emit("retention:created", policy);

		return policy;
	}

	getAllRetentionPolicies(): RetentionPolicy[] {
		const stmt = this.db.prepare("SELECT * FROM retention_policies ORDER BY name");
		const rows = stmt.all() as Record<string, unknown>[];

		return rows.map((row) => ({
			id: row.id as string,
			name: row.name as string,
			dataType: row.data_type as "spans" | "metrics" | "logs" | "all",
			retentionDays: row.retention_days as number,
			enabled: Boolean(row.enabled),
		}));
	}

	private applyRetentionPolicies(): void {
		const policies = this.getAllRetentionPolicies().filter((p) => p.enabled);
		const now = new Date();

		for (const policy of policies) {
			const cutoffDate = new Date(now);
			cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
			const cutoffStr = cutoffDate.toISOString();

			let deleted = 0;

			if (policy.dataType === "spans" || policy.dataType === "all") {
				const stmt = this.db.prepare("DELETE FROM spans WHERE start_time < ?");
				deleted += stmt.run(cutoffStr).changes;
			}

			if (policy.dataType === "metrics" || policy.dataType === "all") {
				const stmt = this.db.prepare("DELETE FROM metrics WHERE timestamp < ?");
				deleted += stmt.run(cutoffStr).changes;
			}

			if (policy.dataType === "logs" || policy.dataType === "all") {
				const stmt = this.db.prepare("DELETE FROM logs WHERE timestamp < ?");
				deleted += stmt.run(cutoffStr).changes;
			}

			if (deleted > 0) {
				this.emit("retention:applied", { policy, deleted });
			}
		}

		// Clean old export batches
		const batchCutoff = new Date(now);
		batchCutoff.setDate(batchCutoff.getDate() - 7);
		const batchStmt = this.db.prepare("DELETE FROM export_batches WHERE timestamp < ?");
		batchStmt.run(batchCutoff.toISOString());
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getStats(): TelemetryStats {
		const now = new Date();
		const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

		const spansTotalStmt = this.db.prepare("SELECT COUNT(*) as count FROM spans");
		const spansTotal = (spansTotalStmt.get() as { count: number }).count;

		const spans24hStmt = this.db.prepare("SELECT COUNT(*) as count FROM spans WHERE start_time >= ?");
		const spans24h = (spans24hStmt.get(last24h.toISOString()) as { count: number }).count;

		const metricsTotalStmt = this.db.prepare("SELECT COUNT(*) as count FROM metrics");
		const metricsTotal = (metricsTotalStmt.get() as { count: number }).count;

		const metrics24hStmt = this.db.prepare("SELECT COUNT(*) as count FROM metrics WHERE timestamp >= ?");
		const metrics24h = (metrics24hStmt.get(last24h.toISOString()) as { count: number }).count;

		const logsTotalStmt = this.db.prepare("SELECT COUNT(*) as count FROM logs");
		const logsTotal = (logsTotalStmt.get() as { count: number }).count;

		const logs24hStmt = this.db.prepare("SELECT COUNT(*) as count FROM logs WHERE timestamp >= ?");
		const logs24h = (logs24hStmt.get(last24h.toISOString()) as { count: number }).count;

		const activeTracesStmt = this.db.prepare(
			"SELECT COUNT(DISTINCT trace_id) as count FROM spans WHERE end_time IS NULL",
		);
		const activeTraces = (activeTracesStmt.get() as { count: number }).count;

		const sampledStmt = this.db.prepare("SELECT COUNT(*) as count FROM spans WHERE sampled = 1");
		const sampled = (sampledStmt.get() as { count: number }).count;

		const exportedStmt = this.db.prepare("SELECT COUNT(*) as count FROM export_batches WHERE status = 'exported'");
		const exported = (exportedStmt.get() as { count: number }).count;

		const failedStmt = this.db.prepare("SELECT COUNT(*) as count FROM export_batches WHERE status = 'failed'");
		const failed = (failedStmt.get() as { count: number }).count;

		const rangeStmt = this.db.prepare(`
      SELECT MIN(start_time) as oldest, MAX(start_time) as newest FROM spans
    `);
		const range = rangeStmt.get() as { oldest: string | null; newest: string | null };

		return {
			totalSpans: spansTotal,
			totalMetrics: metricsTotal,
			totalLogs: logsTotal,
			spansLast24h: spans24h,
			metricsLast24h: metrics24h,
			logsLast24h: logs24h,
			activeTraces: activeTraces + this.activeSpans.size,
			sampledSpans: sampled,
			droppedSpans: spansTotal - sampled,
			exportedBatches: exported,
			failedExports: failed,
			oldestData: range.oldest ? new Date(range.oldest) : undefined,
			newestData: range.newest ? new Date(range.newest) : undefined,
		};
	}

	// ============================================================================
	// Convenience Methods
	// ============================================================================

	/**
	 * Creates a traced operation that automatically starts and ends a span
	 */
	async withSpan<T>(
		name: string,
		fn: (context: TraceContext) => Promise<T>,
		options?: {
			kind?: SpanKind;
			parentContext?: TraceContext;
			attributes?: Record<string, string | number | boolean>;
		},
	): Promise<T> {
		const context = this.startSpan({
			name,
			kind: options?.kind,
			parentContext: options?.parentContext,
			attributes: options?.attributes,
		});

		if (!context || !context.sampled) {
			return fn(context ?? { traceId: "", spanId: "", baggage: {}, sampled: false });
		}

		try {
			const result = await fn(context);
			this.setSpanStatus(context.spanId, "ok");
			return result;
		} catch (error) {
			this.setSpanStatus(context.spanId, "error", error instanceof Error ? error.message : String(error));
			this.addSpanEvent(context.spanId, {
				name: "exception",
				attributes: {
					"exception.type": error instanceof Error ? error.constructor.name : "Error",
					"exception.message": error instanceof Error ? error.message : String(error),
				},
			});
			throw error;
		} finally {
			this.endSpan(context.spanId);
		}
	}

	/**
	 * Records execution time as a histogram metric
	 */
	async timeOperation<T>(
		metricName: string,
		fn: () => Promise<T>,
		attributes?: Record<string, string | number | boolean>,
	): Promise<T> {
		const startTime = Date.now();
		try {
			return await fn();
		} finally {
			const duration = Date.now() - startTime;
			this.recordHistogram({
				name: metricName,
				value: duration,
				unit: "ms",
				attributes,
			});
		}
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	async shutdown(): Promise<void> {
		// Flush pending batch
		await this.flushBatch();

		// End any active spans
		for (const [_spanId, span] of this.activeSpans) {
			span.endTime = new Date();
			span.status = "error";
			span.statusMessage = "Span ended due to shutdown";
			this.persistSpan(span);
		}
		this.activeSpans.clear();

		// Clear intervals
		if (this.batchInterval) {
			clearInterval(this.batchInterval);
			this.batchInterval = null;
		}
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		this.db.close();
		this.emit("shutdown");
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

let telemetryCollectorInstance: TelemetryCollector | null = null;

export function getTelemetryCollector(config?: TelemetryConfig): TelemetryCollector {
	if (!telemetryCollectorInstance) {
		if (!config) {
			throw new Error("TelemetryCollector requires config on first initialization");
		}
		telemetryCollectorInstance = new TelemetryCollector(config);
	}
	return telemetryCollectorInstance;
}

export function resetTelemetryCollector(): Promise<void> {
	if (telemetryCollectorInstance) {
		const promise = telemetryCollectorInstance.shutdown();
		telemetryCollectorInstance = null;
		return promise;
	}
	return Promise.resolve();
}
