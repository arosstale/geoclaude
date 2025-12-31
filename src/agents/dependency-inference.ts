/**
 * DEPENDENCY INFERENCE SYSTEM
 *
 * Learned from Agentis Framework - Auto-detect task relationships using NLP
 * Automatically infers dependencies between tasks based on:
 * - Content similarity
 * - Information flow (what each task needs/produces)
 * - Task type hierarchy (research → analysis → writing)
 * - Keyword extraction and matching
 */

import { EventEmitter } from "events";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface InferenceTask {
	id: string;
	description: string;
	dependencies: string[];
	status: "pending" | "in_progress" | "completed" | "failed";
	type?: TaskType;
	produces?: string[]; // What information this task produces
	requires?: string[]; // What information this task needs
}

export type TaskType =
	| "research"
	| "analysis"
	| "writing"
	| "coding"
	| "testing"
	| "review"
	| "planning"
	| "execution"
	| "validation"
	| "unknown";

export interface DependencyLink {
	from: string;
	to: string;
	certainty: number; // 0-1
	reason: string;
}

export interface InferenceConfig {
	enableContentSimilarity: boolean;
	enableTypeHierarchy: boolean;
	enableInformationFlow: boolean;
	minDependencyCertainty: number; // 0-1, minimum confidence to create link
	maxDependenciesPerTask: number;
}

export interface InferenceResult {
	tasks: InferenceTask[];
	links: DependencyLink[];
	graph: string; // ASCII visualization
}

// ============================================================================
// TASK TYPE DETECTION
// ============================================================================

const TASK_TYPE_KEYWORDS: Record<TaskType, string[]> = {
	research: ["research", "find", "search", "gather", "collect", "discover", "investigate", "explore"],
	analysis: ["analyze", "analyse", "examine", "evaluate", "assess", "study", "compare", "review data"],
	writing: ["write", "draft", "create document", "compose", "author", "report", "document"],
	coding: ["code", "implement", "develop", "program", "build", "create function", "fix bug"],
	testing: ["test", "verify", "validate code", "check", "qa", "quality"],
	review: ["review", "approve", "feedback", "critique", "inspect"],
	planning: ["plan", "design", "architect", "strategy", "outline", "propose"],
	execution: ["execute", "run", "deploy", "launch", "perform", "do"],
	validation: ["validate", "confirm", "ensure", "verify results"],
	unknown: [],
};

// Task type hierarchy - earlier types typically feed into later types
const TYPE_HIERARCHY: TaskType[] = [
	"planning",
	"research",
	"analysis",
	"coding",
	"testing",
	"review",
	"validation",
	"writing",
	"execution",
];

function detectTaskType(description: string): TaskType {
	const lower = description.toLowerCase();

	for (const [type, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
		if (type === "unknown") continue;
		if (keywords.some((kw) => lower.includes(kw))) {
			return type as TaskType;
		}
	}

	return "unknown";
}

// ============================================================================
// KEYWORD EXTRACTION
// ============================================================================

// Common stop words to ignore
const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"but",
	"in",
	"on",
	"at",
	"to",
	"for",
	"of",
	"with",
	"by",
	"from",
	"as",
	"is",
	"was",
	"are",
	"were",
	"been",
	"be",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"must",
	"shall",
	"can",
	"need",
	"this",
	"that",
	"these",
	"those",
	"i",
	"you",
	"he",
	"she",
	"it",
	"we",
	"they",
	"what",
	"which",
	"who",
	"whom",
	"when",
	"where",
	"why",
	"how",
	"all",
	"each",
	"every",
	"both",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"not",
	"only",
	"own",
	"same",
	"so",
	"than",
	"too",
	"very",
	"just",
	"also",
]);

function extractKeywords(text: string): string[] {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w));

	// Remove duplicates and return
	return [...new Set(words)];
}

// ============================================================================
// SIMILARITY CALCULATION
// ============================================================================

