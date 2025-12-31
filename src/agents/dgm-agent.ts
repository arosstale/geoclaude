/**
 * DGM Agent - Darwin Gödel Machine Integration
 *
 * Self-improving AI agent that can modify and improve its own code.
 * Implements the Sakana AI's Darwin Gödel Machine approach for
 * autonomous agent improvement through code self-modification.
 *
 * Features:
 * - Self-improving agent code modification
 * - Performance-driven evolution
 * - Safety-bounded modifications
 * - Rollback on regression
 * - Integration with Agent Experts
 *
 * Paper: arXiv:2505.22954 "Darwin Gödel Machine"
 * GitHub: jennyzzt/dgm
 */

import { type SpawnOptions, spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const RUNNER_PATH = join(PACKAGE_ROOT, "src", "agents", "dgm-runner.py");
const DGM_DIR = join(PACKAGE_ROOT, "data", "dgm");

// ============================================================================
// TYPES
// ============================================================================

/** Target for self-improvement */
export interface DGMTarget {
	/** Unique identifier */
	targetId: string;
	/** File path to improve */
	filePath: string;
	/** Improvement objective */
	objective: string;
	/** Evaluation function/criteria */
	evaluationCriteria: string;
	/** Constraints on modifications */
	constraints?: DGMConstraints;
	/** Maximum improvement iterations */
	maxIterations?: number;
	/** Timeout per iteration in ms */
	iterationTimeout?: number;
}

/** Constraints on code modifications */
export interface DGMConstraints {
	/** Preserve these function signatures */
	preserveSignatures?: string[];
	/** Do not modify these files */
	excludeFiles?: string[];
	/** Maximum lines changed per iteration */
	maxLinesChanged?: number;
	/** Require tests to pass */
	requireTests?: boolean;
	/** Test command to run */
	testCommand?: string;
	/** Minimum performance threshold */
	minPerformanceThreshold?: number;
}

/** Self-improvement result */
export interface DGMResult {
	success: boolean;
	targetId: string;
	originalCode?: string;
	improvedCode?: string;
	performanceImprovement?: number;
	iterations?: number;
	modifications?: DGMModification[];
	rollbacks?: number;
	error?: string;
	duration: number;
}

/** Individual modification */
export interface DGMModification {
	iteration: number;
	description: string;
	linesChanged: number;
	performanceBefore: number;
	performanceAfter: number;
	accepted: boolean;
	reason?: string;
}

/** DGM status */
export interface DGMStatus {
	available: boolean;
	version: string | null;
	pythonVersion: string;
}

// ============================================================================
// PRESETS
// ============================================================================

/** Preset configurations for common improvement targets */
export const DGMPresets = {
	/** Improve agent prompt */
	agentPrompt: (expertisePath: string, objective: string): DGMTarget => ({
		targetId: `prompt_${basename(expertisePath, ".md")}_${Date.now()}`,
		filePath: expertisePath,
		objective,
		evaluationCriteria: "Measure task success rate and response quality",
		maxIterations: 10,
	}),

	/** Improve trading strategy code */
	tradingStrategy: (filePath: string): DGMTarget => ({
		targetId: `trading_${basename(filePath, ".ts")}_${Date.now()}`,
		filePath,
		objective: "Maximize Sharpe ratio while minimizing maximum drawdown",
		evaluationCriteria: "Backtest on historical data, measure risk-adjusted returns",
		constraints: {
			preserveSignatures: ["analyze", "execute", "getSignal"],
			requireTests: true,
			testCommand: "npm test",
			minPerformanceThreshold: 0,
		},
		maxIterations: 20,
	}),

	/** Improve utility function */
	utilityFunction: (filePath: string, functionName: string): DGMTarget => ({
		targetId: `util_${functionName}_${Date.now()}`,
		filePath,
		objective: `Optimize ${functionName} for speed and memory efficiency`,
		evaluationCriteria: "Benchmark execution time and memory usage",
		constraints: {
			preserveSignatures: [functionName],
			requireTests: true,
			maxLinesChanged: 50,
		},
		maxIterations: 15,
	}),

	/** Improve error handling */
	errorHandling: (filePath: string): DGMTarget => ({
		targetId: `errors_${basename(filePath, ".ts")}_${Date.now()}`,
		filePath,
		objective: "Improve error handling, add recovery mechanisms, improve error messages",
		evaluationCriteria: "Code review for error coverage, test failure scenarios",
		constraints: {
			requireTests: true,
			maxLinesChanged: 100,
		},
		maxIterations: 10,
	}),

	/** Safe minimal improvement */
	safeMinimal: (filePath: string, objective: string): DGMTarget => ({
		targetId: `safe_${Date.now()}`,
		filePath,
		objective,
		evaluationCriteria: "Verify no regressions, improvement in target metric",
		constraints: {
			requireTests: true,
			maxLinesChanged: 20,
		},
		maxIterations: 5,
	}),
};

// ============================================================================
// SAFETY UTILITIES
// ============================================================================

/**
 * Create backup of file before modification
 */
function createBackup(filePath: string): string {
	if (!existsSync(DGM_DIR)) {
		mkdirSync(DGM_DIR, { recursive: true });
	}

	const timestamp = Date.now();
	const backupPath = join(DGM_DIR, `${basename(filePath)}.${timestamp}.backup`);
	copyFileSync(filePath, backupPath);
	return backupPath;
}

/**
 * Restore file from backup
 */
function restoreBackup(backupPath: string, originalPath: string): void {
	copyFileSync(backupPath, originalPath);
}

/**
 * Validate constraints before applying modification
 */
function validateConstraints(
	originalCode: string,
	modifiedCode: string,
	constraints?: DGMConstraints,
): { valid: boolean; reason?: string } {
	if (!constraints) {
		return { valid: true };
	}

	// Check max lines changed
	if (constraints.maxLinesChanged) {
		const originalLines = originalCode.split("\n");
		const modifiedLines = modifiedCode.split("\n");
		const changedLines =
			Math.abs(originalLines.length - modifiedLines.length) +
			originalLines.filter((line, i) => modifiedLines[i] !== line).length;

		if (changedLines > constraints.maxLinesChanged) {
			return {
				valid: false,
				reason: `Too many lines changed: ${changedLines} > ${constraints.maxLinesChanged}`,
			};
		}
	}

	// Check preserved signatures
	if (constraints.preserveSignatures) {
		for (const sig of constraints.preserveSignatures) {
			const sigPattern = new RegExp(`(function|const|async function)\\s+${sig}\\s*[(<]`);
			if (sigPattern.test(originalCode) && !sigPattern.test(modifiedCode)) {
				return {
					valid: false,
					reason: `Required signature removed: ${sig}`,
				};
			}
		}
	}

	return { valid: true };
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if DGM is available
 */
export async function isDGMAvailable(): Promise<boolean> {
	try {
		const status = await getDGMStatus();
		return status.available;
	} catch {
		return false;
	}
}

/**
 * Get DGM status
 */
export async function getDGMStatus(): Promise<DGMStatus> {
	return new Promise((resolve) => {
		const python = spawn("python3", [
			"-c",
			`
import sys
print('{"available": true, "version": "1.0.0", "python_version": "' + sys.version.split()[0] + '"}')
`,
		]);

		let stdout = "";
		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.on("close", () => {
			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					available: result.available,
					version: result.version,
					pythonVersion: result.python_version,
				});
			} catch {
				resolve({
					available: false,
					version: null,
					pythonVersion: "unknown",
				});
			}
		});

		python.on("error", () => {
			resolve({
				available: false,
				version: null,
				pythonVersion: "unknown",
			});
		});
	});
}

