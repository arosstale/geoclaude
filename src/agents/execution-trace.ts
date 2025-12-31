/**
 * Class 3.37: Execution Trace
 *
 * Comprehensive tracing and debugging for agent execution.
 * Captures detailed execution flow, timing, and context.
 *
 * Features:
 * - Hierarchical trace spans
 * - Timing and duration tracking
 * - Context propagation
 * - Export to various formats
 * - Visualization support
 *
 * @module execution-trace
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type SpanKind = "agent" | "tool" | "llm" | "internal" | "external";
export type SpanStatus = "running" | "success" | "error" | "cancelled";

export interface SpanContext {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
}

export interface TraceSpan {
	id: string;
	traceId: string;
	parentId?: string;
	name: string;
	kind: SpanKind;
	status: SpanStatus;
	startTime: number;
	endTime?: number;
	duration?: number;
	attributes: Record<string, unknown>;
	events: SpanEvent[];
	children: string[];
	error?: {
		message: string;
		stack?: string;
		code?: string;
	};
}

export interface SpanEvent {
	name: string;
	timestamp: number;
	attributes?: Record<string, unknown>;
}

export interface ExecutionTrace {
	id: string;
	name: string;
	startTime: number;
	endTime?: number;
	duration?: number;
	status: SpanStatus;
	rootSpanId: string;
	spans: Map<string, TraceSpan>;
	metadata: Record<string, unknown>;
}

export interface TraceExport {
	format: "json" | "jaeger" | "zipkin" | "otlp";
	trace: ExecutionTrace;
	exported: string;
}

export interface ExecutionTracerConfig {
	maxSpansPerTrace: number;
	maxTracesInMemory: number;
	maxEventsPerSpan: number;
	enableAutoFlush: boolean;
	flushIntervalMs: number;
	sampleRate: number;
}

export interface ExecutionTracerEvents {
	"trace:started": { trace: ExecutionTrace };
	"trace:ended": { trace: ExecutionTrace };
	"span:started": { span: TraceSpan };
	"span:ended": { span: TraceSpan };
	"span:event": { spanId: string; event: SpanEvent };
	"trace:flushed": { count: number };
	"trace:sampled": { traceId: string; sampled: boolean };
}

// =============================================================================
// Execution Tracer
// =============================================================================

export class ExecutionTracer extends EventEmitter {
	private config: ExecutionTracerConfig;
	private traces: Map<string, ExecutionTrace> = new Map();
	private activeSpans: Map<string, TraceSpan> = new Map();
	private flushTimer?: ReturnType<typeof setInterval>;

	constructor(config: Partial<ExecutionTracerConfig> = {}) {
		super();
		this.config = {
			maxSpansPerTrace: 1000,
			maxTracesInMemory: 100,
			maxEventsPerSpan: 100,
			enableAutoFlush: false,
			flushIntervalMs: 60000,
			sampleRate: 1.0,
			...config,
		};

		if (this.config.enableAutoFlush) {
			this.startAutoFlush();
		}
	}

	// ---------------------------------------------------------------------------
	// Trace Management
	// ---------------------------------------------------------------------------

	startTrace(name: string, metadata: Record<string, unknown> = {}): ExecutionTrace {
		// Check sampling
		if (Math.random() > this.config.sampleRate) {
			const traceId = this.generateId();
			this.emit("trace:sampled", { traceId, sampled: false });
			// Return a dummy trace that won't be stored
			return {
				id: traceId,
				name,
				startTime: Date.now(),
				status: "running",
				rootSpanId: "",
				spans: new Map(),
				metadata: { ...metadata, sampled: false },
			};
		}

		const traceId = this.generateId();
		const rootSpanId = this.generateId();

		const rootSpan: TraceSpan = {
			id: rootSpanId,
			traceId,
			name,
			kind: "agent",
			status: "running",
			startTime: Date.now(),
			attributes: {},
			events: [],
			children: [],
		};

		const trace: ExecutionTrace = {
			id: traceId,
			name,
			startTime: Date.now(),
			status: "running",
			rootSpanId,
			spans: new Map([[rootSpanId, rootSpan]]),
			metadata,
		};

		this.traces.set(traceId, trace);
		this.activeSpans.set(rootSpanId, rootSpan);

		// Enforce memory limits
		this.enforceMemoryLimits();

		this.emit("trace:started", { trace });
		this.emit("span:started", { span: rootSpan });

		return trace;
	}

	endTrace(traceId: string, status: SpanStatus = "success"): ExecutionTrace | null {
		const trace = this.traces.get(traceId);
		if (!trace) return null;

		trace.endTime = Date.now();
		trace.duration = trace.endTime - trace.startTime;
		trace.status = status;

		// End root span
		const rootSpan = trace.spans.get(trace.rootSpanId);
		if (rootSpan && rootSpan.status === "running") {
			this.endSpan(rootSpan.id, status);
		}

		// End any remaining active spans
		for (const span of trace.spans.values()) {
			if (span.status === "running") {
				this.endSpan(span.id, "cancelled");
			}
		}

		this.emit("trace:ended", { trace });
		return trace;
	}

	getTrace(traceId: string): ExecutionTrace | null {
		return this.traces.get(traceId) || null;
	}

	// ---------------------------------------------------------------------------
	// Span Management
	// ---------------------------------------------------------------------------

	startSpan(traceId: string, name: string, kind: SpanKind = "internal", parentSpanId?: string): TraceSpan | null {
		const trace = this.traces.get(traceId);
		if (!trace || trace.metadata.sampled === false) return null;

		// Check span limit
		if (trace.spans.size >= this.config.maxSpansPerTrace) {
			return null;
		}

		const spanId = this.generateId();
		const actualParentId = parentSpanId || trace.rootSpanId;

		const span: TraceSpan = {
			id: spanId,
			traceId,
			parentId: actualParentId,
			name,
			kind,
			status: "running",
			startTime: Date.now(),
			attributes: {},
			events: [],
			children: [],
		};

		trace.spans.set(spanId, span);
		this.activeSpans.set(spanId, span);

		// Update parent's children
		const parentSpan = trace.spans.get(actualParentId);
		if (parentSpan) {
			parentSpan.children.push(spanId);
		}

		this.emit("span:started", { span });
		return span;
	}

	endSpan(spanId: string, status: SpanStatus = "success", error?: Error): TraceSpan | null {
		const span = this.activeSpans.get(spanId);
		if (!span) return null;

		span.endTime = Date.now();
		span.duration = span.endTime - span.startTime;
		span.status = status;

		if (error) {
			span.error = {
				message: error.message,
				stack: error.stack,
				code: (error as any).code,
			};
		}

		this.activeSpans.delete(spanId);
		this.emit("span:ended", { span });
		return span;
	}

	addSpanEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
		const span = this.activeSpans.get(spanId);
		if (!span) return;

		if (span.events.length >= this.config.maxEventsPerSpan) {
			return;
		}

		const event: SpanEvent = {
			name,
			timestamp: Date.now(),
			attributes,
		};

		span.events.push(event);
		this.emit("span:event", { spanId, event });
	}

	setSpanAttribute(spanId: string, key: string, value: unknown): void {
		const span = this.activeSpans.get(spanId);
		if (span) {
			span.attributes[key] = value;
		}
	}

	setSpanAttributes(spanId: string, attributes: Record<string, unknown>): void {
		const span = this.activeSpans.get(spanId);
		if (span) {
			Object.assign(span.attributes, attributes);
		}
	}

	// ---------------------------------------------------------------------------
	// Context Helpers
	// ---------------------------------------------------------------------------

	getSpanContext(spanId: string): SpanContext | null {
		const span = this.activeSpans.get(spanId);
		if (!span) return null;

		return {
			traceId: span.traceId,
			spanId: span.id,
			parentSpanId: span.parentId,
		};
	}

	getCurrentSpan(traceId: string): TraceSpan | null {
		const trace = this.traces.get(traceId);
		if (!trace) return null;

		// Find the most recent active span
		let current: TraceSpan | null = null;
		let latestStart = 0;

		for (const span of this.activeSpans.values()) {
			if (span.traceId === traceId && span.startTime > latestStart) {
				latestStart = span.startTime;
				current = span;
			}
		}

		return current;
	}

	// ---------------------------------------------------------------------------
	// Wrapper Methods
	// ---------------------------------------------------------------------------

	async withSpan<T>(
		traceId: string,
		name: string,
		kind: SpanKind,
		fn: (span: TraceSpan | null) => Promise<T>,
		parentSpanId?: string,
	): Promise<T> {
		const span = this.startSpan(traceId, name, kind, parentSpanId);

		try {
			const result = await fn(span);
			if (span) {
				this.endSpan(span.id, "success");
			}
			return result;
		} catch (error) {
			if (span) {
				this.endSpan(span.id, "error", error as Error);
			}
			throw error;
		}
	}

	async withTrace<T>(
		name: string,
		fn: (trace: ExecutionTrace) => Promise<T>,
		metadata: Record<string, unknown> = {},
	): Promise<T> {
		const trace = this.startTrace(name, metadata);

		try {
			const result = await fn(trace);
			this.endTrace(trace.id, "success");
			return result;
		} catch (error) {
			this.endTrace(trace.id, "error");
			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	// Export
	// ---------------------------------------------------------------------------

	exportTrace(traceId: string, format: "json" | "jaeger" | "zipkin" | "otlp" = "json"): TraceExport | null {
		const trace = this.traces.get(traceId);
		if (!trace) return null;

		let exported: string;

		switch (format) {
			case "json":
				exported = this.exportJson(trace);
				break;
			case "jaeger":
				exported = this.exportJaeger(trace);
				break;
			case "zipkin":
				exported = this.exportZipkin(trace);
				break;
			case "otlp":
				exported = this.exportOTLP(trace);
				break;
			default:
				exported = this.exportJson(trace);
		}

		return { format, trace, exported };
	}

	private exportJson(trace: ExecutionTrace): string {
		return JSON.stringify(
			{
				...trace,
				spans: Array.from(trace.spans.values()),
			},
			null,
			2,
		);
	}

	private exportJaeger(trace: ExecutionTrace): string {
		// Jaeger format
		const spans = Array.from(trace.spans.values()).map((span) => ({
			traceID: span.traceId,
			spanID: span.id,
			operationName: span.name,
			references: span.parentId ? [{ refType: "CHILD_OF", traceID: span.traceId, spanID: span.parentId }] : [],
			startTime: span.startTime * 1000, // microseconds
			duration: (span.duration || 0) * 1000,
			tags: Object.entries(span.attributes).map(([key, value]) => ({
				key,
				type: typeof value,
				value,
			})),
			logs: span.events.map((e) => ({
				timestamp: e.timestamp * 1000,
				fields: [
					{ key: "event", value: e.name },
					...(e.attributes ? Object.entries(e.attributes).map(([k, v]) => ({ key: k, value: v })) : []),
				],
			})),
		}));

		return JSON.stringify({ data: [{ traceID: trace.id, spans, processes: {} }] }, null, 2);
	}

	private exportZipkin(trace: ExecutionTrace): string {
		// Zipkin v2 format
		const spans = Array.from(trace.spans.values()).map((span) => ({
			traceId: span.traceId,
			id: span.id,
			parentId: span.parentId,
			name: span.name,
			timestamp: span.startTime * 1000,
			duration: (span.duration || 0) * 1000,
			kind: span.kind === "llm" ? "CLIENT" : span.kind === "tool" ? "SERVER" : undefined,
			tags: span.attributes,
			annotations: span.events.map((e) => ({
				timestamp: e.timestamp * 1000,
				value: e.name,
			})),
		}));

		return JSON.stringify(spans, null, 2);
	}

	private exportOTLP(trace: ExecutionTrace): string {
		// OpenTelemetry Protocol format (simplified)
		const resourceSpans = {
			resource: {
				attributes: Object.entries(trace.metadata).map(([key, value]) => ({
					key,
					value: { stringValue: String(value) },
				})),
			},
			scopeSpans: [
				{
					scope: { name: "execution-trace" },
					spans: Array.from(trace.spans.values()).map((span) => ({
						traceId: span.traceId,
						spanId: span.id,
						parentSpanId: span.parentId,
						name: span.name,
						kind: this.otlpSpanKind(span.kind),
						startTimeUnixNano: span.startTime * 1000000,
						endTimeUnixNano: (span.endTime || span.startTime) * 1000000,
						attributes: Object.entries(span.attributes).map(([key, value]) => ({
							key,
							value: { stringValue: String(value) },
						})),
						status: {
							code: span.status === "success" ? 1 : span.status === "error" ? 2 : 0,
							message: span.error?.message,
						},
						events: span.events.map((e) => ({
							timeUnixNano: e.timestamp * 1000000,
							name: e.name,
							attributes: e.attributes
								? Object.entries(e.attributes).map(([k, v]) => ({
										key: k,
										value: { stringValue: String(v) },
									}))
								: [],
						})),
					})),
				},
			],
		};

		return JSON.stringify({ resourceSpans: [resourceSpans] }, null, 2);
	}

	private otlpSpanKind(kind: SpanKind): number {
		switch (kind) {
			case "agent":
				return 1; // INTERNAL
			case "tool":
				return 3; // CLIENT
			case "llm":
				return 3; // CLIENT
			case "external":
				return 3; // CLIENT
			default:
				return 1; // INTERNAL
		}
	}

	// ---------------------------------------------------------------------------
	// Visualization
	// ---------------------------------------------------------------------------

	generateTimeline(traceId: string): string {
		const trace = this.traces.get(traceId);
		if (!trace) return "";

		const lines: string[] = [
			`Trace: ${trace.name} (${trace.id})`,
			`Duration: ${trace.duration || 0}ms`,
			`Status: ${trace.status}`,
			"",
			"Timeline:",
		];

		const spans = Array.from(trace.spans.values()).sort((a, b) => a.startTime - b.startTime);

		for (const span of spans) {
			const depth = this.getSpanDepth(trace, span.id);
			const indent = "  ".repeat(depth);
			const duration = span.duration || 0;
			const status = span.status === "success" ? "+" : span.status === "error" ? "x" : "-";

			lines.push(`${indent}[${status}] ${span.name} (${span.kind}) - ${duration}ms`);

			for (const event of span.events) {
				const eventTime = event.timestamp - span.startTime;
				lines.push(`${indent}    @ +${eventTime}ms: ${event.name}`);
			}
		}

		return lines.join("\n");
	}

	generateMermaidDiagram(traceId: string): string {
		const trace = this.traces.get(traceId);
		if (!trace) return "";

		const lines: string[] = ["gantt", `    title ${trace.name}`, "    dateFormat x"];

		const spans = Array.from(trace.spans.values()).sort((a, b) => a.startTime - b.startTime);
		const baseTime = trace.startTime;

		for (const span of spans) {
			const start = span.startTime - baseTime;
			const duration = span.duration || 0;
			const status = span.status === "error" ? "crit" : span.status === "running" ? "active" : "";
			const safeName = span.name.replace(/[:[\]]/g, "_");

			lines.push(`    ${safeName} :${status} ${span.id}, ${start}, ${duration}ms`);
		}

		return lines.join("\n");
	}

	private getSpanDepth(trace: ExecutionTrace, spanId: string): number {
		let depth = 0;
		let currentId: string | undefined = spanId;

		while (currentId) {
			const span = trace.spans.get(currentId);
			if (!span || !span.parentId) break;
			currentId = span.parentId;
			depth++;
		}

		return depth;
	}

	// ---------------------------------------------------------------------------
	// Statistics
	// ---------------------------------------------------------------------------

	getTraceStats(traceId: string): {
		spanCount: number;
		totalDuration: number;
		spansByKind: Record<SpanKind, number>;
		spansByStatus: Record<SpanStatus, number>;
		avgSpanDuration: number;
	} | null {
		const trace = this.traces.get(traceId);
		if (!trace) return null;

		const spans = Array.from(trace.spans.values());
		const spansByKind: Record<string, number> = {};
		const spansByStatus: Record<string, number> = {};
		let totalSpanDuration = 0;

		for (const span of spans) {
			spansByKind[span.kind] = (spansByKind[span.kind] || 0) + 1;
			spansByStatus[span.status] = (spansByStatus[span.status] || 0) + 1;
			totalSpanDuration += span.duration || 0;
		}

		return {
			spanCount: spans.length,
			totalDuration: trace.duration || 0,
			spansByKind: spansByKind as Record<SpanKind, number>,
			spansByStatus: spansByStatus as Record<SpanStatus, number>,
			avgSpanDuration: spans.length > 0 ? totalSpanDuration / spans.length : 0,
		};
	}

	// ---------------------------------------------------------------------------
	// Memory Management
	// ---------------------------------------------------------------------------

	private enforceMemoryLimits(): void {
		if (this.traces.size <= this.config.maxTracesInMemory) return;

		// Remove oldest completed traces
		const traces = Array.from(this.traces.entries())
			.filter(([_, t]) => t.status !== "running")
			.sort((a, b) => (a[1].endTime || 0) - (b[1].endTime || 0));

		const toRemove = traces.slice(0, traces.length - this.config.maxTracesInMemory + 10);
		for (const [id] of toRemove) {
			this.traces.delete(id);
		}
	}

	private startAutoFlush(): void {
		this.flushTimer = setInterval(() => {
			this.flush();
		}, this.config.flushIntervalMs);
	}

	flush(): number {
		const completedTraces = Array.from(this.traces.entries()).filter(([_, t]) => t.status !== "running");

		for (const [id] of completedTraces) {
			this.traces.delete(id);
		}

		this.emit("trace:flushed", { count: completedTraces.length });
		return completedTraces.length;
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private generateId(): string {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getAllTraces(): ExecutionTrace[] {
		return Array.from(this.traces.values());
	}

	getActiveTraces(): ExecutionTrace[] {
		return Array.from(this.traces.values()).filter((t) => t.status === "running");
	}

	getCompletedTraces(): ExecutionTrace[] {
		return Array.from(this.traces.values()).filter((t) => t.status !== "running");
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clear(): void {
		this.traces.clear();
		this.activeSpans.clear();
	}

	destroy(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
		}
		this.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: ExecutionTracer | null = null;

export function getExecutionTracer(config?: Partial<ExecutionTracerConfig>): ExecutionTracer {
	if (!instance) {
		instance = new ExecutionTracer(config);
	}
	return instance;
}

export function resetExecutionTracer(): void {
	if (instance) {
		instance.destroy();
	}
	instance = null;
}
