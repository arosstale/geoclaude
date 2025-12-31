/**
 * OpenTelemetry Distributed Tracing for Agent Observability
 *
 * This module provides tracing capabilities following the VoltAgent pattern.
 * It gracefully degrades to no-op when OpenTelemetry is not configured or packages are missing.
 *
 * Usage:
 *   import { traceAsync, traceSync, getTracer } from './observability/index.js';
 *
 *   await traceAsync('agent.execute', async () => {
 *     // Your async code here
 *   }, { agentId: 'my-agent', model: 'gpt-4' });
 *
 * Environment Variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT - OTLP endpoint (e.g., http://localhost:4318)
 *   OTEL_SERVICE_NAME - Service name (default: pi-discord-bot)
 */

type Tracer = any;
type Span = any;

let tracerInstance: Tracer | null = null;
let isInitialized = false;
let isAvailable = false;

/**
 * Initialize OpenTelemetry SDK
 * Only initializes if OTEL_EXPORTER_OTLP_ENDPOINT is set
 * Gracefully handles missing packages
 */
export function initializeTracing(): void {
	if (isInitialized) {
		return;
	}

	isInitialized = true;

	const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
	const serviceName = process.env.OTEL_SERVICE_NAME || "pi-discord-bot";

	if (!endpoint) {
		console.log("[Tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled");
		return;
	}

	try {
		// Dynamic imports to avoid crashes when packages are missing
		const otelSdk = require("@opentelemetry/sdk-node");
		const otelApi = require("@opentelemetry/api");
		const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
		const { Resource } = require("@opentelemetry/resources");
		const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require("@opentelemetry/semantic-conventions");

		const resource = new Resource({
			[ATTR_SERVICE_NAME]: serviceName,
			[ATTR_SERVICE_VERSION]: process.env.npm_package_version || "unknown",
		});

		const traceExporter = new OTLPTraceExporter({
			url: `${endpoint}/v1/traces`,
		});

		const sdk = new otelSdk.NodeSDK({
			resource,
			traceExporter,
		});

		sdk.start();
		console.log(`[Tracing] OpenTelemetry initialized: ${endpoint}`);

		// Store tracer instance
		tracerInstance = otelApi.trace.getTracer(serviceName);
		isAvailable = true;

		// Graceful shutdown
		process.on("SIGTERM", () => {
			sdk.shutdown()
				.then(() => console.log("[Tracing] SDK shut down successfully"))
				.catch((error: Error) => console.error("[Tracing] Error shutting down SDK", error));
		});
	} catch (error) {
		console.warn(
			"[Tracing] OpenTelemetry packages not installed or initialization failed:",
			error instanceof Error ? error.message : String(error),
		);
		console.warn(
			"[Tracing] To enable tracing, install: npm install @opentelemetry/sdk-node @opentelemetry/api @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions",
		);
	}
}

/**
 * Get the tracer instance
 * Returns null if tracing is not available
 */
export function getTracer(): Tracer | null {
	if (!isInitialized) {
		initializeTracing();
	}
	return tracerInstance;
}

/**
 * Check if tracing is available
 */
export function isTracingAvailable(): boolean {
	if (!isInitialized) {
		initializeTracing();
	}
	return isAvailable;
}

/**
 * Trace an async function with automatic span lifecycle management
 *
 * @param name - Span name (e.g., "agent.execute", "tool.call")
 * @param fn - Async function to trace
 * @param attributes - Optional span attributes (key-value pairs)
 * @returns Promise resolving to the function's return value
 *
 * @example
 * const result = await traceAsync('agent.processMessage', async () => {
 *   return await processMessage(msg);
 * }, { userId: '123', channelId: '456' });
 */
export async function traceAsync<T>(
	name: string,
	fn: () => Promise<T>,
	attributes?: Record<string, string | number | boolean>,
): Promise<T> {
	const tracer = getTracer();

	if (!tracer) {
		// No-op when tracing unavailable
		return fn();
	}

	try {
		// Import SpanStatusCode dynamically
		const { SpanStatusCode } = require("@opentelemetry/api");

		return await tracer.startActiveSpan(name, async (span: Span) => {
			try {
				// Set attributes if provided
				if (attributes) {
					for (const [key, value] of Object.entries(attributes)) {
						span.setAttribute(key, value);
					}
				}

				// Execute the function
				const result = await fn();

				// Mark span as successful
				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			} catch (error) {
				// Record error in span
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: error instanceof Error ? error.message : String(error),
				});
				span.recordException(error as Error);
				throw error;
			} finally {
				span.end();
			}
		});
	} catch (error) {
		// Fallback if require fails
		console.warn("[Tracing] Failed to trace async function:", error);
		return fn();
	}
}

/**
 * Trace a synchronous function with automatic span lifecycle management
 *
 * @param name - Span name
 * @param fn - Synchronous function to trace
 * @param attributes - Optional span attributes
 * @returns The function's return value
 *
 * @example
 * const result = traceSync('parser.parse', () => {
 *   return parseData(input);
 * }, { dataSize: input.length });
 */
export function traceSync<T>(name: string, fn: () => T, attributes?: Record<string, string | number | boolean>): T {
	const tracer = getTracer();

	if (!tracer) {
		// No-op when tracing unavailable
		return fn();
	}

	try {
		const { SpanStatusCode } = require("@opentelemetry/api");

		return tracer.startActiveSpan(name, (span: Span) => {
			try {
				if (attributes) {
					for (const [key, value] of Object.entries(attributes)) {
						span.setAttribute(key, value);
					}
				}

				const result = fn();
				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			} catch (error) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: error instanceof Error ? error.message : String(error),
				});
				span.recordException(error as Error);
				throw error;
			} finally {
				span.end();
			}
		});
	} catch (error) {
		console.warn("[Tracing] Failed to trace sync function:", error);
		return fn();
	}
}

/**
 * Add an event to the current active span
 *
 * @param name - Event name
 * @param attributes - Event attributes
 *
 * @example
 * addSpanEvent('tool.executed', { toolName: 'search', duration: 123 });
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
	try {
		const { trace } = require("@opentelemetry/api");
		const span = trace.getActiveSpan();
		if (span) {
			span.addEvent(name, attributes);
		}
	} catch (_error) {
		// Silent no-op if not available
	}
}

/**
 * Set attributes on the current active span
 *
 * @param attributes - Attributes to set
 *
 * @example
 * setSpanAttributes({ modelName: 'gpt-4', tokenCount: 1234 });
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
	try {
		const { trace } = require("@opentelemetry/api");
		const span = trace.getActiveSpan();
		if (span) {
			for (const [key, value] of Object.entries(attributes)) {
				span.setAttribute(key, value);
			}
		}
	} catch (_error) {
		// Silent no-op if not available
	}
}

// Auto-initialize on module load
initializeTracing();
