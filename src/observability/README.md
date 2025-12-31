# Agent Observability System

OpenTelemetry-based distributed tracing and metrics for agent monitoring, implementing the VoltAgent observability pattern.

## Features

- **Distributed Tracing**: Automatic span lifecycle management for async/sync operations
- **Metrics Collection**: Counters, histograms, and gauges for performance monitoring
- **Graceful Degradation**: No-op behavior when OpenTelemetry is not configured
- **Production Ready**: Comprehensive error handling and logging

## Installation

### 1. Install OpenTelemetry Packages (Optional)

```bash
npm install @opentelemetry/sdk-node \
            @opentelemetry/api \
            @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/exporter-metrics-otlp-http \
            @opentelemetry/sdk-metrics \
            @opentelemetry/resources \
            @opentelemetry/semantic-conventions
```

### 2. Configure Environment Variables

```bash
# OTLP endpoint (e.g., Jaeger, Tempo, or other OTLP-compatible backend)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Service name (optional, defaults to "pi-discord-bot")
export OTEL_SERVICE_NAME=pi-discord-bot
```

### 3. Use in Code

```typescript
import { traceAsync, traceSync, metrics } from './observability/index.js';
```

## Usage Examples

### Distributed Tracing

#### Trace Async Operations

```typescript
import { traceAsync } from './observability/index.js';

const result = await traceAsync('agent.processMessage', async () => {
  // Your async code here
  return await processMessage(msg);
}, {
  userId: '123',
  channelId: '456',
  model: 'gpt-4'
});
```

#### Trace Sync Operations

```typescript
import { traceSync } from './observability/index.js';

const parsed = traceSync('parser.parse', () => {
  return JSON.parse(data);
}, {
  dataSize: data.length
});
```

#### Add Custom Span Events and Attributes

```typescript
import { addSpanEvent, setSpanAttributes } from './observability/index.js';

// Inside a traced function
addSpanEvent('tool.started', { toolName: 'search' });
setSpanAttributes({ confidence: 0.95, tokenCount: 1234 });
```

### Metrics Collection

#### Record Tool Executions

```typescript
import { metrics } from './observability/index.js';

metrics.recordToolExecution('web_search', 'success', 1234);
metrics.recordToolExecution('code_edit', 'error', 5678);
```

#### Record Response Times

```typescript
const startTime = Date.now();
// ... agent processing ...
const duration = Date.now() - startTime;

metrics.recordResponseTime(duration, {
  model: 'gpt-4',
  channelId: '123'
});
```

#### Track Active Sessions

```typescript
// When session starts
metrics.incrementActiveSessions();

// When session ends
metrics.decrementActiveSessions();

// Or set directly
metrics.setActiveSessions(5);

// Query current count
const count = metrics.getActiveSessions();
```

## Integration Patterns

### Agent Execution Wrapper

```typescript
async function executeAgent(agentId: string, input: string) {
  return traceAsync('agent.execute', async () => {
    metrics.incrementActiveSessions();
    const startTime = Date.now();

    try {
      addSpanEvent('agent.started', { agentId });

      const result = await agent.run(input);

      addSpanEvent('agent.completed', {
        agentId,
        outputLength: result.length
      });

      const duration = Date.now() - startTime;
      metrics.recordResponseTime(duration, { agentId });

      return result;
    } finally {
      metrics.decrementActiveSessions();
    }
  }, {
    agent_id: agentId,
    input_length: input.length
  });
}
```

### Tool Execution Wrapper

```typescript
async function executeTool(toolName: string, args: any) {
  return traceAsync(`tool.${toolName}`, async () => {
    const startTime = Date.now();

    try {
      const result = await tool.execute(args);
      const duration = Date.now() - startTime;

      metrics.recordToolExecution(toolName, 'success', duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      metrics.recordToolExecution(toolName, 'error', duration);
      throw error;
    }
  }, {
    tool_name: toolName,
    arg_count: Object.keys(args).length
  });
}
```

## OpenTelemetry Backends

### Local Development (Jaeger)

```bash
# Run Jaeger all-in-one
docker run -d --name jaeger \
  -p 4318:4318 \
  -p 16686:16686 \
  jaegertracing/all-in-one:latest

# View traces at http://localhost:16686
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Production (Grafana Tempo)

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo.example.com:4318
```

### Cloud Providers

- **AWS X-Ray**: Use AWS Distro for OpenTelemetry
- **Google Cloud Trace**: Use Cloud Trace exporter
- **Azure Monitor**: Use Azure Monitor exporter

## Metrics Available

| Metric Name | Type | Description |
|-------------|------|-------------|
| `agent.tool.executions` | Counter | Number of tool executions with status |
| `agent.response.time` | Histogram | Agent response time distribution |
| `agent.sessions.active` | Gauge | Number of active agent sessions |

## Span Naming Convention

Follow the format: `{component}.{operation}`

Examples:
- `agent.execute` - Main agent execution
- `agent.processMessage` - Message processing
- `tool.web_search` - Tool execution
- `parser.parse` - Data parsing
- `db.query` - Database query

## Attributes Best Practices

**Standard Attributes:**
- `agent_id`: Agent identifier
- `user_id`: User identifier
- `channel_id`: Discord channel ID
- `model`: AI model name
- `tool_name`: Tool name
- `status`: Operation status

**Custom Attributes:**
- Use snake_case for attribute names
- Avoid high-cardinality values (e.g., timestamps, random IDs)
- Keep values short and meaningful

## Graceful Degradation

The observability system is designed to never crash your application:

1. **Package Missing**: Silently falls back to no-op if OpenTelemetry packages not installed
2. **Config Missing**: Disabled when `OTEL_EXPORTER_OTLP_ENDPOINT` not set
3. **Runtime Errors**: Caught and logged, original function continues normally

```typescript
// This NEVER throws even if OTEL is not configured
await traceAsync('operation', async () => {
  // Your code here - always executes
});
```

## Troubleshooting

### Tracing Not Working

1. Check environment variable:
   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   ```

2. Verify packages installed:
   ```bash
   npm list @opentelemetry/sdk-node
   ```

3. Check console output:
   ```
   [Tracing] OpenTelemetry initialized: http://localhost:4318
   ```

### Metrics Not Showing

1. Metrics export every 60 seconds by default
2. Check backend is receiving data
3. Verify endpoint URL includes `/v1/metrics`

### Performance Impact

- Tracing overhead: ~1-2ms per span
- Metrics overhead: ~0.1ms per recording
- Memory: ~10MB for SDK and buffers

## Advanced Usage

### Custom Tracer

```typescript
import { getTracer } from './observability/index.js';

const tracer = getTracer();
if (tracer) {
  const span = tracer.startSpan('custom.operation');
  try {
    // ... work ...
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

### Conditional Tracing

```typescript
import { isTracingAvailable } from './observability/index.js';

if (isTracingAvailable()) {
  // Expensive tracing-specific logic
  const metadata = collectExpensiveMetadata();
  setSpanAttributes(metadata);
}
```

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [VoltAgent Pattern](https://github.com/voltagent/voltagent)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
