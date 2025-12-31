/**
 * Class 3.8 Safety Guards System
 *
 * TAC Pattern: Dangerous Command Blocking
 * "Protect agents from executing harmful operations"
 *
 * Guards:
 * - File system protection (delete, overwrite critical)
 * - Git protection (force push, rebase main)
 * - Process protection (kill critical, spawn malicious)
 * - Network protection (external data exfiltration)
 * - Secrets protection (env vars, credentials)
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

/** Risk level classification */
export type RiskLevel = "safe" | "caution" | "warning" | "danger" | "blocked";

/** Guard category */
export type GuardCategory = "filesystem" | "git" | "process" | "network" | "secrets" | "database" | "custom";

/** Guard check result */
export interface GuardCheckResult {
	allowed: boolean;
	risk: RiskLevel;
	category: GuardCategory;
	rule: string;
	reason: string;
	/** Suggested safer alternative */
	alternative?: string;
	/** Details for logging */
	details?: Record<string, unknown>;
}

/** Guard rule definition */
export interface GuardRule {
	id: string;
	category: GuardCategory;
	description: string;
	risk: RiskLevel;
	/** Pattern to match (regex or function) */
	pattern: RegExp | ((command: string, context: GuardContext) => boolean);
	/** Custom check function */
	check?: (command: string, context: GuardContext) => GuardCheckResult | null;
	/** Safer alternative suggestion */
	alternative?: string;
	/** Can be bypassed with approval */
	bypassable: boolean;
}

/** Context for guard checks */
export interface GuardContext {
	/** Agent ID executing the command */
	agentId?: string;
	/** User ID who initiated */
	userId?: string;
	/** Current working directory */
	cwd?: string;
	/** Is this a trusted agent */
	trusted?: boolean;
	/** Has bypass approval */
	bypassApproval?: boolean;
	/** Custom metadata */
	metadata?: Record<string, unknown>;
}

/** Blocked command record */
export interface BlockedCommand {
	id: string;
	timestamp: Date;
	command: string;
	category: GuardCategory;
	rule: string;
	risk: RiskLevel;
	agentId?: string;
	userId?: string;
	reason: string;
}

/** Safety guards configuration */
export interface SafetyGuardsConfig {
	/** Enable guards */
	enabled: boolean;
	/** Default risk threshold to block */
	blockThreshold: RiskLevel;
	/** Allow bypass for trusted agents */
	allowTrustedBypass: boolean;
	/** Log all checks (not just blocks) */
	logAllChecks: boolean;
	/** Max blocked commands to retain */
	maxBlockedHistory: number;
	/** Custom rules to add */
	customRules?: GuardRule[];
	/** Categories to disable */
	disabledCategories?: GuardCategory[];
}

// =============================================================================
// Built-in Guard Rules
// =============================================================================

const FILESYSTEM_RULES: GuardRule[] = [
	{
		id: "fs-rm-rf",
		category: "filesystem",
		description: "Recursive force delete",
		risk: "danger",
		pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive.*--force|--force.*--recursive|-[a-zA-Z]*f[a-zA-Z]*r)/,
		alternative: "Use trash-cli or move to backup first",
		bypassable: true,
	},
	{
		id: "fs-rm-root",
		category: "filesystem",
		description: "Delete root or home directory",
		risk: "blocked",
		pattern: /rm\s+.*(\s\/\s*$|\s~\s*$|\s\/home\s*$|\$HOME)/,
		alternative: "Specify exact subdirectory to delete",
		bypassable: false,
	},
	{
		id: "fs-chmod-777",
		category: "filesystem",
		description: "World-writable permissions",
		risk: "warning",
		pattern: /chmod\s+.*777/,
		alternative: "Use 755 for directories, 644 for files",
		bypassable: true,
	},
	{
		id: "fs-overwrite-config",
		category: "filesystem",
		description: "Overwrite critical config files",
		risk: "danger",
		pattern: />\s*(\/etc\/|~\/\.|\.env|\.gitignore|package\.json|tsconfig\.json)/,
		alternative: "Use >> to append or backup first",
		bypassable: true,
	},
	{
		id: "fs-delete-git",
		category: "filesystem",
		description: "Delete .git directory",
		risk: "danger",
		pattern: /rm\s+.*\.git($|\s|\/)/,
		alternative: "Archive .git first if needed",
		bypassable: true,
	},
];