function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
	if (set1.size === 0 && set2.size === 0) return 0;

	const intersection = new Set([...set1].filter((x) => set2.has(x)));
	const union = new Set([...set1, ...set2]);

	return intersection.size / union.size;
}

function contentSimilarity(desc1: string, desc2: string): number {
	const kw1 = new Set(extractKeywords(desc1));
	const kw2 = new Set(extractKeywords(desc2));
	return jaccardSimilarity(kw1, kw2);
}

// ============================================================================
// INFORMATION FLOW DETECTION
// ============================================================================

// Keywords that indicate a task produces information
const PRODUCES_KEYWORDS = [
	"create",
	"generate",
	"produce",
	"build",
	"make",
	"develop",
	"write",
	"draft",
	"compile",
	"gather",
	"collect",
	"find",
	"analyze",
	"compute",
	"calculate",
	"determine",
	"identify",
];

// Keywords that indicate a task requires information
const REQUIRES_KEYWORDS = [
	"based on",
	"using",
	"from",
	"with",
	"given",
	"according to",
	"after",
	"following",
	"considering",
	"reviewing",
	"analyzing",
];

function detectInformationFlow(description: string): { produces: string[]; requires: string[] } {
	const lower = description.toLowerCase();
	const keywords = extractKeywords(description);

	const produces: string[] = [];
	const requires: string[] = [];

	// Check for production patterns
	for (const kw of PRODUCES_KEYWORDS) {
		if (lower.includes(kw)) {
			// Extract what follows the keyword as potential output
			const regex = new RegExp(`${kw}\\s+(?:a\\s+|the\\s+)?([\\w\\s]+?)(?:\\s+(?:for|from|with|based)|$)`, "i");
			const match = lower.match(regex);
			if (match) {
				produces.push(...extractKeywords(match[1]));
			}
		}
	}

	// Check for requirement patterns
	for (const kw of REQUIRES_KEYWORDS) {
		if (lower.includes(kw)) {
			const regex = new RegExp(`${kw}\\s+(?:the\\s+)?([\\w\\s]+?)(?:\\s+(?:and|to|for)|$)`, "i");
			const match = lower.match(regex);
			if (match) {
				requires.push(...extractKeywords(match[1]));
			}
		}
	}

	// Also add all keywords as potential outputs for simpler matching
	if (produces.length === 0) {
		produces.push(...keywords.slice(0, 5));
	}

	return { produces, requires };
}

// ============================================================================
// DEPENDENCY INFERENCE ENGINE
// ============================================================================

export class DependencyInference extends EventEmitter {
	private config: InferenceConfig;

	constructor(config: Partial<InferenceConfig> = {}) {
		super();
		this.config = {
			enableContentSimilarity: true,
			enableTypeHierarchy: true,
			enableInformationFlow: true,
			minDependencyCertainty: 0.4,
			maxDependenciesPerTask: 3,
			...config,
		};
	}

