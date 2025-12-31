/**
 * SQLite Database Layer for Pi Discord Bot
 * Provides persistent storage for users, alerts, command history, and settings
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

/** Valid SQL parameter types for better-sqlite3 */
type SqlValue = string | number | bigint | Buffer | null;

export interface User {
	id: number;
	discord_id: string;
	created_at: string;
	settings_json: string;
}

export interface Alert {
	id: number;
	user_id: string;
	symbol: string;
	condition: ">" | "<";
	price: number;
	created_at: string;
	triggered_at: string | null;
}

export interface CommandHistory {
	id: number;
	user_id: string;
	command: string;
	args: string;
	timestamp: string;
	response_time_ms: number;
}

export interface Setting {
	key: string;
	value: string;
	updated_at: string;
}

export interface ScheduledTaskDB {
	id: string;
	name: string;
	cron_expression: string;
	action: string;
	channel_id: string;
	user_id: string;
	enabled: number; // SQLite doesn't have boolean, 0 or 1
	last_run: string | null;
	created_at: string;
}

/**
 * Tool metrics for MCP-Bench aligned performance tracking
 */
export interface ToolMetricDB {
	id: string;
	tool_name: string;
	server_name: string;
	timestamp: number;
	latency_ms: number;
	status: "success" | "error" | "timeout";
	confidence_score: number;
	input_tokens: number | null;
	output_tokens: number | null;
	error_message: string | null;
}

/**
 * Trading signal awaiting outcome evaluation
 */
export interface TradingSignalDB {
	id: string;
	timestamp: number;
	symbol: string;
	action: "BUY" | "SELL" | "HOLD";
	entry_price: number;
	confidence: number;
	agents: string; // JSON array
	evaluate_after_ms: number;
	created_at: string;
}

/**
 * Completed trading outcome for learning
 */
export interface TradingOutcomeDB {
	id: string;
	signal_id: string | null;
	timestamp: string;
	symbol: string;
	action: "BUY" | "SELL" | "HOLD";
	entry_price: number;
	exit_price: number | null;
	pnl: number | null;
	success: number; // SQLite boolean
	confidence: number;
	market_condition: "bull" | "bear" | "sideways" | "volatile";
	agents: string; // JSON array
	reason: string;
	created_at: string;
}

/**
 * Agent cost tracking for budget management
 */
export interface AgentCostDB {
	id: string;
	agent_id: string;
	pool_type: string;
	timestamp: number;
	input_tokens: number;
	output_tokens: number;
	api_calls: number;
	total_cost: number;
	model_used: string | null;
	task_id: string | null;
	roi: number | null;
	metadata: string | null; // JSON
	created_at: string;
}

/**
 * Semantic memory with vector embedding
 */
export interface SemanticMemoryDB {
	id: string;
	agent_id: string;
	content: string;
	embedding: Buffer;
	metadata: string | null; // JSON
	created_at: string;
}

/**
 * Research result from 24/7 research orchestrator
 */
export interface ResearchResultDB {
	id: string;
	cycle_id: string;
	topic_id: string;
	topic_name: string;
	domain: string;
	phase: string;
	success: number; // 0 or 1
	confidence: number;
	findings: string | null; // JSON array
	insights: string | null; // JSON array
	improvements: string | null; // JSON array
	duration_ms: number;
	error: string | null;
	created_at: string;
}

/**
 * Feature queue item for autonomous shipping
 */
export interface FeatureQueueDB {
	id: string;
	description: string;
	type: "feature" | "bug" | "chore";
	priority: number; // 1-10, higher = more urgent
	status: "pending" | "in_progress" | "completed" | "failed";
	user_id: string;
	channel_id: string;
	branch_name: string | null;
	pr_url: string | null;
	commit_sha: string | null;
	phases_json: string | null; // JSON object tracking phases
	error: string | null;
	created_at: string;
	started_at: string | null;
	completed_at: string | null;
}

export class BotDatabase {
	private _db: Database.Database;

	/** Raw database access for advanced queries */
	get db(): Database.Database {
		return this._db;
	}

	constructor(dbPath: string) {
		// Ensure directory exists
		const dir = dirname(dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this._db = new Database(dbPath);
		this._db.pragma("journal_mode = WAL"); // Better concurrency
		this.initializeTables();
	}

	private initializeTables(): void {
		// Users table
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				discord_id TEXT UNIQUE NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				settings_json TEXT DEFAULT '{}'
			)
		`);

		// Alerts table
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS alerts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				symbol TEXT NOT NULL,
				condition TEXT CHECK(condition IN ('>', '<')) NOT NULL,
				price REAL NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				triggered_at TEXT DEFAULT NULL,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Command history table
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS command_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				command TEXT NOT NULL,
				args TEXT NOT NULL DEFAULT '',
				timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				response_time_ms INTEGER NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Settings table (key-value store)
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Scheduled tasks table
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS scheduled_tasks (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				cron_expression TEXT NOT NULL,
				action TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				last_run TEXT DEFAULT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Tool metrics table for MCP-Bench aligned tracking
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS tool_metrics (
				id TEXT PRIMARY KEY,
				tool_name TEXT NOT NULL,
				server_name TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				latency_ms INTEGER NOT NULL,
				status TEXT CHECK(status IN ('success', 'error', 'timeout')) NOT NULL,
				confidence_score REAL NOT NULL DEFAULT 0.5,
				input_tokens INTEGER DEFAULT NULL,
				output_tokens INTEGER DEFAULT NULL,
				error_message TEXT DEFAULT NULL
			)
		`);

