# Tool Permissions - Quick Reference

## Import

```typescript
import {
  checkToolExecution,
  getPermissionChecker,
  getRateLimiter,
  initPermissionStore,
  getPermissionStore,
} from "./agents/index.js";
```

## Basic Usage

```typescript
// 1. Initialize (once at startup)
const db = getDatabase();
initPermissionStore(db);

// 2. Check permission before tool execution
const result = checkToolExecution(toolName, userId, args);

if (!result.allowed) {
  throw new Error(`Blocked: ${result.reason}`);
}

if (result.requiresApproval) {
  const store = getPermissionStore();
  const requestId = store.createApprovalRequest(
    channelId, userId, toolName, args, result.reason || "Requires approval"
  );
  throw new Error(`Approval required: ${requestId}`);
}

// 3. Execute tool
await tool.execute(args);
```

## Blocked Patterns Cheat Sheet

### Bash (BLOCKED)
```
rm -rf /          sudo rm           chmod 777 /
:(){ :|:& };:     curl ... | bash   eval $(...)
dd if=/dev/zero   /etc/passwd       fork bombs
```

### Files (BLOCKED)
```
.env              credentials.json  id_rsa
private_key.pem   wallet.dat        *_token
*.secret          API keys          Private keys
```

### Web (BLOCKED)
```
localhost         127.0.0.1         file://
10.*              192.168.*         169.254.*
```

### SQL (BLOCKED)
```
DROP TABLE        TRUNCATE          '; DELETE FROM
UNION SELECT      OR 1=1            --
```

## Default Risk Levels

| Level | Tools | Approval? | Rate Limit |
|-------|-------|-----------|------------|
| **CRITICAL** | execute_trade | Yes | 3/5min |
| **HIGH** | Bash, db_query, code_sandbox, openhands_run, expert_run | Yes | 5-20/min or 10/hour |
| **MEDIUM** | Write, Edit, web_scrape | No | 15-30/min |
| **LOW** | memory_*, web_search | No | 20-100/min |

## Per-Channel Override

```typescript
const store = getPermissionStore();

// Allow Bash without approval in trusted channel
store.setOverride(
  "channel-123",  // channel ID
  "*",            // all users
  "Bash",         // tool
  {
    tool: "Bash",
    requiresApproval: false,  // OVERRIDE
    dangerousPatterns: DANGEROUS_BASH_PATTERNS,
    blockedPatterns: ["rm -rf /"],  // Still enforce hard blocks
    rateLimit: { requests: 20, windowMs: 60000 },
  },
  "admin-user-id"
);
```

## Approval Workflow

```typescript
const store = getPermissionStore();

// List pending
const pending = store.getPendingApprovals(channelId);

// Approve
const approved = store.approveRequest(requestId, adminUserId);
if (approved) {
  // Re-execute the tool
}

// Reject
const rejected = store.rejectRequest(requestId, adminUserId);
```

## Custom Tool Permission

```typescript
const checker = getPermissionChecker();

checker.setPermission("my_tool", {
  tool: "my_tool",
  requiresApproval: false,
  dangerousPatterns: ["DELETE"],
  blockedPatterns: ["DROP"],
  rateLimit: { requests: 10, windowMs: 60000 },
  validator: (args) => {
    if (args.dangerous) {
      return { allowed: false, reason: "Dangerous operation" };
    }
    return { allowed: true };
  },
});
```

## Rate Limit Info

```typescript
const limiter = getRateLimiter();
const checker = getPermissionChecker();
const permission = checker.getPermission("Bash")!;

const info = limiter.getRateLimitInfo("Bash", userId, permission);
if (info) {
  console.log(`Remaining: ${info.remaining}`);
  console.log(`Reset in: ${Math.ceil(info.resetIn / 1000)}s`);
}

// Clear rate limit (admin)
limiter.clearRateLimit("Bash", userId);
```

## Common Patterns

### Trading Bot Safety
```typescript
{
  tool: "execute_trade",
  requiresApproval: true,
  rateLimit: { requests: 3, windowMs: 300000 },
  validator: (args) => {
    if (args.amount > 1000) {
      return { allowed: false, reason: "Exceeds $1000 limit" };
    }
    return { allowed: true };
  },
}
```

### Developer Sandbox
```typescript
// Allow code execution in specific channel
store.setOverride("dev-channel", "*", "code_sandbox", {
  tool: "code_sandbox",
  requiresApproval: false,
  rateLimit: { requests: 50, windowMs: 60000 },
  blockedPatterns: ["rm -rf /"],  // Still block destructive
}, "admin");
```

### Restrict User Globally
```typescript
// Stricter limits for specific user across all channels
store.setOverride("*", "user-123", "Bash", {
  tool: "Bash",
  requiresApproval: true,
  rateLimit: { requests: 3, windowMs: 60000 },
}, "admin");
```

## Security Checklist

- [ ] Initialize permission store at startup
- [ ] Check permissions before every tool execution
- [ ] Handle approval requests properly
- [ ] Never bypass blocked patterns
- [ ] Log all permission denials
- [ ] Review overrides regularly
- [ ] Prune old approvals monthly
- [ ] Monitor rate limit violations

## Troubleshooting

**"Permission denied"** - Check DEFAULT_PERMISSIONS for tool rules

**"Rate limit exceeded"** - Wait for reset or increase limit via override

**"Blocked pattern detected"** - Command contains dangerous pattern, modify or request approval

**"Requires approval"** - High-risk operation, admin must approve via approval workflow

## Database Tables

```sql
permission_overrides (
  id, channel_id, user_id, tool,
  permission_json, created_at, created_by
)

approval_requests (
  id, channel_id, user_id, tool, args_json,
  reason, status, created_at, resolved_at, resolved_by
)
```

## API Summary

```typescript
// Check execution
checkToolExecution(tool: string, userId: string, args: object)
  → { allowed: boolean, reason?: string, requiresApproval?: boolean }

// Permission checker
getPermissionChecker().checkPermission(tool: string, args: object)
getPermissionChecker().setPermission(tool: string, permission: ToolPermission)

// Rate limiter
getRateLimiter().isRateLimited(tool: string, userId: string, permission: ToolPermission)
getRateLimiter().getRateLimitInfo(tool: string, userId: string, permission: ToolPermission)

// Permission store
getPermissionStore().getOverride(channelId: string, userId: string, tool: string)
getPermissionStore().setOverride(channelId, userId, tool, permission, createdBy)
getPermissionStore().createApprovalRequest(channelId, userId, tool, args, reason)
getPermissionStore().approveRequest(requestId: string, resolvedBy: string)
```

## Full Documentation

See `PERMISSIONS.md` for detailed examples and best practices.
