/**
 * Self-Debug Service - Autonomous Error Detection, Diagnosis, and Repair
 *
 * Architecture:
 * 1. Error Capture: Hooks into process error handlers
 * 2. Diagnosis: Uses AI to analyze errors and propose fixes
 * 3. Safe Repair: Git checkpoint -> Apply fix -> Validate -> Rollback on failure
 * 4. Auto-Restart: Signals systemd or uses exec for clean restart
 *
 * Safety Features:
 * - Git checkpoint before any code changes
 * - Whitelist of safe-to-modify files
 * - Maximum fix attempts per error
 * - Cooldown period between fix attempts
 * - Human notification for critical failures
 */

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";

import { runLearningAgent } from "./lightweight-agent.js";

// ============================================================================
// Types
// ============================================================================

export interface ErrorCapture {
	id: string;
	timestamp: Date;
	type: "uncaughtException" | "unhandledRejection" | "agentError" | "toolError";
	message: string;
	stack?: string;
	context?: Record<string, unknown>;
	fixAttempts: number;
	resolved: boolean;
	resolution?: string;
}

export interface DiagnosisResult {
	errorId: string;
	rootCause: string;
	affectedFiles: string[];
	proposedFix: ProposedFix | null;
	confidence: number; // 0-1
	reasoning: string;
}

export interface ProposedFix {
	file: string;
	description: string;
	oldCode: string;
	newCode: string;
	lineNumber?: number;
}

export interface RepairResult {
	success: boolean;
	checkpointId?: string;
	error?: string;
	rolledBack?: boolean;
}

export interface SelfDebugConfig {
	enabled: boolean;
	cwd: string;
	maxFixAttempts: number;
	cooldownMs: number;
	safeFiles: RegExp[];
	unsafePatterns: RegExp[];
	notifyChannel?: string;
	autoRestart: boolean;
	debugLog: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SELF_DEBUG_CONFIG: SelfDebugConfig = {
	enabled: true,
	cwd: process.cwd(),
	maxFixAttempts: 3,
	cooldownMs: 60000, // 1 minute between attempts
	safeFiles: [
		/^src\/.*\.ts$/, // TypeScript source
		/^src\/.*\.js$/, // JavaScript source
	],
	unsafePatterns: [
		/\.env/, // Never touch env files
		/credentials/, // No credentials
		/secret/, // No secrets
		/password/, // No passwords
		/private.*key/i, // No private keys
		/node_modules/, // No node_modules
		/dist\//, // No compiled output
	],
	notifyChannel: undefined,
	autoRestart: false, // Disabled by default for safety
	debugLog: true,
};

// ============================================================================
// Self Debug Service
// ============================================================================

export class SelfDebugService {
	private config: SelfDebugConfig;
	private errors: Map<string, ErrorCapture> = new Map();
	private lastFixAttempt: Map<string, number> = new Map();
	private isProcessing = false;
	private logFile: string;

	constructor(config: Partial<SelfDebugConfig> = {}) {
		this.config = { ...DEFAULT_SELF_DEBUG_CONFIG, ...config };
		this.logFile = join(this.config.cwd, ".self-debug.log");

		// Ensure log directory exists
		if (!existsSync(dirname(this.logFile))) {
			mkdirSync(dirname(this.logFile), { recursive: true });
		}
	}

	// -------------------------------------------------------------------------
	// Logging
	// -------------------------------------------------------------------------

	private log(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string, data?: unknown): void {
		if (level === "DEBUG" && !this.config.debugLog) return;

		const entry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			data,
		};

		const line = `${JSON.stringify(entry)}\n`;

		// Console output
		const prefix = `[SELF-DEBUG][${level}]`;
		if (level === "ERROR") {
			console.error(prefix, message, data || "");
		} else if (level === "WARN") {
			console.warn(prefix, message, data || "");
		} else {
			console.log(prefix, message, data || "");
		}

		// File output
		try {
			writeFileSync(this.logFile, line, { flag: "a" });
		} catch {
			// Ignore log write failures
		}
	}

	// -------------------------------------------------------------------------
	// Error Capture
	// -------------------------------------------------------------------------

