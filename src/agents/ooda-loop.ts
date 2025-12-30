/**
 * Class 3.18: OODA Loop Engine
 *
 * Implements Boyd's OODA (Observe-Orient-Decide-Act) loop for agent execution.
 * Based on research from Anthropic's research_subagent and military decision theory.
 *
 * Key insight: The side that cycles faster wins.
 * - 2x faster = dominate
 * - 4x faster = opponent can't respond
 *
 * @module ooda-loop
 */

import { EventEmitter } from "events";
import Database from "better-sqlite3";

// =============================================================================
// Types
// =============================================================================

export type OODAPhase = "observe" | "orient" | "decide" | "act" | "complete" | "failed";

export interface Observation {
	id: string;
	source: string;
	content: string;
	confidence: number;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

export interface Orientation {
	id: string;
	observations: string[];
	analysis: string;
	threats: string[];
	opportunities: string[];
	constraints: string[];
	timestamp: number;
}

export interface Decision {
	id: string;
	orientationId: string;
	action: string;
	reasoning: string;
	confidence: number;
	alternatives: string[];
	timestamp: number;
}

export interface Action {
	id: string;
	decisionId: string;
	type: "tool_call" | "response" | "delegate" | "wait" | "abort";
	payload: Record<string, unknown>;
	result?: unknown;
	success: boolean;
	duration: number;
	timestamp: number;
}

export interface OODAState {
	id: string;
	taskId: string;
	phase: OODAPhase;
	iteration: number;
	observations: Observation[];
	orientation: Orientation | null;
	decision: Decision | null;
	action: Action | null;
	history: OODACycle[];
	startTime: number;
	endTime: number | null;
	metadata: Record<string, unknown>;
}

export interface OODACycle {
	iteration: number;
	observations: Observation[];
	orientation: Orientation;
	decision: Decision;
	action: Action;
	duration: number;
	timestamp: number;
}

export interface OODAConfig {
	maxIterations: number;
	maxDuration: number;
	observeTimeout: number;
	orientTimeout: number;
	decideTimeout: number;
	actTimeout: number;
	enablePersistence: boolean;
	dbPath?: string;
}

export interface ToolBudget {
	total: number;
	used: number;
	remaining: number;
	complexity: "simple" | "medium" | "hard" | "complex";
}

export interface OODAEvents {
	"loop:start": { state: OODAState };
	"loop:complete": { state: OODAState; result: unknown };
	"loop:failed": { state: OODAState; error: Error };
	"phase:observe": { state: OODAState; observations: Observation[] };
	"phase:orient": { state: OODAState; orientation: Orientation };
	"phase:decide": { state: OODAState; decision: Decision };
	"phase:act": { state: OODAState; action: Action };
	"iteration:complete": { state: OODAState; cycle: OODACycle };
	"budget:warning": { budget: ToolBudget; threshold: number };
	"budget:exhausted": { budget: ToolBudget };
}

// =============================================================================
// OODA Loop Engine
// =============================================================================

export class OODALoopEngine extends EventEmitter {
	private db: Database.Database | null = null;
	private config: OODAConfig;
	private activeLoops: Map<string, OODAState> = new Map();

	constructor(config: Partial<OODAConfig> = {}) {
		super();
		this.config = {
			maxIterations: 20,
			maxDuration: 300000, // 5 minutes
			observeTimeout: 30000,
			orientTimeout: 15000,
			decideTimeout: 10000,
			actTimeout: 60000,
			enablePersistence: true,
			dbPath: "./data/ooda.db",
			...config,
		};

		if (this.config.enablePersistence) {
			this.initDatabase();
		}
	}

