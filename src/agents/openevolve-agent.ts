/**
 * OpenEvolve Agent - LLM-based Evolutionary Code Optimization
 *
 * Integrates OpenEvolve (open-source AlphaEvolve) for evolutionary code improvement.
 * Uses MAP-Elites algorithm with island-based evolution for diverse solution discovery.
 *
 * Features:
 * - Evolutionary code optimization via LLM mutations
 * - MAP-Elites quality-diversity algorithm
 * - Island-based parallel population evolution
 * - Integration with Agent Experts for domain-specific evolution
 *
 * GitHub: codelion/openevolve (4.4k stars)
 * Install: pip install openevolve
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const RUNNER_PATH = join(PACKAGE_ROOT, "src", "agents", "openevolve-runner.py");
const EVOLUTION_DIR = join(PACKAGE_ROOT, "data", "evolution");

// ============================================================================
// TYPES
// ============================================================================

/** Evolution task configuration */
export interface OpenEvolveTask {
	/** Unique task identifier */
	taskId: string;
	/** Initial code/prompt to evolve */
	seed: string;
	/** Evaluation function description */
	evaluationCriteria: string;
	/** Domain for evolution (coding, trading, research, etc.) */
	domain?: string;
	/** Maximum evolution generations */
	maxGenerations?: number;
	/** Population size per generation */
	populationSize?: number;
	/** Number of parallel islands */
	numIslands?: number;
	/** Model for mutations */
	mutationModel?: string;
	/** Model for evaluation */
	evaluationModel?: string;
	/** Enable elitism (preserve top performers) */
	elitism?: boolean;
	/** Crossover rate (0-1) */
	crossoverRate?: number;
	/** Mutation rate (0-1) */
	mutationRate?: number;
	/** Timeout in milliseconds */
	timeout?: number;
}

/** Evolution result */
export interface OpenEvolveResult {
	success: boolean;
	taskId: string;
	bestSolution?: string;
	bestFitness?: number;
	generations?: number;
	totalEvaluations?: number;
	diversityScore?: number;
	paretoFront?: EvolutionCandidate[];
	history?: GenerationHistory[];
	error?: string;
	duration: number;
}

/** Individual evolution candidate */
export interface EvolutionCandidate {
	id: string;
	content: string;
	fitness: number;
	novelty: number;
	generation: number;
	parentId?: string;
	mutationType?: "point" | "crossover" | "insertion" | "deletion";
}

/** Generation history entry */
export interface GenerationHistory {
	generation: number;
	bestFitness: number;
	avgFitness: number;
	diversity: number;
	populationSize: number;
	improvements: number;
}

/** OpenEvolve service status */
export interface OpenEvolveStatus {
	available: boolean;
	version: string | null;
	pythonVersion: string;
	hasGPU: boolean;
}

// ============================================================================
// PRESETS
// ============================================================================

