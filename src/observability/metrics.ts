/**
 * OpenTelemetry Metrics for Agent Performance Monitoring
 *
 * Provides counters, histograms, and gauges for tracking:
 * - Tool execution counts and success rates
 * - Response time distributions
 * - Active session counts
 *
 * Usage:
 *   import { metrics } from './observability/index.js';
 *
 *   metrics.recordToolExecution('search', 'success', 1234);
 *   metrics.recordResponseTime(1500);
 *   metrics.setActiveSessions(5);
 */

type Meter = any;
type Counter = any;
type Histogram = any;
type ObservableGauge = any;

let meterInstance: Meter | null = null;
let toolExecutionCounter: Counter | null = null;
let responseTimeHistogram: Histogram | null = null;
let activeSessionsGauge: ObservableGauge | null = null;
let activeSessionsValue = 0;

/**
 * Initialize OpenTelemetry Metrics
 * Called automatically on module load
 */
function initializeMetrics(): void {
	const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
	const serviceName = process.env.OTEL_SERVICE_NAME || "pi-discord-bot";

	if (!endpoint) {
		return; // Metrics disabled
	}

	try {
		const { MeterProvider, PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
		const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
		const { Resource } = require("@opentelemetry/resources");
		const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require("@opentelemetry/semantic-conventions");

		const resource = new Resource({
			[ATTR_SERVICE_NAME]: serviceName,
			[ATTR_SERVICE_VERSION]: process.env.npm_package_version || "unknown",
		});

		const metricExporter = new OTLPMetricExporter({
			url: `${endpoint}/v1/metrics`,
		});

		const metricReader = new PeriodicExportingMetricReader({
			exporter: metricExporter,
			exportIntervalMillis: 60000, // Export every 60 seconds
		});

		const meterProvider = new MeterProvider({
			resource,
			readers: [metricReader],
		});

		meterInstance = meterProvider.getMeter(serviceName);

		// Create tool execution counter
		toolExecutionCounter = meterInstance.createCounter("agent.tool.executions", {
			description: "Number of tool executions",
			unit: "1",
		});

		// Create response time histogram
		responseTimeHistogram = meterInstance.createHistogram("agent.response.time", {
			description: "Agent response time distribution",
			unit: "ms",
		});

		// Create active sessions gauge
		activeSessionsGauge = meterInstance.createObservableGauge("agent.sessions.active", {
			description: "Number of active agent sessions",
			unit: "1",
		});

		// Register callback for gauge
		activeSessionsGauge.addCallback((result: any) => {
			result.observe(activeSessionsValue);
		});

		console.log("[Metrics] OpenTelemetry metrics initialized");
	} catch (error) {
		console.warn(
			"[Metrics] OpenTelemetry metrics packages not installed:",
			error instanceof Error ? error.message : String(error),
		);
		console.warn(
			"[Metrics] To enable metrics, install: npm install @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http",
		);
	}
}

/**
 * Metrics API
 */
export const metrics = {
	/**
	 * Record a tool execution
	 *
	 * @param toolName - Name of the tool executed
	 * @param status - Execution status ('success' | 'error' | 'timeout')
	 * @param durationMs - Execution duration in milliseconds
	 *
	 * @example
	 * metrics.recordToolExecution('search', 'success', 1234);
	 */
	recordToolExecution(toolName: string, status: "success" | "error" | "timeout", durationMs?: number): void {
		if (!toolExecutionCounter) {
			return; // No-op when metrics unavailable
		}

		try {
			const attributes: Record<string, string | number> = {
				tool_name: toolName,
				status,
			};

			if (durationMs !== undefined) {
				attributes.duration_ms = durationMs;
			}

			toolExecutionCounter.add(1, attributes);
		} catch (error) {
			console.warn("[Metrics] Failed to record tool execution:", error);
		}
	},

	/**
	 * Record an agent response time
	 *
	 * @param durationMs - Response time in milliseconds
	 * @param attributes - Optional additional attributes
	 *
	 * @example
	 * metrics.recordResponseTime(1500, { model: 'gpt-4', channelId: '123' });
	 */
	recordResponseTime(durationMs: number, attributes?: Record<string, string | number>): void {
		if (!responseTimeHistogram) {
			return;
		}

		try {
			responseTimeHistogram.record(durationMs, attributes || {});
		} catch (error) {
			console.warn("[Metrics] Failed to record response time:", error);
		}
	},

	/**
	 * Set the number of active agent sessions
	 *
	 * @param count - Number of active sessions
	 *
	 * @example
	 * metrics.setActiveSessions(5);
	 */
	setActiveSessions(count: number): void {
		activeSessionsValue = count;
	},

	/**
	 * Increment active sessions count
	 *
	 * @example
	 * metrics.incrementActiveSessions();
	 */
	incrementActiveSessions(): void {
		activeSessionsValue++;
	},

	/**
	 * Decrement active sessions count
	 *
	 * @example
	 * metrics.decrementActiveSessions();
	 */
	decrementActiveSessions(): void {
		if (activeSessionsValue > 0) {
			activeSessionsValue--;
		}
	},

	/**
	 * Get current active sessions count
	 */
	getActiveSessions(): number {
		return activeSessionsValue;
	},

	/**
	 * Check if metrics are available
	 */
	isAvailable(): boolean {
		return toolExecutionCounter !== null;
	},
};

// Auto-initialize on module load
initializeMetrics();
