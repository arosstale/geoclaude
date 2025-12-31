/**
 * Tool Permissions System
 * Inspired by ADA_V2 for security-first agent execution
 * Blocks dangerous operations and enforces rate limiting
 */

// =============================================================================
// Types
// =============================================================================

export interface ToolPermission {
	/** Tool name (matches AgentTool.name) */
	tool: string;
	/** Whether this tool requires human approval before execution */
	requiresApproval: boolean;
	/** Dangerous patterns to block (regex strings) */
	dangerousPatterns?: string[];
	/** Patterns to always block (no exceptions) */
	blockedPatterns?: string[];
	/** Patterns that are explicitly allowed (overrides dangerous) */
	allowedPatterns?: string[];
	/** Rate limit configuration */
	rateLimit?: {
		requests: number;
		windowMs: number;
	};
	/** Optional custom validator function */
	validator?: (args: Record<string, any>) => PermissionResult;
}

export interface PermissionResult {
	/** Whether the operation is allowed */
	allowed: boolean;
	/** Human-readable reason for denial */
	reason?: string;
	/** Whether human approval is required */
	requiresApproval?: boolean;
	/** Sanitized/modified arguments (if needed) */
	sanitizedArgs?: Record<string, any>;
}

export interface RateLimitEntry {
	timestamps: number[];
	userId: string;
	tool: string;
}

// =============================================================================
// Dangerous Patterns (Security)
// =============================================================================

/** Common dangerous bash patterns */
const DANGEROUS_BASH_PATTERNS = [
	// Destructive operations
	"rm\\s+-rf\\s+/",
	"rm\\s+-rf\\s+\\*",
	"rm\\s+-rf\\s+~",
	"rm\\s+-fr\\s+/",
	"rm\\s+-rf\\s+\\.",
	":\\(\\)\\{\\s*:\\|:\\&\\s*\\}\\s*;\\s*:", // fork bomb
	"dd\\s+if=/dev/zero\\s+of=/dev/sda",
	"mkfs\\.ext[34]\\s+/dev/sda",
	"dd\\s+if=/dev/random",

	// Privilege escalation
	"sudo\\s+rm",
	"sudo\\s+chmod\\s+777",
	"sudo\\s+chown\\s+root",
	"sudo\\s+bash",
	"sudo\\s+su",
	"chmod\\s+-R\\s+777",
	"chmod\\s+777\\s+/",

	// Network attacks
	"curl\\s+.*\\|\\s*bash",
	"wget\\s+.*\\|\\s*bash",
	"curl\\s+.*\\|\\s*sh",
	"wget\\s+.*\\|\\s*sh",
	"curl.*--data-urlencode",

	// Code injection
	"eval\\s*\\(",
	"exec\\s*\\(",
	"\\$\\(curl",
	"\\$\\(wget",
	"`;.*`",

	// System modification
	"/etc/passwd",
	"/etc/shadow",
	"/etc/sudoers",
	"crontab\\s+-e",
	"systemctl\\s+disable",

	// Cryptocurrency miners
	"xmrig",
	"minerd",
	"cpuminer",
	"stratum\\+tcp",
];

/** Sensitive file patterns to block writes */
const SENSITIVE_FILE_PATTERNS = [
	"\\.env$",
	"\\.env\\..*$",
	"credentials\\.json$",
	".*[kK]ey$",
	".*[kK]ey\\.json$",
	".*[sS]ecret.*",
	".*[tT]oken.*",
	"id_rsa",
	"id_ed25519",
	"\\.ssh/",
	"\\.aws/credentials",
	"\\.gnupg/",
	"wallet\\.dat$",
	"keystore",
	"private.*\\.pem$",
];

/** SQL injection patterns */
const SQL_INJECTION_PATTERNS = [
	"';\\s*DROP\\s+TABLE",
	"';\\s*DELETE\\s+FROM",
	"';\\s*UPDATE\\s+.*SET",
	"UNION\\s+SELECT",
	"OR\\s+1\\s*=\\s*1",
	"OR\\s+'1'\\s*=\\s*'1'",
];