/** Preset configurations for common evolution scenarios */
export const OpenEvolvePresets = {
	/** Quick evolution for prompt optimization */
	quickPrompt: (seed: string, criteria: string): OpenEvolveTask => ({
		taskId: `quick_${Date.now()}`,
		seed,
		evaluationCriteria: criteria,
		maxGenerations: 10,
		populationSize: 8,
		numIslands: 2,
		elitism: true,
	}),

	/** Thorough code evolution */
	thoroughCode: (seed: string, criteria: string): OpenEvolveTask => ({
		taskId: `thorough_${Date.now()}`,
		seed,
		evaluationCriteria: criteria,
		domain: "coding",
		maxGenerations: 50,
		populationSize: 20,
		numIslands: 4,
		elitism: true,
		crossoverRate: 0.7,
		mutationRate: 0.3,
	}),

	/** Trading strategy evolution */
	tradingStrategy: (seed: string): OpenEvolveTask => ({
		taskId: `trading_${Date.now()}`,
		seed,
		evaluationCriteria:
			"Maximize risk-adjusted returns (Sharpe ratio), minimize drawdown, ensure positive expectancy",
		domain: "trading",
		maxGenerations: 100,
		populationSize: 30,
		numIslands: 6,
		elitism: true,
		crossoverRate: 0.6,
		mutationRate: 0.4,
	}),

	/** Research hypothesis evolution */
	researchHypothesis: (seed: string, field: string): OpenEvolveTask => ({
		taskId: `research_${Date.now()}`,
		seed,
		evaluationCriteria: `Generate novel, testable hypotheses in ${field}. Prioritize: novelty, feasibility, impact potential`,
		domain: "research",
		maxGenerations: 30,
		populationSize: 15,
		numIslands: 3,
		elitism: true,
	}),

	/** Agent prompt evolution (for self-improvement) */
	agentPrompt: (seed: string, agentType: string): OpenEvolveTask => ({
		taskId: `agent_${agentType}_${Date.now()}`,
		seed,
		evaluationCriteria: `Optimize agent system prompt for ${agentType} tasks. Maximize: task success rate, response quality, efficiency`,
		domain: agentType,
		maxGenerations: 40,
		populationSize: 12,
		numIslands: 3,
		elitism: true,
		crossoverRate: 0.5,
		mutationRate: 0.5,
	}),
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if OpenEvolve is available
 */
export async function isOpenEvolveAvailable(): Promise<boolean> {
	try {
		const status = await getOpenEvolveStatus();
		return status.available;
	} catch {
		return false;
	}
}

/**
 * Get OpenEvolve status and version info
 */
export async function getOpenEvolveStatus(): Promise<OpenEvolveStatus> {
	return new Promise((resolve) => {
		const python = spawn("python3", [
			"-c",
			`
import sys
try:
    import openevolve
    print('{"available": true, "version": "' + getattr(openevolve, '__version__', 'unknown') + '", "python_version": "' + sys.version.split()[0] + '", "has_gpu": false}')
except ImportError:
    print('{"available": false, "version": null, "python_version": "' + sys.version.split()[0] + '", "has_gpu": false}')
`,
		]);

		let stdout = "";
		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.on("close", (_code) => {
			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					available: result.available,
					version: result.version,
					pythonVersion: result.python_version,
					hasGPU: result.has_gpu,
				});
			} catch {
				resolve({
					available: false,
					version: null,
					pythonVersion: "unknown",
					hasGPU: false,
				});
			}
		});

		python.on("error", () => {
			resolve({
				available: false,
				version: null,
				pythonVersion: "unknown",
				hasGPU: false,
			});
		});
	});
}

/**
 * Run evolutionary optimization on code/prompts
 */
