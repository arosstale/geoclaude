/**
 * Class 3.32: Delegation Router
 *
 * Smart task routing based on task analysis.
 * Routes to optimal agent/pattern based on task characteristics.
 *
 * Features:
 * - Task classification
 * - Rule-based routing
 * - ML-based routing (optional)
 * - Load balancing
 *
 * @module delegation-router
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type TaskCategory =
	| "coding"
	| "debugging"
	| "refactoring"
	| "documentation"
	| "research"
	| "analysis"
	| "planning"
	| "review"
	| "testing"
	| "security"
	| "trading"
	| "general";

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex" | "expert";

export interface TaskClassification {
	category: TaskCategory;
	complexity: TaskComplexity;
	keywords: string[];
	confidence: number;
	suggestedPatterns: string[];
}

export interface RoutingTarget {
	id: string;
	name: string;
	type: "agent" | "pattern" | "workflow";
	capabilities: string[];
	load: number;
	successRate: number;
}

export interface RoutingRule {
	id: string;
	name: string;
	condition: (task: string, classification: TaskClassification) => boolean;
	target: string;
	priority: number;
	enabled: boolean;
}

export interface RoutingDecision {
	task: string;
	classification: TaskClassification;
	target: RoutingTarget;
	rule?: RoutingRule;
	confidence: number;
	alternatives: RoutingTarget[];
	reasoning: string;
}

export interface DelegationRouterConfig {
	enableMLRouting: boolean;
	loadBalancingWeight: number;
	successRateWeight: number;
	maxAlternatives: number;
	defaultTarget: string;
}

export interface DelegationRouterEvents {
	"task:classified": { task: string; classification: TaskClassification };
	"route:decided": { decision: RoutingDecision };
	"route:fallback": { task: string; reason: string };
	"target:overloaded": { target: RoutingTarget };
}

// =============================================================================
// Classification Patterns
// =============================================================================

const CATEGORY_PATTERNS: Record<TaskCategory, RegExp[]> = {
	coding: [
		/\b(write|create|implement|build|code|program)\b/i,
		/\b(function|class|method|api|endpoint)\b/i,
		/\b(typescript|javascript|python|rust)\b/i,
	],
	debugging: [
		/\b(fix|debug|error|bug|issue|problem)\b/i,
		/\b(crash|fail|broken|not working)\b/i,
		/\b(stack trace|exception|undefined)\b/i,
	],
	refactoring: [
		/\b(refactor|clean|improve|optimize|restructure)\b/i,
		/\b(technical debt|code smell|simplify)\b/i,
	],
	documentation: [
		/\b(document|docs|readme|comment|explain)\b/i,
		/\b(jsdoc|markdown|wiki)\b/i,
	],
	research: [
		/\b(research|investigate|explore|find out|look into)\b/i,
		/\b(compare|evaluate|assess|analyze options)\b/i,
	],
	analysis: [
		/\b(analyze|examine|review|assess|audit)\b/i,
		/\b(performance|metrics|statistics)\b/i,
	],
	planning: [
		/\b(plan|design|architect|structure)\b/i,
		/\b(strategy|roadmap|timeline)\b/i,
	],
	review: [
		/\b(review|check|verify|validate)\b/i,
		/\b(code review|pr review|pull request)\b/i,
	],
	testing: [
		/\b(test|spec|unit test|integration test)\b/i,
		/\b(coverage|jest|vitest|mocha)\b/i,
	],
	security: [
		/\b(security|vulnerability|exploit|auth)\b/i,
		/\b(permissions|access control|encryption)\b/i,
	],
	trading: [
		/\b(trade|trading|market|price|position)\b/i,
		/\b(buy|sell|order|portfolio|strategy)\b/i,
	],
	general: [],
};

const COMPLEXITY_INDICATORS: Record<TaskComplexity, { patterns: RegExp[]; minWords: number }> = {
	trivial: {
		patterns: [/\b(simple|quick|easy|small|minor)\b/i],
		minWords: 0,
	},
	simple: {
		patterns: [/\b(basic|straightforward|single)\b/i],
		minWords: 5,
	},
	moderate: {
		patterns: [/\b(moderate|several|multiple|few)\b/i],
		minWords: 10,
	},
	complex: {
		patterns: [/\b(complex|comprehensive|extensive|many)\b/i],
		minWords: 20,
	},
	expert: {
		patterns: [/\b(advanced|expert|intricate|sophisticated)\b/i],
		minWords: 30,
	},
};

// =============================================================================
// Delegation Router
// =============================================================================

export class DelegationRouter extends EventEmitter {
	private config: DelegationRouterConfig;
	private targets: Map<string, RoutingTarget> = new Map();
	private rules: Map<string, RoutingRule> = new Map();
	private routingHistory: Map<string, RoutingDecision> = new Map();

	constructor(config: Partial<DelegationRouterConfig> = {}) {
		super();
		this.config = {
			enableMLRouting: false,
			loadBalancingWeight: 0.3,
			successRateWeight: 0.7,
			maxAlternatives: 3,
			defaultTarget: "general-agent",
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Target Registration
	// ---------------------------------------------------------------------------

	registerTarget(target: RoutingTarget): void {
		this.targets.set(target.id, target);
	}

	updateTargetLoad(targetId: string, load: number): void {
		const target = this.targets.get(targetId);
		if (target) {
			target.load = load;
			if (load > 0.9) {
				this.emit("target:overloaded", { target });
			}
		}
	}

	updateTargetSuccessRate(targetId: string, successRate: number): void {
		const target = this.targets.get(targetId);
		if (target) {
			target.successRate = successRate;
		}
	}

	// ---------------------------------------------------------------------------
	// Rule Registration
	// ---------------------------------------------------------------------------

	registerRule(rule: RoutingRule): void {
		this.rules.set(rule.id, rule);
	}

	enableRule(ruleId: string): boolean {
		const rule = this.rules.get(ruleId);
		if (rule) {
			rule.enabled = true;
			return true;
		}
		return false;
	}

	disableRule(ruleId: string): boolean {
		const rule = this.rules.get(ruleId);
		if (rule) {
			rule.enabled = false;
			return true;
		}
		return false;
	}

	// ---------------------------------------------------------------------------
	// Classification
	// ---------------------------------------------------------------------------

	classify(task: string): TaskClassification {
		const classification = this.classifyTask(task);
		this.emit("task:classified", { task, classification });
		return classification;
	}

	private classifyTask(task: string): TaskClassification {
		// Determine category
		let category: TaskCategory = "general";
		let maxMatches = 0;
		const keywords: string[] = [];

		for (const [cat, patterns] of Object.entries(CATEGORY_PATTERNS) as [TaskCategory, RegExp[]][]) {
			let matches = 0;
			for (const pattern of patterns) {
				const match = task.match(pattern);
				if (match) {
					matches++;
					keywords.push(match[0].toLowerCase());
				}
			}
			if (matches > maxMatches) {
				maxMatches = matches;
				category = cat;
			}
		}

		// Determine complexity
		const wordCount = task.split(/\s+/).length;
		let complexity: TaskComplexity = "simple";
		let complexityConfidence = 0;

		for (const [level, indicators] of Object.entries(COMPLEXITY_INDICATORS) as [TaskComplexity, typeof COMPLEXITY_INDICATORS[TaskComplexity]][]) {
			let score = 0;

			// Check patterns
			for (const pattern of indicators.patterns) {
				if (pattern.test(task)) {
					score += 0.5;
				}
			}

			// Check word count
			if (wordCount >= indicators.minWords) {
				score += 0.3;
			}

			if (score > complexityConfidence) {
				complexityConfidence = score;
				complexity = level;
			}
		}

		// Determine confidence
		const confidence = maxMatches > 0 ? Math.min(0.95, 0.5 + maxMatches * 0.15) : 0.3;

		// Suggest patterns based on category and complexity
		const suggestedPatterns = this.suggestPatterns(category, complexity);

		return {
			category,
			complexity,
			keywords: [...new Set(keywords)],
			confidence,
			suggestedPatterns,
		};
	}

	private suggestPatterns(category: TaskCategory, complexity: TaskComplexity): string[] {
		const patterns: string[] = [];

		// Base patterns for all
		if (complexity === "complex" || complexity === "expert") {
			patterns.push("ooda-loop", "task-decomposition", "reflection");
		}

		// Category-specific patterns
		switch (category) {
			case "coding":
				patterns.push("double-check", "parallel-execution");
				break;
			case "debugging":
				patterns.push("reflection", "experience-replay");
				break;
			case "research":
				patterns.push("parallel-execution", "experience-replay");
				break;
			case "review":
				patterns.push("reflection", "double-check");
				break;
			case "planning":
				patterns.push("task-decomposition", "ooda-loop");
				break;
			case "trading":
				patterns.push("reflection", "ooda-loop", "experience-replay");
				break;
		}

		return [...new Set(patterns)];
	}

	// ---------------------------------------------------------------------------
	// Routing
	// ---------------------------------------------------------------------------

	route(task: string): RoutingDecision {
		const classification = this.classify(task);

		// Try rules first
		const matchedRule = this.findMatchingRule(task, classification);
		if (matchedRule) {
			const target = this.targets.get(matchedRule.target);
			if (target) {
				const decision: RoutingDecision = {
					task,
					classification,
					target,
					rule: matchedRule,
					confidence: 0.9,
					alternatives: this.findAlternatives(target.id, classification),
					reasoning: `Matched rule: ${matchedRule.name}`,
				};

				this.emit("route:decided", { decision });
				this.routingHistory.set(task, decision);
				return decision;
			}
		}

		// Find best target based on capabilities
		const bestTarget = this.findBestTarget(classification);
		if (bestTarget) {
			const decision: RoutingDecision = {
				task,
				classification,
				target: bestTarget,
				confidence: classification.confidence,
				alternatives: this.findAlternatives(bestTarget.id, classification),
				reasoning: `Best match for ${classification.category} task`,
			};

			this.emit("route:decided", { decision });
			this.routingHistory.set(task, decision);
			return decision;
		}

		// Fallback to default
		const defaultTarget = this.targets.get(this.config.defaultTarget);
		if (!defaultTarget) {
			throw new Error(`Default target ${this.config.defaultTarget} not found`);
		}

		const decision: RoutingDecision = {
			task,
			classification,
			target: defaultTarget,
			confidence: 0.5,
			alternatives: [],
			reasoning: "Fallback to default target",
		};

		this.emit("route:fallback", { task, reason: "No specific match found" });
		this.emit("route:decided", { decision });
		this.routingHistory.set(task, decision);
		return decision;
	}

	private findMatchingRule(task: string, classification: TaskClassification): RoutingRule | null {
		const enabledRules = Array.from(this.rules.values())
			.filter((r) => r.enabled)
			.sort((a, b) => b.priority - a.priority);

		for (const rule of enabledRules) {
			if (rule.condition(task, classification)) {
				return rule;
			}
		}

		return null;
	}

	private findBestTarget(classification: TaskClassification): RoutingTarget | null {
		let bestTarget: RoutingTarget | null = null;
		let bestScore = -Infinity;

		for (const target of this.targets.values()) {
			const score = this.scoreTarget(target, classification);
			if (score > bestScore) {
				bestScore = score;
				bestTarget = target;
			}
		}

		return bestTarget;
	}

	private scoreTarget(target: RoutingTarget, classification: TaskClassification): number {
		// Capability match
		const capabilityMatch = target.capabilities.includes(classification.category) ? 1 : 0;

		// Load (prefer less loaded)
		const loadScore = 1 - target.load;

		// Success rate
		const successScore = target.successRate;

		// Combined score
		return (
			capabilityMatch * 0.4 +
			loadScore * this.config.loadBalancingWeight +
			successScore * this.config.successRateWeight
		);
	}

	private findAlternatives(excludeId: string, classification: TaskClassification): RoutingTarget[] {
		const alternatives: { target: RoutingTarget; score: number }[] = [];

		for (const target of this.targets.values()) {
			if (target.id === excludeId) continue;

			const score = this.scoreTarget(target, classification);
			alternatives.push({ target, score });
		}

		return alternatives
			.sort((a, b) => b.score - a.score)
			.slice(0, this.config.maxAlternatives)
			.map((a) => a.target);
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getTarget(id: string): RoutingTarget | null {
		return this.targets.get(id) || null;
	}

	getAllTargets(): RoutingTarget[] {
		return Array.from(this.targets.values());
	}

	getRule(id: string): RoutingRule | null {
		return this.rules.get(id) || null;
	}

	getAllRules(): RoutingRule[] {
		return Array.from(this.rules.values());
	}

	getRoutingHistory(limit = 100): RoutingDecision[] {
		return Array.from(this.routingHistory.values()).slice(-limit);
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clearHistory(): void {
		this.routingHistory.clear();
	}

	reset(): void {
		this.targets.clear();
		this.rules.clear();
		this.routingHistory.clear();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: DelegationRouter | null = null;

export function getDelegationRouter(config?: Partial<DelegationRouterConfig>): DelegationRouter {
	if (!instance) {
		instance = new DelegationRouter(config);
	}
	return instance;
}

export function resetDelegationRouter(): void {
	if (instance) {
		instance.reset();
	}
	instance = null;
}