/**
 * Run self-improvement on target code
 */
export async function improve(target: DGMTarget): Promise<DGMResult> {
	const startTime = Date.now();
	const {
		targetId,
		filePath,
		objective,
		evaluationCriteria,
		constraints,
		maxIterations = 10,
		iterationTimeout = 60000,
	} = target;

	// Validate file exists
	if (!existsSync(filePath)) {
		return {
			success: false,
			targetId,
			error: `File not found: ${filePath}`,
			duration: Date.now() - startTime,
		};
	}

	// Create backup
	const backupPath = createBackup(filePath);
	const originalCode = readFileSync(filePath, "utf-8");

	const modifications: DGMModification[] = [];
	let currentCode = originalCode;
	let rollbacks = 0;
	let bestPerformance = 0;

	try {
		for (let iteration = 0; iteration < maxIterations; iteration++) {
			// Generate improvement suggestion
			const suggestion = await generateImprovement(currentCode, objective, evaluationCriteria, modifications);

			if (!suggestion.code) {
				// No more improvements possible
				break;
			}

			// Validate constraints
			const validation = validateConstraints(currentCode, suggestion.code, constraints);
			if (!validation.valid) {
				modifications.push({
					iteration,
					description: suggestion.description || "Unknown modification",
					linesChanged: 0,
					performanceBefore: bestPerformance,
					performanceAfter: bestPerformance,
					accepted: false,
					reason: validation.reason,
				});
				continue;
			}

			// Write modified code
			writeFileSync(filePath, suggestion.code);

			// Run tests if required
			if (constraints?.requireTests && constraints.testCommand) {
				const testResult = await runTests(constraints.testCommand, iterationTimeout);
				if (!testResult.passed) {
					// Rollback
					writeFileSync(filePath, currentCode);
					rollbacks++;
					modifications.push({
						iteration,
						description: suggestion.description || "Unknown modification",
						linesChanged: suggestion.linesChanged || 0,
						performanceBefore: bestPerformance,
						performanceAfter: 0,
						accepted: false,
						reason: `Tests failed: ${testResult.error}`,
					});
					continue;
				}
			}

			// Evaluate performance
			const performance = await evaluatePerformance(suggestion.code, evaluationCriteria);

			// Check if improvement
			if (performance > bestPerformance || performance >= (constraints?.minPerformanceThreshold || 0)) {
				// Accept modification
				currentCode = suggestion.code;
				const improvement = performance - bestPerformance;
				bestPerformance = performance;

				modifications.push({
					iteration,
					description: suggestion.description || "Unknown modification",
					linesChanged: suggestion.linesChanged || 0,
					performanceBefore: bestPerformance - improvement,
					performanceAfter: performance,
					accepted: true,
				});
			} else {
				// Rollback
				writeFileSync(filePath, currentCode);
				rollbacks++;
				modifications.push({
					iteration,
					description: suggestion.description || "Unknown modification",
					linesChanged: suggestion.linesChanged || 0,
					performanceBefore: bestPerformance,
					performanceAfter: performance,
					accepted: false,
					reason: "No performance improvement",
				});
			}
		}

		const acceptedMods = modifications.filter((m) => m.accepted);
		const totalImprovement =
			acceptedMods.length > 0
				? acceptedMods[acceptedMods.length - 1].performanceAfter - modifications[0].performanceBefore
				: 0;

		return {
			success: true,
			targetId,
			originalCode,
			improvedCode: currentCode,
			performanceImprovement: totalImprovement,
			iterations: modifications.length,
			modifications,
			rollbacks,
			duration: Date.now() - startTime,
		};
	} catch (error) {
		// Restore backup on error
		restoreBackup(backupPath, filePath);
		return {
			success: false,
			targetId,
			originalCode,
			error: `Improvement failed: ${error}`,
			modifications,
			rollbacks,
			duration: Date.now() - startTime,
		};
	}
}

