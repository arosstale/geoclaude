# Tool Permissions System

Security-first tool execution control system inspired by ADA_V2. Blocks dangerous operations, enforces rate limiting, and provides granular per-channel/user permission overrides.

## Features

- **Dangerous Pattern Blocking**: Regex-based blocking of rm -rf, sudo, eval, fork bombs, etc.
- **Sensitive File Protection**: Prevents writes to .env, credentials, private keys, etc.
- **Rate Limiting**: Sliding window rate limits per tool/user
- **Custom Validators**: Tool-specific validation logic
- **Per-Channel/User Overrides**: Database-backed permission customization
- **Approval Workflow**: High-risk operations require human approval

## Quick Start

```typescript
import {
  checkToolExecution,
  initPermissionStore,
  getPermissionStore,
} from "./agents/index.js";
import { getDatabase } from "./database.js";

// Initialize store with database
const db = getDatabase();
initPermissionStore(db);

// Check if tool execution is allowed
const result = checkToolExecution("Bash", "user123", {
  command: "ls -la",
});

if (!result.allowed) {
  console.log(`Blocked: ${result.reason}`);
  return;
}

if (result.requiresApproval) {
  console.log(`Requires approval: ${result.reason}`);
  // Create approval request
  const store = getPermissionStore();
  const requestId = store.createApprovalRequest(
    "channel123",
    "user123",
    "Bash",
    { command: "ls -la" },
    "User wants to list files",
  );
  console.log(`Approval request created: ${requestId}`);
  return;
}

// Execute tool
console.log("Allowed - proceeding with execution");
```

## Security Patterns

### Dangerous Bash Commands (Blocked)

```bash
rm -rf /                  # Destructive file deletion
sudo rm -rf *             # Privileged deletion
chmod 777 /etc            # Dangerous permissions
:(){ :|:& };:             # Fork bomb
curl ... | bash           # Pipe to shell
eval $(...)               # Code injection
dd if=/dev/zero of=/dev/sda  # Disk wipe
```

### Sensitive Files (Blocked Writes)

```
.env
.env.production
credentials.json
private_key.pem
id_rsa
wallet.dat
*.secret
*_token
```

### SQL Injection Patterns

```sql
'; DROP TABLE users--
' OR 1=1--
UNION SELECT * FROM passwords
```

### Code Execution Patterns

```javascript
eval("malicious code")
exec("rm -rf /")
new Function("return process.env")
__import__("os").system("...")
```

## Permission Configuration

### Default Permissions

```typescript
import { DEFAULT_PERMISSIONS } from "./agents/index.js";

// HIGH RISK - Requires approval
DEFAULT_PERMISSIONS["Bash"].requiresApproval = true;
DEFAULT_PERMISSIONS["db_query"].requiresApproval = true;
DEFAULT_PERMISSIONS["execute_trade"].requiresApproval = true;

// MEDIUM RISK - Dangerous patterns only
DEFAULT_PERMISSIONS["Write"].requiresApproval = false;
DEFAULT_PERMISSIONS["web_scrape"].requiresApproval = false;

// LOW RISK - Rate limited only
DEFAULT_PERMISSIONS["memory_search"].requiresApproval = false;
```

### Custom Permissions

```typescript
import { getPermissionChecker } from "./agents/index.js";

const checker = getPermissionChecker();

// Add custom permission for new tool
checker.setPermission("custom_api", {
  tool: "custom_api",
  requiresApproval: false,
  dangerousPatterns: ["DELETE.*FROM"],
  rateLimit: { requests: 10, windowMs: 60000 },
  validator: (args) => {
    if (args.destructive) {
      return {
        allowed: false,
        reason: "Destructive operations not allowed",
      };
    }
    return { allowed: true };
  },
});
```

### Per-Channel Overrides

```typescript
import { getPermissionStore } from "./agents/index.js";

const store = getPermissionStore();

// Allow Bash without approval for specific channel
store.setOverride(
  "channel123",  // channel ID
  "*",           // all users
  "Bash",        // tool name
  {
    tool: "Bash",
    requiresApproval: false,  // Override: no approval needed
    dangerousPatterns: DANGEROUS_BASH_PATTERNS,
    blockedPatterns: ["rm -rf /"],  // Still block destructive
    rateLimit: { requests: 20, windowMs: 60000 },
  },
  "admin456",  // who created this override
);

// Restrict specific user globally
store.setOverride(
  "*",          // all channels
  "user789",    // specific user
  "Bash",
  {
    tool: "Bash",
    requiresApproval: true,
    rateLimit: { requests: 3, windowMs: 60000 },  // Stricter limit
  },
  "admin456",
);
```