export async function evolve(task: OpenEvolveTask): Promise<OpenEvolveResult> {
	const startTime = Date.now();

	const {
		taskId,
		seed,
		evaluationCriteria,
		domain = "general",
		maxGenerations = 20,
		populationSize = 10,
		numIslands = 2,
		mutationModel = "openai/gpt-4.1-mini",
		evaluationModel = "openai/gpt-4.1-mini",
		elitism = true,
		crossoverRate = 0.6,
		mutationRate = 0.4,
		timeout = 600000, // 10 minutes default
	} = task;

	// Ensure evolution directory exists
	if (!existsSync(EVOLUTION_DIR)) {
		mkdirSync(EVOLUTION_DIR, { recursive: true });
	}

	return new Promise((resolve) => {
		const taskConfig = {
			task_id: taskId,
			seed,
			evaluation_criteria: evaluationCriteria,
			domain,
			max_generations: maxGenerations,
			population_size: populationSize,
			num_islands: numIslands,
			mutation_model: mutationModel,
			evaluation_model: evaluationModel,
			elitism,
			crossover_rate: crossoverRate,
			mutation_rate: mutationRate,
			output_dir: EVOLUTION_DIR,
		};

		const python = spawn("python3", [RUNNER_PATH, "--mode", "evolve", "--config", JSON.stringify(taskConfig)], {
			timeout,
		});

		let stdout = "";
		let stderr = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		python.on("close", (code) => {
			const duration = Date.now() - startTime;

			if (code !== 0) {
				resolve({
					success: false,
					taskId,
					error: stderr || `Process exited with code ${code}`,
					duration,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					success: result.success,
					taskId: result.task_id,
					bestSolution: result.best_solution,
					bestFitness: result.best_fitness,
					generations: result.generations,
					totalEvaluations: result.total_evaluations,
					diversityScore: result.diversity_score,
					paretoFront: result.pareto_front?.map((c: any) => ({
						id: c.id,
						content: c.content,
						fitness: c.fitness,
						novelty: c.novelty,
						generation: c.generation,
						parentId: c.parent_id,
						mutationType: c.mutation_type,
					})),
					history: result.history?.map((h: any) => ({
						generation: h.generation,
						bestFitness: h.best_fitness,
						avgFitness: h.avg_fitness,
						diversity: h.diversity,
						populationSize: h.population_size,
						improvements: h.improvements,
					})),
					error: result.error,
					duration,
				});
			} catch (e) {
				resolve({
					success: false,
					taskId,
					error: `Failed to parse output: ${e}`,
					duration,
				});
			}
		});

		python.on("error", (err) => {
			resolve({
				success: false,
				taskId,
				error: `Failed to spawn process: ${err.message}`,
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Continue evolution from a checkpoint
 */
export async function continueEvolution(taskId: string, additionalGenerations: number = 10): Promise<OpenEvolveResult> {
	const checkpointPath = join(EVOLUTION_DIR, `${taskId}_checkpoint.json`);

	if (!existsSync(checkpointPath)) {
		return {
			success: false,
			taskId,
			error: `No checkpoint found for task: ${taskId}`,
			duration: 0,
		};
	}

	const startTime = Date.now();

	return new Promise((resolve) => {
		const python = spawn("python3", [
			RUNNER_PATH,
			"--mode",
			"continue",
			"--task-id",
			taskId,
			"--additional-generations",
			additionalGenerations.toString(),
			"--checkpoint-dir",
			EVOLUTION_DIR,
		]);

		let stdout = "";
		let stderr = "";

		python.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		python.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		python.on("close", (code) => {
			const duration = Date.now() - startTime;

			if (code !== 0) {
				resolve({
					success: false,
					taskId,
					error: stderr || `Process exited with code ${code}`,
					duration,
				});
				return;
			}

			try {
				const result = JSON.parse(stdout.trim());
				resolve({
					success: result.success,
					taskId: result.task_id,
					bestSolution: result.best_solution,
					bestFitness: result.best_fitness,
					generations: result.generations,
					totalEvaluations: result.total_evaluations,
					diversityScore: result.diversity_score,
					error: result.error,
					duration,
				});
			} catch (e) {
				resolve({
					success: false,
					taskId,
					error: `Failed to parse output: ${e}`,
					duration,
				});
			}
		});

		python.on("error", (err) => {
			resolve({
				success: false,
				taskId,
				error: `Failed to spawn process: ${err.message}`,
				duration: Date.now() - startTime,
			});
		});
	});
}

/**
 * Get evolution task status
 */
export async function getEvolutionStatus(
	taskId: string,
): Promise<{ active: boolean; generation: number; bestFitness: number } | null> {
	const statusPath = join(EVOLUTION_DIR, `${taskId}_status.json`);

	if (!existsSync(statusPath)) {
		return null;
	}

	try {
		const status = JSON.parse(readFileSync(statusPath, "utf-8"));
		return {
			active: status.active,
			generation: status.generation,
			bestFitness: status.best_fitness,
		};
	} catch {
		return null;
	}
}

/**
 * List all evolution tasks
 */
export function listEvolutionTasks(): string[] {
	if (!existsSync(EVOLUTION_DIR)) {
		return [];
	}

	const { readdirSync } = require("fs");
	const files = readdirSync(EVOLUTION_DIR) as string[];

	return files
		.filter((f: string) => f.endsWith("_checkpoint.json"))
		.map((f: string) => f.replace("_checkpoint.json", ""));
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick evolution with sensible defaults
 */
export async function quickEvolve(seed: string, criteria: string, generations: number = 10): Promise<OpenEvolveResult> {
	return evolve({
		...OpenEvolvePresets.quickPrompt(seed, criteria),
		maxGenerations: generations,
	});
}

/**
 * Evolve agent prompt for self-improvement
 */
export async function evolveAgentPrompt(
	agentType: string,
	currentPrompt: string,
	examples: { input: string; expectedOutput: string }[],
): Promise<OpenEvolveResult> {
	const criteria = `
Optimize the agent system prompt to maximize performance on these example tasks:
${examples.map((e, i) => `${i + 1}. Input: "${e.input}" -> Expected: "${e.expectedOutput}"`).join("\n")}

Evaluation criteria:
- Task completion accuracy
- Response quality and coherence
- Efficiency (conciseness without losing information)
- Consistency across similar inputs
`;

	return evolve({
		...OpenEvolvePresets.agentPrompt(currentPrompt, agentType),
		evaluationCriteria: criteria,
	});
}
