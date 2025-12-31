/**
 * Class 3.9 Agent Feedback Loop
 *
 * TAC Pattern: Self-Improvement Through Feedback
 * "Agents that learn from user ratings and improve over time"
 *
 * Features:
 * - Collect user ratings on agent responses
 * - Track patterns in good/bad responses
 * - Auto-generate improvement suggestions
 * - A/B test prompt variations
 * - Persist learnings for future sessions
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";
import { join } from "path";

// =============================================================================
// Types
// =============================================================================

/** Feedback rating (1-5 stars or thumbs) */
export type FeedbackRating = 1 | 2 | 3 | 4 | 5 | "thumbs_up" | "thumbs_down";

/** Feedback entry */
export interface FeedbackEntry {
	id: string;
	timestamp: Date;
	agentId: string;
	userId: string;
	channelId: string;

	/** The prompt/task that was given */
	prompt: string;
	/** The response that was provided */
	response: string;
	/** User's rating */
	rating: FeedbackRating;
	/** Optional comment */
	comment?: string;

	/** Normalized score (0-1) */
	normalizedScore: number;
	/** Response latency in ms */
	latencyMs?: number;
	/** Model used */
	model?: string;
	/** Task type classification */
	taskType?: string;
}

/** Feedback summary for an agent */
export interface AgentFeedbackSummary {
	agentId: string;
	totalResponses: number;
	ratedResponses: number;
	averageScore: number;
	positiveCount: number;
	negativeCount: number;
	commonPraises: string[];
	commonComplaints: string[];
	improvementSuggestions: string[];
}

/** A/B test variant */
export interface PromptVariant {
	id: string;
	agentId: string;
	name: string;
	promptModification: string;
	isActive: boolean;
	responsesCount: number;
	averageScore: number;
	createdAt: Date;
}

/** Improvement suggestion */
export interface ImprovementSuggestion {
	id: string;
	agentId: string;
	type: "prompt" | "model" | "behavior" | "capability";
	suggestion: string;
	confidence: number;
	basedOnFeedbackCount: number;
	createdAt: Date;
	applied: boolean;
}

/** Feedback config */
export interface FeedbackConfig {
	/** Minimum responses before generating suggestions */
	minResponsesForSuggestions: number;
	/** Score threshold for positive feedback */
	positiveThreshold: number;
	/** Score threshold for negative feedback */
	negativeThreshold: number;
	/** Enable A/B testing */
	enableABTesting: boolean;
	/** Max variants per agent */
	maxVariantsPerAgent: number;
	/** Auto-apply high-confidence suggestions */
	autoApplySuggestions: boolean;
	/** Confidence threshold for auto-apply */
	autoApplyThreshold: number;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
	minResponsesForSuggestions: 10,
	positiveThreshold: 0.7,
	negativeThreshold: 0.3,
	enableABTesting: false,
	maxVariantsPerAgent: 3,
	autoApplySuggestions: false,
	autoApplyThreshold: 0.9,
};

// =============================================================================
// Rating Normalization
// =============================================================================

function normalizeRating(rating: FeedbackRating): number {
	if (rating === "thumbs_up") return 1.0;
	if (rating === "thumbs_down") return 0.0;
	// 1-5 scale normalized to 0-1
	return (rating - 1) / 4;
}

function _denormalizeRating(score: number): FeedbackRating {
	if (score >= 0.9) return 5;
	if (score >= 0.7) return 4;
	if (score >= 0.5) return 3;
	if (score >= 0.3) return 2;
	return 1;
}

// =============================================================================
// Agent Feedback System
// =============================================================================

export class AgentFeedbackSystem extends EventEmitter {
	private db: Database.Database;
	private config: FeedbackConfig;

	constructor(dataDir: string, config: Partial<FeedbackConfig> = {}) {
		super();
		this.db = new Database(join(dataDir, "agent_feedback.db"));
		this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };

		this.initDatabase();
	}

	private initDatabase(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS feedback (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				prompt TEXT NOT NULL,
				response TEXT NOT NULL,
				rating TEXT NOT NULL,
				normalized_score REAL NOT NULL,
				comment TEXT,
				latency_ms INTEGER,
				model TEXT,
				task_type TEXT
			);

			CREATE TABLE IF NOT EXISTS prompt_variants (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				name TEXT NOT NULL,
				prompt_modification TEXT NOT NULL,
				is_active INTEGER DEFAULT 1,
				responses_count INTEGER DEFAULT 0,
				average_score REAL DEFAULT 0,
				created_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS improvement_suggestions (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				type TEXT NOT NULL,
				suggestion TEXT NOT NULL,
				confidence REAL NOT NULL,
				based_on_count INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				applied INTEGER DEFAULT 0
			);

			CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent_id);
			CREATE INDEX IF NOT EXISTS idx_feedback_score ON feedback(normalized_score);
			CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
			CREATE INDEX IF NOT EXISTS idx_variants_agent ON prompt_variants(agent_id);
		`);
	}

	// =========================================================================
	// Feedback Collection
	// =========================================================================

	/** Record feedback for a response */
	recordFeedback(entry: Omit<FeedbackEntry, "id" | "timestamp" | "normalizedScore">): FeedbackEntry {
		const id = crypto.randomUUID();
		const timestamp = new Date();
		const normalizedScore = normalizeRating(entry.rating);

		const fullEntry: FeedbackEntry = {
			...entry,
			id,
			timestamp,
			normalizedScore,
		};

		this.db
			.prepare(
				`INSERT INTO feedback (
					id, timestamp, agent_id, user_id, channel_id,
					prompt, response, rating, normalized_score,
					comment, latency_ms, model, task_type
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				timestamp.toISOString(),
				entry.agentId,
				entry.userId,
				entry.channelId,
				entry.prompt,
				entry.response.slice(0, 10000), // Limit size
				String(entry.rating),
				normalizedScore,
				entry.comment || null,
				entry.latencyMs || null,
				entry.model || null,
				entry.taskType || null,
			);

		this.emit("feedbackRecorded", fullEntry);

		// Check if we should generate suggestions
		this.checkAndGenerateSuggestions(entry.agentId);

		return fullEntry;
	}

	/** Quick thumbs up/down feedback */
	quickFeedback(
		agentId: string,
		userId: string,
		channelId: string,
		prompt: string,
		response: string,
		isPositive: boolean,
	): FeedbackEntry {
		return this.recordFeedback({
			agentId,
			userId,
			channelId,
			prompt,
			response,
			rating: isPositive ? "thumbs_up" : "thumbs_down",
		});
	}

	// =========================================================================
	// Feedback Analysis
	// =========================================================================

	/** Get feedback summary for an agent */
	getAgentSummary(agentId: string): AgentFeedbackSummary {
		const stats = this.db
			.prepare(
				`SELECT
					COUNT(*) as total,
					AVG(normalized_score) as avg_score,
					SUM(CASE WHEN normalized_score >= ? THEN 1 ELSE 0 END) as positive,
					SUM(CASE WHEN normalized_score <= ? THEN 1 ELSE 0 END) as negative
				FROM feedback
				WHERE agent_id = ?`,
			)
			.get(this.config.positiveThreshold, this.config.negativeThreshold, agentId) as {
			total: number;
			avg_score: number;
			positive: number;
			negative: number;
		};

		// Get common comments from positive feedback
		const positiveComments = this.db
			.prepare(
				`SELECT comment FROM feedback
				WHERE agent_id = ? AND normalized_score >= ? AND comment IS NOT NULL
				ORDER BY timestamp DESC LIMIT 10`,
			)
			.all(agentId, this.config.positiveThreshold) as { comment: string }[];

		// Get common comments from negative feedback
		const negativeComments = this.db
			.prepare(
				`SELECT comment FROM feedback
				WHERE agent_id = ? AND normalized_score <= ? AND comment IS NOT NULL
				ORDER BY timestamp DESC LIMIT 10`,
			)
			.all(agentId, this.config.negativeThreshold) as { comment: string }[];

		// Get improvement suggestions
		const suggestions = this.db
			.prepare(
				`SELECT suggestion FROM improvement_suggestions
				WHERE agent_id = ? AND applied = 0
				ORDER BY confidence DESC LIMIT 5`,
			)
			.all(agentId) as { suggestion: string }[];

		return {
			agentId,
			totalResponses: stats.total,
			ratedResponses: stats.total,
			averageScore: stats.avg_score || 0,
			positiveCount: stats.positive || 0,
			negativeCount: stats.negative || 0,
			commonPraises: positiveComments.map((c) => c.comment),
			commonComplaints: negativeComments.map((c) => c.comment),
			improvementSuggestions: suggestions.map((s) => s.suggestion),
		};
	}

	/** Get recent feedback for an agent */
	getRecentFeedback(agentId: string, limit = 20): FeedbackEntry[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM feedback
				WHERE agent_id = ?
				ORDER BY timestamp DESC
				LIMIT ?`,
			)
			.all(agentId, limit) as any[];

		return rows.map((row) => ({
			id: row.id,
			timestamp: new Date(row.timestamp),
			agentId: row.agent_id,
			userId: row.user_id,
			channelId: row.channel_id,
			prompt: row.prompt,
			response: row.response,
			rating: row.rating.includes("thumbs") ? row.rating : parseInt(row.rating, 10),
			normalizedScore: row.normalized_score,
			comment: row.comment,
			latencyMs: row.latency_ms,
			model: row.model,
			taskType: row.task_type,
		}));
	}

	/** Get best and worst responses */
	getExtremeResponses(agentId: string, limit = 5): { best: FeedbackEntry[]; worst: FeedbackEntry[] } {
		const best = this.db
			.prepare(
				`SELECT * FROM feedback
				WHERE agent_id = ?
				ORDER BY normalized_score DESC, timestamp DESC
				LIMIT ?`,
			)
			.all(agentId, limit) as any[];

		const worst = this.db
			.prepare(
				`SELECT * FROM feedback
				WHERE agent_id = ?
				ORDER BY normalized_score ASC, timestamp DESC
				LIMIT ?`,
			)
			.all(agentId, limit) as any[];

		const mapRow = (row: any): FeedbackEntry => ({
			id: row.id,
			timestamp: new Date(row.timestamp),
			agentId: row.agent_id,
			userId: row.user_id,
			channelId: row.channel_id,
			prompt: row.prompt,
			response: row.response,
			rating: row.rating.includes("thumbs") ? row.rating : parseInt(row.rating, 10),
			normalizedScore: row.normalized_score,
			comment: row.comment,
			latencyMs: row.latency_ms,
			model: row.model,
			taskType: row.task_type,
		});

		return {
			best: best.map(mapRow),
			worst: worst.map(mapRow),
		};
	}

	// =========================================================================
	// Improvement Suggestions
	// =========================================================================

	/** Generate improvement suggestions based on feedback patterns */
	private checkAndGenerateSuggestions(agentId: string): void {
		const count = this.db.prepare(`SELECT COUNT(*) as count FROM feedback WHERE agent_id = ?`).get(agentId) as {
			count: number;
		};

		if (count.count < this.config.minResponsesForSuggestions) {
			return;
		}

		// Check if we recently generated suggestions
		const lastSuggestion = this.db
			.prepare(
				`SELECT created_at FROM improvement_suggestions
				WHERE agent_id = ?
				ORDER BY created_at DESC LIMIT 1`,
			)
			.get(agentId) as { created_at: string } | undefined;

		if (lastSuggestion) {
			const hoursSinceLast = (Date.now() - new Date(lastSuggestion.created_at).getTime()) / (1000 * 60 * 60);
			if (hoursSinceLast < 24) return; // Max once per day
		}

		// Analyze patterns
		const summary = this.getAgentSummary(agentId);

		// Generate suggestions based on analysis
		const suggestions: Omit<ImprovementSuggestion, "id" | "createdAt">[] = [];

		// If average score is low, suggest prompt improvements
		if (summary.averageScore < 0.5 && summary.totalResponses >= 10) {
			suggestions.push({
				agentId,
				type: "prompt",
				suggestion:
					"Consider revising the system prompt to be more specific about expected output format and quality.",
				confidence: 0.6 + (0.5 - summary.averageScore),
				basedOnFeedbackCount: summary.totalResponses,
				applied: false,
			});
		}

		// If many negative ratings, suggest behavior changes
		if (summary.negativeCount > summary.positiveCount) {
			suggestions.push({
				agentId,
				type: "behavior",
				suggestion: "High negative feedback ratio detected. Review recent complaints and adjust response style.",
				confidence: Math.min(0.9, summary.negativeCount / summary.totalResponses),
				basedOnFeedbackCount: summary.negativeCount,
				applied: false,
			});
		}

		// Store suggestions
		for (const suggestion of suggestions) {
			const id = crypto.randomUUID();
			this.db
				.prepare(
					`INSERT INTO improvement_suggestions (
						id, agent_id, type, suggestion, confidence,
						based_on_count, created_at, applied
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					suggestion.agentId,
					suggestion.type,
					suggestion.suggestion,
					suggestion.confidence,
					suggestion.basedOnFeedbackCount,
					new Date().toISOString(),
					0,
				);

			this.emit("suggestionGenerated", { ...suggestion, id });
		}
	}

	/** Get pending suggestions for an agent */
	getSuggestions(agentId: string): ImprovementSuggestion[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM improvement_suggestions
				WHERE agent_id = ? AND applied = 0
				ORDER BY confidence DESC`,
			)
			.all(agentId) as any[];

		return rows.map((row) => ({
			id: row.id,
			agentId: row.agent_id,
			type: row.type,
			suggestion: row.suggestion,
			confidence: row.confidence,
			basedOnFeedbackCount: row.based_on_count,
			createdAt: new Date(row.created_at),
			applied: Boolean(row.applied),
		}));
	}

	/** Mark a suggestion as applied */
	applySuggestion(suggestionId: string): void {
		this.db.prepare(`UPDATE improvement_suggestions SET applied = 1 WHERE id = ?`).run(suggestionId);
		this.emit("suggestionApplied", { id: suggestionId });
	}

	// =========================================================================
	// A/B Testing
	// =========================================================================

	/** Create a prompt variant for A/B testing */
	createVariant(agentId: string, name: string, promptModification: string): PromptVariant {
		if (!this.config.enableABTesting) {
			throw new Error("A/B testing is not enabled");
		}

		const existing = this.db
			.prepare(`SELECT COUNT(*) as count FROM prompt_variants WHERE agent_id = ? AND is_active = 1`)
			.get(agentId) as { count: number };

		if (existing.count >= this.config.maxVariantsPerAgent) {
			throw new Error(`Max variants (${this.config.maxVariantsPerAgent}) reached for this agent`);
		}

		const id = crypto.randomUUID();
		const createdAt = new Date();

		this.db
			.prepare(
				`INSERT INTO prompt_variants (
					id, agent_id, name, prompt_modification, is_active,
					responses_count, average_score, created_at
				) VALUES (?, ?, ?, ?, 1, 0, 0, ?)`,
			)
			.run(id, agentId, name, promptModification, createdAt.toISOString());

		const variant: PromptVariant = {
			id,
			agentId,
			name,
			promptModification,
			isActive: true,
			responsesCount: 0,
			averageScore: 0,
			createdAt,
		};

		this.emit("variantCreated", variant);
		return variant;
	}

	/** Get active variants for an agent */
	getActiveVariants(agentId: string): PromptVariant[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM prompt_variants
				WHERE agent_id = ? AND is_active = 1`,
			)
			.all(agentId) as any[];

		return rows.map((row) => ({
			id: row.id,
			agentId: row.agent_id,
			name: row.name,
			promptModification: row.prompt_modification,
			isActive: Boolean(row.is_active),
			responsesCount: row.responses_count,
			averageScore: row.average_score,
			createdAt: new Date(row.created_at),
		}));
	}

	/** Pick a variant for A/B testing (random selection) */
	pickVariant(agentId: string): PromptVariant | null {
		if (!this.config.enableABTesting) return null;

		const variants = this.getActiveVariants(agentId);
		if (variants.length === 0) return null;

		// Random selection
		const index = Math.floor(Math.random() * variants.length);
		return variants[index];
	}

	/** Record A/B test result */
	recordVariantResult(variantId: string, score: number): void {
		const variant = this.db.prepare(`SELECT * FROM prompt_variants WHERE id = ?`).get(variantId) as any;

		if (!variant) return;

		const newCount = variant.responses_count + 1;
		const newAvg = (variant.average_score * variant.responses_count + score) / newCount;

		this.db
			.prepare(
				`UPDATE prompt_variants
				SET responses_count = ?, average_score = ?
				WHERE id = ?`,
			)
			.run(newCount, newAvg, variantId);

		this.emit("variantResultRecorded", { variantId, score, newAverage: newAvg });
	}

	/** Deactivate a variant */
	deactivateVariant(variantId: string): void {
		this.db.prepare(`UPDATE prompt_variants SET is_active = 0 WHERE id = ?`).run(variantId);
		this.emit("variantDeactivated", { id: variantId });
	}

	// =========================================================================
	// Global Stats
	// =========================================================================

	/** Get global feedback stats */
	getGlobalStats(): {
		totalFeedback: number;
		totalAgents: number;
		globalAverageScore: number;
		feedbackToday: number;
		topAgents: { agentId: string; score: number; count: number }[];
	} {
		const stats = this.db
			.prepare(
				`SELECT
					COUNT(*) as total,
					COUNT(DISTINCT agent_id) as agents,
					AVG(normalized_score) as avg_score
				FROM feedback`,
			)
			.get() as { total: number; agents: number; avg_score: number };

		const today = new Date().toISOString().split("T")[0];
		const todayStats = this.db
			.prepare(`SELECT COUNT(*) as count FROM feedback WHERE timestamp >= ?`)
			.get(`${today}T00:00:00`) as { count: number };

		const topAgents = this.db
			.prepare(
				`SELECT
					agent_id,
					AVG(normalized_score) as score,
					COUNT(*) as count
				FROM feedback
				GROUP BY agent_id
				HAVING count >= 5
				ORDER BY score DESC
				LIMIT 10`,
			)
			.all() as { agent_id: string; score: number; count: number }[];

		return {
			totalFeedback: stats.total,
			totalAgents: stats.agents,
			globalAverageScore: stats.avg_score || 0,
			feedbackToday: todayStats.count,
			topAgents: topAgents.map((a) => ({
				agentId: a.agent_id,
				score: a.score,
				count: a.count,
			})),
		};
	}

	// =========================================================================
	// Accessors
	// =========================================================================

	getConfig(): FeedbackConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<FeedbackConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	close(): void {
		this.db.close();
	}
}

// =============================================================================
// Factory
// =============================================================================

let feedbackInstance: AgentFeedbackSystem | null = null;

export function getFeedbackSystem(dataDir: string, config?: Partial<FeedbackConfig>): AgentFeedbackSystem {
	if (!feedbackInstance) {
		feedbackInstance = new AgentFeedbackSystem(dataDir, config);
	}
	return feedbackInstance;
}

export function resetFeedbackSystem(): void {
	if (feedbackInstance) {
		feedbackInstance.close();
		feedbackInstance = null;
	}
}
