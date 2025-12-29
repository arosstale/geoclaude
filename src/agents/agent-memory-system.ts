/**
 * Class 3.3 Agent Memory System
 *
 * Persistent memory and learning for agents:
 * - Performance tracking per agent/task type
 * - Pattern recognition for smart routing
 * - Insight storage and retrieval
 * - Cross-session learning persistence
 *
 * Uses SQLite for durability, enables agents to learn from experience.
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";

// =============================================================================
// Types
// =============================================================================

/** Task execution record for learning */
export interface TaskRecord {
	id: string;
	agentId: string;
	agentRole: string;
	taskType: string;
	prompt: string;
	promptHash: string; // For similarity matching
	success: boolean;
	latencyMs: number;
	outputQuality?: number; // 0-1 if rated
	tokenCount?: number;
	cost?: number;
	errorType?: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}

/** Agent performance stats */
export interface AgentStats {
	agentId: string;
	totalTasks: number;
	successRate: number;
	avgLatencyMs: number;
	avgQuality: number;
	taskTypeBreakdown: Map<string, { count: number; successRate: number }>;
	bestTaskTypes: string[];
	worstTaskTypes: string[];
	lastActive: Date;
}

/** Learned insight */
export interface Insight {
	id: string;
	type: "pattern" | "preference" | "failure" | "optimization" | "correlation";
	title: string;
	description: string;
	confidence: number; // 0-1
	evidence: string[]; // Task IDs that support this insight
	agentIds?: string[];
	taskTypes?: string[];
	createdAt: Date;
	updatedAt: Date;
	active: boolean;
}

/** Routing recommendation */
export interface RoutingRecommendation {
	taskType: string;
	prompt: string;
	recommendedAgents: Array<{
		agentId: string;
		score: number;
		reasoning: string;
	}>;
	confidence: number;
	basedOn: string[]; // Insight IDs used
}

/** Memory system configuration */
export interface MemoryConfig {
	dbPath: string;
	enableLearning: boolean;
	minSamplesForInsight: number;
	insightConfidenceThreshold: number;
	maxInsights: number;
	qualityRatingEnabled: boolean;
}

// =============================================================================
// Agent Memory System
// =============================================================================

export class AgentMemorySystem extends EventEmitter {
	private db: Database.Database;
	private config: MemoryConfig;

	constructor(config: Partial<MemoryConfig> = {}) {
		super();
		this.config = {
			dbPath: config.dbPath || "agent-memory.db",
			enableLearning: config.enableLearning ?? true,
			minSamplesForInsight: config.minSamplesForInsight || 10,
			insightConfidenceThreshold: config.insightConfidenceThreshold || 0.7,
			maxInsights: config.maxInsights || 100,
			qualityRatingEnabled: config.qualityRatingEnabled ?? true,
		};

		this.db = new Database(this.config.dbPath);
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
			-- Task execution records
			CREATE TABLE IF NOT EXISTS task_records (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				agent_role TEXT NOT NULL,
				task_type TEXT NOT NULL,
				prompt TEXT NOT NULL,
				prompt_hash TEXT NOT NULL,
				success INTEGER NOT NULL,
				latency_ms INTEGER NOT NULL,
				output_quality REAL,
				token_count INTEGER,
				cost REAL,
				error_type TEXT,
				timestamp TEXT NOT NULL,
				metadata TEXT
			);

			-- Learned insights
			CREATE TABLE IF NOT EXISTS insights (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				confidence REAL NOT NULL,
				evidence TEXT NOT NULL,
				agent_ids TEXT,
				task_types TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				active INTEGER NOT NULL DEFAULT 1
			);

			-- Agent performance cache
			CREATE TABLE IF NOT EXISTS agent_performance (
				agent_id TEXT PRIMARY KEY,
				total_tasks INTEGER NOT NULL DEFAULT 0,
				success_count INTEGER NOT NULL DEFAULT 0,
				total_latency_ms INTEGER NOT NULL DEFAULT 0,
				total_quality REAL NOT NULL DEFAULT 0,
				quality_count INTEGER NOT NULL DEFAULT 0,
				task_type_stats TEXT NOT NULL DEFAULT '{}',
				last_active TEXT NOT NULL
			);

			-- Indexes
			CREATE INDEX IF NOT EXISTS idx_task_agent ON task_records(agent_id);
			CREATE INDEX IF NOT EXISTS idx_task_type ON task_records(task_type);
			CREATE INDEX IF NOT EXISTS idx_task_success ON task_records(success);
			CREATE INDEX IF NOT EXISTS idx_task_timestamp ON task_records(timestamp);
			CREATE INDEX IF NOT EXISTS idx_insight_type ON insights(type);
			CREATE INDEX IF NOT EXISTS idx_insight_active ON insights(active);
		`);
	}

	// =========================================================================
	// Task Recording
	// =========================================================================

	/** Record a task execution */
	recordTask(record: Omit<TaskRecord, "promptHash">): void {
		const promptHash = this.hashPrompt(record.prompt);

		this.db
			.prepare(
				`
			INSERT INTO task_records (
				id, agent_id, agent_role, task_type, prompt, prompt_hash,
				success, latency_ms, output_quality, token_count, cost,
				error_type, timestamp, metadata
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			)
			.run(
				record.id,
				record.agentId,
				record.agentRole,
				record.taskType,
				record.prompt,
				promptHash,
				record.success ? 1 : 0,
				record.latencyMs,
				record.outputQuality ?? null,
				record.tokenCount ?? null,
				record.cost ?? null,
				record.errorType ?? null,
				record.timestamp.toISOString(),
				record.metadata ? JSON.stringify(record.metadata) : null,
			);

		// Update agent performance cache
		this.updateAgentPerformance(record.agentId, record);

		// Trigger learning if enabled
		if (this.config.enableLearning) {
			this.maybeGenerateInsights(record.agentId, record.taskType);
		}

		this.emit("task:recorded", record);
	}

