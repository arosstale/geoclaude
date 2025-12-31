/**
 * Trading-Rxiv: Cumulative Trading Knowledge Repository
 *
 * Inspired by AgentLaboratory's AgentRxiv system.
 * Stores and indexes trading research, strategies, insights,
 * and discoveries for cumulative learning and retrieval.
 *
 * Pattern from: https://github.com/SamuelSchmidgall/AgentLaboratory
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { cosineSimilarity, generateEmbedding } from "./embeddings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, "..", "..");
const RXIV_DIR = join(PACKAGE_ROOT, "data", "trading-rxiv");

// ============================================================================
// TYPES
// ============================================================================

/** Research entry type */
export type EntryType =
	| "strategy" // Trading strategy
	| "signal" // Trading signal or pattern
	| "insight" // Market insight or observation
	| "hypothesis" // Untested hypothesis
	| "experiment" // Experiment results
	| "failure" // Failed strategy or approach (important for learning)
	| "pattern" // Recurring market pattern
	| "indicator" // Custom indicator or metric
	| "model"; // ML model or prediction system

/** Research entry status */
export type EntryStatus =
	| "draft" // Work in progress
	| "submitted" // Submitted for review
	| "reviewed" // Peer reviewed
	| "validated" // Backtested or validated
	| "deployed" // Currently in use
	| "deprecated" // No longer relevant
	| "failed"; // Failed validation

/** Research entry metadata */
export interface EntryMetadata {
	/** Unique identifier */
	id: string;
	/** Entry title */
	title: string;
	/** Entry type */
	type: EntryType;
	/** Current status */
	status: EntryStatus;
	/** Author agent or user */
	author: string;
	/** Creation timestamp */
	createdAt: number;
	/** Last update timestamp */
	updatedAt: number;
	/** Domain tags */
	tags: string[];
	/** Related asset symbols */
	symbols: string[];
	/** Timeframes (1m, 5m, 1h, 4h, 1d, etc.) */
	timeframes: string[];
	/** Performance metrics if validated */
	performance?: {
		winRate?: number;
		sharpeRatio?: number;
		maxDrawdown?: number;
		profitFactor?: number;
		totalTrades?: number;
		returnPercent?: number;
	};
	/** Review scores if reviewed */
	reviewScores?: {
		overall: number;
		technical: number;
		practical: number;
		novelty: number;
	};
	/** References to other entries */
	references: string[];
	/** Entries that cite this one */
	citations: string[];
	/** Version number */
	version: number;
	/** Previous version ID if updated */
	previousVersion?: string;
}

/** Full research entry */
export interface TradingRxivEntry {
	metadata: EntryMetadata;
	/** Abstract/summary */
	abstract: string;
	/** Full content (markdown) */
	content: string;
	/** Structured data (JSON) */
	data?: Record<string, unknown>;
	/** Embedding vector for semantic search */
	embedding?: number[];
}

/** Search result */
export interface SearchResult {
	entry: TradingRxivEntry;
	relevanceScore: number;
	matchedTerms: string[];
}

/** Search options */
export interface SearchOptions {
	/** Filter by type */
	type?: EntryType | EntryType[];
	/** Filter by status */
	status?: EntryStatus | EntryStatus[];
	/** Filter by tags */
	tags?: string[];
	/** Filter by symbols */
	symbols?: string[];
	/** Filter by timeframes */
	timeframes?: string[];
	/** Filter by author */
	author?: string;
	/** Filter by date range */
	dateRange?: {
		start?: number;
		end?: number;
	};
	/** Minimum review score */
	minReviewScore?: number;
	/** Maximum results */
	limit?: number;
	/** Use semantic search */
	semantic?: boolean;
}

/** Repository statistics */
export interface RxivStats {
	totalEntries: number;
	byType: Record<EntryType, number>;
	byStatus: Record<EntryStatus, number>;
	topTags: Array<{ tag: string; count: number }>;
	topSymbols: Array<{ symbol: string; count: number }>;
	topAuthors: Array<{ author: string; count: number }>;
	averageReviewScore: number;
	recentActivity: number; // Entries in last 7 days
}

// ============================================================================
// TRADING-RXIV REPOSITORY
// ============================================================================

export class TradingRxiv extends EventEmitter {
	private entries: Map<string, TradingRxivEntry> = new Map();
	private indexByType: Map<EntryType, Set<string>> = new Map();
	private indexByTag: Map<string, Set<string>> = new Map();
	private indexBySymbol: Map<string, Set<string>> = new Map();
	private indexByAuthor: Map<string, Set<string>> = new Map();

	constructor() {
		super();
		this.ensureDirectories();
		this.loadEntries();
	}

