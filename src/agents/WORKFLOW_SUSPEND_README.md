# Workflow Suspend/Resume System

VoltAgent-style suspend/resume capabilities for workflows. Enables workflows to pause execution and resume later with full state restoration.

## Features

- **Persistent State**: Suspended workflows saved to SQLite database
- **Automatic Expiration**: Optional TTL for suspended workflows
- **Resume with Input**: Inject new data when resuming
- **Query & Filter**: List suspended workflows by workflow ID, expiration status
- **Cleanup**: Automatic removal of expired suspensions
- **Database-backed**: Integrates with existing BotDatabase

## Files

### Core Implementation

- **`src/agents/workflow-suspend.ts`** - Main suspend/resume manager
  - `WorkflowSuspendManager` class
  - `SuspendedWorkflow` type with full state snapshot
  - Database persistence via `BotDatabase` methods

- **`src/agents/workflow-chains.ts`** - Enhanced Workflow class
  - `workflow.suspend(reason, expiresIn?, resumeInput?)` - Suspend a running workflow
  - `workflow.resumeFromSuspension(suspendId, input?)` - Resume from suspension

- **`src/database.ts`** - Database layer extensions
  - `suspended_workflows` table with indexes
  - Public methods for CRUD operations on suspended workflows
  - Statistics and cleanup methods

### Exports

All exports added to `src/agents/index.ts`:
```typescript
export {
  WorkflowSuspendManager,
  getWorkflowSuspendManager,
  disposeWorkflowSuspendManager,
  addSuspendMethods,
  createWorkflowSuspendTools,
  type SuspendedWorkflow,
  type SuspendOptions,
  type SuspendFilter,
  type ResumeResult,
  type WorkflowSuspendTool,
} from "./workflow-suspend.js";
```

## Usage Examples

### Basic Suspend/Resume

```typescript
import { createWorkflow, getWorkflowSuspendManager } from "./agents/index.js";

// Create a workflow
const workflow = createWorkflow("data-processing", [
  { agent: "collector", output: "raw_data" },
  { agent: "processor", input: "raw_data", output: "processed_data" },
  { agent: "validator", input: "processed_data", output: "validated_data" }
]);

// Start workflow with executor
await workflow.run(async (step, input, context) => {
  // Execute step
  return await executeStep(step, input);
});

// Suspend mid-execution (e.g., waiting for user approval)
const suspendId = await workflow.suspend(
  "Waiting for user approval",
  3600000,  // expires in 1 hour
  { approvalRequired: true }
);

console.log("Workflow suspended:", suspendId);

// Later, resume with approval
const manager = getWorkflowSuspendManager();
const result = await manager.resume(suspendId, { approved: true });

if (result.success) {
  console.log("Workflow resumed successfully");
  console.log("Final result:", result.result);
} else {
  console.error("Resume failed:", result.error);
}
```

### Query Suspended Workflows

```typescript
import { getWorkflowSuspendManager } from "./agents/index.js";

const manager = getWorkflowSuspendManager();

// List all active (non-expired) suspensions
const active = manager.list({ expired: false });

// List suspensions for specific workflow
const workflowSuspensions = manager.list({
  workflowId: "workflow-123",
  limit: 10
});

// Get specific suspension
const suspended = manager.getSuspended(suspendId);
if (suspended) {
  console.log("Step:", suspended.step);
  console.log("Reason:", suspended.reason);
  console.log("Expires at:", suspended.expiresAt);
}
```

### Cleanup Expired Suspensions

```typescript
import { getWorkflowSuspendManager } from "./agents/index.js";

const manager = getWorkflowSuspendManager();

// Remove expired suspensions
const removed = manager.cleanup();
console.log(`Removed ${removed} expired suspensions`);

// Get statistics
const stats = manager.getStats();
console.log("Total suspensions:", stats.total);
console.log("Active:", stats.active);
console.log("Expired:", stats.expired);
console.log("By workflow:", stats.byWorkflow);
```

### Workflow Methods (Convenience)

```typescript
import { createWorkflow } from "./agents/index.js";

const workflow = createWorkflow("my-workflow", steps);

// Suspend directly from workflow instance
const suspendId = await workflow.suspend("Waiting for external data", 1800000);

// Resume directly from workflow instance
const context = await workflow.resumeFromSuspension(suspendId, { data: "..." });
```

## Database Schema