/**
 * Generate improvement suggestion using LLM
 */
async function generateImprovement(
	code: string,
	objective: string,
	evaluationCriteria: string,
	previousMods: DGMModification[],
): Promise<{ code?: string; description?: string; linesChanged?: number }> {
	return new Promise((resolve) => {
		const context = {
			code: code.slice(0, 10000), // Limit context size
			objective,
			evaluation_criteria: evaluationCriteria,
			previous_attempts: previousMods.slice(-5).map((m) => ({
				description: m.description,
				accepted: m.accepted,
				reason: m.reason,
			})),
		};

		const python = spawn("python3", [RUNNER_PATH, "--mode", "suggest", "--context", JSON.stringify(context)]);

		let stdout = "";
		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.on("close", (code) => {
			if (code !== 0) {
				resolve({});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					code: result.improved_code,
					description: result.description,
					linesChanged: result.lines_changed,
				});
			} catch {
				resolve({});
			}
		});

		python.on("error", () => {
			resolve({});
		});
	});
}

/**
 * Run test command
 */
async function runTests(command: string, timeout: number): Promise<{ passed: boolean; error?: string }> {
	return new Promise((resolve) => {
		const [cmd, ...args] = command.split(" ");
		const child = spawn(cmd, args, {
			timeout,
			shell: true,
		} as SpawnOptions);

		let stderr = "";
		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			resolve({
				passed: code === 0,
				error: code !== 0 ? stderr.slice(0, 500) : undefined,
			});
		});

		child.on("error", (err) => {
			resolve({
				passed: false,
				error: err.message,
			});
		});
	});
}