const GIT_RULES: GuardRule[] = [
	{
		id: "git-force-push",
		category: "git",
		description: "Force push to remote",
		risk: "danger",
		pattern: /git\s+push\s+.*(-f|--force|--force-with-lease)/,
		alternative: "Use git push without force, resolve conflicts",
		bypassable: true,
	},
	{
		id: "git-push-main",
		category: "git",
		description: "Direct push to main/master",
		risk: "warning",
		pattern: /git\s+push\s+.*\s+(origin\s+)?(main|master)($|\s)/,
		alternative: "Create PR instead of direct push",
		bypassable: true,
	},
	{
		id: "git-hard-reset",
		category: "git",
		description: "Hard reset losing work",
		risk: "danger",
		pattern: /git\s+reset\s+--hard/,
		alternative: "Use git stash or create backup branch first",
		bypassable: true,
	},
	{
		id: "git-clean-fd",
		category: "git",
		description: "Clean untracked files and directories",
		risk: "warning",
		pattern: /git\s+clean\s+.*(-fd|-df|--force.*-d|-d.*--force)/,
		alternative: "Use git clean -n to preview first",
		bypassable: true,
	},
	{
		id: "git-rebase-main",
		category: "git",
		description: "Rebase shared branches",
		risk: "danger",
		pattern: /git\s+rebase\s+.*\s+(main|master|develop)($|\s)/,
		alternative: "Use merge instead of rebase for shared branches",
		bypassable: true,
	},
];

const PROCESS_RULES: GuardRule[] = [
	{
		id: "proc-kill-9",
		category: "process",
		description: "Force kill processes",
		risk: "warning",
		pattern: /kill\s+-9|pkill\s+-9|killall\s+-9/,
		alternative: "Use SIGTERM first, then SIGKILL if needed",
		bypassable: true,
	},
	{
		id: "proc-kill-all",
		category: "process",
		description: "Kill all processes",
		risk: "danger",
		pattern: /killall\s+|pkill\s+\.\*/,
		alternative: "Kill specific PIDs instead",
		bypassable: true,
	},
	{
		id: "proc-fork-bomb",
		category: "process",
		description: "Fork bomb pattern",
		risk: "blocked",
		pattern: /:\(\)\{\s*:\|:\s*&\s*\};:|\.\/\w+\s*&\s*\.\/\w+\s*&/,
		alternative: "This is a malicious pattern, do not execute",
		bypassable: false,
	},
	{
		id: "proc-sudo-rm",
		category: "process",
		description: "Sudo with destructive commands",
		risk: "danger",
		pattern: /sudo\s+(rm|dd|mkfs|fdisk|parted)/,
		alternative: "Be extremely careful with sudo destructive commands",
		bypassable: true,
	},
];

const NETWORK_RULES: GuardRule[] = [
	{
		id: "net-curl-pipe-bash",
		category: "network",
		description: "Curl pipe to bash",
		risk: "danger",
		pattern: /curl\s+.*\|\s*(bash|sh|zsh)|wget\s+.*-O\s*-\s*\|\s*(bash|sh)/,
		alternative: "Download script first, review, then execute",
		bypassable: true,
	},
	{
		id: "net-exfiltrate",
		category: "network",
		description: "Potential data exfiltration",
		risk: "danger",
		pattern: /curl\s+.*(-d|--data|--data-binary|--data-raw)\s+.*(\$|env|password|secret|key|token)/i,
		alternative: "Review what data is being sent",
		bypassable: true,
	},
	{
		id: "net-nc-reverse",
		category: "network",
		description: "Reverse shell pattern",
		risk: "blocked",
		pattern: /nc\s+.*-e\s*(\/bin\/bash|\/bin\/sh)|bash\s+-i\s+>&\s*\/dev\/tcp/,
		alternative: "This is a malicious pattern",
		bypassable: false,
	},
];