## Rate Limiting

### Default Limits

```typescript
// Per tool, per user, sliding window
{
  Bash: { requests: 10, windowMs: 60000 },          // 10/min
  Write: { requests: 30, windowMs: 60000 },         // 30/min
  web_search: { requests: 20, windowMs: 60000 },    // 20/min
  execute_trade: { requests: 3, windowMs: 300000 }, // 3/5min
}
```

### Check Rate Limit Info

```typescript
import { getRateLimiter, getPermissionChecker } from "./agents/index.js";

const limiter = getRateLimiter();
const checker = getPermissionChecker();
const permission = checker.getPermission("Bash")!;

const info = limiter.getRateLimitInfo("Bash", "user123", permission);
if (info) {
  console.log(`Limited: ${info.limited}`);
  console.log(`Remaining: ${info.remaining} requests`);
  console.log(`Reset in: ${info.resetIn}ms`);
}
```

## Approval Workflow

### Create Approval Request

```typescript
import { getPermissionStore } from "./agents/index.js";

const store = getPermissionStore();

const requestId = store.createApprovalRequest(
  "channel123",
  "user456",
  "Bash",
  { command: "npm install risky-package" },
  "User wants to install unverified package",
);

console.log(`Created request: ${requestId}`);
```

### List Pending Approvals

```typescript
const pending = store.getPendingApprovals("channel123");

for (const request of pending) {
  console.log(`[${request.id}] ${request.tool}`);
  console.log(`  User: ${request.userId}`);
  console.log(`  Reason: ${request.reason}`);
  console.log(`  Args: ${JSON.stringify(request.args)}`);
}
```

### Approve/Reject

```typescript
// Approve
const approved = store.approveRequest(requestId, "admin789");
if (approved) {
  console.log("Request approved");
  // Execute the tool
}

// Reject
const rejected = store.rejectRequest(requestId, "admin789");
if (rejected) {
  console.log("Request rejected");
}
```

## Integration with Agent Tools

### Wrap Tool Execution

```typescript
import { checkToolExecution } from "./agents/index.js";

async function executeTool(
  toolName: string,
  userId: string,
  args: Record<string, any>,
): Promise<string> {
  // Check permissions
  const check = checkToolExecution(toolName, userId, args);

  if (!check.allowed) {
    throw new Error(`Permission denied: ${check.reason}`);
  }

  if (check.requiresApproval) {
    // Create approval request and throw
    const store = getPermissionStore();
    const requestId = store.createApprovalRequest(
      "channel",
      userId,
      toolName,
      args,
      check.reason || "Requires approval",
    );
    throw new Error(`Requires approval: ${requestId}`);
  }

  // Execute tool
  return await actualToolExecution(toolName, args);
}
```

### Discord Slash Command Example

```typescript
// /permissions approve <request_id>
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === "permissions") {
    const subcommand = interaction.options.getSubcommand();
    const store = getPermissionStore();

    if (subcommand === "approve") {
      const requestId = interaction.options.getString("request_id", true);
      const request = store.getApprovalRequest(requestId);

      if (!request) {
        await interaction.reply("Request not found");
        return;
      }

      // Check if user is admin
      if (!interaction.memberPermissions?.has("Administrator")) {
        await interaction.reply("Only admins can approve requests");
        return;
      }

      const approved = store.approveRequest(requestId, interaction.user.id);
      if (approved) {
        await interaction.reply(`Approved request: ${request.tool} for ${request.userId}`);
      }
    }
  }
});
```

## Best Practices

### 1. Defense in Depth

Always combine multiple security layers:

```typescript
checker.setPermission("critical_tool", {
  tool: "critical_tool",
  requiresApproval: true,              // Layer 1: Human approval
  blockedPatterns: ["DANGER"],          // Layer 2: Hard blocks
  dangerousPatterns: ["WARN"],          // Layer 3: Soft blocks
  rateLimit: { requests: 1, windowMs: 3600000 },  // Layer 4: Rate limit
  validator: (args) => {                // Layer 5: Custom logic
    if (args.amount > MAX_SAFE_AMOUNT) {
      return { allowed: false, reason: "Amount too high" };
    }
    return { allowed: true };
  },
});
```

### 2. Principle of Least Privilege

Start restrictive, grant exceptions as needed:

