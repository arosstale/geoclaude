/**
 * Agent Observability Module
 *
 * Provides OpenTelemetry-based distributed tracing and metrics for agent monitoring.
 * Implements the VoltAgent observability pattern.
 *
 * Features:
 * - Distributed tracing with automatic span management
 * - Metrics for tool execution, response times, and active sessions
 * - Graceful degradation when OpenTelemetry is not configured
 * - Production-ready error handling
 *
 * Setup:
 *   1. Install OpenTelemetry packages (optional):
 *      npm install @opentelemetry/sdk-node @opentelemetry/api \
 *                  @opentelemetry/exporter-trace-otlp-http \
 *                  @opentelemetry/exporter-metrics-otlp-http \
 *                  @opentelemetry/sdk-metrics \
 *                  @opentelemetry/resources \
 *                  @opentelemetry/semantic-conventions
 *
 *   2. Set environment variables:
 *      OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *      OTEL_SERVICE_NAME=pi-discord-bot
 *
 *   3. Use tracing helpers in your code:
 *      import { traceAsync, metrics } from './observability/index.js';
 *
 *      await traceAsync('agent.execute', async () => {
 *        // Your code here
 *      }, { agentId: 'my-agent' });
 *
 *      metrics.recordToolExecution('search', 'success', 1234);
 *
 * Examples:
 *
 *   // Trace async operations
 *   const result = await traceAsync('agent.processMessage', async () => {
 *     return await processMessage(msg);
 *   }, { userId: '123', channelId: '456' });
 *
 *   // Trace sync operations
 *   const parsed = traceSync('parser.parse', () => {
 *     return JSON.parse(data);
 *   }, { dataSize: data.length });
 *
 *   // Record metrics
 *   metrics.recordToolExecution('web_search', 'success', 1234);
 *   metrics.recordResponseTime(1500, { model: 'gpt-4' });
 *   metrics.incrementActiveSessions();
 *
 *   // Add custom span events
 *   addSpanEvent('tool.started', { toolName: 'search' });
 *   setSpanAttributes({ confidence: 0.95 });
 */

// Metrics exports
export { metrics } from "./metrics.js";
// Tracing exports
export {
	addSpanEvent,
	getTracer,
	initializeTracing,
	isTracingAvailable,
	setSpanAttributes,
	traceAsync,
	traceSync,
} from "./tracing.js";

/**
 * Check if observability is fully configured
 */
export function isObservabilityEnabled(): boolean {
	return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

/**
 * Get observability status
 */
export function getObservabilityStatus(): {
	enabled: boolean;
	endpoint: string | undefined;
	serviceName: string;
} {
	return {
		enabled: isObservabilityEnabled(),
		endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
		serviceName: process.env.OTEL_SERVICE_NAME || "pi-discord-bot",
	};
}