const SECRETS_RULES: GuardRule[] = [
	{
		id: "secrets-env-print",
		category: "secrets",
		description: "Print sensitive env vars",
		risk: "warning",
		pattern: /echo\s+.*\$(PASSWORD|SECRET|KEY|TOKEN|PRIVATE|API_KEY)/i,
		alternative: "Use secret managers instead of printing",
		bypassable: true,
	},
	{
		id: "secrets-cat-env",
		category: "secrets",
		description: "Display .env file",
		risk: "warning",
		pattern: /cat\s+.*\.env($|\s)/,
		alternative: "Use env | grep for specific vars",
		bypassable: true,
	},
	{
		id: "secrets-commit-env",
		category: "secrets",
		description: "Commit env/secret files",
		risk: "danger",
		pattern: /git\s+(add|commit)\s+.*\.(env|pem|key|secret|credential)/i,
		alternative: "Add to .gitignore instead",
		bypassable: true,
	},
	{
		id: "secrets-log-creds",
		category: "secrets",
		description: "Log credentials",
		risk: "danger",
		pattern: /console\.(log|debug|info)\s*\(\s*.*\b(password|secret|token|api.?key)\b/i,
		alternative: "Redact sensitive values before logging",
		bypassable: true,
	},
];

const DATABASE_RULES: GuardRule[] = [
	{
		id: "db-drop-database",
		category: "database",
		description: "Drop entire database",
		risk: "blocked",
		pattern: /DROP\s+DATABASE/i,
		alternative: "Create backup first, use specific table drops",
		bypassable: false,
	},
	{
		id: "db-truncate-table",
		category: "database",
		description: "Truncate table",
		risk: "danger",
		pattern: /TRUNCATE\s+TABLE/i,
		alternative: "Use DELETE with WHERE clause",
		bypassable: true,
	},
	{
		id: "db-delete-all",
		category: "database",
		description: "Delete all rows",
		risk: "danger",
		pattern: /DELETE\s+FROM\s+\w+\s*($|;)/i,
		alternative: "Add WHERE clause to limit deletion",
		bypassable: true,
	},
	{
		id: "db-update-all",
		category: "database",
		description: "Update all rows without WHERE",
		risk: "warning",
		pattern: /UPDATE\s+\w+\s+SET\s+.*(?!WHERE)/i,
		alternative: "Add WHERE clause to limit update",
		bypassable: true,
	},
];

/** All built-in rules */
export const BUILTIN_RULES: GuardRule[] = [
	...FILESYSTEM_RULES,
	...GIT_RULES,
	...PROCESS_RULES,
	...NETWORK_RULES,
	...SECRETS_RULES,
	...DATABASE_RULES,
];

// =============================================================================
// Risk Level Helpers
// =============================================================================

const RISK_ORDER: Record<RiskLevel, number> = {
	safe: 0,
	caution: 1,
	warning: 2,
	danger: 3,
	blocked: 4,
};

function isRiskAtOrAbove(risk: RiskLevel, threshold: RiskLevel): boolean {
	return RISK_ORDER[risk] >= RISK_ORDER[threshold];
}

// =============================================================================
// Safety Guards Manager
// =============================================================================

export class SafetyGuards extends EventEmitter {
	private config: SafetyGuardsConfig;
	private rules: Map<string, GuardRule> = new Map();
	private blockedHistory: BlockedCommand[] = [];

	constructor(config: Partial<SafetyGuardsConfig> = {}) {
		super();
		this.config = {
			enabled: config.enabled ?? true,
			blockThreshold: config.blockThreshold ?? "danger",
			allowTrustedBypass: config.allowTrustedBypass ?? true,
			logAllChecks: config.logAllChecks ?? false,
			maxBlockedHistory: config.maxBlockedHistory ?? 1000,
			customRules: config.customRules,
			disabledCategories: config.disabledCategories ?? [],
		};

		// Load built-in rules
		for (const rule of BUILTIN_RULES) {
			this.rules.set(rule.id, rule);
		}

		// Load custom rules
		if (config.customRules) {
			for (const rule of config.customRules) {
				this.rules.set(rule.id, rule);
			}
		}
	}

	// =========================================================================
	// Command Checking
	// =========================================================================

	/** Check if a command is safe to execute */
	check(command: string, context: GuardContext = {}): GuardCheckResult {
		if (!this.config.enabled) {
			return {
				allowed: true,
				risk: "safe",
				category: "custom",
				rule: "guards-disabled",
				reason: "Safety guards are disabled",
			};
		}

		// Check all rules
		for (const rule of this.rules.values()) {
			// Skip disabled categories
			if (this.config.disabledCategories?.includes(rule.category)) {
				continue;
			}

			// Check if rule matches
			const matches = this.matchesRule(command, rule, context);
			if (!matches) continue;

			// Custom check function
			if (rule.check) {
				const result = rule.check(command, context);
				if (result) {
					return this.processResult(result, rule, command, context);
				}
			}

			// Standard pattern match
			const result: GuardCheckResult = {
				allowed: !isRiskAtOrAbove(rule.risk, this.config.blockThreshold),
				risk: rule.risk,
				category: rule.category,
				rule: rule.id,
				reason: rule.description,
				alternative: rule.alternative,
				details: { command, agentId: context.agentId },
			};

			return this.processResult(result, rule, command, context);
		}

		// No rules matched - safe
		const safeResult: GuardCheckResult = {
			allowed: true,
			risk: "safe",
			category: "custom",
			rule: "no-match",
			reason: "No safety rules matched",
		};

		if (this.config.logAllChecks) {
			this.emit("check", { command, result: safeResult, context });
		}

		return safeResult;
	}

	/** Check multiple commands */
	checkBatch(commands: string[], context: GuardContext = {}): GuardCheckResult[] {
		return commands.map((cmd) => this.check(cmd, context));
	}

	/** Check if any command in batch is blocked */
	hasBlockedCommands(commands: string[], context: GuardContext = {}): boolean {
		return commands.some((cmd) => !this.check(cmd, context).allowed);
	}

	// =========================================================================
	// Rule Management
	// =========================================================================

	/** Add a custom rule */
	addRule(rule: GuardRule): void {
		this.rules.set(rule.id, rule);
		this.emit("ruleAdded", { id: rule.id, category: rule.category });
	}

	/** Remove a rule */
	removeRule(ruleId: string): boolean {
		const deleted = this.rules.delete(ruleId);
		if (deleted) {
			this.emit("ruleRemoved", { id: ruleId });
		}
		return deleted;
	}

	/** Get a rule by ID */
	getRule(ruleId: string): GuardRule | undefined {
		return this.rules.get(ruleId);
	}

	/** List all rules */
	listRules(category?: GuardCategory): GuardRule[] {
		const rules = Array.from(this.rules.values());
		if (category) {
			return rules.filter((r) => r.category === category);
		}
		return rules;
	}

	/** Enable/disable a category */
	setCategoryEnabled(category: GuardCategory, enabled: boolean): void {
		if (enabled) {
			this.config.disabledCategories = this.config.disabledCategories?.filter((c) => c !== category);
		} else {
			if (!this.config.disabledCategories) {
				this.config.disabledCategories = [];
			}
			if (!this.config.disabledCategories.includes(category)) {
				this.config.disabledCategories.push(category);
			}
		}
		this.emit("categoryToggled", { category, enabled });
	}

	// =========================================================================
	// History & Stats
	// =========================================================================

	/** Get blocked command history */
	getBlockedHistory(limit = 100): BlockedCommand[] {
		return this.blockedHistory.slice(-limit);
	}

	/** Get stats by category */
	getStats(): Record<GuardCategory, { blocked: number; warned: number }> {
		const stats: Record<GuardCategory, { blocked: number; warned: number }> = {
			filesystem: { blocked: 0, warned: 0 },
			git: { blocked: 0, warned: 0 },
			process: { blocked: 0, warned: 0 },
			network: { blocked: 0, warned: 0 },
			secrets: { blocked: 0, warned: 0 },
			database: { blocked: 0, warned: 0 },
			custom: { blocked: 0, warned: 0 },
		};

		for (const blocked of this.blockedHistory) {
			if (blocked.risk === "blocked" || blocked.risk === "danger") {
				stats[blocked.category].blocked++;
			} else {
				stats[blocked.category].warned++;
			}
		}

		return stats;
	}

	/** Clear history */
	clearHistory(): void {
		this.blockedHistory = [];
		this.emit("historyCleared");
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	private matchesRule(command: string, rule: GuardRule, context: GuardContext): boolean {
		if (typeof rule.pattern === "function") {
			return rule.pattern(command, context);
		}
		return rule.pattern.test(command);
	}

	private processResult(
		result: GuardCheckResult,
		rule: GuardRule,
		command: string,
		context: GuardContext,
	): GuardCheckResult {
		// Handle bypass for trusted agents
		if (!result.allowed && rule.bypassable) {
			if (context.bypassApproval) {
				result.allowed = true;
				result.reason += " (bypass approved)";
			} else if (context.trusted && this.config.allowTrustedBypass) {
				result.allowed = true;
				result.reason += " (trusted agent bypass)";
			}
		}

		// Record blocked command
		if (!result.allowed || isRiskAtOrAbove(result.risk, "warning")) {
			const blocked: BlockedCommand = {
				id: crypto.randomUUID(),
				timestamp: new Date(),
				command: command.slice(0, 500), // Truncate for storage
				category: result.category,
				rule: result.rule,
				risk: result.risk,
				agentId: context.agentId,
				userId: context.userId,
				reason: result.reason,
			};

			this.blockedHistory.push(blocked);
			if (this.blockedHistory.length > this.config.maxBlockedHistory) {
				this.blockedHistory.shift();
			}

			this.emit(result.allowed ? "warned" : "blocked", blocked);
		}

		if (this.config.logAllChecks || !result.allowed) {
			this.emit("check", { command, result, context });
		}

		return result;
	}

	// =========================================================================
	// Accessors
	// =========================================================================

	getConfig(): SafetyGuardsConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<SafetyGuardsConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	setEnabled(enabled: boolean): void {
		this.config.enabled = enabled;
		this.emit("enabledChanged", { enabled });
	}
}

// =============================================================================
// Factory
// =============================================================================

let guardsInstance: SafetyGuards | null = null;

export function getSafetyGuards(config?: Partial<SafetyGuardsConfig>): SafetyGuards {
	if (!guardsInstance) {
		guardsInstance = new SafetyGuards(config);
	}
	return guardsInstance;
}

export function resetSafetyGuards(): void {
	guardsInstance = null;
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Quick check if command is safe */
export function isSafe(command: string, context?: GuardContext): boolean {
	return getSafetyGuards().check(command, context).allowed;
}

/** Get risk level for a command */
export function getRisk(command: string, context?: GuardContext): RiskLevel {
	return getSafetyGuards().check(command, context).risk;
}

/** Check and throw if blocked */
export function assertSafe(command: string, context?: GuardContext): void {
	const result = getSafetyGuards().check(command, context);
	if (!result.allowed) {
		throw new Error(`Command blocked by safety guard: ${result.reason}`);
	}
}

/** Wrap command execution with safety check */
export function withSafetyGuard<T>(command: string, executor: () => T, context?: GuardContext): T {
	assertSafe(command, context);
	return executor();
}