```typescript
// Default: Deny all
const DEFAULT_DENY: ToolPermission = {
  tool: "__default__",
  requiresApproval: true,
  rateLimit: { requests: 5, windowMs: 60000 },
};

// Grant specific permissions per channel/user
store.setOverride("trusted-channel", "*", "Bash", { ... });
```

### 3. Audit Trail

All overrides and approvals are logged in the database:

```sql
-- View who created which overrides
SELECT * FROM permission_overrides
WHERE created_by = 'admin123'
ORDER BY created_at DESC;

-- Track approval patterns
SELECT tool, status, COUNT(*) as count
FROM approval_requests
GROUP BY tool, status;
```

### 4. Regular Review

Prune old data and review permissions:

```typescript
// Clean up old approvals (keep only recent)
store.pruneOldApprovals(30);  // Delete resolved requests older than 30 days

// Review overrides
const overrides = store.listOverrides();
for (const override of overrides) {
  console.log(`${override.channelId}:${override.userId} - ${override.tool}`);
}
```

## API Reference

### PermissionChecker

```typescript
class PermissionChecker {
  checkPermission(tool: string, args: Record<string, any>): PermissionResult;
  setPermission(tool: string, permission: ToolPermission): void;
  getPermission(tool: string): ToolPermission | undefined;
  removePermission(tool: string): void;
}
```

### RateLimiter

```typescript
class RateLimiter {
  isRateLimited(tool: string, userId: string, permission: ToolPermission): boolean;
  getRemainingRequests(tool: string, userId: string, permission: ToolPermission): number;
  getRateLimitInfo(tool: string, userId: string, permission: ToolPermission): { ... } | null;
  clearRateLimit(tool: string, userId: string): void;
  clearAll(): void;
}
```

### PermissionStore

```typescript
class PermissionStore {
  getOverride(channelId: string, userId: string, tool: string): PermissionOverride | null;
  setOverride(channelId: string, userId: string, tool: string, permission: ToolPermission, createdBy: string): string;
  removeOverride(id: string): boolean;
  listOverrides(filters?: { ... }): PermissionOverride[];
  checkPermission(channelId: string, userId: string, tool: string, args: Record<string, any>): PermissionResult;

  createApprovalRequest(channelId: string, userId: string, tool: string, args: Record<string, any>, reason: string): string;
  getApprovalRequest(id: string): ApprovalRequest | null;
  getPendingApprovals(channelId?: string): ApprovalRequest[];
  approveRequest(id: string, resolvedBy: string): boolean;
  rejectRequest(id: string, resolvedBy: string): boolean;
  pruneOldApprovals(olderThanDays: number): number;
}
```

## Security Guarantees

1. **No Bypass**: Permission checks are applied before tool execution
2. **Immutable Blocks**: Blocked patterns cannot be overridden
3. **Audit Trail**: All overrides and approvals are logged with timestamps and creators
4. **Rate Limiting**: Sliding window prevents abuse
5. **Pattern Matching**: Regex-based security patterns catch variations
6. **Defense in Depth**: Multiple layers (blocks, approval, rate limits, validators)

## Common Patterns

### Trading Bot Safety

```typescript
checker.setPermission("execute_trade", {
  tool: "execute_trade",
  requiresApproval: true,
  rateLimit: { requests: 3, windowMs: 300000 },  // 3 trades per 5 minutes
  validator: (args) => {
    const amount = args.amount || 0;
    if (amount > 1000) {
      return { allowed: false, reason: "Trade amount exceeds $1000 limit" };
    }
    if (args.leverage && args.leverage > 3) {
      return { allowed: false, reason: "Leverage exceeds 3x limit" };
    }
    return { allowed: true };
  },
});
```

### Developer Sandbox

```typescript
// Allow unrestricted code execution in sandbox channel
store.setOverride(
  "sandbox-channel",
  "*",
  "code_sandbox",
  {
    tool: "code_sandbox",
    requiresApproval: false,
    rateLimit: { requests: 50, windowMs: 60000 },
    // Still block obviously malicious code
    blockedPatterns: ["fork bomb", "rm -rf /"],
  },
  "admin",
);
```

### Public Bot (Strict)

```typescript
// All tools require approval for unknown users
for (const tool of ["Bash", "Write", "Edit", "db_query"]) {
  store.setOverride("*", "*", tool, {
    tool,
    requiresApproval: true,
    rateLimit: { requests: 2, windowMs: 300000 },  // 2 per 5 minutes
  }, "system");
}
```