		// Trading signals table for pending signal tracking (fixes 0% win rate issue)
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS trading_signals (
				id TEXT PRIMARY KEY,
				timestamp INTEGER NOT NULL,
				symbol TEXT NOT NULL,
				action TEXT CHECK(action IN ('BUY', 'SELL', 'HOLD')) NOT NULL,
				entry_price REAL NOT NULL,
				confidence REAL NOT NULL,
				agents TEXT NOT NULL DEFAULT '[]',
				evaluate_after_ms INTEGER NOT NULL DEFAULT 900000,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Trading outcomes table for completed trades and learning
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS trading_outcomes (
				id TEXT PRIMARY KEY,
				signal_id TEXT,
				timestamp TEXT NOT NULL,
				symbol TEXT NOT NULL,
				action TEXT CHECK(action IN ('BUY', 'SELL', 'HOLD')) NOT NULL,
				entry_price REAL NOT NULL,
				exit_price REAL,
				pnl REAL,
				success INTEGER NOT NULL DEFAULT 0,
				confidence REAL NOT NULL,
				market_condition TEXT CHECK(market_condition IN ('bull', 'bear', 'sideways', 'volatile')) NOT NULL,
				agents TEXT NOT NULL DEFAULT '[]',
				reason TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (signal_id) REFERENCES trading_signals(id)
			)
		`);

		// Agent costs table for budget management and cost tracking
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS agent_costs (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				pool_type TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				input_tokens INTEGER NOT NULL DEFAULT 0,
				output_tokens INTEGER NOT NULL DEFAULT 0,
				api_calls INTEGER NOT NULL DEFAULT 1,
				total_cost REAL NOT NULL DEFAULT 0,
				model_used TEXT,
				task_id TEXT,
				roi REAL,
				metadata TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Semantic memories table for vector search
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS semantic_memories (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				content TEXT NOT NULL,
				embedding BLOB NOT NULL,
				metadata TEXT DEFAULT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Research results table for 24/7 research persistence
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS research_results (
				id TEXT PRIMARY KEY,
				cycle_id TEXT NOT NULL,
				topic_id TEXT NOT NULL,
				topic_name TEXT NOT NULL,
				domain TEXT NOT NULL,
				phase TEXT NOT NULL,
				success INTEGER NOT NULL DEFAULT 0,
				confidence REAL NOT NULL DEFAULT 0,
				findings TEXT,
				insights TEXT,
				improvements TEXT,
				duration_ms INTEGER NOT NULL DEFAULT 0,
				error TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Feature queue table for autonomous feature shipping
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS feature_queue (
				id TEXT PRIMARY KEY,
				description TEXT NOT NULL,
				type TEXT CHECK(type IN ('feature', 'bug', 'chore')) NOT NULL DEFAULT 'feature',
				priority INTEGER NOT NULL DEFAULT 5,
				status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')) NOT NULL DEFAULT 'pending',
				user_id TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				branch_name TEXT DEFAULT NULL,
				pr_url TEXT DEFAULT NULL,
				commit_sha TEXT DEFAULT NULL,
				phases_json TEXT DEFAULT NULL,
				error TEXT DEFAULT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				started_at TEXT DEFAULT NULL,
				completed_at TEXT DEFAULT NULL,
				FOREIGN KEY (user_id) REFERENCES users(discord_id)
			)
		`);