	// ==========================================================================
	// SETUP
	// ==========================================================================

	private ensureDirectories(): void {
		const dirs = [RXIV_DIR, join(RXIV_DIR, "entries"), join(RXIV_DIR, "embeddings"), join(RXIV_DIR, "archive")];

		for (const dir of dirs) {
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
		}
	}

	private loadEntries(): void {
		const entriesDir = join(RXIV_DIR, "entries");

		if (!existsSync(entriesDir)) return;

		const files = readdirSync(entriesDir).filter((f) => f.endsWith(".json"));

		for (const file of files) {
			try {
				const content = readFileSync(join(entriesDir, file), "utf-8");
				const entry: TradingRxivEntry = JSON.parse(content);
				this.indexEntry(entry);
			} catch (error) {
				this.emit("loadError", { file, error });
			}
		}

		this.emit("loaded", { count: this.entries.size });
	}

	private indexEntry(entry: TradingRxivEntry): void {
		const { metadata } = entry;

		// Store in main map
		this.entries.set(metadata.id, entry);

		// Index by type
		if (!this.indexByType.has(metadata.type)) {
			this.indexByType.set(metadata.type, new Set());
		}
		this.indexByType.get(metadata.type)!.add(metadata.id);

		// Index by tags
		for (const tag of metadata.tags) {
			if (!this.indexByTag.has(tag)) {
				this.indexByTag.set(tag, new Set());
			}
			this.indexByTag.get(tag)!.add(metadata.id);
		}

		// Index by symbols
		for (const symbol of metadata.symbols) {
			if (!this.indexBySymbol.has(symbol)) {
				this.indexBySymbol.set(symbol, new Set());
			}
			this.indexBySymbol.get(symbol)!.add(metadata.id);
		}

		// Index by author
		if (!this.indexByAuthor.has(metadata.author)) {
			this.indexByAuthor.set(metadata.author, new Set());
		}
		this.indexByAuthor.get(metadata.author)!.add(metadata.id);
	}

	private removeFromIndex(entry: TradingRxivEntry): void {
		const { metadata } = entry;

		// Remove from type index
		this.indexByType.get(metadata.type)?.delete(metadata.id);

		// Remove from tag indexes
		for (const tag of metadata.tags) {
			this.indexByTag.get(tag)?.delete(metadata.id);
		}

		// Remove from symbol indexes
		for (const symbol of metadata.symbols) {
			this.indexBySymbol.get(symbol)?.delete(metadata.id);
		}

		// Remove from author index
		this.indexByAuthor.get(metadata.author)?.delete(metadata.id);
	}

	// ==========================================================================
	// CRUD OPERATIONS
	// ==========================================================================