	/** Update quality rating for a task */
	rateTask(taskId: string, quality: number): void {
		this.db.prepare("UPDATE task_records SET output_quality = ? WHERE id = ?").run(quality, taskId);

		const record = this.db
			.prepare("SELECT agent_id FROM task_records WHERE id = ?")
			.get(taskId) as { agent_id: string } | undefined;

		if (record) {
			// Update quality in performance cache
			const perf = this.db.prepare("SELECT * FROM agent_performance WHERE agent_id = ?").get(record.agent_id) as any;
			if (perf) {
				this.db
					.prepare(
						`
					UPDATE agent_performance
					SET total_quality = total_quality + ?, quality_count = quality_count + 1
					WHERE agent_id = ?
				`,
					)
					.run(quality, record.agent_id);
			}
		}

		this.emit("task:rated", { taskId, quality });
	}

	// =========================================================================
	// Performance Analysis
	// =========================================================================

	/** Get stats for an agent */
	getAgentStats(agentId: string): AgentStats | null {
		const perf = this.db.prepare("SELECT * FROM agent_performance WHERE agent_id = ?").get(agentId) as any;

		if (!perf) return null;

		const taskTypeStats = JSON.parse(perf.task_type_stats) as Record<string, { count: number; success: number }>;
		const taskTypeBreakdown = new Map<string, { count: number; successRate: number }>();

		const sortedTypes: Array<{ type: string; rate: number }> = [];

		for (const [type, stats] of Object.entries(taskTypeStats)) {
			const successRate = stats.count > 0 ? stats.success / stats.count : 0;
			taskTypeBreakdown.set(type, { count: stats.count, successRate });
			sortedTypes.push({ type, rate: successRate });
		}

		sortedTypes.sort((a, b) => b.rate - a.rate);

		return {
			agentId,
			totalTasks: perf.total_tasks,
			successRate: perf.total_tasks > 0 ? perf.success_count / perf.total_tasks : 0,
			avgLatencyMs: perf.total_tasks > 0 ? perf.total_latency_ms / perf.total_tasks : 0,
			avgQuality: perf.quality_count > 0 ? perf.total_quality / perf.quality_count : 0,
			taskTypeBreakdown,
			bestTaskTypes: sortedTypes.slice(0, 3).map((t) => t.type),
			worstTaskTypes: sortedTypes.slice(-3).map((t) => t.type),
			lastActive: new Date(perf.last_active),
		};
	}

	/** Get all agent stats */
	getAllAgentStats(): AgentStats[] {
		const agents = this.db.prepare("SELECT agent_id FROM agent_performance").all() as Array<{ agent_id: string }>;
		return agents.map((a) => this.getAgentStats(a.agent_id)).filter(Boolean) as AgentStats[];
	}

	/** Get best agent for a task type */
	getBestAgentForTask(taskType: string, excludeAgents: string[] = []): string | null {
		const agents = this.getAllAgentStats();

		let bestAgent: string | null = null;
		let bestScore = -1;

		for (const agent of agents) {
			if (excludeAgents.includes(agent.agentId)) continue;

			const typeStats = agent.taskTypeBreakdown.get(taskType);
			if (!typeStats || typeStats.count < 3) continue; // Need minimum samples

			// Score = success rate * (1 - latency penalty) * quality bonus
			const latencyPenalty = Math.min(agent.avgLatencyMs / 60000, 0.3); // Max 30% penalty
			const qualityBonus = agent.avgQuality > 0 ? agent.avgQuality * 0.2 : 0;
			const score = typeStats.successRate * (1 - latencyPenalty) + qualityBonus;

			if (score > bestScore) {
				bestScore = score;
				bestAgent = agent.agentId;
			}
		}

		return bestAgent;
	}