/** Code execution patterns in various languages */
const CODE_EXECUTION_PATTERNS = [
	"eval\\s*\\(",
	"exec\\s*\\(",
	"__import__\\s*\\(",
	"compile\\s*\\(",
	"execfile\\s*\\(",
	"new\\s+Function\\s*\\(",
	"setTimeout\\s*\\(.*String",
	"setInterval\\s*\\(.*String",
];

// =============================================================================
// Default Permission Rules
// =============================================================================

export const DEFAULT_PERMISSIONS: Record<string, ToolPermission> = {
	// ===== Bash Execution (HIGH RISK) =====
	Bash: {
		tool: "Bash",
		requiresApproval: true,
		dangerousPatterns: DANGEROUS_BASH_PATTERNS,
		blockedPatterns: [
			"rm\\s+-rf\\s+/",
			":\\(\\)\\{", // fork bomb
			"sudo\\s+rm",
			"chmod\\s+777\\s+/",
			"/etc/passwd",
			"/etc/shadow",
		],
		allowedPatterns: [
			"^ls\\s",
			"^pwd$",
			"^echo\\s",
			"^cat\\s",
			"^grep\\s",
			"^find\\s",
			"^git\\s+status",
			"^git\\s+log",
			"^npm\\s+list",
		],
		rateLimit: { requests: 10, windowMs: 60000 }, // 10 per minute
	},

	// ===== File Operations (MEDIUM RISK) =====
	Write: {
		tool: "Write",
		requiresApproval: false,
		dangerousPatterns: SENSITIVE_FILE_PATTERNS,
		blockedPatterns: ["\\.env$", "credentials\\.json$", "id_rsa$", "wallet\\.dat$"],
		rateLimit: { requests: 30, windowMs: 60000 }, // 30 per minute
	},

	Edit: {
		tool: "Edit",
		requiresApproval: false,
		dangerousPatterns: [...SENSITIVE_FILE_PATTERNS, ...CODE_EXECUTION_PATTERNS],
		blockedPatterns: ["\\.env$", "id_rsa$"],
		rateLimit: { requests: 30, windowMs: 60000 },
	},

	// ===== Web Requests (MEDIUM RISK) =====
	web_search: {
		tool: "web_search",
		requiresApproval: false,
		rateLimit: { requests: 20, windowMs: 60000 }, // 20 per minute
	},

	web_scrape: {
		tool: "web_scrape",
		requiresApproval: false,
		rateLimit: { requests: 15, windowMs: 60000 }, // 15 per minute
		dangerousPatterns: [
			"file://",
			"localhost",
			"127\\.0\\.0\\.1",
			"0\\.0\\.0\\.0",
			"169\\.254\\.",
			"10\\.0\\.",
			"192\\.168\\.",
		],
	},

	// ===== Database Operations (HIGH RISK) =====
	db_query: {
		tool: "db_query",
		requiresApproval: true,
		dangerousPatterns: SQL_INJECTION_PATTERNS,
		blockedPatterns: ["DROP\\s+TABLE", "DROP\\s+DATABASE", "TRUNCATE\\s+TABLE"],
		rateLimit: { requests: 20, windowMs: 60000 },
	},

	// ===== Code Execution (HIGH RISK) =====
	code_sandbox: {
		tool: "code_sandbox",
		requiresApproval: true,
		dangerousPatterns: [...CODE_EXECUTION_PATTERNS, ...DANGEROUS_BASH_PATTERNS],
		rateLimit: { requests: 5, windowMs: 60000 }, // 5 per minute
	},

	// ===== Trading (CRITICAL RISK) =====
	execute_trade: {
		tool: "execute_trade",
		requiresApproval: true,
		rateLimit: { requests: 3, windowMs: 300000 }, // 3 per 5 minutes
		validator: (args) => {
			const amount = args.amount || args.size || 0;
			if (amount > 1000) {
				return {
					allowed: false,
					reason: "Trade amount exceeds safety limit ($1000)",
				};
			}
			return { allowed: true };
		},
	},

	// ===== Memory Operations (LOW RISK) =====
	memory_add: {
		tool: "memory_add",
		requiresApproval: false,
		rateLimit: { requests: 50, windowMs: 60000 },
	},

	memory_search: {
		tool: "memory_search",
		requiresApproval: false,
		rateLimit: { requests: 100, windowMs: 60000 },
	},

	// ===== GitHub Operations (MEDIUM RISK) =====
	github_create_issue: {
		tool: "github_create_issue",
		requiresApproval: false,
		rateLimit: { requests: 10, windowMs: 3600000 }, // 10 per hour
	},

	github_create_pr: {
		tool: "github_create_pr",
		requiresApproval: true,
		rateLimit: { requests: 5, windowMs: 3600000 }, // 5 per hour
	},

	// ===== OpenHands (CODE MODIFICATION - HIGH RISK) =====
	openhands_run: {
		tool: "openhands_run",
		requiresApproval: true,
		rateLimit: { requests: 10, windowMs: 3600000 }, // 10 per hour
	},

	// ===== Agent Experts (CODE MODIFICATION - HIGH RISK) =====
	expert_run: {
		tool: "expert_run",
		requiresApproval: true,
		rateLimit: { requests: 10, windowMs: 3600000 },
	},

	// ===== Default for unknown tools =====
	__default__: {
		tool: "__default__",
		requiresApproval: false,
		rateLimit: { requests: 50, windowMs: 60000 },
	},
};

