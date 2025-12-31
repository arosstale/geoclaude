/**
 * Pi-Watcher - Autonomous Monitoring & Hotfix System
 *
 * Codebase Singularity Class 3.3 - "Always-On Guardian"
 * Inspired by Clopus-Watcher concept: "What if Claude could auto-fix issues?"
 *
 * This watcher provides:
 * - Continuous health monitoring of the codebase
 * - Automatic issue detection (type errors, test failures, lint issues)
 * - Autonomous hotfix attempts with quality gates
 * - Discord notifications for critical issues
 * - Learning from past fixes to improve future corrections
 *
 * Based on: Shipping at Inference-Speed workflow patterns
 */

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { createBugFixWorkflow, getADWRunner, SECURITY_GATE } from "./adw-wrapper.js";
import { getOrchestrator } from "./orchestrator.js";

// =============================================================================
// Types
// =============================================================================

/** Health check types */
export type HealthCheckType = "typecheck" | "test" | "lint" | "build" | "custom";

/** Health check result */
export interface HealthCheckResult {
	type: HealthCheckType;
	passed: boolean;
	errors: string[];
	warnings: string[];
	duration: number;
	timestamp: Date;
}

/** Issue detected by watcher */
export interface DetectedIssue {
	id: string;
	type: HealthCheckType;
	severity: "critical" | "high" | "medium" | "low";
	title: string;
	description: string;
	file?: string;
	line?: number;
	rawError: string;
	detectedAt: Date;
	autoFixable: boolean;
	fixAttempts: number;
	status: "detected" | "fixing" | "fixed" | "failed" | "ignored";
}

/** Fix attempt result */
export interface FixAttempt {
	issueId: string;
	attemptNumber: number;
	strategy: "inline" | "agent" | "workflow";
	success: boolean;
	changes?: string;
	error?: string;
	duration: number;
	timestamp: Date;
}

/** Watcher configuration */
export interface WatcherConfig {
	workingDir: string;
	orchestratorDbPath: string;
	checkInterval: number; // ms between health checks
	maxFixAttempts: number;
	autoFixEnabled: boolean;
	notifyOnIssue: boolean;
	notifyOnFix: boolean;
	enabledChecks: HealthCheckType[];
	ignorePaths: string[];
	customChecks: CustomCheck[];
}

/** Custom health check definition */
export interface CustomCheck {
	name: string;
	command: string;
	args: string[];
	successExitCode: number;
	parseErrors: (output: string) => string[];
}

/** Watcher state */
export interface WatcherState {
	running: boolean;
	startedAt?: Date;
	lastCheck?: Date;
	checksPerformed: number;
	issuesDetected: number;
	issuesFixed: number;
	issuesFailed: number;
	currentIssues: DetectedIssue[];
}

/** Watcher event types */
export type WatcherEvent =
	| "started"
	| "stopped"
	| "check:started"
	| "check:completed"
	| "issue:detected"
	| "issue:fixing"
	| "issue:fixed"
	| "issue:failed"
	| "error";

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_WATCHER_CONFIG: Partial<WatcherConfig> = {
	checkInterval: 5 * 60 * 1000, // 5 minutes
	maxFixAttempts: 3,
	autoFixEnabled: true,
	notifyOnIssue: true,
	notifyOnFix: true,
	enabledChecks: ["typecheck", "test", "lint"],
	ignorePaths: ["node_modules", "dist", ".git", "coverage"],
	customChecks: [],
};

// =============================================================================
// Error Parsers
// =============================================================================

/** Parse TypeScript errors */
function parseTypeScriptErrors(output: string): DetectedIssue[] {
	const issues: DetectedIssue[] = [];
	const errorRegex = /([^:]+):(\d+):(\d+) - error (TS\d+): (.+)/g;

	let match;
	while ((match = errorRegex.exec(output)) !== null) {
		const [, file, line, _col, code, message] = match;
		issues.push({
			id: randomUUID(),
			type: "typecheck",
			severity: "high",
			title: `TypeScript ${code}`,
			description: message,
			file,
			line: parseInt(line, 10),
			rawError: match[0],
			detectedAt: new Date(),
			autoFixable: true,
			fixAttempts: 0,
			status: "detected",
		});
	}

	return issues;
}

/** Parse test failures */
function parseTestErrors(output: string): DetectedIssue[] {
	const issues: DetectedIssue[] = [];

	// Vitest/Jest format
	const failRegex = /FAIL\s+(.+)\n[\s\S]*?Error: (.+)/g;
	let match;
	while ((match = failRegex.exec(output)) !== null) {
		const [, file, message] = match;
		issues.push({
			id: randomUUID(),
			type: "test",
			severity: "high",
			title: `Test Failure: ${file}`,
			description: message,
			file,
			rawError: match[0],
			detectedAt: new Date(),
			autoFixable: true,
			fixAttempts: 0,
			status: "detected",
		});
	}

	return issues;
}