		// Create indexes for better performance
		this._db.exec(`
			CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
			CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered_at);
			CREATE INDEX IF NOT EXISTS idx_command_history_user_id ON command_history(user_id);
			CREATE INDEX IF NOT EXISTS idx_command_history_timestamp ON command_history(timestamp);
			CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
			CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
			CREATE INDEX IF NOT EXISTS idx_tool_metrics_tool ON tool_metrics(tool_name);
			CREATE INDEX IF NOT EXISTS idx_tool_metrics_server ON tool_metrics(server_name);
			CREATE INDEX IF NOT EXISTS idx_tool_metrics_timestamp ON tool_metrics(timestamp);
			CREATE INDEX IF NOT EXISTS idx_tool_metrics_status ON tool_metrics(status);
			CREATE INDEX IF NOT EXISTS idx_trading_signals_symbol ON trading_signals(symbol);
			CREATE INDEX IF NOT EXISTS idx_trading_signals_timestamp ON trading_signals(timestamp);
			CREATE INDEX IF NOT EXISTS idx_trading_outcomes_symbol ON trading_outcomes(symbol);
			CREATE INDEX IF NOT EXISTS idx_trading_outcomes_success ON trading_outcomes(success);
			CREATE INDEX IF NOT EXISTS idx_trading_outcomes_timestamp ON trading_outcomes(timestamp);
			CREATE INDEX IF NOT EXISTS idx_agent_costs_agent ON agent_costs(agent_id);
			CREATE INDEX IF NOT EXISTS idx_agent_costs_pool ON agent_costs(pool_type);
			CREATE INDEX IF NOT EXISTS idx_agent_costs_timestamp ON agent_costs(timestamp);
			CREATE INDEX IF NOT EXISTS idx_agent_costs_task ON agent_costs(task_id);
			CREATE INDEX IF NOT EXISTS idx_semantic_agent ON semantic_memories(agent_id);
			CREATE INDEX IF NOT EXISTS idx_semantic_created ON semantic_memories(created_at);
			CREATE INDEX IF NOT EXISTS idx_research_topic ON research_results(topic_id);
			CREATE INDEX IF NOT EXISTS idx_research_domain ON research_results(domain);
			CREATE INDEX IF NOT EXISTS idx_research_success ON research_results(success);
			CREATE INDEX IF NOT EXISTS idx_research_created ON research_results(created_at);
			CREATE INDEX IF NOT EXISTS idx_feature_queue_status ON feature_queue(status);
			CREATE INDEX IF NOT EXISTS idx_feature_queue_priority ON feature_queue(priority);
			CREATE INDEX IF NOT EXISTS idx_feature_queue_user ON feature_queue(user_id);
			CREATE INDEX IF NOT EXISTS idx_feature_queue_created ON feature_queue(created_at);
		`);
	}

	// ========================================================================
	// User Methods
	// ========================================================================

	public ensureUser(discordId: string): void {
		const stmt = this._db.prepare(`
			INSERT OR IGNORE INTO users (discord_id) VALUES (?)
		`);
		stmt.run(discordId);
	}

	public getUser(discordId: string): User | undefined {
		const stmt = this._db.prepare(`
			SELECT * FROM users WHERE discord_id = ?
		`);
		return stmt.get(discordId) as User | undefined;
	}

	public getUserSettings(discordId: string): Record<string, any> {
		const user = this.getUser(discordId);
		if (!user) return {};
		try {
			return JSON.parse(user.settings_json);
		} catch {
			return {};
		}
	}

	public updateUserSettings(discordId: string, settings: Record<string, any>): void {
		this.ensureUser(discordId);
		const stmt = this._db.prepare(`
			UPDATE users SET settings_json = ? WHERE discord_id = ?
		`);
		stmt.run(JSON.stringify(settings), discordId);
	}

	// ========================================================================
	// Alert Methods
	// ========================================================================

	public saveAlert(userId: string, symbol: string, condition: ">" | "<", price: number): number {
		this.ensureUser(userId);
		const stmt = this._db.prepare(`
			INSERT INTO alerts (user_id, symbol, condition, price)
			VALUES (?, ?, ?, ?)
		`);
		const result = stmt.run(userId, symbol.toUpperCase(), condition, price);
		return result.lastInsertRowid as number;
	}

	public getAlerts(userId?: string, activeOnly: boolean = true): Alert[] {
		let query = `SELECT * FROM alerts`;
		const params: SqlValue[] = [];

		const conditions: string[] = [];
		if (userId) {
			conditions.push("user_id = ?");
			params.push(userId);
		}
		if (activeOnly) {
			conditions.push("triggered_at IS NULL");
		}

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		query += " ORDER BY created_at DESC";

		const stmt = this._db.prepare(query);
		return stmt.all(...params) as Alert[];
	}

	public getAlertById(alertId: number): Alert | undefined {
		const stmt = this._db.prepare(`
			SELECT * FROM alerts WHERE id = ?
		`);
		return stmt.get(alertId) as Alert | undefined;
	}

	public triggerAlert(alertId: number): void {
		const stmt = this._db.prepare(`
			UPDATE alerts SET triggered_at = CURRENT_TIMESTAMP WHERE id = ?
		`);
		stmt.run(alertId);
	}

	public deleteAlert(alertId: number): void {
		const stmt = this._db.prepare(`
			DELETE FROM alerts WHERE id = ?
		`);
		stmt.run(alertId);
	}

	public getUserAlertCount(userId: string, activeOnly: boolean = true): number {
		let query = `SELECT COUNT(*) as count FROM alerts WHERE user_id = ?`;
		if (activeOnly) {
			query += " AND triggered_at IS NULL";
		}
		const stmt = this._db.prepare(query);
		const result = stmt.get(userId) as { count: number };
		return result.count;
	}

	// ========================================================================
	// Command History Methods
	// ========================================================================

	public logCommand(userId: string, command: string, args: string, responseTimeMs: number): void {
		this.ensureUser(userId);
		const stmt = this._db.prepare(`
			INSERT INTO command_history (user_id, command, args, response_time_ms)
			VALUES (?, ?, ?, ?)
		`);
		stmt.run(userId, command, args, responseTimeMs);
	}

	public getCommandHistory(userId?: string, limit: number = 100): CommandHistory[] {
		let query = `SELECT * FROM command_history`;
		const params: SqlValue[] = [];

		if (userId) {
			query += " WHERE user_id = ?";
			params.push(userId);
		}

		query += ` ORDER BY timestamp DESC LIMIT ?`;
		params.push(limit);

		const stmt = this._db.prepare(query);
		return stmt.all(...params) as CommandHistory[];
	}

	public getCommandStats(userId?: string): {
		total: number;
		avgResponseTime: number;
		topCommands: Array<{ command: string; count: number }>;
	} {
		let baseQuery = "";
		const params: SqlValue[] = [];

		if (userId) {
			baseQuery = " WHERE user_id = ?";
			params.push(userId);
		}

		// Total and average response time
		const stmt1 = this._db.prepare(`
			SELECT
				COUNT(*) as total,
				AVG(response_time_ms) as avg_time
			FROM command_history${baseQuery}
		`);
		const basicStats = stmt1.get(...params) as { total: number; avg_time: number };

		// Top commands
		const stmt2 = this._db.prepare(`
			SELECT command, COUNT(*) as count
			FROM command_history${baseQuery}
			GROUP BY command
			ORDER BY count DESC
			LIMIT 10
		`);
		const topCommands = stmt2.all(...params) as Array<{ command: string; count: number }>;

		return {
			total: basicStats.total,
			avgResponseTime: Math.round(basicStats.avg_time || 0),
			topCommands,
		};
	}

	// ========================================================================
	// Settings Methods
	// ========================================================================

	public getSetting(key: string, defaultValue?: string): string | undefined {
		const stmt = this._db.prepare(`
			SELECT value FROM settings WHERE key = ?
		`);
		const result = stmt.get(key) as { value: string } | undefined;
		return result ? result.value : defaultValue;
	}

	public setSetting(key: string, value: string): void {
		const stmt = this._db.prepare(`
			INSERT OR REPLACE INTO settings (key, value, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
		`);
		stmt.run(key, value);
	}

	public getAllSettings(): Setting[] {
		const stmt = this._db.prepare(`
			SELECT * FROM settings ORDER BY key
		`);
		return stmt.all() as Setting[];
	}

	// ========================================================================
	// Scheduled Tasks Methods
	// ========================================================================

	public upsertScheduledTask(task: ScheduledTaskDB): void {
		this.ensureUser(task.user_id);
		const stmt = this._db.prepare(`
			INSERT OR REPLACE INTO scheduled_tasks
			(id, name, cron_expression, action, channel_id, user_id, enabled, last_run, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			task.id,
			task.name,
			task.cron_expression,
			task.action,
			task.channel_id,
			task.user_id,
			task.enabled,
			task.last_run,
			task.created_at,
		);
	}

	public getScheduledTask(taskId: string): ScheduledTaskDB | undefined {
		const stmt = this._db.prepare(`
			SELECT * FROM scheduled_tasks WHERE id = ?
		`);
		return stmt.get(taskId) as ScheduledTaskDB | undefined;
	}

	public getAllScheduledTasks(userId?: string): ScheduledTaskDB[] {
		let query = `SELECT * FROM scheduled_tasks`;
		const params: SqlValue[] = [];

		if (userId) {
			query += " WHERE user_id = ?";
			params.push(userId);
		}

		query += " ORDER BY created_at DESC";

		const stmt = this._db.prepare(query);
		return stmt.all(...params) as ScheduledTaskDB[];
	}

	public deleteScheduledTask(taskId: string): void {
		const stmt = this._db.prepare(`
			DELETE FROM scheduled_tasks WHERE id = ?
		`);
		stmt.run(taskId);
	}

	public updateTaskLastRun(taskId: string, lastRun: string): void {
		const stmt = this._db.prepare(`
			UPDATE scheduled_tasks SET last_run = ? WHERE id = ?
		`);
		stmt.run(lastRun, taskId);
	}

	public toggleScheduledTask(taskId: string): boolean {
		const task = this.getScheduledTask(taskId);
		if (!task) return false;

		const newEnabled = task.enabled === 1 ? 0 : 1;
		const stmt = this._db.prepare(`
			UPDATE scheduled_tasks SET enabled = ? WHERE id = ?
		`);
		stmt.run(newEnabled, taskId);
		return newEnabled === 1;
	}

	// ========================================================================
	// Tool Metrics Methods (MCP-Bench aligned)
	// ========================================================================

	public saveToolMetric(metric: ToolMetricDB): void {
		const stmt = this._db.prepare(`
			INSERT INTO tool_metrics (id, tool_name, server_name, timestamp, latency_ms, status, confidence_score, input_tokens, output_tokens, error_message)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			metric.id,
			metric.tool_name,
			metric.server_name,
			metric.timestamp,
			metric.latency_ms,
			metric.status,
			metric.confidence_score,
			metric.input_tokens,
			metric.output_tokens,
			metric.error_message,
		);
	}

	public saveToolMetricsBatch(metrics: ToolMetricDB[]): void {
		const stmt = this._db.prepare(`
			INSERT INTO tool_metrics (id, tool_name, server_name, timestamp, latency_ms, status, confidence_score, input_tokens, output_tokens, error_message)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const insertMany = this._db.transaction((items: ToolMetricDB[]) => {
			for (const m of items) {
				stmt.run(
					m.id,
					m.tool_name,
					m.server_name,
					m.timestamp,
					m.latency_ms,
					m.status,
					m.confidence_score,
					m.input_tokens,
					m.output_tokens,
					m.error_message,
				);
			}
		});

		insertMany(metrics);
	}

	public getToolMetrics(
		options: {
			toolName?: string;
			serverName?: string;
			status?: "success" | "error" | "timeout";
			since?: number;
			limit?: number;
		} = {},
	): ToolMetricDB[] {
		const { toolName, serverName, status, since, limit = 1000 } = options;

		let query = "SELECT * FROM tool_metrics";
		const conditions: string[] = [];
		const params: SqlValue[] = [];

		if (toolName) {
			conditions.push("tool_name = ?");
			params.push(toolName);
		}
		if (serverName) {
			conditions.push("server_name = ?");
			params.push(serverName);
		}
		if (status) {
			conditions.push("status = ?");
			params.push(status);
		}
		if (since) {
			conditions.push("timestamp >= ?");
			params.push(since);
		}

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		query += " ORDER BY timestamp DESC LIMIT ?";
		params.push(limit);

		const stmt = this._db.prepare(query);
		return stmt.all(...params) as ToolMetricDB[];
	}

	public getToolMetricsStats(
		toolName?: string,
		serverName?: string,
	): {
		totalCalls: number;
		successRate: number;
		avgLatencyMs: number;
		avgConfidence: number;
		errorCount: number;
		timeoutCount: number;
	} {
		let query = `
			SELECT
				COUNT(*) as total_calls,
				SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
				SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
				SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout_count,
				AVG(latency_ms) as avg_latency,
				AVG(confidence_score) as avg_confidence
			FROM tool_metrics
		`;

		const conditions: string[] = [];
		const params: SqlValue[] = [];

		if (toolName) {
			conditions.push("tool_name = ?");
			params.push(toolName);
		}
		if (serverName) {
			conditions.push("server_name = ?");
			params.push(serverName);
		}

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		const stmt = this._db.prepare(query);
		const result = stmt.get(...params) as {
			total_calls: number;
			success_count: number;
			error_count: number;
			timeout_count: number;
			avg_latency: number | null;
			avg_confidence: number | null;
		};

		return {
			totalCalls: result.total_calls,
			successRate: result.total_calls > 0 ? result.success_count / result.total_calls : 0,
			avgLatencyMs: Math.round(result.avg_latency || 0),
			avgConfidence: result.avg_confidence || 0,
			errorCount: result.error_count,
			timeoutCount: result.timeout_count,
		};
	}

	public getTopToolsByUsage(
		limit: number = 20,
	): Array<{ tool_name: string; server_name: string; call_count: number; success_rate: number }> {
		const stmt = this._db.prepare(`
			SELECT
				tool_name,
				server_name,
				COUNT(*) as call_count,
				CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
			FROM tool_metrics
			GROUP BY tool_name, server_name
			ORDER BY call_count DESC
			LIMIT ?
		`);
		return stmt.all(limit) as Array<{
			tool_name: string;
			server_name: string;
			call_count: number;
			success_rate: number;
		}>;
	}

	public getLowPerformingTools(
		successRateThreshold: number = 0.7,
		minCalls: number = 10,
	): Array<{
		tool_name: string;
		server_name: string;
		call_count: number;
		success_rate: number;
		avg_latency_ms: number;
	}> {
		const stmt = this._db.prepare(`
			SELECT
				tool_name,
				server_name,
				COUNT(*) as call_count,
				CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate,
				AVG(latency_ms) as avg_latency_ms
			FROM tool_metrics
			GROUP BY tool_name, server_name
			HAVING call_count >= ? AND success_rate < ?
			ORDER BY success_rate ASC
		`);
		return stmt.all(minCalls, successRateThreshold) as Array<{
			tool_name: string;
			server_name: string;
			call_count: number;
			success_rate: number;
			avg_latency_ms: number;
		}>;
	}

	public pruneOldMetrics(olderThanDays: number = 30): number {
		const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
		const stmt = this._db.prepare("DELETE FROM tool_metrics WHERE timestamp < ?");
		const result = stmt.run(cutoff);
		return result.changes;
	}

	/**
	 * Get top performing tools by success rate
	 */
	public getTopTools(limit: number = 10): Array<{
		tool_name: string;
		server_name: string;
		total_calls: number;
		success_rate: number;
	}> {
		const stmt = this._db.prepare(`
			SELECT
				tool_name,
				server_name,
				COUNT(*) as total_calls,
				CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
			FROM tool_metrics
			GROUP BY tool_name, server_name
			HAVING COUNT(*) >= 3
			ORDER BY success_rate DESC, total_calls DESC
			LIMIT ?
		`);
		return stmt.all(limit) as Array<{
			tool_name: string;
			server_name: string;
			total_calls: number;
			success_rate: number;
		}>;
	}

	/**
	 * Get slowest tools by average latency
	 */
	public getSlowestTools(limit: number = 10): Array<{
		tool_name: string;
		server_name: string;
		total_calls: number;
		avg_latency: number;
	}> {
		const stmt = this._db.prepare(`
			SELECT
				tool_name,
				server_name,
				COUNT(*) as total_calls,
				AVG(latency_ms) as avg_latency
			FROM tool_metrics
			GROUP BY tool_name, server_name
			HAVING COUNT(*) >= 2
			ORDER BY avg_latency DESC
			LIMIT ?
		`);
		return stmt.all(limit) as Array<{
			tool_name: string;
			server_name: string;
			total_calls: number;
			avg_latency: number;
		}>;
	}

	/**
	 * Get most error-prone tools
	 */
	public getMostErrorProneTools(limit: number = 10): Array<{
		tool_name: string;
		server_name: string;
		total_calls: number;
		error_count: number;
		error_rate: number;
	}> {
		const stmt = this._db.prepare(`
			SELECT
				tool_name,
				server_name,
				COUNT(*) as total_calls,
				SUM(CASE WHEN status = 'error' OR status = 'timeout' THEN 1 ELSE 0 END) as error_count,
				CAST(SUM(CASE WHEN status = 'error' OR status = 'timeout' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as error_rate
			FROM tool_metrics
			GROUP BY tool_name, server_name
			HAVING error_count > 0
			ORDER BY error_count DESC, error_rate DESC
			LIMIT ?
		`);
		return stmt.all(limit) as Array<{
			tool_name: string;
			server_name: string;
			total_calls: number;
			error_count: number;
			error_rate: number;
		}>;
	}

	// ========================================================================
	// Trading Signal Methods (fixes 0% win rate by persisting signals across restarts)
	// ========================================================================

	public saveTradingSignal(signal: Omit<TradingSignalDB, "created_at">): void {
		const stmt = this._db.prepare(`
			INSERT OR REPLACE INTO trading_signals
			(id, timestamp, symbol, action, entry_price, confidence, agents, evaluate_after_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			signal.id,
			signal.timestamp,
			signal.symbol,
			signal.action,
			signal.entry_price,
			signal.confidence,
			signal.agents,
			signal.evaluate_after_ms,
		);
	}

	public getTradingSignal(id: string): TradingSignalDB | undefined {
		const stmt = this._db.prepare("SELECT * FROM trading_signals WHERE id = ?");
		return stmt.get(id) as TradingSignalDB | undefined;
	}

	public getPendingTradingSignals(): TradingSignalDB[] {
		const now = Date.now();
		const stmt = this._db.prepare(`
			SELECT * FROM trading_signals
			WHERE timestamp + evaluate_after_ms > ?
			ORDER BY timestamp ASC
		`);
		return stmt.all(now) as TradingSignalDB[];
	}

	public getExpiredTradingSignals(): TradingSignalDB[] {
		const now = Date.now();
		const stmt = this._db.prepare(`
			SELECT * FROM trading_signals
			WHERE timestamp + evaluate_after_ms <= ?
			ORDER BY timestamp ASC
		`);
		return stmt.all(now) as TradingSignalDB[];
	}

	public deleteTradingSignal(id: string): void {
		const stmt = this._db.prepare("DELETE FROM trading_signals WHERE id = ?");
		stmt.run(id);
	}

	public deleteAllTradingSignals(): number {
		const result = this._db.prepare("DELETE FROM trading_signals").run();
		return result.changes;
	}

	// ========================================================================
	// Trading Outcome Methods
	// ========================================================================

	public saveTradingOutcome(outcome: Omit<TradingOutcomeDB, "id" | "created_at">): string {
		const id = `outcome_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const stmt = this._db.prepare(`
			INSERT INTO trading_outcomes
			(id, signal_id, timestamp, symbol, action, entry_price, exit_price, pnl, success, confidence, market_condition, agents, reason)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			id,
			outcome.signal_id,
			outcome.timestamp,
			outcome.symbol,
			outcome.action,
			outcome.entry_price,
			outcome.exit_price,
			outcome.pnl,
			outcome.success,
			outcome.confidence,
			outcome.market_condition,
			outcome.agents,
			outcome.reason,
		);
		return id;
	}

	public getTradingOutcomes(limit: number = 100): TradingOutcomeDB[] {
		const stmt = this._db.prepare(`
			SELECT * FROM trading_outcomes
			ORDER BY created_at DESC
			LIMIT ?
		`);
		return stmt.all(limit) as TradingOutcomeDB[];
	}

	public getTradingOutcomeStats(): {
		total: number;
		successful: number;
		winRate: number;
		avgPnl: number;
		byMarketCondition: Array<{ condition: string; total: number; successful: number; winRate: number }>;
	} {
		const totalStmt = this._db.prepare(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
				AVG(pnl) as avg_pnl
			FROM trading_outcomes
		`);
		const totals = totalStmt.get() as { total: number; successful: number; avg_pnl: number | null };

		const conditionStmt = this._db.prepare(`
			SELECT
				market_condition as condition,
				COUNT(*) as total,
				SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful
			FROM trading_outcomes
			GROUP BY market_condition
		`);
		const byCondition = conditionStmt.all() as Array<{ condition: string; total: number; successful: number }>;

		return {
			total: totals.total,
			successful: totals.successful,
			winRate: totals.total > 0 ? (totals.successful / totals.total) * 100 : 0,
			avgPnl: totals.avg_pnl ?? 0,
			byMarketCondition: byCondition.map((c) => ({
				...c,
				winRate: c.total > 0 ? (c.successful / c.total) * 100 : 0,
			})),
		};
	}

	public pruneOldOutcomes(olderThanDays: number = 90): number {
		const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
		const stmt = this._db.prepare("DELETE FROM trading_outcomes WHERE created_at < ?");
		const result = stmt.run(cutoff);
		return result.changes;
	}

	// ========================================================================
	// Agent Cost Methods
	// ========================================================================

	public saveAgentCost(cost: Omit<AgentCostDB, "created_at">): void {
		const stmt = this._db.prepare(`
			INSERT INTO agent_costs
			(id, agent_id, pool_type, timestamp, input_tokens, output_tokens, api_calls, total_cost, model_used, task_id, roi, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			cost.id,
			cost.agent_id,
			cost.pool_type,
			cost.timestamp,
			cost.input_tokens,
			cost.output_tokens,
			cost.api_calls,
			cost.total_cost,
			cost.model_used,
			cost.task_id,
			cost.roi,
			cost.metadata,
		);
	}

	public getAgentCosts(
		options: { agentId?: string; poolType?: string; since?: number; limit?: number } = {},
	): AgentCostDB[] {
		const { agentId, poolType, since, limit = 1000 } = options;

		let query = "SELECT * FROM agent_costs";
		const conditions: string[] = [];
		const params: SqlValue[] = [];

		if (agentId) {
			conditions.push("agent_id = ?");
			params.push(agentId);
		}
		if (poolType) {
			conditions.push("pool_type = ?");
			params.push(poolType);
		}
		if (since) {
			conditions.push("timestamp >= ?");
			params.push(since);
		}

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		query += " ORDER BY timestamp DESC LIMIT ?";
		params.push(limit);

		const stmt = this._db.prepare(query);
		return stmt.all(...params) as AgentCostDB[];
	}

	public getAgentCostStats(
		agentId?: string,
		poolType?: string,
	): {
		totalCost: number;
		totalTokens: number;
		totalApiCalls: number;
		avgCost: number;
		avgTokens: number;
	} {
		let query = `
			SELECT
				SUM(total_cost) as total_cost,
				SUM(input_tokens + output_tokens) as total_tokens,
				SUM(api_calls) as total_api_calls,
				AVG(total_cost) as avg_cost,
				AVG(input_tokens + output_tokens) as avg_tokens
			FROM agent_costs
		`;

		const conditions: string[] = [];
		const params: SqlValue[] = [];

		if (agentId) {
			conditions.push("agent_id = ?");
			params.push(agentId);
		}
		if (poolType) {
			conditions.push("pool_type = ?");
			params.push(poolType);
		}

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		const stmt = this._db.prepare(query);
		const result = stmt.get(...params) as {
			total_cost: number | null;
			total_tokens: number | null;
			total_api_calls: number | null;
			avg_cost: number | null;
			avg_tokens: number | null;
		};

		return {
			totalCost: result.total_cost || 0,
			totalTokens: result.total_tokens || 0,
			totalApiCalls: result.total_api_calls || 0,
			avgCost: result.avg_cost || 0,
			avgTokens: result.avg_tokens || 0,
		};
	}

	public getTopCostAgents(limit: number = 10): Array<{
		agent_id: string;
		pool_type: string;
		total_cost: number;
		total_calls: number;
	}> {
		const stmt = this._db.prepare(`
			SELECT
				agent_id,
				pool_type,
				SUM(total_cost) as total_cost,
				SUM(api_calls) as total_calls
			FROM agent_costs
			GROUP BY agent_id, pool_type
			ORDER BY total_cost DESC
			LIMIT ?
		`);
		return stmt.all(limit) as Array<{
			agent_id: string;
			pool_type: string;
			total_cost: number;
			total_calls: number;
		}>;
	}

	public pruneOldAgentCosts(olderThanDays: number = 30): number {
		const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
		const stmt = this._db.prepare("DELETE FROM agent_costs WHERE timestamp < ?");
		const result = stmt.run(cutoff);
		return result.changes;
	}

	// ========================================================================
	// Semantic Memory Methods (Vector Embeddings)
	// ========================================================================

	public saveSemanticMemory(memory: Omit<SemanticMemoryDB, "created_at">): void {
		const stmt = this._db.prepare(`
			INSERT INTO semantic_memories (id, agent_id, content, embedding, metadata)
			VALUES (?, ?, ?, ?, ?)
		`);
		stmt.run(memory.id, memory.agent_id, memory.content, memory.embedding, memory.metadata);
	}

	public getSemanticMemory(id: string): SemanticMemoryDB | undefined {
		const stmt = this._db.prepare("SELECT * FROM semantic_memories WHERE id = ?");
		return stmt.get(id) as SemanticMemoryDB | undefined;
	}

	public getSemanticMemories(agentId: string, metadata?: Record<string, any>): SemanticMemoryDB[] {
		let query = "SELECT * FROM semantic_memories WHERE agent_id = ?";
		const params: SqlValue[] = [agentId];

		// Note: Metadata filtering is limited in SQLite without JSON1 extension
		// For now, we return all and filter in application layer
		query += " ORDER BY created_at DESC";

		const stmt = this._db.prepare(query);
		const results = stmt.all(...params) as SemanticMemoryDB[];

		// Filter by metadata in application layer if needed
		if (metadata) {
			return results.filter((mem) => {
				if (!mem.metadata) return false;
				try {
					const memMeta = JSON.parse(mem.metadata);
					return Object.entries(metadata).every(([key, val]) => memMeta[key] === val);
				} catch {
					return false;
				}
			});
		}

		return results;
	}

	public deleteSemanticMemory(id: string): void {
		const stmt = this._db.prepare("DELETE FROM semantic_memories WHERE id = ?");
		stmt.run(id);
	}

	public deleteAllSemanticMemories(agentId: string): number {
		const stmt = this._db.prepare("DELETE FROM semantic_memories WHERE agent_id = ?");
		const result = stmt.run(agentId);
		return result.changes;
	}

	public updateSemanticMemory(
		id: string,
		updates: { content: string; embedding: Buffer; metadata: string | null },
	): void {
		const stmt = this._db.prepare(`
			UPDATE semantic_memories
			SET content = ?, embedding = ?, metadata = ?
			WHERE id = ?
		`);
		stmt.run(updates.content, updates.embedding, updates.metadata, id);
	}

	public getSemanticMemoryCount(agentId: string): number {
		const stmt = this._db.prepare("SELECT COUNT(*) as count FROM semantic_memories WHERE agent_id = ?");
		const result = stmt.get(agentId) as { count: number };
		return result.count;
	}

	public getSemanticMemoryStats(): {
		totalMemories: number;
		agentCounts: Array<{ agentId: string; count: number }>;
	} {
		const totalStmt = this._db.prepare("SELECT COUNT(*) as total FROM semantic_memories");
		const { total } = totalStmt.get() as { total: number };

		const agentStmt = this._db.prepare(`
			SELECT agent_id as agentId, COUNT(*) as count
			FROM semantic_memories
			GROUP BY agent_id
			ORDER BY count DESC
		`);
		const agentCounts = agentStmt.all() as Array<{ agentId: string; count: number }>;

		return {
			totalMemories: total,
			agentCounts,
		};
	}

	public pruneOldSemanticMemories(agentId: string, keepRecent: number): number {
		const stmt = this._db.prepare(`
			DELETE FROM semantic_memories
			WHERE agent_id = ?
			AND id NOT IN (
				SELECT id FROM semantic_memories
				WHERE agent_id = ?
				ORDER BY created_at DESC
				LIMIT ?
			)
		`);
		const result = stmt.run(agentId, agentId, keepRecent);
		return result.changes;
	}

	// ========================================================================
	// Maintenance Methods
	// ========================================================================

	public vacuum(): void {
		this._db.exec("VACUUM");
	}

	public getStats(): {
		users: number;
		alerts: number;
		activeAlerts: number;
		commands: number;
		scheduledTasks: number;
		dbSize: number;
	} {
		const userCount = (this._db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
		const alertCount = (this._db.prepare("SELECT COUNT(*) as count FROM alerts").get() as { count: number }).count;
		const activeAlertCount = (
			this._db.prepare("SELECT COUNT(*) as count FROM alerts WHERE triggered_at IS NULL").get() as { count: number }
		).count;
		const commandCount = (
			this._db.prepare("SELECT COUNT(*) as count FROM command_history").get() as { count: number }
		).count;
		const scheduledTaskCount = (
			this._db.prepare("SELECT COUNT(*) as count FROM scheduled_tasks").get() as { count: number }
		).count;

		return {
			users: userCount,
			alerts: alertCount,
			activeAlerts: activeAlertCount,
			commands: commandCount,
			scheduledTasks: scheduledTaskCount,
			dbSize: 0, // Would need fs.statSync to get actual size
		};
	}

	// ========================================================================
	// Research Results Methods
	// ========================================================================

	/**
	 * Save a research result to the database
	 */
	saveResearchResult(result: {
		cycleId: string;
		topicId: string;
		topicName: string;
		domain: string;
		phase: string;
		success: boolean;
		confidence: number;
		findings?: string[];
		insights?: string[];
		improvements?: string[];
		duration: number;
		error?: string;
	}): string {
		const id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const stmt = this._db.prepare(`
			INSERT INTO research_results
			(id, cycle_id, topic_id, topic_name, domain, phase, success, confidence, findings, insights, improvements, duration_ms, error)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			id,
			result.cycleId,
			result.topicId,
			result.topicName,
			result.domain,
			result.phase,
			result.success ? 1 : 0,
			result.confidence,
			result.findings ? JSON.stringify(result.findings) : null,
			result.insights ? JSON.stringify(result.insights) : null,
			result.improvements ? JSON.stringify(result.improvements) : null,
			result.duration,
			result.error || null,
		);

		return id;
	}

	/**
	 * Get recent research results
	 */
	getRecentResearchResults(limit = 20): ResearchResultDB[] {
		return this.db
			.prepare("SELECT * FROM research_results ORDER BY created_at DESC LIMIT ?")
			.all(limit) as ResearchResultDB[];
	}

	/**
	 * Get research results by topic
	 */
	getResearchResultsByTopic(topicId: string, limit = 20): ResearchResultDB[] {
		return this.db
			.prepare("SELECT * FROM research_results WHERE topic_id = ? ORDER BY created_at DESC LIMIT ?")
			.all(topicId, limit) as ResearchResultDB[];
	}

	/**
	 * Get research results by domain
	 */
	getResearchResultsByDomain(domain: string, limit = 20): ResearchResultDB[] {
		return this.db
			.prepare("SELECT * FROM research_results WHERE domain = ? ORDER BY created_at DESC LIMIT ?")
			.all(domain, limit) as ResearchResultDB[];
	}

	/**
	 * Get successful trading research results
	 */
	getSuccessfulTradingResearch(limit = 20): ResearchResultDB[] {
		return this.db
			.prepare(`
				SELECT * FROM research_results
				WHERE domain = 'trading' AND success = 1 AND confidence >= 0.7
				ORDER BY created_at DESC LIMIT ?
			`)
			.all(limit) as ResearchResultDB[];
	}

	/**
	 * Get research statistics
	 */
	getResearchStats(): {
		total: number;
		successful: number;
		byDomain: Record<string, number>;
		avgConfidence: number;
		totalDuration: number;
	} {
		const total = (this._db.prepare("SELECT COUNT(*) as count FROM research_results").get() as { count: number })
			.count;
		const successful = (
			this._db.prepare("SELECT COUNT(*) as count FROM research_results WHERE success = 1").get() as { count: number }
		).count;
		const avgConfidence =
			(this._db.prepare("SELECT AVG(confidence) as avg FROM research_results").get() as { avg: number | null })
				.avg || 0;
		const totalDuration =
			(this._db.prepare("SELECT SUM(duration_ms) as sum FROM research_results").get() as { sum: number | null })
				.sum || 0;

		// Get counts by domain
		const domainResults = this.db
			.prepare("SELECT domain, COUNT(*) as count FROM research_results GROUP BY domain")
			.all() as Array<{ domain: string; count: number }>;

		const byDomain: Record<string, number> = {};
		for (const row of domainResults) {
			byDomain[row.domain] = row.count;
		}

		return { total, successful, byDomain, avgConfidence, totalDuration };
	}

	/**
	 * Delete old research results (keep last N days)
	 */
	pruneOldResearchResults(daysToKeep = 30): number {
		const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
		const result = this._db.prepare("DELETE FROM research_results WHERE created_at < ?").run(cutoffDate);
		return result.changes;
	}

	// ========================================================================
	// Feature Queue Methods (Autonomous Feature Shipping)
	// ========================================================================

	/**
	 * Add a feature to the shipping queue
	 */
	addToFeatureQueue(feature: {
		id: string;
		description: string;
		type: "feature" | "bug" | "chore";
		priority: number;
		userId: string;
		channelId: string;
	}): void {
		this.ensureUser(feature.userId);
		const stmt = this._db.prepare(`
			INSERT INTO feature_queue (id, description, type, priority, status, user_id, channel_id)
			VALUES (?, ?, ?, ?, 'pending', ?, ?)
		`);
		stmt.run(feature.id, feature.description, feature.type, feature.priority, feature.userId, feature.channelId);
	}

	/**
	 * Get a feature by ID
	 */
	getFeatureById(id: string): FeatureQueueDB | undefined {
		const stmt = this._db.prepare("SELECT * FROM feature_queue WHERE id = ?");
		return stmt.get(id) as FeatureQueueDB | undefined;
	}

	/**
	 * Get all pending features ordered by priority
	 */
	getPendingFeatures(limit = 20): FeatureQueueDB[] {
		const stmt = this._db.prepare(`
			SELECT * FROM feature_queue
			WHERE status = 'pending'
			ORDER BY priority DESC, created_at ASC
			LIMIT ?
		`);
		return stmt.all(limit) as FeatureQueueDB[];
	}

	/**
	 * Get the next feature to process
	 */
	getNextFeature(): FeatureQueueDB | undefined {
		const stmt = this._db.prepare(`
			SELECT * FROM feature_queue
			WHERE status = 'pending'
			ORDER BY priority DESC, created_at ASC
			LIMIT 1
		`);
		return stmt.get() as FeatureQueueDB | undefined;
	}

	/**
	 * Get current in-progress feature
	 */
	getInProgressFeature(): FeatureQueueDB | undefined {
		const stmt = this._db.prepare(`
			SELECT * FROM feature_queue
			WHERE status = 'in_progress'
			LIMIT 1
		`);
		return stmt.get() as FeatureQueueDB | undefined;
	}

	/**
	 * Start processing a feature
	 */
	startFeature(id: string, branchName: string): void {
		const stmt = this._db.prepare(`
			UPDATE feature_queue
			SET status = 'in_progress', branch_name = ?, started_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`);
		stmt.run(branchName, id);
	}

	/**
	 * Update feature phases progress
	 */
	updateFeaturePhases(id: string, phasesJson: string): void {
		const stmt = this._db.prepare(`
			UPDATE feature_queue SET phases_json = ? WHERE id = ?
		`);
		stmt.run(phasesJson, id);
	}

	/**
	 * Complete a feature successfully
	 */
	completeFeature(id: string, data: { commitSha?: string; prUrl?: string }): void {
		const stmt = this._db.prepare(`
			UPDATE feature_queue
			SET status = 'completed', commit_sha = ?, pr_url = ?, completed_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`);
		stmt.run(data.commitSha || null, data.prUrl || null, id);
	}

	/**
	 * Mark a feature as failed
	 */
	failFeature(id: string, error: string): void {
		const stmt = this._db.prepare(`
			UPDATE feature_queue
			SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`);
		stmt.run(error, id);
	}

	/**
	 * Update feature priority
	 */
	updateFeaturePriority(id: string, priority: number): void {
		const stmt = this._db.prepare(`
			UPDATE feature_queue SET priority = ? WHERE id = ?
		`);
		stmt.run(priority, id);
	}

	/**
	 * Delete a feature from queue
	 */
	deleteFeature(id: string): number {
		const stmt = this._db.prepare("DELETE FROM feature_queue WHERE id = ?");
		const result = stmt.run(id);
		return result.changes;
	}

	/**
	 * Get recent shipped features
	 */
	getRecentShippedFeatures(limit = 10): FeatureQueueDB[] {
		const stmt = this._db.prepare(`
			SELECT * FROM feature_queue
			WHERE status = 'completed'
			ORDER BY completed_at DESC
			LIMIT ?
		`);
		return stmt.all(limit) as FeatureQueueDB[];
	}

	/**
	 * Get feature queue stats
	 */
	getFeatureQueueStats(): {
		pending: number;
		inProgress: number;
		completed: number;
		failed: number;
		avgCompletionTime: number;
	} {
		const counts = this._db
			.prepare(`
			SELECT
				SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
				SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
				SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
			FROM feature_queue
		`)
			.get() as {
			pending: number;
			in_progress: number;
			completed: number;
			failed: number;
		};

		const avgTime = this._db
			.prepare(`
			SELECT AVG(
				(julianday(completed_at) - julianday(started_at)) * 24 * 60
			) as avg_minutes
			FROM feature_queue
			WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
		`)
			.get() as { avg_minutes: number | null };

		return {
			pending: counts.pending || 0,
			inProgress: counts.in_progress || 0,
			completed: counts.completed || 0,
			failed: counts.failed || 0,
			avgCompletionTime: Math.round(avgTime.avg_minutes || 0),
		};
	}

	/**
	 * Get all features for a user
	 */
	getUserFeatures(userId: string, limit = 20): FeatureQueueDB[] {
		const stmt = this._db.prepare(`
			SELECT * FROM feature_queue
			WHERE user_id = ?
			ORDER BY created_at DESC
			LIMIT ?
		`);
		return stmt.all(userId, limit) as FeatureQueueDB[];
	}

	/**
	 * Prune old completed/failed features
	 */
	pruneOldFeatures(daysToKeep = 30): number {
		const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
		const result = this._db
			.prepare(`
			DELETE FROM feature_queue
			WHERE status IN ('completed', 'failed') AND created_at < ?
		`)
			.run(cutoffDate);
		return result.changes;
	}

	// ========================================================================
	// Suspended Workflows Methods (VoltAgent-style)
	// ========================================================================

	/**
	 * Initialize suspended_workflows table
	 */
	initSuspendedWorkflowsTable(): void {
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS suspended_workflows (
				id TEXT PRIMARY KEY,
				workflow_id TEXT NOT NULL,
				step TEXT NOT NULL,
				state TEXT NOT NULL,
				reason TEXT NOT NULL,
				suspended_at TEXT NOT NULL,
				expires_at TEXT DEFAULT NULL,
				resume_input TEXT DEFAULT NULL,
				metadata TEXT DEFAULT NULL
			)
		`);

		this._db.exec(`
			CREATE INDEX IF NOT EXISTS idx_suspended_workflows_workflow_id ON suspended_workflows(workflow_id);
			CREATE INDEX IF NOT EXISTS idx_suspended_workflows_suspended_at ON suspended_workflows(suspended_at);
			CREATE INDEX IF NOT EXISTS idx_suspended_workflows_expires_at ON suspended_workflows(expires_at);
		`);
	}

	/**
	 * Save a suspended workflow
	 */
	saveSuspendedWorkflow(data: {
		id: string;
		workflowId: string;
		step: string;
		state: string;
		reason: string;
		suspendedAt: string;
		expiresAt: string | null;
		resumeInput: string | null;
		metadata: string | null;
	}): void {
		const stmt = this._db.prepare(`
			INSERT OR REPLACE INTO suspended_workflows
			(id, workflow_id, step, state, reason, suspended_at, expires_at, resume_input, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			data.id,
			data.workflowId,
			data.step,
			data.state,
			data.reason,
			data.suspendedAt,
			data.expiresAt,
			data.resumeInput,
			data.metadata,
		);
	}

	/**
	 * Get a suspended workflow by ID
	 */
	getSuspendedWorkflow(id: string):
		| {
				id: string;
				workflow_id: string;
				step: string;
				state: string;
				reason: string;
				suspended_at: string;
				expires_at: string | null;
				resume_input: string | null;
				metadata: string | null;
		  }
		| undefined {
		const stmt = this._db.prepare("SELECT * FROM suspended_workflows WHERE id = ?");
		return stmt.get(id) as
			| {
					id: string;
					workflow_id: string;
					step: string;
					state: string;
					reason: string;
					suspended_at: string;
					expires_at: string | null;
					resume_input: string | null;
					metadata: string | null;
			  }
			| undefined;
	}

	/**
	 * Query suspended workflows with filters
	 */
	querySuspendedWorkflows(
		conditions: string[],
		params: (string | number)[],
		limit?: number,
	): Array<{
		id: string;
		workflow_id: string;
		step: string;
		state: string;
		reason: string;
		suspended_at: string;
		expires_at: string | null;
		resume_input: string | null;
		metadata: string | null;
	}> {
		let query = "SELECT * FROM suspended_workflows";

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		query += " ORDER BY suspended_at DESC";

		if (limit !== undefined && limit > 0) {
			query += " LIMIT ?";
			params.push(limit);
		}

		const stmt = this._db.prepare(query);
		return stmt.all(...params) as Array<{
			id: string;
			workflow_id: string;
			step: string;
			state: string;
			reason: string;
			suspended_at: string;
			expires_at: string | null;
			resume_input: string | null;
			metadata: string | null;
		}>;
	}

	/**
	 * Delete a suspended workflow
	 */
	deleteSuspendedWorkflow(id: string): number {
		const stmt = this._db.prepare("DELETE FROM suspended_workflows WHERE id = ?");
		const result = stmt.run(id);
		return result.changes;
	}

	/**
	 * Delete suspended workflows by workflow ID
	 */
	deleteSuspendedWorkflowsByWorkflowId(workflowId: string): number {
		const stmt = this._db.prepare("DELETE FROM suspended_workflows WHERE workflow_id = ?");
		const result = stmt.run(workflowId);
		return result.changes;
	}

	/**
	 * Delete expired suspended workflows
	 */
	deleteExpiredSuspendedWorkflows(now: string): number {
		const stmt = this._db.prepare(`
			DELETE FROM suspended_workflows
			WHERE expires_at IS NOT NULL AND expires_at <= ?
		`);
		const result = stmt.run(now);
		return result.changes;
	}

	/**
	 * Count suspended workflows
	 */
	countSuspendedWorkflows(): number {
		const stmt = this._db.prepare("SELECT COUNT(*) as count FROM suspended_workflows");
		const { count } = stmt.get() as { count: number };
		return count;
	}

	/**
	 * Count expired suspended workflows
	 */
	countExpiredSuspendedWorkflows(now: string): number {
		const stmt = this._db.prepare(`
			SELECT COUNT(*) as count FROM suspended_workflows
			WHERE expires_at IS NOT NULL AND expires_at <= ?
		`);
		const { count } = stmt.get(now) as { count: number };
		return count;
	}

	/**
	 * Get suspended workflow counts by workflow ID
	 */
	getSuspendedWorkflowCountsByWorkflowId(): Array<{
		workflow_id: string;
		count: number;
	}> {
		const stmt = this._db.prepare(`
			SELECT workflow_id, COUNT(*) as count
			FROM suspended_workflows
			GROUP BY workflow_id
		`);
		return stmt.all() as Array<{ workflow_id: string; count: number }>;
	}

	public close(): void {
		this._db.close();
	}
}

// Export singleton instance
let dbInstance: BotDatabase | null = null;

export function initDatabase(dbPath: string): BotDatabase {
	if (!dbInstance) {
		dbInstance = new BotDatabase(dbPath);
	}
	return dbInstance;
}

export function getDatabase(): BotDatabase {
	if (!dbInstance) {
		throw new Error("Database not initialized. Call initDatabase() first.");
	}
	return dbInstance;
}