The `suspended_workflows` table:

```sql
CREATE TABLE suspended_workflows (
  id TEXT PRIMARY KEY,              -- Unique suspension ID
  workflow_id TEXT NOT NULL,        -- Workflow being suspended
  step TEXT NOT NULL,               -- Current step ID
  state TEXT NOT NULL,              -- Full workflow state (JSON)
  reason TEXT NOT NULL,             -- Suspension reason
  suspended_at TEXT NOT NULL,       -- ISO timestamp
  expires_at TEXT DEFAULT NULL,     -- Optional expiration (ISO)
  resume_input TEXT DEFAULT NULL,   -- Optional input for resume (JSON)
  metadata TEXT DEFAULT NULL        -- Optional metadata (JSON)
);

CREATE INDEX idx_suspended_workflows_workflow_id ON suspended_workflows(workflow_id);
CREATE INDEX idx_suspended_workflows_suspended_at ON suspended_workflows(suspended_at);
CREATE INDEX idx_suspended_workflows_expires_at ON suspended_workflows(expires_at);
```

## MCP Tools

Workflow suspension tools for MCP integration:

```typescript
import { createWorkflowSuspendTools } from "./agents/index.js";

const tools = createWorkflowSuspendTools();

// Available tools:
// - workflow_suspend
// - workflow_resume_suspended
// - workflow_list_suspended
// - workflow_cleanup_suspended
// - workflow_suspend_status
// - workflow_delete_suspended
```

## Comparison: Pause vs Suspend

| Feature | `pause()` | `suspend()` |
|---------|-----------|-------------|
| State persistence | File only | Database + file |
| Expiration | No | Yes (optional TTL) |
| Resume input | No | Yes |
| Query/search | No | Yes |
| Metadata | No | Yes |
| Use case | Short-term pause | Long-term suspension |

## Integration with Existing Systems

### Stateful Agents

Workflows use `StatefulAgent` for checkpointing:

```typescript
const workflow = createWorkflow("my-workflow", steps);
await workflow.run(executor);

// Auto-checkpoint enabled by default
// Each step completion creates a git checkpoint
// Suspend/resume works alongside checkpoints
```

### Workflow Builder

```typescript
import { workflow } from "./agents/index.js";

const wf = workflow("data-pipeline")
  .step({ agent: "collector", output: "data" })
  .step({ agent: "processor", input: "data", output: "result" })
  .autoCheckpoint(true)
  .build();

// Suspend/resume available on built workflows
const suspendId = await wf.suspend("Pausing for maintenance", 7200000);
```

## Type Safety

All types are fully typed with TypeScript:

```typescript
interface SuspendedWorkflow {
  id: string;
  workflowId: string;
  step: string;
  state: Record<string, unknown>;
  reason: string;
  suspendedAt: Date;
  expiresAt: Date | null;
  resumeInput?: unknown;
  metadata?: Record<string, unknown>;
}

interface ResumeResult {
  success: boolean;
  result?: WorkflowContext;
  error?: string;
  suspended?: SuspendedWorkflow;
}
```

## Error Handling

```typescript
import { getWorkflowSuspendManager } from "./agents/index.js";

const manager = getWorkflowSuspendManager();

try {
  const result = await manager.resume(suspendId);

  if (!result.success) {
    // Handle known errors
    if (result.error?.includes("expired")) {
      console.log("Suspension expired");
    } else if (result.error?.includes("not found")) {
      console.log("Suspension not found");
    }
  }
} catch (error) {
  // Handle unexpected errors
  console.error("Resume failed:", error);
}
```

## Performance Considerations

- **Database indexes**: All queries use indexes for fast lookups
- **Singleton manager**: Single instance per process
- **Lazy imports**: Circular dependency avoidance with lazy imports
- **Cleanup**: Regular cleanup prevents database bloat

## Testing

Type check passes (except unrelated livekit issue):

```bash
npm run type-check
# All workflow-suspend types validated ✓
```

## Future Enhancements

Potential improvements:
- [ ] Webhook notifications on expiration
- [ ] Suspend/resume events for monitoring
- [ ] Workflow priority queue for resumption
- [ ] Multi-workflow batch operations
- [ ] Resume scheduling (cron-based)

---

**Implementation Date**: 2025-12-24
**Status**: ✅ Complete and integrated
**Breaking Changes**: None (additive only)