/** Parse ESLint errors */
function parseLintErrors(output: string): DetectedIssue[] {
	const issues: DetectedIssue[] = [];

	// ESLint format
	const errorRegex = /([^\n]+)\n\s+(\d+):(\d+)\s+error\s+(.+?)\s+(\S+)/g;
	let match;
	while ((match = errorRegex.exec(output)) !== null) {
		const [, file, line, _col, message, rule] = match;
		issues.push({
			id: randomUUID(),
			type: "lint",
			severity: "medium",
			title: `ESLint: ${rule}`,
			description: message,
			file,
			line: parseInt(line, 10),
			rawError: match[0],
			detectedAt: new Date(),
			autoFixable: rule !== "@typescript-eslint/no-explicit-any", // Some rules can be auto-fixed
			fixAttempts: 0,
			status: "detected",
		});
	}

	return issues;
}

// =============================================================================
// Pi-Watcher Class
// =============================================================================

export class PiWatcher extends EventEmitter {
	private config: WatcherConfig;
	private state: WatcherState;
	private checkTimer?: NodeJS.Timeout;
	private issueHistory: Map<string, DetectedIssue[]> = new Map();
	private fixHistory: Map<string, FixAttempt[]> = new Map();

	constructor(config: Partial<WatcherConfig> & { workingDir: string; orchestratorDbPath: string }) {
		super();
		this.config = { ...DEFAULT_WATCHER_CONFIG, ...config } as WatcherConfig;
		this.state = {
			running: false,
			checksPerformed: 0,
			issuesDetected: 0,
			issuesFixed: 0,
			issuesFailed: 0,
			currentIssues: [],
		};
	}

	/** Start the watcher */
	start(): void {
		if (this.state.running) return;

		this.state.running = true;
		this.state.startedAt = new Date();
		this.emit("started", { config: this.config });

		// Run initial check
		this.runHealthChecks();

		// Schedule periodic checks
		this.checkTimer = setInterval(() => {
			this.runHealthChecks();
		}, this.config.checkInterval);
	}

	/** Stop the watcher */
	stop(): void {
		if (!this.state.running) return;

		this.state.running = false;
		if (this.checkTimer) {
			clearInterval(this.checkTimer);
			this.checkTimer = undefined;
		}

		this.emit("stopped", { state: this.state });
	}

	/** Run all health checks */
	async runHealthChecks(): Promise<HealthCheckResult[]> {
		const results: HealthCheckResult[] = [];
		this.state.lastCheck = new Date();
		this.state.checksPerformed++;

		this.emit("check:started", { checks: this.config.enabledChecks });

		for (const checkType of this.config.enabledChecks) {
			const result = await this.runCheck(checkType);
			results.push(result);

			if (!result.passed) {
				await this.handleCheckFailure(checkType, result);
			}
		}

		// Run custom checks
		for (const custom of this.config.customChecks) {
			const result = await this.runCustomCheck(custom);
			results.push(result);

			if (!result.passed) {
				await this.handleCheckFailure("custom", result);
			}
		}

		this.emit("check:completed", { results });
		return results;
	}

	/** Run a specific health check */
	private async runCheck(type: HealthCheckType): Promise<HealthCheckResult> {
		const startTime = Date.now();

		const commands: Record<HealthCheckType, { cmd: string; args: string[] }> = {
			typecheck: { cmd: "npm", args: ["run", "type-check"] },
			test: { cmd: "npm", args: ["run", "test", "--", "--run"] },
			lint: { cmd: "npm", args: ["run", "lint"] },
			build: { cmd: "npm", args: ["run", "build"] },
			custom: { cmd: "echo", args: ["custom"] },
		};

		const { cmd, args } = commands[type];

		try {
			const { stdout, stderr, exitCode } = await this.execCommand(cmd, args);
			const output = stdout + stderr;

			const passed = exitCode === 0;
			const errors: string[] = [];
			const warnings: string[] = [];

			if (!passed) {
				// Parse errors based on check type
				switch (type) {
					case "typecheck":
						errors.push(...parseTypeScriptErrors(output).map((i) => i.rawError));
						break;
					case "test":
						errors.push(...parseTestErrors(output).map((i) => i.rawError));
						break;
					case "lint":
						errors.push(...parseLintErrors(output).map((i) => i.rawError));
						break;
					default:
						if (output) errors.push(output.slice(0, 500));
				}
			}

			return {
				type,
				passed,
				errors,
				warnings,
				duration: Date.now() - startTime,
				timestamp: new Date(),
			};
		} catch (error) {
			return {
				type,
				passed: false,
				errors: [error instanceof Error ? error.message : String(error)],
				warnings: [],
				duration: Date.now() - startTime,
				timestamp: new Date(),
			};
		}
	}