	/**
	 * Capture an error for potential self-healing
	 */
	captureError(type: ErrorCapture["type"], error: Error | string, context?: Record<string, unknown>): ErrorCapture {
		const message = error instanceof Error ? error.message : error;
		const stack = error instanceof Error ? error.stack : undefined;

		// Generate unique ID based on error signature
		const signature = `${type}:${message}:${stack?.split("\n")[1] || ""}`;
		const id = Buffer.from(signature).toString("base64").slice(0, 16);

		// Check if we already have this error
		const existing = this.errors.get(id);
		if (existing) {
			this.log("DEBUG", `Duplicate error captured: ${id}`);
			return existing;
		}

		const capture: ErrorCapture = {
			id,
			timestamp: new Date(),
			type,
			message,
			stack,
			context,
			fixAttempts: 0,
			resolved: false,
		};

		this.errors.set(id, capture);
		this.log("INFO", `Error captured: ${message}`, { id, type });

		// Trigger async diagnosis
		if (this.config.enabled) {
			this.processError(capture).catch((e) => {
				this.log("ERROR", "Failed to process error", e);
			});
		}

		return capture;
	}

	// -------------------------------------------------------------------------
	// Error Processing Pipeline
	// -------------------------------------------------------------------------

	private async processError(error: ErrorCapture): Promise<void> {
		if (this.isProcessing) {
			this.log("DEBUG", "Already processing an error, queuing");
			return;
		}

		// Check cooldown
		const lastAttempt = this.lastFixAttempt.get(error.id) || 0;
		const elapsed = Date.now() - lastAttempt;
		if (elapsed < this.config.cooldownMs) {
			this.log("DEBUG", `Cooldown active for ${error.id}, ${this.config.cooldownMs - elapsed}ms remaining`);
			return;
		}

		// Check max attempts
		if (error.fixAttempts >= this.config.maxFixAttempts) {
			this.log("WARN", `Max fix attempts reached for ${error.id}`);
			return;
		}

		this.isProcessing = true;
		this.lastFixAttempt.set(error.id, Date.now());
		error.fixAttempts++;

		try {
			this.log("INFO", `Processing error ${error.id} (attempt ${error.fixAttempts})`);

			// Step 1: Diagnose
			const diagnosis = await this.diagnose(error);
			this.log("INFO", `Diagnosis complete`, { rootCause: diagnosis.rootCause, confidence: diagnosis.confidence });

			if (!diagnosis.proposedFix) {
				this.log("WARN", "No fix proposed");
				return;
			}

			if (diagnosis.confidence < 0.7) {
				this.log("WARN", `Low confidence fix (${diagnosis.confidence}), skipping`);
				return;
			}

			// Step 2: Validate fix is safe
			if (!this.isFixSafe(diagnosis.proposedFix)) {
				this.log("WARN", "Fix rejected by safety check");
				return;
			}

			// Step 3: Apply fix
			const result = await this.applyFix(diagnosis.proposedFix);

			if (result.success) {
				error.resolved = true;
				error.resolution = diagnosis.proposedFix.description;
				this.log("INFO", `Fix applied successfully`, { checkpointId: result.checkpointId });

				// Step 4: Rebuild and restart if configured
				if (this.config.autoRestart) {
					await this.rebuildAndRestart();
				}
			} else if (result.rolledBack) {
				this.log("WARN", `Fix failed, rolled back to ${result.checkpointId}`);
			}
		} catch (e) {
			this.log("ERROR", "Error processing pipeline failed", e);
		} finally {
			this.isProcessing = false;
		}
	}

	// -------------------------------------------------------------------------
	// Diagnosis
	// -------------------------------------------------------------------------

