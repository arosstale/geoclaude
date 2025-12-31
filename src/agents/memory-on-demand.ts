/**
 * Class 3.21: Memory on Demand
 *
 * Query-based memory retrieval instead of pre-loading entire context.
 * Based on AgentJo's "Memory on Demand" pattern.
 *
 * Key insight: Only retrieve relevant memories when needed.
 * - Reduces token usage significantly
 * - Improves response quality (less noise)
 * - Scales to large memory stores
 *
 * @module memory-on-demand
 */

import Database from "better-sqlite3";
import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface Memory {
	id: string;
	content: string;
	type: MemoryType;
	source: string;
	embedding?: number[];
	metadata: Record<string, unknown>;
	relevance: number;
	accessCount: number;
	lastAccessed: number;
	createdAt: number;
	expiresAt?: number;
}

export type MemoryType = "fact" | "episode" | "procedure" | "preference" | "context" | "skill" | "error" | "success";

export interface MemoryQuery {
	text?: string;
	types?: MemoryType[];
	sources?: string[];
	minRelevance?: number;
	limit?: number;
	recency?: "hour" | "day" | "week" | "month" | "all";
	excludeIds?: string[];
}

export interface MemoryConfig {
	maxMemories: number;
	defaultLimit: number;
	decayRate: number;
	minRelevanceThreshold: number;
	enableEmbeddings: boolean;
	embeddingDimension: number;
	pruneInterval: number;
	dbPath: string;
}

export interface RetrievalResult {
	memories: Memory[];
	totalMatched: number;
	queryTime: number;
	strategy: "semantic" | "keyword" | "hybrid";
}

export interface MemoryStats {
	total: number;
	byType: Record<MemoryType, number>;
	bySource: Record<string, number>;
	avgRelevance: number;
	oldestMemory: number;
	newestMemory: number;
}

// =============================================================================
// Memory on Demand System
// =============================================================================

export class MemoryOnDemand extends EventEmitter {
	private db: Database.Database;
	private config: MemoryConfig;
	private cache: Map<string, Memory[]> = new Map();
	private cacheMaxAge = 60000; // 1 minute

	constructor(config: Partial<MemoryConfig> = {}) {
		super();
		this.config = {
			maxMemories: 10000,
			defaultLimit: 5,
			decayRate: 0.01, // Relevance decays 1% per day
			minRelevanceThreshold: 0.1,
			enableEmbeddings: false,
			embeddingDimension: 384,
			pruneInterval: 3600000, // 1 hour
			dbPath: "./data/memory-on-demand.db",
			...config,
		};

		this.db = new Database(this.config.dbPath, { fileMustExist: false });
		this.initDatabase();
		this.startPruneInterval();
	}

	private initDatabase(): void {
		this.db.pragma("journal_mode = WAL");

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				type TEXT NOT NULL,
				source TEXT NOT NULL,
				embedding BLOB,
				metadata_json TEXT,
				relevance REAL DEFAULT 1.0,
				access_count INTEGER DEFAULT 0,
				last_accessed INTEGER,
				created_at INTEGER NOT NULL,
				expires_at INTEGER
			);

			CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
			CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
			CREATE INDEX IF NOT EXISTS idx_memories_relevance ON memories(relevance DESC);
			CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

			CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
				id,
				content,
				tokenize='porter'
			);

			CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
				INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
			END;

			CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
				DELETE FROM memories_fts WHERE id = old.id;
			END;

			CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
				DELETE FROM memories_fts WHERE id = old.id;
				INSERT INTO memories_fts(id, content) VALUES (new.id, new.content);
			END;
		`);
	}

	// ---------------------------------------------------------------------------
	// Core Operations
	// ---------------------------------------------------------------------------

	store(params: {
		content: string;
		type: MemoryType;
		source: string;
		metadata?: Record<string, unknown>;
		relevance?: number;
		expiresAt?: number;
	}): Memory {
		const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const now = Date.now();

		const memory: Memory = {
			id,
			content: params.content,
			type: params.type,
			source: params.source,
			metadata: params.metadata || {},
			relevance: params.relevance ?? 1.0,
			accessCount: 0,
			lastAccessed: now,
			createdAt: now,
			expiresAt: params.expiresAt,
		};

		const stmt = this.db.prepare(`
			INSERT INTO memories
			(id, content, type, source, metadata_json, relevance, access_count, last_accessed, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			memory.id,
			memory.content,
			memory.type,
			memory.source,
			JSON.stringify(memory.metadata),
			memory.relevance,
			memory.accessCount,
			memory.lastAccessed,
			memory.createdAt,
			memory.expiresAt || null,
		);

		this.emit("memory:stored", { memory });
		this.invalidateCache();

		return memory;
	}

	/**
	 * Query memories on demand - the core method
	 */
	async query(query: MemoryQuery): Promise<RetrievalResult> {
		const startTime = Date.now();
		const limit = query.limit || this.config.defaultLimit;

		// Check cache
		const cacheKey = JSON.stringify(query);
		const cached = this.cache.get(cacheKey);
		if (cached) {
			return {
				memories: cached,
				totalMatched: cached.length,
				queryTime: Date.now() - startTime,
				strategy: "keyword",
			};
		}

		let memories: Memory[] = [];
		let strategy: RetrievalResult["strategy"] = "keyword";

		if (query.text) {
			// Full-text search
			memories = this.searchByText(query.text, query, limit * 2);
			strategy = "keyword";

			// If embeddings enabled and we have them, do semantic search
			if (this.config.enableEmbeddings && memories.length < limit) {
				const semantic = await this.searchBySemantic(query.text, query, limit);
				memories = this.mergeResults(memories, semantic);
				strategy = "hybrid";
			}
		} else {
			// Filter-based query
			memories = this.searchByFilters(query, limit * 2);
		}

		// Apply filters
		memories = this.applyFilters(memories, query);

		// Sort by relevance (considering recency decay)
		memories = this.sortByRelevance(memories);

		// Limit results
		memories = memories.slice(0, limit);

		// Update access counts
		this.updateAccessCounts(memories.map((m) => m.id));

		// Cache results
		this.cache.set(cacheKey, memories);
		setTimeout(() => this.cache.delete(cacheKey), this.cacheMaxAge);

		const result: RetrievalResult = {
			memories,
			totalMatched: memories.length,
			queryTime: Date.now() - startTime,
			strategy,
		};

		this.emit("memory:queried", { query, result });

		return result;
	}

	/**
	 * Retrieve memories relevant to current task context
	 */
	async getRelevant(
		task: string,
		context?: {
			currentSource?: string;
			recentMemoryIds?: string[];
			preferredTypes?: MemoryType[];
		},
	): Promise<Memory[]> {
		const result = await this.query({
			text: task,
			types: context?.preferredTypes,
			sources: context?.currentSource ? [context.currentSource] : undefined,
			excludeIds: context?.recentMemoryIds,
			limit: this.config.defaultLimit,
		});

		return result.memories;
	}

	/**
	 * Augment a task with relevant memories
	 */
	async augmentTask(task: string, options?: { maxTokens?: number }): Promise<string> {
		const memories = await this.getRelevant(task);

		if (memories.length === 0) {
			return task;
		}

		const maxTokens = options?.maxTokens || 500;
		let memoryContext = "";
		let tokenEstimate = 0;

		for (const memory of memories) {
			const memoryText = `[${memory.type}] ${memory.content}`;
			const estimatedTokens = Math.ceil(memoryText.length / 4);

			if (tokenEstimate + estimatedTokens > maxTokens) break;

			memoryContext += `\n- ${memoryText}`;
			tokenEstimate += estimatedTokens;
		}

		if (!memoryContext) {
			return task;
		}

		return `Relevant context from memory:${memoryContext}\n\nTask: ${task}`;
	}

	// ---------------------------------------------------------------------------
	// Search Methods
	// ---------------------------------------------------------------------------

	private searchByText(text: string, _query: MemoryQuery, limit: number): Memory[] {
		// Prepare search terms
		const terms = text
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 2)
			.map((t) => `"${t}"`)
			.join(" OR ");

		if (!terms) return [];

		const stmt = this.db.prepare(`
			SELECT m.*, mf.rank
			FROM memories_fts mf
			JOIN memories m ON m.id = mf.id
			WHERE memories_fts MATCH ?
			ORDER BY mf.rank
			LIMIT ?
		`);

		const rows = stmt.all(terms, limit) as any[];
		return rows.map((row) => this.rowToMemory(row));
	}

	private async searchBySemantic(_text: string, _query: MemoryQuery, _limit: number): Promise<Memory[]> {
		// Placeholder for semantic search
		// Would use embeddings if enabled
		return [];
	}

	private searchByFilters(query: MemoryQuery, limit: number): Memory[] {
		let sql = "SELECT * FROM memories WHERE 1=1";
		const params: unknown[] = [];

		if (query.types?.length) {
			sql += ` AND type IN (${query.types.map(() => "?").join(",")})`;
			params.push(...query.types);
		}

		if (query.sources?.length) {
			sql += ` AND source IN (${query.sources.map(() => "?").join(",")})`;
			params.push(...query.sources);
		}

		if (query.minRelevance) {
			sql += " AND relevance >= ?";
			params.push(query.minRelevance);
		}

		if (query.recency && query.recency !== "all") {
			const recencyMap: Record<string, number> = {
				hour: 3600000,
				day: 86400000,
				week: 604800000,
				month: 2592000000,
			};
			sql += " AND created_at >= ?";
			params.push(Date.now() - recencyMap[query.recency]);
		}

		if (query.excludeIds?.length) {
			sql += ` AND id NOT IN (${query.excludeIds.map(() => "?").join(",")})`;
			params.push(...query.excludeIds);
		}

		sql += " ORDER BY relevance DESC, created_at DESC LIMIT ?";
		params.push(limit);

		const stmt = this.db.prepare(sql);
		const rows = stmt.all(...params) as any[];
		return rows.map((row) => this.rowToMemory(row));
	}

	private applyFilters(memories: Memory[], query: MemoryQuery): Memory[] {
		let filtered = memories;

		// Remove expired
		const now = Date.now();
		filtered = filtered.filter((m) => !m.expiresAt || m.expiresAt > now);

		// Apply minimum relevance
		const minRelevance = query.minRelevance || this.config.minRelevanceThreshold;
		filtered = filtered.filter((m) => m.relevance >= minRelevance);

		// Exclude IDs
		if (query.excludeIds?.length) {
			const excludeSet = new Set(query.excludeIds);
			filtered = filtered.filter((m) => !excludeSet.has(m.id));
		}

		return filtered;
	}

	private sortByRelevance(memories: Memory[]): Memory[] {
		const now = Date.now();
		const dayMs = 86400000;

		return memories.sort((a, b) => {
			// Calculate time-decayed relevance
			const ageA = (now - a.createdAt) / dayMs;
			const ageB = (now - b.createdAt) / dayMs;

			const decayedA = a.relevance * Math.exp(-this.config.decayRate * ageA);
			const decayedB = b.relevance * Math.exp(-this.config.decayRate * ageB);

			// Also factor in access count
			const scoreA = decayedA * (1 + 0.1 * Math.log(a.accessCount + 1));
			const scoreB = decayedB * (1 + 0.1 * Math.log(b.accessCount + 1));

			return scoreB - scoreA;
		});
	}

	private mergeResults(primary: Memory[], secondary: Memory[]): Memory[] {
		const seen = new Set(primary.map((m) => m.id));
		const merged = [...primary];

		for (const memory of secondary) {
			if (!seen.has(memory.id)) {
				merged.push(memory);
				seen.add(memory.id);
			}
		}

		return merged;
	}

	// ---------------------------------------------------------------------------
	// Memory Management
	// ---------------------------------------------------------------------------

	updateRelevance(id: string, delta: number): void {
		const stmt = this.db.prepare(`
			UPDATE memories SET relevance = MAX(0, MIN(1, relevance + ?))
			WHERE id = ?
		`);
		stmt.run(delta, id);
		this.invalidateCache();
	}

	forget(id: string): void {
		const stmt = this.db.prepare("DELETE FROM memories WHERE id = ?");
		stmt.run(id);
		this.emit("memory:forgotten", { id });
		this.invalidateCache();
	}

	forgetBySource(source: string): number {
		const stmt = this.db.prepare("DELETE FROM memories WHERE source = ?");
		const result = stmt.run(source);
		this.invalidateCache();
		return result.changes;
	}

	prune(): number {
		const now = Date.now();

		// Delete expired
		const expiredStmt = this.db.prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?");
		const expiredResult = expiredStmt.run(now);

		// Delete low relevance
		const lowRelevanceStmt = this.db.prepare("DELETE FROM memories WHERE relevance < ?");
		const lowRelevanceResult = lowRelevanceStmt.run(this.config.minRelevanceThreshold);

		// Delete oldest if over limit
		const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM memories");
		const count = (countStmt.get() as { count: number }).count;

		let overflowDeleted = 0;
		if (count > this.config.maxMemories) {
			const toDelete = count - this.config.maxMemories;
			const overflowStmt = this.db.prepare(`
				DELETE FROM memories WHERE id IN (
					SELECT id FROM memories ORDER BY relevance ASC, created_at ASC LIMIT ?
				)
			`);
			const overflowResult = overflowStmt.run(toDelete);
			overflowDeleted = overflowResult.changes;
		}

		const totalDeleted = expiredResult.changes + lowRelevanceResult.changes + overflowDeleted;

		if (totalDeleted > 0) {
			this.emit("memory:pruned", { deleted: totalDeleted });
			this.invalidateCache();
		}

		return totalDeleted;
	}

	// ---------------------------------------------------------------------------
	// Stats & Utilities
	// ---------------------------------------------------------------------------

	getStats(): MemoryStats {
		const totalStmt = this.db.prepare("SELECT COUNT(*) as count FROM memories");
		const total = (totalStmt.get() as { count: number }).count;

		const byTypeStmt = this.db.prepare("SELECT type, COUNT(*) as count FROM memories GROUP BY type");
		const byTypeRows = byTypeStmt.all() as { type: MemoryType; count: number }[];
		const byType: Record<MemoryType, number> = {} as any;
		for (const row of byTypeRows) {
			byType[row.type] = row.count;
		}

		const bySourceStmt = this.db.prepare("SELECT source, COUNT(*) as count FROM memories GROUP BY source");
		const bySourceRows = bySourceStmt.all() as { source: string; count: number }[];
		const bySource: Record<string, number> = {};
		for (const row of bySourceRows) {
			bySource[row.source] = row.count;
		}

		const avgStmt = this.db.prepare("SELECT AVG(relevance) as avg FROM memories");
		const avgRelevance = (avgStmt.get() as { avg: number }).avg || 0;

		const rangeStmt = this.db.prepare("SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories");
		const range = rangeStmt.get() as { oldest: number; newest: number };

		return {
			total,
			byType,
			bySource,
			avgRelevance,
			oldestMemory: range.oldest || 0,
			newestMemory: range.newest || 0,
		};
	}

	private updateAccessCounts(ids: string[]): void {
		if (ids.length === 0) return;

		const now = Date.now();
		const stmt = this.db.prepare(`
			UPDATE memories SET access_count = access_count + 1, last_accessed = ?
			WHERE id = ?
		`);

		const transaction = this.db.transaction((memoryIds: string[]) => {
			for (const id of memoryIds) {
				stmt.run(now, id);
			}
		});

		transaction(ids);
	}

	private rowToMemory(row: any): Memory {
		return {
			id: row.id,
			content: row.content,
			type: row.type as MemoryType,
			source: row.source,
			metadata: JSON.parse(row.metadata_json || "{}"),
			relevance: row.relevance,
			accessCount: row.access_count,
			lastAccessed: row.last_accessed,
			createdAt: row.created_at,
			expiresAt: row.expires_at,
		};
	}

	private invalidateCache(): void {
		this.cache.clear();
	}

	private pruneIntervalId: ReturnType<typeof setInterval> | null = null;

	private startPruneInterval(): void {
		this.pruneIntervalId = setInterval(() => {
			this.prune();
		}, this.config.pruneInterval);
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	close(): void {
		if (this.pruneIntervalId) {
			clearInterval(this.pruneIntervalId);
		}
		this.db.close();
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: MemoryOnDemand | null = null;

export function getMemoryOnDemand(config?: Partial<MemoryConfig>): MemoryOnDemand {
	if (!instance) {
		instance = new MemoryOnDemand(config);
	}
	return instance;
}

export function resetMemoryOnDemand(): void {
	if (instance) {
		instance.close();
		instance = null;
	}
}