	/** Run a custom health check */
	private async runCustomCheck(check: CustomCheck): Promise<HealthCheckResult> {
		const startTime = Date.now();

		try {
			const { stdout, stderr, exitCode } = await this.execCommand(check.command, check.args);
			const output = stdout + stderr;
			const passed = exitCode === check.successExitCode;
			const errors = passed ? [] : check.parseErrors(output);

			return {
				type: "custom",
				passed,
				errors,
				warnings: [],
				duration: Date.now() - startTime,
				timestamp: new Date(),
			};
		} catch (error) {
			return {
				type: "custom",
				passed: false,
				errors: [error instanceof Error ? error.message : String(error)],
				warnings: [],
				duration: Date.now() - startTime,
				timestamp: new Date(),
			};
		}
	}

	/** Handle a failed health check */
	private async handleCheckFailure(type: HealthCheckType, result: HealthCheckResult): Promise<void> {
		// Parse errors into issues
		let issues: DetectedIssue[] = [];

		switch (type) {
			case "typecheck":
				issues = parseTypeScriptErrors(result.errors.join("\n"));
				break;
			case "test":
				issues = parseTestErrors(result.errors.join("\n"));
				break;
			case "lint":
				issues = parseLintErrors(result.errors.join("\n"));
				break;
			default:
				// Generic issue for custom/build
				if (result.errors.length > 0) {
					issues.push({
						id: randomUUID(),
						type,
						severity: "high",
						title: `${type} failed`,
						description: result.errors[0].slice(0, 200),
						rawError: result.errors.join("\n"),
						detectedAt: new Date(),
						autoFixable: false,
						fixAttempts: 0,
						status: "detected",
					});
				}
		}

		// Process each issue
		for (const issue of issues) {
			// Check if we've seen this issue before
			const existingIssue = this.state.currentIssues.find(
				(i) => i.file === issue.file && i.line === issue.line && i.title === issue.title,
			);

			if (existingIssue) {
				continue; // Already tracking this issue
			}

			this.state.currentIssues.push(issue);
			this.state.issuesDetected++;
			this.emit("issue:detected", { issue });

			// Attempt auto-fix if enabled
			if (this.config.autoFixEnabled && issue.autoFixable) {
				await this.attemptFix(issue);
			}
		}
	}