	// =========================================================================
	// Routing Recommendations
	// =========================================================================

	/** Get routing recommendation for a task */
	getRoutingRecommendation(taskType: string, prompt: string): RoutingRecommendation {
		const agents = this.getAllAgentStats();
		const insights = this.getActiveInsights();

		const recommendations: Array<{
			agentId: string;
			score: number;
			reasoning: string;
		}> = [];

		const usedInsights: string[] = [];

		for (const agent of agents) {
			const typeStats = agent.taskTypeBreakdown.get(taskType);
			let score = 0;
			const reasons: string[] = [];

			// Base score from task type performance
			if (typeStats && typeStats.count >= 3) {
				score += typeStats.successRate * 0.4;
				reasons.push(`${(typeStats.successRate * 100).toFixed(0)}% success on ${taskType}`);
			}

			// Overall success rate
			if (agent.totalTasks >= 5) {
				score += agent.successRate * 0.2;
				reasons.push(`${(agent.successRate * 100).toFixed(0)}% overall success`);
			}

			// Quality bonus
			if (agent.avgQuality > 0.7) {
				score += 0.15;
				reasons.push(`High quality: ${(agent.avgQuality * 100).toFixed(0)}%`);
			}

			// Speed bonus for fast agents
			if (agent.avgLatencyMs < 5000) {
				score += 0.1;
				reasons.push("Fast response time");
			}

			// Apply insights
			for (const insight of insights) {
				if (insight.agentIds?.includes(agent.agentId) && insight.taskTypes?.includes(taskType)) {
					if (insight.type === "pattern" || insight.type === "optimization") {
						score += insight.confidence * 0.15;
						reasons.push(`Insight: ${insight.title}`);
						usedInsights.push(insight.id);
					}
				}
			}

			if (score > 0) {
				recommendations.push({
					agentId: agent.agentId,
					score,
					reasoning: reasons.join("; "),
				});
			}
		}

		// Sort by score
		recommendations.sort((a, b) => b.score - a.score);

		return {
			taskType,
			prompt: prompt.slice(0, 100),
			recommendedAgents: recommendations.slice(0, 5),
			confidence: recommendations.length > 0 ? recommendations[0].score : 0,
			basedOn: [...new Set(usedInsights)],
		};
	}

	// =========================================================================
	// Insight Management
	// =========================================================================

	/** Get active insights */
	getActiveInsights(): Insight[] {
		const rows = this.db.prepare("SELECT * FROM insights WHERE active = 1 ORDER BY confidence DESC").all() as any[];

		return rows.map((row) => ({
			id: row.id,
			type: row.type,
			title: row.title,
			description: row.description,
			confidence: row.confidence,
			evidence: JSON.parse(row.evidence),
			agentIds: row.agent_ids ? JSON.parse(row.agent_ids) : undefined,
			taskTypes: row.task_types ? JSON.parse(row.task_types) : undefined,
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
			active: Boolean(row.active),
		}));
	}

	/** Get global statistics across all agents */
	getGlobalStats(): {
		totalTasks: number;
		agentCount: number;
		insightCount: number;
		globalSuccessRate: number;
		avgLatencyMs: number;
		avgQuality: number;
	} {
		const taskStats = this.db
			.prepare(
				`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
				AVG(latency_ms) as avg_latency,
				AVG(CASE WHEN output_quality IS NOT NULL THEN output_quality ELSE NULL END) as avg_quality
			FROM task_records
		`,
			)
			.get() as { total: number; successes: number; avg_latency: number; avg_quality: number };

		const agentCount = (
			this.db
				.prepare("SELECT COUNT(DISTINCT agent_id) as count FROM agent_performance")
				.get() as { count: number }
		).count;

		const insightCount = (
			this.db.prepare("SELECT COUNT(*) as count FROM insights WHERE active = 1").get() as { count: number }
		).count;

		return {
			totalTasks: taskStats.total || 0,
			agentCount: agentCount || 0,
			insightCount: insightCount || 0,
			globalSuccessRate: taskStats.total > 0 ? taskStats.successes / taskStats.total : 0,
			avgLatencyMs: taskStats.avg_latency || 0,
			avgQuality: taskStats.avg_quality || 0,
		};
	}