	private initDatabase(): void {
		this.db = new Database(this.config.dbPath!, { fileMustExist: false });
		this.db.pragma("journal_mode = WAL");

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS ooda_loops (
				id TEXT PRIMARY KEY,
				task_id TEXT NOT NULL,
				phase TEXT NOT NULL,
				iteration INTEGER DEFAULT 0,
				state_json TEXT NOT NULL,
				start_time INTEGER NOT NULL,
				end_time INTEGER,
				created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
			);

			CREATE TABLE IF NOT EXISTS ooda_cycles (
				id TEXT PRIMARY KEY,
				loop_id TEXT NOT NULL,
				iteration INTEGER NOT NULL,
				observations_json TEXT,
				orientation_json TEXT,
				decision_json TEXT,
				action_json TEXT,
				duration INTEGER,
				timestamp INTEGER NOT NULL,
				FOREIGN KEY (loop_id) REFERENCES ooda_loops(id)
			);

			CREATE INDEX IF NOT EXISTS idx_loops_task ON ooda_loops(task_id);
			CREATE INDEX IF NOT EXISTS idx_cycles_loop ON ooda_cycles(loop_id);
		`);
	}

	// ---------------------------------------------------------------------------
	// Tool Budget Management (from Anthropic research_subagent)
	// ---------------------------------------------------------------------------

	createBudget(complexity: ToolBudget["complexity"]): ToolBudget {
		const limits: Record<ToolBudget["complexity"], number> = {
			simple: 5,
			medium: 8,
			hard: 12,
			complex: 20,
		};

		return {
			total: limits[complexity],
			used: 0,
			remaining: limits[complexity],
			complexity,
		};
	}

	consumeBudget(budget: ToolBudget, count: number = 1): boolean {
		if (budget.remaining < count) {
			this.emit("budget:exhausted", { budget });
			return false;
		}

		budget.used += count;
		budget.remaining -= count;

		// Warn at 80% usage
		if (budget.remaining <= budget.total * 0.2) {
			this.emit("budget:warning", { budget, threshold: 0.2 });
		}

		return true;
	}

	// ---------------------------------------------------------------------------
	// OODA Loop Execution
	// ---------------------------------------------------------------------------

	async startLoop(
		taskId: string,
		task: string,
		handlers: {
			observe: (state: OODAState, budget: ToolBudget) => Promise<Observation[]>;
			orient: (observations: Observation[], state: OODAState) => Promise<Orientation>;
			decide: (orientation: Orientation, state: OODAState) => Promise<Decision>;
			act: (decision: Decision, state: OODAState, budget: ToolBudget) => Promise<Action>;
			isComplete: (state: OODAState) => boolean;
		},
		options: {
			complexity?: ToolBudget["complexity"];
			metadata?: Record<string, unknown>;
		} = {}
	): Promise<OODAState> {
		const loopId = `ooda_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const budget = this.createBudget(options.complexity || "medium");

		const state: OODAState = {
			id: loopId,
			taskId,
			phase: "observe",
			iteration: 0,
			observations: [],
			orientation: null,
			decision: null,
			action: null,
			history: [],
			startTime: Date.now(),
			endTime: null,
			metadata: {
				task,
				budget,
				...options.metadata,
			},
		};

		this.activeLoops.set(loopId, state);
		this.emit("loop:start", { state });
		this.persistState(state);

		try {
			while (
				state.iteration < this.config.maxIterations &&
				Date.now() - state.startTime < this.config.maxDuration &&
				budget.remaining > 0 &&
				!handlers.isComplete(state)
			) {
				const cycleStart = Date.now();
				state.iteration++;

				// OBSERVE
				state.phase = "observe";
				const observations = await this.withTimeout(
					handlers.observe(state, budget),
					this.config.observeTimeout,
					"Observe timeout"
				);
				state.observations = observations;
				this.emit("phase:observe", { state, observations });

				// ORIENT
				state.phase = "orient";
				const orientation = await this.withTimeout(
					handlers.orient(observations, state),
					this.config.orientTimeout,
					"Orient timeout"
				);
				state.orientation = orientation;
				this.emit("phase:orient", { state, orientation });

				// DECIDE
				state.phase = "decide";
				const decision = await this.withTimeout(
					handlers.decide(orientation, state),
					this.config.decideTimeout,
					"Decide timeout"
				);
				state.decision = decision;
				this.emit("phase:decide", { state, decision });

				// Check if decision is to complete
				if (decision.action === "COMPLETE" || decision.action === "ABORT") {
					state.phase = decision.action === "COMPLETE" ? "complete" : "failed";
					break;
				}

				// ACT
				state.phase = "act";
				const action = await this.withTimeout(
					handlers.act(decision, state, budget),
					this.config.actTimeout,
					"Act timeout"
				);
				state.action = action;
				this.emit("phase:act", { state, action });

				// Record cycle
				const cycle: OODACycle = {
					iteration: state.iteration,
					observations,
					orientation,
					decision,
					action,
					duration: Date.now() - cycleStart,
					timestamp: Date.now(),
				};
				state.history.push(cycle);
				this.emit("iteration:complete", { state, cycle });
				this.persistCycle(state.id, cycle);

				// Check action result
				if (!action.success && action.type === "abort") {
					state.phase = "failed";
					break;
				}
			}

			// Finalize
			state.endTime = Date.now();
			if (state.phase !== "complete" && state.phase !== "failed") {
				state.phase = handlers.isComplete(state) ? "complete" : "failed";
			}

			this.persistState(state);

			if (state.phase === "complete") {
				this.emit("loop:complete", { state, result: state.action?.result });
			} else {
				this.emit("loop:failed", {
					state,
					error: new Error(`Loop ended in phase: ${state.phase}`),
				});
			}

			return state;
		} catch (error) {
			state.phase = "failed";
			state.endTime = Date.now();
			this.persistState(state);
			this.emit("loop:failed", { state, error: error as Error });
			throw error;
		} finally {
			this.activeLoops.delete(loopId);
		}
	}

