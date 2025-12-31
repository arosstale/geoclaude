/**
 * Example usage of the observability system
 *
 * This file demonstrates how to integrate tracing and metrics
 * into your agent code.
 *
 * To run with actual telemetry:
 *   1. Start Jaeger: docker run -d -p4318:4318 -p16686:16686 jaegertracing/all-in-one
 *   2. Set env: export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   3. Run this file: tsx src/observability/example.ts
 *   4. View traces: http://localhost:16686
 */

import { addSpanEvent, getObservabilityStatus, metrics, setSpanAttributes, traceAsync, traceSync } from "./index.js";

/**
 * Example: Traced agent execution
 */
async function executeAgent(agentId: string, userMessage: string): Promise<string> {
	return traceAsync(
		"agent.execute",
		async () => {
			metrics.incrementActiveSessions();

			try {
				addSpanEvent("agent.started", { agentId });
				setSpanAttributes({
					agent_id: agentId,
					message_length: userMessage.length,
				});

				// Simulate agent processing
				const tools = await discoverTools();
				addSpanEvent("tools.discovered", { tool_count: tools.length });

				const response = await processMessage(userMessage, tools);

				addSpanEvent("agent.completed", {
					response_length: response.length,
				});

				return response;
			} finally {
				metrics.decrementActiveSessions();
			}
		},
		{
			agent_id: agentId,
			user_message_preview: userMessage.substring(0, 50),
		},
	);
}

/**
 * Example: Traced tool discovery
 */
async function discoverTools(): Promise<string[]> {
	return traceAsync(
		"tools.discover",
		async () => {
			// Simulate async tool discovery
			await sleep(100);
			const tools = ["web_search", "file_read", "code_edit"];

			setSpanAttributes({
				tool_count: tools.length,
			});

			return tools;
		},
		{
			source: "mcp",
		},
	);
}

/**
 * Example: Traced message processing with tool calls
 */
async function processMessage(message: string, tools: string[]): Promise<string> {
	return traceAsync(
		"agent.processMessage",
		async () => {
			// Simulate choosing a tool
			const selectedTool = traceSync(
				"tool.select",
				() => {
					return tools[0]; // Simple selection logic
				},
				{
					available_tools: tools.length,
				},
			);

			addSpanEvent("tool.selected", { tool_name: selectedTool });

			// Execute the tool
			const toolResult = await executeTool(selectedTool, { query: message });

			// Generate response
			const response = `Used ${selectedTool}: ${toolResult}`;

			return response;
		},
		{
			message_length: message.length,
			tool_count: tools.length,
		},
	);
}

/**
 * Example: Traced tool execution with metrics
 */
async function executeTool(toolName: string, args: Record<string, any>): Promise<string> {
	return traceAsync(
		`tool.${toolName}`,
		async () => {
			const startTime = Date.now();

			try {
				addSpanEvent("tool.started", { tool_name: toolName });

				// Simulate tool execution
				await sleep(200);
				const result = `Result from ${toolName}`;

				const duration = Date.now() - startTime;

				addSpanEvent("tool.completed", {
					tool_name: toolName,
					duration_ms: duration,
				});

				// Record metrics
				metrics.recordToolExecution(toolName, "success", duration);

				return result;
			} catch (error) {
				const duration = Date.now() - startTime;
				metrics.recordToolExecution(toolName, "error", duration);
				throw error;
			}
		},
		{
			tool_name: toolName,
			arg_count: Object.keys(args).length,
		},
	);
}

/**
 * Example: Sync tracing for fast operations
 */
function parseInput(input: string): any {
	return traceSync(
		"parser.parse",
		() => {
			try {
				return JSON.parse(input);
			} catch {
				return { raw: input };
			}
		},
		{
			input_length: input.length,
		},
	);
}

// Helper
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main example execution
 */
async function main() {
	console.log("\n🔍 Observability Example\n");

	const status = getObservabilityStatus();
	console.log("Status:", status);

	if (!status.enabled) {
		console.log("\n⚠️  OpenTelemetry is not configured.");
		console.log("To enable, set: export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318");
		console.log("Continuing with no-op mode...\n");
	} else {
		console.log(`\n✅ Tracing to: ${status.endpoint}`);
		console.log(`📊 Service: ${status.serviceName}\n`);
	}

	// Execute some traced operations
	console.log("Executing traced agent...");
	const response = await executeAgent("example-agent", "What is the weather?");
	console.log("Response:", response);

	// Parse some data
	console.log("\nParsing JSON...");
	const parsed = parseInput('{"test": true}');
	console.log("Parsed:", parsed);

	// Record some metrics
	const startTime = Date.now();
	await sleep(500);
	const duration = Date.now() - startTime;

	metrics.recordResponseTime(duration, {
		agent_id: "example-agent",
		model: "gpt-4",
	});

	// Show metrics state
	console.log("\n📊 Metrics:");
	console.log(`Active sessions: ${metrics.getActiveSessions()}`);
	console.log(`Metrics available: ${metrics.isAvailable()}`);

	console.log("\n✨ Example complete!");

	if (status.enabled) {
		console.log("\n👉 View traces at: http://localhost:16686");
		console.log("   (if using Jaeger)");
	}

	// Give time for metrics to export
	await sleep(2000);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}