	/**
	 * Infer dependencies between tasks
	 */
	inferDependencies(tasks: InferenceTask[], context?: string): InferenceResult {
		const links: DependencyLink[] = [];

		// Enrich tasks with detected types and information flow
		const enrichedTasks = tasks.map((task) => ({
			...task,
			type: task.type || detectTaskType(task.description),
			...detectInformationFlow(task.description),
		}));

		// Compare each pair of tasks
		for (let i = 0; i < enrichedTasks.length; i++) {
			for (let j = 0; j < enrichedTasks.length; j++) {
				if (i === j) continue;

				const taskA = enrichedTasks[i];
				const taskB = enrichedTasks[j];

				// Calculate dependency certainty from multiple signals
				let certainty = 0;
				const reasons: string[] = [];

				// 1. Type hierarchy (does A's type typically precede B's?)
				if (this.config.enableTypeHierarchy) {
					const typeA = taskA.type || "unknown";
					const typeB = taskB.type || "unknown";
					const indexA = TYPE_HIERARCHY.indexOf(typeA);
					const indexB = TYPE_HIERARCHY.indexOf(typeB);

					if (indexA !== -1 && indexB !== -1 && indexA < indexB) {
						const typeBoost = 0.3 * (1 - (indexB - indexA) / TYPE_HIERARCHY.length);
						certainty += typeBoost;
						reasons.push(`type hierarchy: ${typeA} → ${typeB}`);
					}
				}

				// 2. Information flow (does A produce what B requires?)
				if (this.config.enableInformationFlow) {
					const aProduces = new Set(taskA.produces || []);
					const bRequires = new Set(taskB.requires || []);

					if (aProduces.size > 0 && bRequires.size > 0) {
						const overlap = jaccardSimilarity(aProduces, bRequires);
						if (overlap > 0.1) {
							certainty += overlap * 0.4;
							reasons.push(`info flow: ${[...aProduces].slice(0, 2).join(", ")} → needed`);
						}
					}
				}

				// 3. Content similarity
				if (this.config.enableContentSimilarity) {
					const similarity = contentSimilarity(taskA.description, taskB.description);
					if (similarity > 0.2) {
						certainty += similarity * 0.3;
						reasons.push(`content similarity: ${(similarity * 100).toFixed(0)}%`);
					}
				}

				// 4. Context hints (if provided)
				if (context) {
					const contextLower = context.toLowerCase();
					const aKeywords = extractKeywords(taskA.description);
					const bKeywords = extractKeywords(taskB.description);

					// Look for ordering hints in context
					for (const aKw of aKeywords) {
						for (const bKw of bKeywords) {
							// Check if context mentions A before B
							const aIndex = contextLower.indexOf(aKw);
							const bIndex = contextLower.indexOf(bKw);
							if (aIndex !== -1 && bIndex !== -1 && aIndex < bIndex) {
								certainty += 0.1;
								reasons.push(`context order: "${aKw}" before "${bKw}"`);
								break;
							}
						}
						if (reasons.length > 0 && reasons[reasons.length - 1].startsWith("context")) break;
					}
				}

				// Create link if above threshold
				if (certainty >= this.config.minDependencyCertainty) {
					links.push({
						from: taskA.id,
						to: taskB.id,
						certainty: Math.min(1, certainty),
						reason: reasons.join("; "),
					});
				}
			}
		}

		// Sort by certainty and limit dependencies per task
		links.sort((a, b) => b.certainty - a.certainty);

		const dependencyCount: Record<string, number> = {};
		const filteredLinks = links.filter((link) => {
			const count = dependencyCount[link.to] || 0;
			if (count >= this.config.maxDependenciesPerTask) return false;
			dependencyCount[link.to] = count + 1;
			return true;
		});

		// Update tasks with inferred dependencies
		const updatedTasks = enrichedTasks.map((task) => ({
			...task,
			dependencies: [
				...new Set([...task.dependencies, ...filteredLinks.filter((l) => l.to === task.id).map((l) => l.from)]),
			],
		}));

		const graph = this.visualizeDependencyGraph(updatedTasks, filteredLinks);

		this.emit("inferred", { tasks: updatedTasks, links: filteredLinks });

		return {
			tasks: updatedTasks,
			links: filteredLinks,
			graph,
		};
	}

