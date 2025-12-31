/**
 * Tool Permissions System - Usage Examples
 * Run: npx tsx src/agents/tool-permissions.example.ts
 */

import { checkToolExecution, DEFAULT_PERMISSIONS, getPermissionChecker, getRateLimiter } from "./tool-permissions.js";

console.log("=== Tool Permissions System Examples ===\n");

// =============================================================================
// Example 1: Basic Permission Check
// =============================================================================

console.log("1. Basic Permission Check");
console.log("-------------------------");

const result1 = checkToolExecution("Bash", "user123", {
	command: "ls -la",
});
console.log(`Command: ls -la`);
console.log(`Allowed: ${result1.allowed}`);
console.log(`Requires Approval: ${result1.requiresApproval || false}`);
console.log();

// =============================================================================
// Example 2: Dangerous Command Blocked
// =============================================================================

console.log("2. Dangerous Command Blocked");
console.log("----------------------------");

const result2 = checkToolExecution("Bash", "user123", {
	command: "rm -rf /",
});
console.log(`Command: rm -rf /`);
console.log(`Allowed: ${result2.allowed}`);
console.log(`Reason: ${result2.reason}`);
console.log();

// =============================================================================
// Example 3: Sensitive File Write Blocked
// =============================================================================

console.log("3. Sensitive File Write Blocked");
console.log("-------------------------------");

const result3 = checkToolExecution("Write", "user456", {
	file_path: "/home/user/.env",
	content: "API_KEY=secret123",
});
console.log(`File: /home/user/.env`);
console.log(`Allowed: ${result3.allowed}`);
console.log(`Reason: ${result3.reason}`);
console.log();

// =============================================================================
// Example 4: Secret Detection in Content
// =============================================================================

console.log("4. Secret Detection in Content");
console.log("------------------------------");

const result4 = checkToolExecution("Write", "user789", {
	file_path: "/tmp/config.txt",
	content: "My API key is sk-1234567890abcdefghijklmnopqrstuvwxyz",
});
console.log(`File: /tmp/config.txt`);
console.log(`Allowed: ${result4.allowed}`);
console.log(`Reason: ${result4.reason}`);
console.log();

// =============================================================================
// Example 5: Custom Validator (Trading)
// =============================================================================

console.log("5. Custom Validator - Trading Safety");
console.log("------------------------------------");

const result5a = checkToolExecution("execute_trade", "trader1", {
	symbol: "BTC/USD",
	amount: 500,
	side: "BUY",
});
console.log(`Trade: BUY $500 BTC/USD`);
console.log(`Allowed: ${result5a.allowed}`);
console.log(`Requires Approval: ${result5a.requiresApproval || false}`);
console.log();

const result5b = checkToolExecution("execute_trade", "trader1", {
	symbol: "BTC/USD",
	amount: 5000, // Exceeds $1000 limit
	side: "BUY",
});
console.log(`Trade: BUY $5000 BTC/USD (exceeds limit)`);
console.log(`Allowed: ${result5b.allowed}`);
console.log(`Reason: ${result5b.reason}`);
console.log();

// =============================================================================
// Example 6: Rate Limiting
// =============================================================================

console.log("6. Rate Limiting");
console.log("----------------");

const limiter = getRateLimiter();
const checker = getPermissionChecker();
const bashPermission = checker.getPermission("Bash")!;

// Simulate multiple requests
for (let i = 0; i < 12; i++) {
	const result = checkToolExecution("Bash", "user999", {
		command: `echo "Request ${i + 1}"`,
	});

	if (!result.allowed) {
		const info = limiter.getRateLimitInfo("Bash", "user999", bashPermission);
		console.log(`Request ${i + 1}: BLOCKED (${result.reason})`);
		if (info) {
			console.log(`  Reset in: ${Math.ceil(info.resetIn / 1000)}s`);
		}
		break;
	}
	console.log(`Request ${i + 1}: OK (${limiter.getRemainingRequests("Bash", "user999", bashPermission)} remaining)`);
}
console.log();

// =============================================================================
// Example 7: Internal Network Access Blocked
// =============================================================================

console.log("7. Internal Network Access Blocked");
console.log("----------------------------------");

const result7 = checkToolExecution("web_scrape", "user111", {
	url: "http://localhost:3000/admin",
});
console.log(`URL: http://localhost:3000/admin`);
console.log(`Allowed: ${result7.allowed}`);
console.log(`Reason: ${result7.reason}`);
console.log();

// =============================================================================
// Example 8: SQL Injection Blocked
// =============================================================================

console.log("8. SQL Injection Blocked");
console.log("------------------------");

const result8 = checkToolExecution("db_query", "user222", {
	query: "SELECT * FROM users WHERE id = 1; DROP TABLE users;--",
});
console.log(`Query: SELECT * FROM users WHERE id = 1; DROP TABLE users;--`);
console.log(`Allowed: ${result8.allowed}`);
console.log(`Reason: ${result8.reason}`);
console.log();

// =============================================================================
// Example 9: Custom Permission for New Tool
// =============================================================================

console.log("9. Custom Permission for New Tool");
console.log("---------------------------------");

checker.setPermission("custom_api", {
	tool: "custom_api",
	requiresApproval: false,
	dangerousPatterns: ["DELETE"],
	rateLimit: { requests: 5, windowMs: 60000 },
});

const result9a = checkToolExecution("custom_api", "user333", {
	method: "GET",
	endpoint: "/users",
});
console.log(`API: GET /users`);
console.log(`Allowed: ${result9a.allowed}`);
console.log();

const result9b = checkToolExecution("custom_api", "user333", {
	method: "DELETE",
	endpoint: "/users/all",
});
console.log(`API: DELETE /users/all`);
console.log(`Allowed: ${result9b.allowed}`);
console.log(`Reason: ${result9b.reason}`);
console.log();

// =============================================================================
// Example 10: Whitelisted Safe Command
// =============================================================================

console.log("10. Whitelisted Safe Command");
console.log("----------------------------");

const result10 = checkToolExecution("Bash", "user444", {
	command: "git status",
});
console.log(`Command: git status`);
console.log(`Allowed: ${result10.allowed}`);
console.log(`Requires Approval: ${result10.requiresApproval || false}`);
console.log();

// =============================================================================
// Summary
// =============================================================================

console.log("=== Summary ===");
console.log(`Total default permissions: ${Object.keys(DEFAULT_PERMISSIONS).length}`);
console.log(`High-risk tools (require approval): Bash, db_query, execute_trade, openhands_run, expert_run`);
console.log(`Blocked patterns: rm -rf, fork bombs, sudo, chmod 777, eval, pipe to shell`);
console.log(`Sensitive files: .env, credentials.json, private keys, wallet.dat`);
console.log(`Rate limiting: Active for all tools (sliding window)`);
console.log();

console.log("See PERMISSIONS.md for full documentation");