	/** Attempt to fix an issue */
	private async attemptFix(issue: DetectedIssue): Promise<FixAttempt> {
		issue.status = "fixing";
		issue.fixAttempts++;
		this.emit("issue:fixing", { issue });

		const startTime = Date.now();
		let attempt: FixAttempt;

		try {
			// Choose fix strategy based on issue type and attempts
			let strategy: "inline" | "agent" | "workflow" = "inline";
			if (issue.fixAttempts > 1) strategy = "agent";
			if (issue.fixAttempts > 2) strategy = "workflow";

			let success = false;
			let changes: string | undefined;
			let error: string | undefined;

			switch (strategy) {
				case "inline": {
					// Simple inline fix using orchestrator
					const orch = getOrchestrator(this.config.orchestratorDbPath);
					const result = await orch.delegate({
						id: randomUUID(),
						taskType: "fix_error",
						prompt: `Fix this error:\n\nError: ${issue.rawError}\n\nFile: ${issue.file || "unknown"}\nLine: ${issue.line || "unknown"}\n\nProvide ONLY the corrected code.`,
						requiredRole: "builder",
						timeout: 30000,
						priority: 8,
					});

					success = result.status === "success";
					changes = String(result.output);
					error = result.error;
					break;
				}

				case "agent": {
					// Use agent with more context
					const orch = getOrchestrator(this.config.orchestratorDbPath);
					const result = await orch.delegate({
						id: randomUUID(),
						taskType: "diagnose_and_fix",
						prompt: `Diagnose and fix this issue:\n\nType: ${issue.type}\nTitle: ${issue.title}\nDescription: ${issue.description}\nFile: ${issue.file || "unknown"}\nLine: ${issue.line || "unknown"}\nRaw Error:\n${issue.rawError}\n\nPrevious fix attempts: ${issue.fixAttempts - 1}\n\nProvide a complete fix with explanation.`,
						requiredRole: "expert",
						timeout: 60000,
						priority: 9,
					});

					success = result.status === "success";
					changes = String(result.output);
					error = result.error;
					break;
				}

				case "workflow": {
					// Full bug fix workflow with quality gates
					const runner = getADWRunner(this.config.orchestratorDbPath);
					const workflow = createBugFixWorkflow(issue.description, issue.rawError);

					// Add security gate
					workflow.globalGates.push(SECURITY_GATE);

					const result = await runner.execute(workflow);
					success = result.status === "completed";
					changes = result.finalOutput ? String(result.finalOutput) : undefined;
					error = result.error;
					break;
				}
			}

			attempt = {
				issueId: issue.id,
				attemptNumber: issue.fixAttempts,
				strategy,
				success,
				changes,
				error,
				duration: Date.now() - startTime,
				timestamp: new Date(),
			};

			// Store in history
			const history = this.fixHistory.get(issue.id) || [];
			history.push(attempt);
			this.fixHistory.set(issue.id, history);

			if (success) {
				issue.status = "fixed";
				this.state.issuesFixed++;
				this.state.currentIssues = this.state.currentIssues.filter((i) => i.id !== issue.id);
				this.emit("issue:fixed", { issue, attempt });
			} else if (issue.fixAttempts >= this.config.maxFixAttempts) {
				issue.status = "failed";
				this.state.issuesFailed++;
				this.emit("issue:failed", { issue, attempt });
			} else {
				// Reset to detected for retry
				issue.status = "detected";
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			attempt = {
				issueId: issue.id,
				attemptNumber: issue.fixAttempts,
				strategy: "inline",
				success: false,
				error: errMsg,
				duration: Date.now() - startTime,
				timestamp: new Date(),
			};

			issue.status = "failed";
			this.state.issuesFailed++;
			this.emit("issue:failed", { issue, attempt });
		}

		return attempt!;
	}

	/** Execute a command and capture output */
	private execCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve) => {
			const proc = spawn(cmd, args, {
				cwd: this.config.workingDir,
				shell: true,
			});

			let stdout = "";
			let stderr = "";

			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				resolve({ stdout, stderr, exitCode: code ?? 1 });
			});

			proc.on("error", (err) => {
				resolve({ stdout, stderr: err.message, exitCode: 1 });
			});
		});
	}

	/** Get current state */
	getState(): WatcherState {
		return { ...this.state };
	}

	/** Get issue history */
	getIssueHistory(issueId: string): DetectedIssue[] {
		return this.issueHistory.get(issueId) || [];
	}

	/** Get fix history for an issue */
	getFixHistory(issueId: string): FixAttempt[] {
		return this.fixHistory.get(issueId) || [];
	}

	/** Manually trigger a fix attempt */
	async manualFix(issueId: string): Promise<FixAttempt | null> {
		const issue = this.state.currentIssues.find((i) => i.id === issueId);
		if (!issue) return null;

		return this.attemptFix(issue);
	}

	/** Ignore an issue */
	ignoreIssue(issueId: string): boolean {
		const issue = this.state.currentIssues.find((i) => i.id === issueId);
		if (!issue) return false;

		issue.status = "ignored";
		this.state.currentIssues = this.state.currentIssues.filter((i) => i.id !== issueId);
		return true;
	}

	/** Update configuration */
	updateConfig(updates: Partial<WatcherConfig>): void {
		this.config = { ...this.config, ...updates };

		// Restart timer if interval changed
		if (updates.checkInterval && this.state.running) {
			if (this.checkTimer) clearInterval(this.checkTimer);
			this.checkTimer = setInterval(() => {
				this.runHealthChecks();
			}, this.config.checkInterval);
		}
	}
}

// =============================================================================
// Singleton Instance
// =============================================================================

let watcherInstance: PiWatcher | null = null;

export function getPiWatcher(
	config?: Partial<WatcherConfig> & { workingDir: string; orchestratorDbPath: string },
): PiWatcher {
	if (!watcherInstance && config) {
		watcherInstance = new PiWatcher(config);
	}
	return watcherInstance!;
}

export function startPiWatcher(
	config: Partial<WatcherConfig> & { workingDir: string; orchestratorDbPath: string },
): PiWatcher {
	if (watcherInstance) {
		watcherInstance.stop();
	}
	watcherInstance = new PiWatcher(config);
	watcherInstance.start();
	return watcherInstance;
}

export function stopPiWatcher(): void {
	if (watcherInstance) {
		watcherInstance.stop();
		watcherInstance = null;
	}
}

export function getPiWatcherState(): WatcherState | null {
	return watcherInstance?.getState() || null;
}