	/**
	 * Submit a new research entry
	 */
	async submit(entry: Omit<TradingRxivEntry, "embedding">): Promise<TradingRxivEntry> {
		// Sanitize ID to prevent path traversal and injection attacks
		// If no ID provided, generate a UUID-based one
		const rawId = entry.metadata.id || "";
		const id = rawId ? `rxiv_${rawId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : `rxiv_${randomUUID()}`;

		// Generate embedding for semantic search
		const textForEmbedding = `${entry.metadata.title} ${entry.abstract} ${entry.metadata.tags.join(" ")}`;
		const embedding = await generateEmbedding(textForEmbedding);

		const fullEntry: TradingRxivEntry = {
			...entry,
			metadata: {
				...entry.metadata,
				id,
				createdAt: entry.metadata.createdAt || Date.now(),
				updatedAt: Date.now(),
				version: entry.metadata.version || 1,
				references: entry.metadata.references || [],
				citations: entry.metadata.citations || [],
			},
			embedding: Array.from(embedding),
		};

		// Save to disk (ID already sanitized above)
		const entryPath = join(RXIV_DIR, "entries", `${id}.json`);
		writeFileSync(entryPath, JSON.stringify(fullEntry, null, 2));

		// Index the entry
		this.indexEntry(fullEntry);

		// Update citations in referenced entries
		for (const refId of fullEntry.metadata.references) {
			const refEntry = this.entries.get(refId);
			if (refEntry && !refEntry.metadata.citations.includes(id)) {
				refEntry.metadata.citations.push(id);
				this.saveEntry(refEntry);
			}
		}

		this.emit("submitted", { id, title: fullEntry.metadata.title, type: fullEntry.metadata.type });

		return fullEntry;
	}

	/**
	 * Update an existing entry (creates new version)
	 */
	async update(id: string, updates: Partial<TradingRxivEntry>): Promise<TradingRxivEntry | null> {
		const existing = this.entries.get(id);
		if (!existing) {
			return null;
		}

		// Archive the old version
		const archivePath = join(RXIV_DIR, "archive", `${id}_v${existing.metadata.version}.json`);
		writeFileSync(archivePath, JSON.stringify(existing, null, 2));

		// Remove from indexes
		this.removeFromIndex(existing);

		// Create updated entry
		const updated: TradingRxivEntry = {
			...existing,
			...updates,
			metadata: {
				...existing.metadata,
				...updates.metadata,
				id,
				updatedAt: Date.now(),
				version: existing.metadata.version + 1,
				previousVersion: `${id}_v${existing.metadata.version}`,
			},
		};

		// Regenerate embedding if content changed
		if (updates.abstract || updates.content || updates.metadata?.title || updates.metadata?.tags) {
			const textForEmbedding = `${updated.metadata.title} ${updated.abstract} ${updated.metadata.tags.join(" ")}`;
			updated.embedding = Array.from(await generateEmbedding(textForEmbedding));
		}

		// Save and index
		this.saveEntry(updated);
		this.indexEntry(updated);

		this.emit("updated", { id, version: updated.metadata.version });

		return updated;
	}

	/**
	 * Get entry by ID
	 */
	get(id: string): TradingRxivEntry | undefined {
		return this.entries.get(id);
	}

	/**
	 * Delete entry (moves to archive)
	 */
	delete(id: string): boolean {
		const entry = this.entries.get(id);
		if (!entry) {
			return false;
		}

		// Archive
		const archivePath = join(RXIV_DIR, "archive", `${id}_deleted.json`);
		writeFileSync(archivePath, JSON.stringify(entry, null, 2));

		// Remove from disk
		const entryPath = join(RXIV_DIR, "entries", `${id}.json`);
		if (existsSync(entryPath)) {
			unlinkSync(entryPath);
		}

		// Remove from indexes
		this.removeFromIndex(entry);
		this.entries.delete(id);

		// Remove from citations in other entries
		for (const refId of entry.metadata.references) {
			const refEntry = this.entries.get(refId);
			if (refEntry) {
				refEntry.metadata.citations = refEntry.metadata.citations.filter((c) => c !== id);
				this.saveEntry(refEntry);
			}
		}

		this.emit("deleted", { id });

		return true;
	}

	private saveEntry(entry: TradingRxivEntry): void {
		const entryPath = join(RXIV_DIR, "entries", `${entry.metadata.id}.json`);
		writeFileSync(entryPath, JSON.stringify(entry, null, 2));
	}

	// ==========================================================================
	// SEARCH
	// ==========================================================================

	/**
	 * Search entries with filters
	 */
	async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
		let candidateIds = new Set<string>(this.entries.keys());

		// Apply filters
		if (options.type) {
			const types = Array.isArray(options.type) ? options.type : [options.type];
			const typeIds = new Set<string>();
			for (const type of types) {
				const ids = this.indexByType.get(type);
				if (ids) {
					for (const id of ids) {
						typeIds.add(id);
					}
				}
			}
			candidateIds = this.intersect(candidateIds, typeIds);
		}

		if (options.status) {
			const statuses = Array.isArray(options.status) ? options.status : [options.status];
			const statusIds = new Set<string>();
			for (const entry of this.entries.values()) {
				if (statuses.includes(entry.metadata.status)) {
					statusIds.add(entry.metadata.id);
				}
			}
			candidateIds = this.intersect(candidateIds, statusIds);
		}

		if (options.tags && options.tags.length > 0) {
			const tagIds = new Set<string>();
			for (const tag of options.tags) {
				const ids = this.indexByTag.get(tag);
				if (ids) {
					for (const id of ids) {
						tagIds.add(id);
					}
				}
			}
			candidateIds = this.intersect(candidateIds, tagIds);
		}

		if (options.symbols && options.symbols.length > 0) {
			const symbolIds = new Set<string>();
			for (const symbol of options.symbols) {
				const ids = this.indexBySymbol.get(symbol);
				if (ids) {
					for (const id of ids) {
						symbolIds.add(id);
					}
				}
			}
			candidateIds = this.intersect(candidateIds, symbolIds);
		}

		if (options.author) {
			const authorIds = this.indexByAuthor.get(options.author) || new Set();
			candidateIds = this.intersect(candidateIds, authorIds);
		}

		if (options.dateRange) {
			const dateIds = new Set<string>();
			for (const entry of this.entries.values()) {
				const date = entry.metadata.createdAt;
				if (
					(!options.dateRange.start || date >= options.dateRange.start) &&
					(!options.dateRange.end || date <= options.dateRange.end)
				) {
					dateIds.add(entry.metadata.id);
				}
			}
			candidateIds = this.intersect(candidateIds, dateIds);
		}

		if (options.minReviewScore !== undefined) {
			const scoreIds = new Set<string>();
			for (const entry of this.entries.values()) {
				if (entry.metadata.reviewScores && entry.metadata.reviewScores.overall >= options.minReviewScore) {
					scoreIds.add(entry.metadata.id);
				}
			}
			candidateIds = this.intersect(candidateIds, scoreIds);
		}

		// Get candidate entries
		const candidates = Array.from(candidateIds)
			.map((id) => this.entries.get(id)!)
			.filter(Boolean);

		// Score by relevance
		let results: SearchResult[];

		if (options.semantic && query) {
			// Semantic search using embeddings
			const queryEmbedding = await generateEmbedding(query);
			results = candidates
				.filter((e) => e.embedding)
				.map((entry) => {
					const similarity = cosineSimilarity(queryEmbedding, new Float32Array(entry.embedding!));
					return {
						entry,
						relevanceScore: similarity,
						matchedTerms: [],
					};
				})
				.sort((a, b) => b.relevanceScore - a.relevanceScore);
		} else if (query) {
			// Keyword search
			const queryTerms = query.toLowerCase().split(/\s+/);
			results = candidates
				.map((entry) => {
					const searchText =
						`${entry.metadata.title} ${entry.abstract} ${entry.content} ${entry.metadata.tags.join(" ")}`.toLowerCase();
					const matchedTerms = queryTerms.filter((term) => searchText.includes(term));
					const relevanceScore = matchedTerms.length / queryTerms.length;
					return { entry, relevanceScore, matchedTerms };
				})
				.filter((r) => r.relevanceScore > 0)
				.sort((a, b) => b.relevanceScore - a.relevanceScore);
		} else {
			// No query - return by date
			results = candidates
				.sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt)
				.map((entry) => ({ entry, relevanceScore: 1, matchedTerms: [] }));
		}

		// Apply limit
		if (options.limit) {
			results = results.slice(0, options.limit);
		}

		return results;
	}

	private intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
		return new Set([...a].filter((x) => b.has(x)));
	}

	/**
	 * Get similar entries (by embedding)
	 */
	async findSimilar(id: string, limit = 5): Promise<SearchResult[]> {
		const entry = this.entries.get(id);
		if (!entry || !entry.embedding) {
			return [];
		}

		const queryEmbedding = new Float32Array(entry.embedding);
		const results: SearchResult[] = [];

		for (const candidate of this.entries.values()) {
			if (candidate.metadata.id === id || !candidate.embedding) continue;

			const similarity = cosineSimilarity(queryEmbedding, new Float32Array(candidate.embedding));
			results.push({
				entry: candidate,
				relevanceScore: similarity,
				matchedTerms: [],
			});
		}

		return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
	}

	/**
	 * Get entries that cite a given entry
	 */
	getCitations(id: string): TradingRxivEntry[] {
		const entry = this.entries.get(id);
		if (!entry) return [];

		return entry.metadata.citations
			.map((citId) => this.entries.get(citId))
			.filter((e): e is TradingRxivEntry => e !== undefined);
	}

	/**
	 * Get entries referenced by a given entry
	 */
	getReferences(id: string): TradingRxivEntry[] {
		const entry = this.entries.get(id);
		if (!entry) return [];

		return entry.metadata.references
			.map((refId) => this.entries.get(refId))
			.filter((e): e is TradingRxivEntry => e !== undefined);
	}

	// ==========================================================================
	// STATISTICS
	// ==========================================================================

	/**
	 * Get repository statistics
	 */
	getStats(): RxivStats {
		const entries = Array.from(this.entries.values());

		// Count by type
		const byType: Record<EntryType, number> = {
			strategy: 0,
			signal: 0,
			insight: 0,
			hypothesis: 0,
			experiment: 0,
			failure: 0,
			pattern: 0,
			indicator: 0,
			model: 0,
		};
		for (const entry of entries) {
			byType[entry.metadata.type]++;
		}

		// Count by status
		const byStatus: Record<EntryStatus, number> = {
			draft: 0,
			submitted: 0,
			reviewed: 0,
			validated: 0,
			deployed: 0,
			deprecated: 0,
			failed: 0,
		};
		for (const entry of entries) {
			byStatus[entry.metadata.status]++;
		}

		// Top tags
		const tagCounts = new Map<string, number>();
		for (const [tag, ids] of this.indexByTag.entries()) {
			tagCounts.set(tag, ids.size);
		}
		const topTags = Array.from(tagCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([tag, count]) => ({ tag, count }));

		// Top symbols
		const symbolCounts = new Map<string, number>();
		for (const [symbol, ids] of this.indexBySymbol.entries()) {
			symbolCounts.set(symbol, ids.size);
		}
		const topSymbols = Array.from(symbolCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([symbol, count]) => ({ symbol, count }));

		// Top authors
		const topAuthors = Array.from(this.indexByAuthor.entries())
			.sort((a, b) => b[1].size - a[1].size)
			.slice(0, 10)
			.map(([author, ids]) => ({ author, count: ids.size }));

		// Average review score
		const reviewedEntries = entries.filter((e) => e.metadata.reviewScores);
		const averageReviewScore =
			reviewedEntries.length > 0
				? reviewedEntries.reduce((sum, e) => sum + (e.metadata.reviewScores?.overall || 0), 0) /
					reviewedEntries.length
				: 0;

		// Recent activity
		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const recentActivity = entries.filter((e) => e.metadata.createdAt >= sevenDaysAgo).length;

		return {
			totalEntries: entries.length,
			byType,
			byStatus,
			topTags,
			topSymbols,
			topAuthors,
			averageReviewScore,
			recentActivity,
		};
	}

	/**
	 * Get all entries (for export)
	 */
	getAllEntries(): TradingRxivEntry[] {
		return Array.from(this.entries.values());
	}

	/**
	 * Get entry count
	 */
	get size(): number {
		return this.entries.size;
	}
}

// ============================================================================
// SINGLETON AND CONVENIENCE
// ============================================================================

let rxivInstance: TradingRxiv | null = null;

/**
 * Get or create the Trading-Rxiv singleton
 */
export function getTradingRxiv(): TradingRxiv {
	if (!rxivInstance) {
		rxivInstance = new TradingRxiv();
	}
	return rxivInstance;
}

/**
 * Submit a new strategy
 */
export async function submitStrategy(
	title: string,
	abstract: string,
	content: string,
	options: {
		author: string;
		tags?: string[];
		symbols?: string[];
		timeframes?: string[];
		performance?: EntryMetadata["performance"];
	},
): Promise<TradingRxivEntry> {
	const rxiv = getTradingRxiv();

	return rxiv.submit({
		metadata: {
			id: "",
			title,
			type: "strategy",
			status: "submitted",
			author: options.author,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			tags: options.tags || [],
			symbols: options.symbols || [],
			timeframes: options.timeframes || [],
			performance: options.performance,
			references: [],
			citations: [],
			version: 1,
		},
		abstract,
		content,
	});
}

/**
 * Submit a new insight
 */
export async function submitInsight(
	title: string,
	abstract: string,
	content: string,
	options: {
		author: string;
		tags?: string[];
		symbols?: string[];
	},
): Promise<TradingRxivEntry> {
	const rxiv = getTradingRxiv();

	return rxiv.submit({
		metadata: {
			id: "",
			title,
			type: "insight",
			status: "submitted",
			author: options.author,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			tags: options.tags || [],
			symbols: options.symbols || [],
			timeframes: [],
			references: [],
			citations: [],
			version: 1,
		},
		abstract,
		content,
	});
}

/**
 * Record a failure (learning from mistakes)
 */
export async function recordFailure(
	title: string,
	abstract: string,
	content: string,
	options: {
		author: string;
		tags?: string[];
		symbols?: string[];
		whatWentWrong: string;
		lessonsLearned: string[];
	},
): Promise<TradingRxivEntry> {
	const rxiv = getTradingRxiv();

	const fullContent = `${content}

## What Went Wrong
${options.whatWentWrong}

## Lessons Learned
${options.lessonsLearned.map((l) => `- ${l}`).join("\n")}
`;

	return rxiv.submit({
		metadata: {
			id: "",
			title,
			type: "failure",
			status: "reviewed", // Failures are auto-reviewed
			author: options.author,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			tags: [...(options.tags || []), "failure", "lessons-learned"],
			symbols: options.symbols || [],
			timeframes: [],
			references: [],
			citations: [],
			version: 1,
		},
		abstract,
		content: fullContent,
		data: {
			whatWentWrong: options.whatWentWrong,
			lessonsLearned: options.lessonsLearned,
		},
	});
}

/**
 * Search the repository
 */
export async function searchRxiv(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
	const rxiv = getTradingRxiv();
	return rxiv.search(query, options);
}

/**
 * Get repository statistics
 */
export function getRxivStats(): RxivStats {
	const rxiv = getTradingRxiv();
	return rxiv.getStats();
}

export { TradingRxiv as default };