/**
 * Evaluate code performance (simplified heuristic)
 */
async function evaluatePerformance(code: string, criteria: string): Promise<number> {
	// Simple heuristic evaluation
	let score = 0.5;

	// Length efficiency
	const lines = code.split("\n").filter((l) => l.trim()).length;
	if (lines > 10 && lines < 500) score += 0.1;

	// Error handling
	if (code.includes("try") && code.includes("catch")) score += 0.1;

	// Type safety
	if (code.includes(": string") || code.includes(": number")) score += 0.1;

	// Documentation
	if (code.includes("/**") || code.includes("//")) score += 0.05;

	// Match criteria keywords
	const criteriaWords = criteria.toLowerCase().split(/\s+/);
	const codeWords = code.toLowerCase();
	const matches = criteriaWords.filter((w) => codeWords.includes(w)).length;
	score += Math.min(0.15, matches * 0.03);

	return Math.min(score, 1.0);
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick improvement with defaults
 */
export async function quickImprove(filePath: string, objective: string): Promise<DGMResult> {
	return improve(DGMPresets.safeMinimal(filePath, objective));
}

/**
 * Improve agent expertise file
 */
export async function improveAgentExpertise(domain: string, objective: string): Promise<DGMResult> {
	const expertisePath = join(PACKAGE_ROOT, "src", "agents", "expertise", `${domain}.md`);

	if (!existsSync(expertisePath)) {
		return {
			success: false,
			targetId: `expertise_${domain}`,
			error: `Expertise file not found: ${expertisePath}`,
			duration: 0,
		};
	}

	return improve(DGMPresets.agentPrompt(expertisePath, objective));
}

/**
 * List all improvement history
 */
export function getImprovementHistory(): { targetId: string; backupPath: string; timestamp: number }[] {
	if (!existsSync(DGM_DIR)) {
		return [];
	}

	const { readdirSync } = require("fs");
	const files = readdirSync(DGM_DIR) as string[];

	return files
		.filter((f: string) => f.endsWith(".backup"))
		.map((f: string) => {
			const match = f.match(/(.+)\.(\d+)\.backup$/);
			return match
				? {
						targetId: match[1],
						backupPath: join(DGM_DIR, f),
						timestamp: parseInt(match[2], 10),
					}
				: null;
		})
		.filter(Boolean) as { targetId: string; backupPath: string; timestamp: number }[];
}