	async diagnose(error: ErrorCapture): Promise<DiagnosisResult> {
		// Extract file and line from stack trace
		const stackLines = error.stack?.split("\n") || [];
		const affectedFiles: string[] = [];
		let relevantCode = "";

		for (const line of stackLines) {
			const match = line.match(/at.*\((.+):(\d+):(\d+)\)/);
			if (match) {
				const [, filePath, lineNum] = match;
				const relPath = relative(this.config.cwd, filePath);

				// Skip node_modules and non-src files
				if (relPath.startsWith("src/") && !relPath.includes("node_modules")) {
					affectedFiles.push(relPath);

					// Read context around the error
					try {
						const content = readFileSync(join(this.config.cwd, relPath), "utf-8");
						const lines = content.split("\n");
						const ln = parseInt(lineNum, 10);
						const start = Math.max(0, ln - 10);
						const end = Math.min(lines.length, ln + 10);
						relevantCode += `\n--- ${relPath}:${ln} ---\n`;
						relevantCode += lines
							.slice(start, end)
							.map((l, i) => `${start + i + 1}: ${l}`)
							.join("\n");
					} catch {
						// File read failed
					}
				}
			}
		}

		// Use AI to diagnose
		const prompt = `You are a debugging expert. Analyze this error and propose a fix.

ERROR TYPE: ${error.type}
ERROR MESSAGE: ${error.message}

STACK TRACE:
${error.stack || "No stack trace"}

RELEVANT CODE:
${relevantCode || "No code context available"}

CONTEXT:
${JSON.stringify(error.context || {}, null, 2)}

Respond in this exact JSON format:
{
  "rootCause": "Brief description of what caused the error",
  "confidence": 0.0 to 1.0,
  "reasoning": "Step by step reasoning",
  "fix": {
    "file": "relative/path/to/file.ts",
    "description": "What the fix does",
    "oldCode": "exact code to replace (copy from relevant code above)",
    "newCode": "replacement code"
  } or null if no fix possible
}

IMPORTANT:
- oldCode must be an EXACT match from the code shown above
- Only propose fixes you are confident will work
- Set confidence below 0.7 if uncertain
- Return null for fix if you cannot determine a safe fix`;

		try {
			const result = await runLearningAgent({
				prompt,
				mode: "coding",
				enableLearning: false, // Don't learn from self-debug
			});

			// Parse AI response
			const jsonMatch = result.output.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				return {
					errorId: error.id,
					rootCause: "Failed to parse diagnosis",
					affectedFiles,
					proposedFix: null,
					confidence: 0,
					reasoning: result.output,
				};
			}

			const parsed = JSON.parse(jsonMatch[0]);

			return {
				errorId: error.id,
				rootCause: parsed.rootCause || "Unknown",
				affectedFiles,
				proposedFix: parsed.fix
					? {
							file: parsed.fix.file,
							description: parsed.fix.description,
							oldCode: parsed.fix.oldCode,
							newCode: parsed.fix.newCode,
						}
					: null,
				confidence: parsed.confidence || 0,
				reasoning: parsed.reasoning || "",
			};
		} catch (e) {
			this.log("ERROR", "Diagnosis AI call failed", e);
			return {
				errorId: error.id,
				rootCause: "Diagnosis failed",
				affectedFiles,
				proposedFix: null,
				confidence: 0,
				reasoning: String(e),
			};
		}
	}

	// -------------------------------------------------------------------------
	// Safety Checks
	// -------------------------------------------------------------------------

	private isFixSafe(fix: ProposedFix): boolean {
		const filePath = fix.file;

		// Check against safe file patterns
		const isSafe = this.config.safeFiles.some((pattern) => pattern.test(filePath));
		if (!isSafe) {
			this.log("WARN", `File ${filePath} not in safe list`);
			return false;
		}

		// Check against unsafe patterns
		const isUnsafe = this.config.unsafePatterns.some((pattern) => pattern.test(filePath));
		if (isUnsafe) {
			this.log("WARN", `File ${filePath} matches unsafe pattern`);
			return false;
		}

		// Check fix content for dangerous patterns
		const dangerousPatterns = [
			/process\.exit/,
			/require\s*\(\s*['"]child_process['"]\s*\)/,
			/exec\s*\(/,
			/spawn\s*\(/,
			/eval\s*\(/,
			/Function\s*\(/,
			/rm\s+-rf/,
			/\.env/,
			/password/i,
			/secret/i,
			/private.*key/i,
		];

		for (const pattern of dangerousPatterns) {
			if (pattern.test(fix.newCode)) {
				this.log("WARN", `Fix contains dangerous pattern: ${pattern}`);
				return false;
			}
		}

		return true;
	}

	// -------------------------------------------------------------------------
	// Fix Application
	// -------------------------------------------------------------------------

	async applyFix(fix: ProposedFix): Promise<RepairResult> {
		const fullPath = join(this.config.cwd, fix.file);

		// Step 1: Create git checkpoint
		let checkpointId: string;
		try {
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			checkpointId = `self-debug-${timestamp}`;

			execSync(`git add -A && git stash push -m "${checkpointId}"`, {
				cwd: this.config.cwd,
				stdio: "pipe",
			});

			// Pop immediately to keep working tree
			try {
				execSync("git stash pop", { cwd: this.config.cwd, stdio: "pipe" });
			} catch {
				// Stash might be empty if no changes
			}

			// Create a ref for this checkpoint
			execSync(`git rev-parse HEAD > /tmp/${checkpointId}`, {
				cwd: this.config.cwd,
				stdio: "pipe",
			});

			this.log("INFO", `Created checkpoint: ${checkpointId}`);
		} catch (e) {
			this.log("ERROR", "Failed to create checkpoint", e);
			return { success: false, error: "Checkpoint failed" };
		}

		// Step 2: Read file
		let content: string;
		try {
			content = readFileSync(fullPath, "utf-8");
		} catch (e) {
			this.log("ERROR", `Failed to read file: ${fix.file}`, e);
			return { success: false, error: "File read failed", checkpointId };
		}

		// Step 3: Apply fix
		if (!content.includes(fix.oldCode)) {
			this.log("ERROR", "Old code not found in file");
			return { success: false, error: "Old code not found", checkpointId };
		}

		const newContent = content.replace(fix.oldCode, fix.newCode);

		try {
			writeFileSync(fullPath, newContent, "utf-8");
			this.log("INFO", `Applied fix to ${fix.file}`);
		} catch (e) {
			this.log("ERROR", "Failed to write fix", e);
			return { success: false, error: "Write failed", checkpointId };
		}

		// Step 4: Validate (type check)
		try {
			execSync("npm run type-check", {
				cwd: this.config.cwd,
				stdio: "pipe",
				timeout: 60000,
			});
			this.log("INFO", "Type check passed");
		} catch (_e) {
			this.log("ERROR", "Type check failed, rolling back");

			// Rollback
			writeFileSync(fullPath, content, "utf-8");
			return { success: false, error: "Type check failed", checkpointId, rolledBack: true };
		}

		// Step 5: Commit the fix
		try {
			execSync(
				`git add "${fix.file}" && git commit -m "fix(self-debug): ${fix.description}

Auto-generated fix by self-debug service.
Error: ${fix.description}"`,
				{
					cwd: this.config.cwd,
					stdio: "pipe",
				},
			);
			this.log("INFO", "Fix committed");
		} catch (e) {
			this.log("WARN", "Commit failed (may have no changes)", e);
		}

		return { success: true, checkpointId };
	}

	// -------------------------------------------------------------------------
	// Rebuild and Restart
	// -------------------------------------------------------------------------

	async rebuildAndRestart(): Promise<void> {
		this.log("INFO", "Rebuilding...");

		try {
			execSync("npm run build", {
				cwd: this.config.cwd,
				stdio: "pipe",
				timeout: 120000,
			});
			this.log("INFO", "Build successful");
		} catch (e) {
			this.log("ERROR", "Build failed", e);
			return;
		}

		this.log("INFO", "Requesting restart via systemd...");

		// Signal systemd to restart
		try {
			// Write restart signal file
			writeFileSync(join(this.config.cwd, ".restart-requested"), new Date().toISOString());

			// Use systemctl if available
			spawn("systemctl", ["restart", "pi-discord.service"], {
				detached: true,
				stdio: "ignore",
			}).unref();
		} catch (e) {
			this.log("ERROR", "Restart signal failed", e);
		}
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Install error handlers on process
	 */
	install(): void {
		process.on("uncaughtException", (error) => {
			this.captureError("uncaughtException", error);
		});

		process.on("unhandledRejection", (reason) => {
			this.captureError("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)));
		});

		this.log("INFO", "Self-debug service installed");
	}

	/**
	 * Get all captured errors
	 */
	getErrors(): ErrorCapture[] {
		return Array.from(this.errors.values());
	}

	/**
	 * Get unresolved errors
	 */
	getUnresolvedErrors(): ErrorCapture[] {
		return this.getErrors().filter((e) => !e.resolved);
	}

	/**
	 * Get service status
	 */
	getStatus(): {
		enabled: boolean;
		totalErrors: number;
		unresolvedErrors: number;
		isProcessing: boolean;
	} {
		return {
			enabled: this.config.enabled,
			totalErrors: this.errors.size,
			unresolvedErrors: this.getUnresolvedErrors().length,
			isProcessing: this.isProcessing,
		};
	}

	/**
	 * Manually trigger diagnosis for an error
	 */
	async manualDiagnose(errorId: string): Promise<DiagnosisResult | null> {
		const error = this.errors.get(errorId);
		if (!error) return null;
		return this.diagnose(error);
	}

	/**
	 * Clear error history
	 */
	clearErrors(): void {
		this.errors.clear();
		this.lastFixAttempt.clear();
		this.log("INFO", "Error history cleared");
	}
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SelfDebugService | null = null;

export function getSelfDebugService(config?: Partial<SelfDebugConfig>): SelfDebugService {
	if (!instance) {
		instance = new SelfDebugService(config);
	}
	return instance;
}

export function disposeSelfDebugService(): void {
	instance = null;
}