// =============================================================================
// Permission Checker
// =============================================================================

export class PermissionChecker {
	private permissions: Map<string, ToolPermission>;

	constructor(customPermissions?: Record<string, ToolPermission>) {
		this.permissions = new Map(
			Object.entries({
				...DEFAULT_PERMISSIONS,
				...customPermissions,
			}),
		);
	}

	/**
	 * Check if a tool execution is permitted
	 */
	checkPermission(tool: string, args: Record<string, any>): PermissionResult {
		const permission = this.permissions.get(tool) || this.permissions.get("__default__")!;

		// Custom validator takes precedence
		if (permission.validator) {
			const customResult = permission.validator(args);
			if (!customResult.allowed) {
				return customResult;
			}
		}

		// Check blocked patterns (hard block)
		if (permission.blockedPatterns) {
			const blockedMatch = this.checkPatterns(args, permission.blockedPatterns);
			if (blockedMatch) {
				return {
					allowed: false,
					reason: `Blocked pattern detected: ${blockedMatch.pattern} in ${blockedMatch.field}`,
				};
			}
		}

		// Check dangerous patterns
		if (permission.dangerousPatterns) {
			const dangerousMatch = this.checkPatterns(args, permission.dangerousPatterns);
			if (dangerousMatch) {
				// Check if allowed by whitelist
				if (permission.allowedPatterns) {
					const allowedMatch = this.checkPatterns(args, permission.allowedPatterns);
					if (!allowedMatch) {
						return {
							allowed: false,
							requiresApproval: true,
							reason: `Dangerous pattern detected: ${dangerousMatch.pattern} in ${dangerousMatch.field}`,
						};
					}
				} else {
					return {
						allowed: false,
						requiresApproval: true,
						reason: `Dangerous pattern detected: ${dangerousMatch.pattern} in ${dangerousMatch.field}`,
					};
				}
			}
		}

		// Tool-specific checks
		if (tool === "Bash") {
			return this.checkBashCommand(args);
		} else if (tool === "Write" || tool === "Edit") {
			return this.checkFileOperation(args);
		} else if (tool === "web_scrape") {
			return this.checkWebRequest(args);
		}

		// Approval required?
		if (permission.requiresApproval) {
			return {
				allowed: true,
				requiresApproval: true,
				reason: `Tool '${tool}' requires human approval`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Check patterns in all argument values
	 */
	private checkPatterns(
		args: Record<string, any>,
		patterns: string[],
	): { pattern: string; field: string; value: string } | null {
		for (const [key, value] of Object.entries(args)) {
			const strValue = String(value);
			for (const pattern of patterns) {
				const regex = new RegExp(pattern, "i");
				if (regex.test(strValue)) {
					return { pattern, field: key, value: strValue };
				}
			}
		}
		return null;
	}

	/**
	 * Bash command security checks
	 */
	private checkBashCommand(args: Record<string, any>): PermissionResult {
		const command = args.command || "";

		// Check for command chaining with dangerous commands
		if (command.includes("&&") || command.includes(";") || command.includes("|")) {
			const parts = command.split(/[;&|]+/);
			for (const part of parts) {
				const trimmed = part.trim();
				if (trimmed.startsWith("rm ") || trimmed.startsWith("sudo ") || trimmed.includes("chmod 777")) {
					return {
						allowed: false,
						reason: "Command chaining with dangerous operations is blocked",
					};
				}
			}
		}

		// Check for pipe to bash/sh
		if (/\|\s*(ba)?sh\s*$/.test(command)) {
			return {
				allowed: false,
				reason: "Piping to shell is blocked for security",
			};
		}

		// Check for background execution of dangerous commands
		if (command.includes("&") && !command.includes("&&")) {
			const bgCommand = command.split("&")[0].trim();
			if (bgCommand.includes("rm ") || bgCommand.includes("sudo ")) {
				return {
					allowed: false,
					reason: "Background execution of dangerous commands is blocked",
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * File operation security checks
	 */
	private checkFileOperation(args: Record<string, any>): PermissionResult {
		const filePath = args.file_path || args.path || "";

		// Check for path traversal
		if (filePath.includes("../") || filePath.includes("..\\")) {
			return {
				allowed: false,
				reason: "Path traversal detected in file path",
			};
		}

		// Check for absolute system paths
		const systemPaths = ["/etc/", "/sys/", "/proc/", "/dev/", "/root/"];
		for (const sysPath of systemPaths) {
			if (filePath.startsWith(sysPath)) {
				return {
					allowed: false,
					reason: `Writing to system directory '${sysPath}' is blocked`,
				};
			}
		}

		// Check file content for secrets
		const content = args.content || args.new_string || "";
		const secretPatterns = [
			/sk-[a-zA-Z0-9]{32,}/i, // OpenAI API keys
			/ghp_[a-zA-Z0-9]{36}/i, // GitHub personal access tokens
			/gho_[a-zA-Z0-9]{36}/i, // GitHub OAuth tokens
			/xox[baprs]-[a-zA-Z0-9-]+/i, // Slack tokens
			/AIza[a-zA-Z0-9_-]{35}/i, // Google API keys
			/AKIA[A-Z0-9]{16}/i, // AWS access keys
			/-----BEGIN (RSA|DSA|EC) PRIVATE KEY-----/i, // Private keys
		];

		for (const pattern of secretPatterns) {
			if (pattern.test(content)) {
				return {
					allowed: false,
					reason: "Potential secret or API key detected in file content",
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Web request security checks
	 */
	private checkWebRequest(args: Record<string, any>): PermissionResult {
		const url = args.url || "";

		// Block internal network access
		const internalPatterns = [
			/^file:\/\//i,
			/^(localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
			/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/i, // Private networks
			/^169\.254\./i, // Link-local
		];

		for (const pattern of internalPatterns) {
			if (pattern.test(url)) {
				return {
					allowed: false,
					reason: "Access to internal/local network is blocked",
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Add or update a permission rule
	 */
	setPermission(tool: string, permission: ToolPermission): void {
		this.permissions.set(tool, permission);
	}

	/**
	 * Get permission for a tool
	 */
	getPermission(tool: string): ToolPermission | undefined {
		return this.permissions.get(tool);
	}

	/**
	 * Remove a permission rule
	 */
	removePermission(tool: string): void {
		this.permissions.delete(tool);
	}
}

// =============================================================================
// Rate Limiter
// =============================================================================

export class RateLimiter {
	private limits: Map<string, RateLimitEntry[]> = new Map();

	/**
	 * Check if a request is rate limited
	 */
	isRateLimited(tool: string, userId: string, permission: ToolPermission): boolean {
		if (!permission.rateLimit) {
			return false;
		}

		const { requests, windowMs } = permission.rateLimit;
		const key = `${tool}:${userId}`;
		const now = Date.now();
		const windowStart = now - windowMs;

		// Get or create entry list for this key
		let entries = this.limits.get(key);
		if (!entries) {
			entries = [];
			this.limits.set(key, entries);
		}

		// Remove expired entries (sliding window)
		const validEntries = entries.filter((e) => e.timestamps.some((ts) => ts >= windowStart));

		// Update timestamps for valid entries
		for (const entry of validEntries) {
			entry.timestamps = entry.timestamps.filter((ts) => ts >= windowStart);
		}

		// Count requests in window
		const requestCount = validEntries.reduce((sum, e) => sum + e.timestamps.length, 0);

		if (requestCount >= requests) {
			return true;
		}

		// Add new timestamp
		if (validEntries.length === 0) {
			validEntries.push({ timestamps: [now], userId, tool });
		} else {
			validEntries[0].timestamps.push(now);
		}

		this.limits.set(key, validEntries);
		return false;
	}

	/**
	 * Get remaining requests in window
	 */
	getRemainingRequests(tool: string, userId: string, permission: ToolPermission): number {
		if (!permission.rateLimit) {
			return Infinity;
		}

		const { requests, windowMs } = permission.rateLimit;
		const key = `${tool}:${userId}`;
		const now = Date.now();
		const windowStart = now - windowMs;

		const entries = this.limits.get(key) || [];
		const validEntries = entries.filter((e) => e.timestamps.some((ts) => ts >= windowStart));

		const requestCount = validEntries.reduce(
			(sum, e) => sum + e.timestamps.filter((ts) => ts >= windowStart).length,
			0,
		);

		return Math.max(0, requests - requestCount);
	}

	/**
	 * Clear rate limit for a user/tool
	 */
	clearRateLimit(tool: string, userId: string): void {
		const key = `${tool}:${userId}`;
		this.limits.delete(key);
	}

	/**
	 * Clear all rate limits (admin)
	 */
	clearAll(): void {
		this.limits.clear();
	}

	/**
	 * Get rate limit info
	 */
	getRateLimitInfo(
		tool: string,
		userId: string,
		permission: ToolPermission,
	): {
		limited: boolean;
		remaining: number;
		resetIn: number;
	} | null {
		if (!permission.rateLimit) {
			return null;
		}

		const { windowMs } = permission.rateLimit;
		const key = `${tool}:${userId}`;
		const entries = this.limits.get(key) || [];
		const now = Date.now();

		if (entries.length === 0) {
			return {
				limited: false,
				remaining: permission.rateLimit.requests,
				resetIn: 0,
			};
		}

		const oldestTimestamp = Math.min(...entries.flatMap((e) => e.timestamps));
		const resetIn = Math.max(0, oldestTimestamp + windowMs - now);

		return {
			limited: this.isRateLimited(tool, userId, permission),
			remaining: this.getRemainingRequests(tool, userId, permission),
			resetIn,
		};
	}
}

// =============================================================================
// Singleton Instances
// =============================================================================

let globalChecker: PermissionChecker | null = null;
let globalLimiter: RateLimiter | null = null;

export function getPermissionChecker(customPermissions?: Record<string, ToolPermission>): PermissionChecker {
	if (!globalChecker) {
		globalChecker = new PermissionChecker(customPermissions);
	}
	return globalChecker;
}

export function getRateLimiter(): RateLimiter {
	if (!globalLimiter) {
		globalLimiter = new RateLimiter();
	}
	return globalLimiter;
}

/**
 * Check tool permission and rate limit
 */
export function checkToolExecution(
	tool: string,
	userId: string,
	args: Record<string, any>,
): { allowed: boolean; reason?: string; requiresApproval?: boolean } {
	const checker = getPermissionChecker();
	const limiter = getRateLimiter();

	// Check permissions first
	const permResult = checker.checkPermission(tool, args);
	if (!permResult.allowed) {
		return permResult;
	}

	// Check rate limit
	const permission = checker.getPermission(tool) || DEFAULT_PERMISSIONS.__default__;
	if (limiter.isRateLimited(tool, userId, permission)) {
		const info = limiter.getRateLimitInfo(tool, userId, permission);
		const resetMin = info ? Math.ceil(info.resetIn / 60000) : 0;
		return {
			allowed: false,
			reason: `Rate limit exceeded. Try again in ${resetMin} minute${resetMin !== 1 ? "s" : ""}.`,
		};
	}

	return permResult;
}

// =============================================================================
// Mario Zechner Minimalist Mode (4 Tools Only)
// =============================================================================

/**
 * Mario Zechner's 4 core tools
 * "If I don't need it, it won't be built"
 */
export const MARIO_CORE_TOOLS = ["Read", "Write", "Edit", "Bash"] as const;

/**
 * Minimalist permissions - YOLO mode inspired by Mario Zechner's pi-mono
 * No approval required, high rate limits, trusts the agent
 */
export const MINIMALIST_PERMISSIONS: Record<string, ToolPermission> = {
	Read: {
		tool: "Read",
		requiresApproval: false,
		rateLimit: { requests: 1000, windowMs: 60000 }, // High limit
	},
	Write: {
		tool: "Write",
		requiresApproval: false, // YOLO mode
		dangerousPatterns: SENSITIVE_FILE_PATTERNS,
		rateLimit: { requests: 100, windowMs: 60000 },
	},
	Edit: {
		tool: "Edit",
		requiresApproval: false, // YOLO mode
		dangerousPatterns: SENSITIVE_FILE_PATTERNS,
		rateLimit: { requests: 100, windowMs: 60000 },
	},
	Bash: {
		tool: "Bash",
		requiresApproval: false, // YOLO mode - Mario accepts bash access = game over
		dangerousPatterns: DANGEROUS_BASH_PATTERNS,
		blockedPatterns: [
			"rm\\s+-rf\\s+/", // Still block catastrophic
			":\\(\\)\\{", // fork bomb
		],
		rateLimit: { requests: 50, windowMs: 60000 },
	},
	__default__: {
		tool: "__default__",
		requiresApproval: false,
		rateLimit: { requests: 100, windowMs: 60000 },
	},
};

/**
 * Create a minimalist permission checker (Mario Zechner philosophy)
 */
export function createMinimalistChecker(): PermissionChecker {
	return new PermissionChecker(MINIMALIST_PERMISSIONS);
}

/**
 * Filter tools to Mario's 4 core tools only
 */
export function filterToMinimalistTools(toolNames: string[]): string[] {
	return toolNames.filter((name) => MARIO_CORE_TOOLS.some((core) => name.toLowerCase() === core.toLowerCase()));
}

/**
 * Check if a tool is in Mario's minimalist set
 */
export function isMinimalistTool(toolName: string): boolean {
	return MARIO_CORE_TOOLS.some((core) => toolName.toLowerCase() === core.toLowerCase());
}