	/**
	 * Create ASCII visualization of dependency graph
	 */
	visualizeDependencyGraph(tasks: InferenceTask[], links?: DependencyLink[]): string {
		const lines: string[] = ["```", "DEPENDENCY GRAPH", "================", ""];

		// Build adjacency info
		const inDegree: Record<string, number> = {};
		const outLinks: Record<string, string[]> = {};

		for (const task of tasks) {
			inDegree[task.id] = task.dependencies.length;
			outLinks[task.id] = [];
		}

		for (const task of tasks) {
			for (const dep of task.dependencies) {
				if (outLinks[dep]) {
					outLinks[dep].push(task.id);
				}
			}
		}

		// Find root tasks (no dependencies)
		const roots = tasks.filter((t) => t.dependencies.length === 0);

		// BFS to display in order
		const visited = new Set<string>();
		const queue = [...roots];
		let level = 0;

		while (queue.length > 0) {
			const levelSize = queue.length;
			const levelTasks: string[] = [];

			for (let i = 0; i < levelSize; i++) {
				const task = queue.shift()!;
				if (visited.has(task.id)) continue;
				visited.add(task.id);

				const taskInfo = tasks.find((t) => t.id === task.id)!;
				const statusIcon = taskInfo.status === "completed" ? "✓" : taskInfo.status === "in_progress" ? "▶" : "○";
				const typeTag = taskInfo.type ? `[${taskInfo.type}]` : "";

				levelTasks.push(`${statusIcon} ${task.id} ${typeTag}`);

				// Add children to queue
				for (const child of outLinks[task.id] || []) {
					queue.push(tasks.find((t) => t.id === child)!);
				}
			}

			if (levelTasks.length > 0) {
				const indent = "  ".repeat(level);
				for (const taskStr of levelTasks) {
					lines.push(`${indent}${taskStr}`);
				}
				if (level < 5) lines.push(`${indent}  ↓`);
				level++;
			}
		}

		// Show any unvisited tasks (cycles or disconnected)
		const unvisited = tasks.filter((t) => !visited.has(t.id));
		if (unvisited.length > 0) {
			lines.push("");
			lines.push("DISCONNECTED:");
			for (const task of unvisited) {
				lines.push(`  ? ${task.id}`);
			}
		}

		// Show link details if provided
		if (links && links.length > 0) {
			lines.push("");
			lines.push("INFERRED LINKS:");
			for (const link of links.slice(0, 10)) {
				lines.push(`  ${link.from} → ${link.to} (${(link.certainty * 100).toFixed(0)}%)`);
				lines.push(`    reason: ${link.reason}`);
			}
		}

		lines.push("```");
		return lines.join("\n");
	}

	/**
	 * Get execution order based on dependencies
	 */
	getExecutionOrder(tasks: InferenceTask[]): InferenceTask[] {
		const result: InferenceTask[] = [];
		const visited = new Set<string>();
		const inProgress = new Set<string>();

		const visit = (task: InferenceTask): boolean => {
			if (visited.has(task.id)) return true;
			if (inProgress.has(task.id)) {
				// Cycle detected
				this.emit("cycleDetected", task.id);
				return false;
			}

			inProgress.add(task.id);

			// Visit dependencies first
			for (const depId of task.dependencies) {
				const dep = tasks.find((t) => t.id === depId);
				if (dep && !visit(dep)) return false;
			}

			inProgress.delete(task.id);
			visited.add(task.id);
			result.push(task);
			return true;
		};

		for (const task of tasks) {
			if (!visited.has(task.id)) {
				visit(task);
			}
		}

		return result;
	}

	/**
	 * Check if dependencies are satisfied for a task
	 */
	canExecute(task: InferenceTask, allTasks: InferenceTask[]): boolean {
		for (const depId of task.dependencies) {
			const dep = allTasks.find((t) => t.id === depId);
			if (!dep || dep.status !== "completed") {
				return false;
			}
		}
		return true;
	}

	/**
	 * Get next executable tasks
	 */
	getNextTasks(tasks: InferenceTask[]): InferenceTask[] {
		return tasks.filter((t) => t.status === "pending" && this.canExecute(t, tasks));
	}
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createDependencyInference(config?: Partial<InferenceConfig>): DependencyInference {
	return new DependencyInference(config);
}

/**
 * Quick inference with default settings
 */
export function inferTaskDependencies(
	tasks: Array<{ id: string; description: string }>,
	context?: string,
): InferenceResult {
	const inference = new DependencyInference();
	const fullTasks: InferenceTask[] = tasks.map((t) => ({
		...t,
		dependencies: [],
		status: "pending",
	}));
	return inference.inferDependencies(fullTasks, context);
}

export default DependencyInference;