	// ---------------------------------------------------------------------------
	// Simplified Execute (for common use cases)
	// ---------------------------------------------------------------------------

	async execute(
		task: string,
		toolExecutor: (toolName: string, params: Record<string, unknown>) => Promise<unknown>,
		llm: {
			observe: (task: string, history: OODACycle[]) => Promise<Observation[]>;
			orient: (observations: Observation[], task: string) => Promise<Orientation>;
			decide: (orientation: Orientation, tools: string[]) => Promise<Decision>;
			synthesize: (history: OODACycle[], task: string) => Promise<string>;
		},
		options: {
			tools: string[];
			complexity?: ToolBudget["complexity"];
			maxIterations?: number;
		}
	): Promise<{ success: boolean; result: string; state: OODAState }> {
		const state = await this.startLoop(
			`task_${Date.now()}`,
			task,
			{
				observe: async (s, budget) => {
					if (!this.consumeBudget(budget)) {
						return [
							{
								id: `obs_budget`,
								source: "system",
								content: "Budget exhausted. Synthesize from gathered information.",
								confidence: 1,
								timestamp: Date.now(),
							},
						];
					}
					return llm.observe(task, s.history);
				},
				orient: async (observations) => {
					return llm.orient(observations, task);
				},
				decide: async (orientation) => {
					return llm.decide(orientation, options.tools);
				},
				act: async (decision, s, budget) => {
					const actionStart = Date.now();

					if (decision.action === "COMPLETE") {
						const result = await llm.synthesize(s.history, task);
						return {
							id: `act_${Date.now()}`,
							decisionId: decision.id,
							type: "response",
							payload: { result },
							result,
							success: true,
							duration: Date.now() - actionStart,
							timestamp: Date.now(),
						};
					}

					// Parse tool call from decision
					const toolMatch = decision.action.match(/^(\w+)\((.*)\)$/);
					if (!toolMatch) {
						return {
							id: `act_${Date.now()}`,
							decisionId: decision.id,
							type: "abort",
							payload: { error: "Invalid action format" },
							success: false,
							duration: Date.now() - actionStart,
							timestamp: Date.now(),
						};
					}

					const [, toolName, paramsStr] = toolMatch;
					if (!this.consumeBudget(budget)) {
						return {
							id: `act_${Date.now()}`,
							decisionId: decision.id,
							type: "wait",
							payload: { reason: "Budget exhausted" },
							success: true,
							duration: Date.now() - actionStart,
							timestamp: Date.now(),
						};
					}

					try {
						const params = JSON.parse(paramsStr || "{}");
						const result = await toolExecutor(toolName, params);
						return {
							id: `act_${Date.now()}`,
							decisionId: decision.id,
							type: "tool_call",
							payload: { tool: toolName, params },
							result,
							success: true,
							duration: Date.now() - actionStart,
							timestamp: Date.now(),
						};
					} catch (error) {
						return {
							id: `act_${Date.now()}`,
							decisionId: decision.id,
							type: "tool_call",
							payload: { tool: toolName, error: String(error) },
							success: false,
							duration: Date.now() - actionStart,
							timestamp: Date.now(),
						};
					}
				},
				isComplete: (s) => {
					return s.decision?.action === "COMPLETE" || s.iteration >= (options.maxIterations || 20);
				},
			},
			{ complexity: options.complexity }
		);

		const finalResult =
			state.phase === "complete" ? String(state.action?.result || "") : "Loop failed to complete";

		return {
			success: state.phase === "complete",
			result: finalResult,
			state,
		};
	}