	/** Add a manual insight */
	addInsight(insight: Omit<Insight, "id" | "createdAt" | "updatedAt">): Insight {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		this.db
			.prepare(
				`
			INSERT INTO insights (
				id, type, title, description, confidence, evidence,
				agent_ids, task_types, created_at, updated_at, active
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			)
			.run(
				id,
				insight.type,
				insight.title,
				insight.description,
				insight.confidence,
				JSON.stringify(insight.evidence),
				insight.agentIds ? JSON.stringify(insight.agentIds) : null,
				insight.taskTypes ? JSON.stringify(insight.taskTypes) : null,
				now,
				now,
				insight.active ? 1 : 0,
			);

		const created: Insight = {
			...insight,
			id,
			createdAt: new Date(now),
			updatedAt: new Date(now),
		};

		this.emit("insight:created", created);
		return created;
	}

	/** Deactivate an insight */
	deactivateInsight(id: string): void {
		this.db.prepare("UPDATE insights SET active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
		this.emit("insight:deactivated", id);
	}

	// =========================================================================
	// Automatic Learning
	// =========================================================================

	/** Check if we should generate new insights */
	private maybeGenerateInsights(agentId: string, taskType: string): void {
		const stats = this.getAgentStats(agentId);
		if (!stats || stats.totalTasks < this.config.minSamplesForInsight) return;

		// Check for success patterns
		const typeStats = stats.taskTypeBreakdown.get(taskType);
		if (typeStats && typeStats.count >= this.config.minSamplesForInsight) {
			if (typeStats.successRate >= 0.9) {
				this.maybeCreatePatternInsight(agentId, taskType, typeStats.successRate, "high_success");
			} else if (typeStats.successRate <= 0.3) {
				this.maybeCreatePatternInsight(agentId, taskType, typeStats.successRate, "low_success");
			}
		}

		// Check for speed insights
		if (stats.avgLatencyMs < 3000 && stats.successRate > 0.8) {
			this.maybeCreateOptimizationInsight(agentId, "fast_reliable");
		}
	}

	private maybeCreatePatternInsight(
		agentId: string,
		taskType: string,
		rate: number,
		pattern: "high_success" | "low_success",
	): void {
		// Check if insight already exists
		const existing = this.db
			.prepare(
				`
			SELECT id FROM insights
			WHERE type = 'pattern'
			AND agent_ids LIKE ?
			AND task_types LIKE ?
			AND active = 1
		`,
			)
			.get(`%${agentId}%`, `%${taskType}%`);

		if (existing) return;

		const recentTasks = this.db
			.prepare(
				`
			SELECT id FROM task_records
			WHERE agent_id = ? AND task_type = ?
			ORDER BY timestamp DESC LIMIT 10
		`,
			)
			.all(agentId, taskType) as Array<{ id: string }>;

		if (pattern === "high_success") {
			this.addInsight({
				type: "pattern",
				title: `${agentId} excels at ${taskType}`,
				description: `Agent ${agentId} has ${(rate * 100).toFixed(0)}% success rate on ${taskType} tasks. Recommend for similar tasks.`,
				confidence: rate,
				evidence: recentTasks.map((t) => t.id),
				agentIds: [agentId],
				taskTypes: [taskType],
				active: true,
			});
		} else {
			this.addInsight({
				type: "failure",
				title: `${agentId} struggles with ${taskType}`,
				description: `Agent ${agentId} has only ${(rate * 100).toFixed(0)}% success rate on ${taskType} tasks. Consider alternatives.`,
				confidence: 1 - rate,
				evidence: recentTasks.map((t) => t.id),
				agentIds: [agentId],
				taskTypes: [taskType],
				active: true,
			});
		}
	}

	private maybeCreateOptimizationInsight(agentId: string, optimization: "fast_reliable"): void {
		const existing = this.db
			.prepare(
				`
			SELECT id FROM insights
			WHERE type = 'optimization'
			AND agent_ids LIKE ?
			AND title LIKE '%fast%'
			AND active = 1
		`,
			)
			.get(`%${agentId}%`);

		if (existing) return;

		const stats = this.getAgentStats(agentId);
		if (!stats) return;

		if (optimization === "fast_reliable") {
			this.addInsight({
				type: "optimization",
				title: `${agentId} is fast and reliable`,
				description: `Agent ${agentId} averages ${stats.avgLatencyMs.toFixed(0)}ms with ${(stats.successRate * 100).toFixed(0)}% success. Good for time-sensitive tasks.`,
				confidence: stats.successRate,
				evidence: [],
				agentIds: [agentId],
				active: true,
			});
		}
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	private updateAgentPerformance(agentId: string, record: Omit<TaskRecord, "promptHash">): void {
		const existing = this.db.prepare("SELECT * FROM agent_performance WHERE agent_id = ?").get(agentId) as any;

		if (!existing) {
			const taskTypeStats: Record<string, { count: number; success: number }> = {
				[record.taskType]: { count: 1, success: record.success ? 1 : 0 },
			};

			this.db
				.prepare(
					`
				INSERT INTO agent_performance (
					agent_id, total_tasks, success_count, total_latency_ms,
					total_quality, quality_count, task_type_stats, last_active
				) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
			`,
				)
				.run(
					agentId,
					record.success ? 1 : 0,
					record.latencyMs,
					record.outputQuality ?? 0,
					record.outputQuality !== undefined ? 1 : 0,
					JSON.stringify(taskTypeStats),
					record.timestamp.toISOString(),
				);
		} else {
			const taskTypeStats = JSON.parse(existing.task_type_stats) as Record<
				string,
				{ count: number; success: number }
			>;
			if (!taskTypeStats[record.taskType]) {
				taskTypeStats[record.taskType] = { count: 0, success: 0 };
			}
			taskTypeStats[record.taskType].count++;
			if (record.success) taskTypeStats[record.taskType].success++;

			this.db
				.prepare(
					`
				UPDATE agent_performance SET
					total_tasks = total_tasks + 1,
					success_count = success_count + ?,
					total_latency_ms = total_latency_ms + ?,
					total_quality = total_quality + ?,
					quality_count = quality_count + ?,
					task_type_stats = ?,
					last_active = ?
				WHERE agent_id = ?
			`,
				)
				.run(
					record.success ? 1 : 0,
					record.latencyMs,
					record.outputQuality ?? 0,
					record.outputQuality !== undefined ? 1 : 0,
					JSON.stringify(taskTypeStats),
					record.timestamp.toISOString(),
					agentId,
				);
		}
	}

	private hashPrompt(prompt: string): string {
		// Simple hash for similarity matching
		const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
		let hash = 0;
		for (let i = 0; i < normalized.length; i++) {
			const char = normalized.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}
		return hash.toString(16);
	}

	// =========================================================================
	// Cleanup & Export
	// =========================================================================

	/** Get summary stats */
	getSummary(): {
		totalTasks: number;
		totalAgents: number;
		activeInsights: number;
		avgSuccessRate: number;
	} {
		const tasks = this.db.prepare("SELECT COUNT(*) as count FROM task_records").get() as { count: number };
		const agents = this.db.prepare("SELECT COUNT(*) as count FROM agent_performance").get() as { count: number };
		const insights = this.db.prepare("SELECT COUNT(*) as count FROM insights WHERE active = 1").get() as {
			count: number;
		};
		const perf = this.db
			.prepare("SELECT SUM(success_count) as success, SUM(total_tasks) as total FROM agent_performance")
			.get() as { success: number; total: number };

		return {
			totalTasks: tasks.count,
			totalAgents: agents.count,
			activeInsights: insights.count,
			avgSuccessRate: perf.total > 0 ? perf.success / perf.total : 0,
		};
	}

	/** Export all data */
	exportData(): {
		tasks: TaskRecord[];
		insights: Insight[];
		agentStats: AgentStats[];
	} {
		const tasks = this.db.prepare("SELECT * FROM task_records ORDER BY timestamp DESC").all() as any[];
		const insights = this.getActiveInsights();
		const agentStats = this.getAllAgentStats();

		return {
			tasks: tasks.map((t) => ({
				id: t.id,
				agentId: t.agent_id,
				agentRole: t.agent_role,
				taskType: t.task_type,
				prompt: t.prompt,
				promptHash: t.prompt_hash,
				success: Boolean(t.success),
				latencyMs: t.latency_ms,
				outputQuality: t.output_quality,
				tokenCount: t.token_count,
				cost: t.cost,
				errorType: t.error_type,
				timestamp: new Date(t.timestamp),
				metadata: t.metadata ? JSON.parse(t.metadata) : undefined,
			})),
			insights,
			agentStats,
		};
	}

	/** Close database */
	close(): void {
		this.db.close();
	}
}

// =============================================================================
// Singleton
// =============================================================================

let memoryInstance: AgentMemorySystem | null = null;

export function getMemorySystem(config?: Partial<MemoryConfig>): AgentMemorySystem {
	if (!memoryInstance) {
		memoryInstance = new AgentMemorySystem(config);
	}
	return memoryInstance;
}

export function resetMemorySystem(): void {
	if (memoryInstance) {
		memoryInstance.close();
		memoryInstance = null;
	}
}