	// ---------------------------------------------------------------------------
	// Utility Methods
	// ---------------------------------------------------------------------------

	private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
		]);
	}

	private persistState(state: OODAState): void {
		if (!this.db) return;

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO ooda_loops
			(id, task_id, phase, iteration, state_json, start_time, end_time)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			state.id,
			state.taskId,
			state.phase,
			state.iteration,
			JSON.stringify(state),
			state.startTime,
			state.endTime
		);
	}

	private persistCycle(loopId: string, cycle: OODACycle): void {
		if (!this.db) return;

		const stmt = this.db.prepare(`
			INSERT INTO ooda_cycles
			(id, loop_id, iteration, observations_json, orientation_json, decision_json, action_json, duration, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			`cycle_${loopId}_${cycle.iteration}`,
			loopId,
			cycle.iteration,
			JSON.stringify(cycle.observations),
			JSON.stringify(cycle.orientation),
			JSON.stringify(cycle.decision),
			JSON.stringify(cycle.action),
			cycle.duration,
			cycle.timestamp
		);
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getActiveLoops(): OODAState[] {
		return Array.from(this.activeLoops.values());
	}

	getLoopHistory(loopId: string): OODACycle[] {
		if (!this.db) return [];

		const stmt = this.db.prepare(`
			SELECT * FROM ooda_cycles WHERE loop_id = ? ORDER BY iteration ASC
		`);

		const rows = stmt.all(loopId) as any[];
		return rows.map((row) => ({
			iteration: row.iteration,
			observations: JSON.parse(row.observations_json || "[]"),
			orientation: JSON.parse(row.orientation_json || "{}"),
			decision: JSON.parse(row.decision_json || "{}"),
			action: JSON.parse(row.action_json || "{}"),
			duration: row.duration,
			timestamp: row.timestamp,
		}));
	}

	getLoopStats(since?: number): {
		total: number;
		completed: number;
		failed: number;
		avgIterations: number;
		avgDuration: number;
	} {
		if (!this.db) {
			return { total: 0, completed: 0, failed: 0, avgIterations: 0, avgDuration: 0 };
		}

		const whereClause = since ? `WHERE start_time >= ${since}` : "";
		const stmt = this.db.prepare(`
			SELECT
				COUNT(*) as total,
				SUM(CASE WHEN phase = 'complete' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN phase = 'failed' THEN 1 ELSE 0 END) as failed,
				AVG(iteration) as avg_iterations,
				AVG(end_time - start_time) as avg_duration
			FROM ooda_loops ${whereClause}
		`);

		const row = stmt.get() as any;
		return {
			total: row.total || 0,
			completed: row.completed || 0,
			failed: row.failed || 0,
			avgIterations: Math.round(row.avg_iterations || 0),
			avgDuration: Math.round(row.avg_duration || 0),
		};
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: OODALoopEngine | null = null;

export function getOODALoop(config?: Partial<OODAConfig>): OODALoopEngine {
	if (!instance) {
		instance = new OODALoopEngine(config);
	}
	return instance;
}

export function resetOODALoop(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
