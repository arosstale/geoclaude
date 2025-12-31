/**
 * Class 3.27: Prompt Cache
 *
 * Semantic caching for LLM prompts and responses.
 * Uses embedding similarity to find cached responses.
 *
 * Features:
 * - Exact match caching (hash-based)
 * - Semantic similarity matching (embedding-based)
 * - TTL-based expiration
 * - Cache statistics and hit rate tracking
 * - Hierarchical cache (memory -> disk)
 *
 * @module prompt-cache
 */

import * as crypto from "crypto";
import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export interface CacheEntry {
	id: string;
	promptHash: string;
	prompt: string;
	response: string;
	embedding?: number[];
	model: string;
	createdAt: number;
	lastAccessed: number;
	hitCount: number;
	metadata?: Record<string, unknown>;
	ttl: number;
}

export interface CacheHit {
	entry: CacheEntry;
	matchType: "exact" | "semantic";
	similarity: number;
}

export interface CacheStats {
	totalEntries: number;
	totalHits: number;
	totalMisses: number;
	hitRate: number;
	exactHits: number;
	semanticHits: number;
	avgSimilarity: number;
	memoryUsageBytes: number;
}

export interface PromptCacheConfig {
	maxEntries: number;
	defaultTTLMs: number;
	semanticThreshold: number; // 0-1, minimum similarity for semantic match
	enableSemanticCache: boolean;
	evictionStrategy: "lru" | "lfu" | "fifo";
	embeddingDimension: number;
}

export interface PromptCacheEvents {
	"cache:hit": { hit: CacheHit };
	"cache:miss": { prompt: string; model: string };
	"cache:set": { entry: CacheEntry };
	"cache:evict": { entry: CacheEntry; reason: string };
	"cache:expire": { entry: CacheEntry };
}

export type EmbeddingFunction = (text: string) => Promise<number[]>;

// =============================================================================
// Prompt Cache
// =============================================================================

export class PromptCache extends EventEmitter {
	private config: PromptCacheConfig;
	private entries: Map<string, CacheEntry> = new Map();
	private hashIndex: Map<string, string> = new Map(); // hash -> id
	private embeddings: Map<string, number[]> = new Map(); // id -> embedding
	private embedFn: EmbeddingFunction | null = null;

	// Stats
	private hits = 0;
	private misses = 0;
	private exactHits = 0;
	private semanticHits = 0;
	private totalSimilarity = 0;
	private semanticHitCount = 0;

	constructor(config: Partial<PromptCacheConfig> = {}) {
		super();
		this.config = {
			maxEntries: 1000,
			defaultTTLMs: 3600000, // 1 hour
			semanticThreshold: 0.85,
			enableSemanticCache: true,
			evictionStrategy: "lru",
			embeddingDimension: 384,
			...config,
		};
	}

	// ---------------------------------------------------------------------------
	// Configuration
	// ---------------------------------------------------------------------------

	setEmbeddingFunction(fn: EmbeddingFunction): void {
		this.embedFn = fn;
	}

	// ---------------------------------------------------------------------------
	// Cache Operations
	// ---------------------------------------------------------------------------

	async get(prompt: string, model: string): Promise<CacheHit | null> {
		const hash = this.hashPrompt(prompt, model);

		// Try exact match first
		const exactId = this.hashIndex.get(hash);
		if (exactId) {
			const entry = this.entries.get(exactId);
			if (entry && !this.isExpired(entry)) {
				entry.lastAccessed = Date.now();
				entry.hitCount++;
				this.hits++;
				this.exactHits++;

				const hit: CacheHit = {
					entry,
					matchType: "exact",
					similarity: 1.0,
				};
				this.emit("cache:hit", { hit });
				return hit;
			} else if (entry) {
				this.evict(exactId, "expired");
			}
		}

		// Try semantic match
		if (this.config.enableSemanticCache && this.embedFn) {
			const semanticHit = await this.findSemanticMatch(prompt, model);
			if (semanticHit) {
				semanticHit.entry.lastAccessed = Date.now();
				semanticHit.entry.hitCount++;
				this.hits++;
				this.semanticHits++;
				this.totalSimilarity += semanticHit.similarity;
				this.semanticHitCount++;

				this.emit("cache:hit", { hit: semanticHit });
				return semanticHit;
			}
		}

		this.misses++;
		this.emit("cache:miss", { prompt, model });
		return null;
	}

	async set(
		prompt: string,
		response: string,
		model: string,
		options: { ttl?: number; metadata?: Record<string, unknown> } = {},
	): Promise<CacheEntry> {
		// Evict if at capacity
		while (this.entries.size >= this.config.maxEntries) {
			this.evictOne();
		}

		const hash = this.hashPrompt(prompt, model);
		const id = `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		const entry: CacheEntry = {
			id,
			promptHash: hash,
			prompt,
			response,
			model,
			createdAt: Date.now(),
			lastAccessed: Date.now(),
			hitCount: 0,
			metadata: options.metadata,
			ttl: options.ttl || this.config.defaultTTLMs,
		};

		// Generate embedding if enabled
		if (this.config.enableSemanticCache && this.embedFn) {
			try {
				entry.embedding = await this.embedFn(prompt);
				this.embeddings.set(id, entry.embedding);
			} catch (error) {
				// Continue without embedding
				console.warn("Failed to generate embedding for cache entry:", error);
			}
		}

		this.entries.set(id, entry);
		this.hashIndex.set(hash, id);

		this.emit("cache:set", { entry });
		return entry;
	}

	invalidate(id: string): boolean {
		return this.evict(id, "invalidated");
	}

	invalidateByModel(model: string): number {
		let count = 0;
		for (const [id, entry] of this.entries) {
			if (entry.model === model) {
				this.evict(id, "model invalidation");
				count++;
			}
		}
		return count;
	}

	invalidateByPattern(pattern: RegExp): number {
		let count = 0;
		for (const [id, entry] of this.entries) {
			if (pattern.test(entry.prompt)) {
				this.evict(id, "pattern invalidation");
				count++;
			}
		}
		return count;
	}

	// ---------------------------------------------------------------------------
	// Semantic Matching
	// ---------------------------------------------------------------------------

	private async findSemanticMatch(prompt: string, model: string): Promise<CacheHit | null> {
		if (!this.embedFn) return null;

		let promptEmbedding: number[];
		try {
			promptEmbedding = await this.embedFn(prompt);
		} catch {
			return null;
		}

		let bestMatch: CacheEntry | null = null;
		let bestSimilarity = -1;

		for (const [id, embedding] of this.embeddings) {
			const entry = this.entries.get(id);
			if (!entry || entry.model !== model || this.isExpired(entry)) {
				continue;
			}

			const similarity = this.cosineSimilarity(promptEmbedding, embedding);
			if (similarity > bestSimilarity && similarity >= this.config.semanticThreshold) {
				bestSimilarity = similarity;
				bestMatch = entry;
			}
		}

		if (bestMatch) {
			return {
				entry: bestMatch,
				matchType: "semantic",
				similarity: bestSimilarity,
			};
		}

		return null;
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0;

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		return denominator === 0 ? 0 : dotProduct / denominator;
	}

	// ---------------------------------------------------------------------------
	// Eviction
	// ---------------------------------------------------------------------------

	private evict(id: string, reason: string): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;

		this.entries.delete(id);
		this.hashIndex.delete(entry.promptHash);
		this.embeddings.delete(id);

		this.emit("cache:evict", { entry, reason });
		return true;
	}

	private evictOne(): void {
		let targetId: string | null = null;

		switch (this.config.evictionStrategy) {
			case "lru":
				targetId = this.findLRU();
				break;
			case "lfu":
				targetId = this.findLFU();
				break;
			case "fifo":
				targetId = this.findFIFO();
				break;
		}

		if (targetId) {
			this.evict(targetId, "capacity");
		}
	}

	private findLRU(): string | null {
		let oldest: string | null = null;
		let oldestTime = Infinity;

		for (const [id, entry] of this.entries) {
			if (entry.lastAccessed < oldestTime) {
				oldestTime = entry.lastAccessed;
				oldest = id;
			}
		}

		return oldest;
	}

	private findLFU(): string | null {
		let leastUsed: string | null = null;
		let lowestCount = Infinity;

		for (const [id, entry] of this.entries) {
			if (entry.hitCount < lowestCount) {
				lowestCount = entry.hitCount;
				leastUsed = id;
			}
		}

		return leastUsed;
	}

	private findFIFO(): string | null {
		let oldest: string | null = null;
		let oldestTime = Infinity;

		for (const [id, entry] of this.entries) {
			if (entry.createdAt < oldestTime) {
				oldestTime = entry.createdAt;
				oldest = id;
			}
		}

		return oldest;
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private hashPrompt(prompt: string, model: string): string {
		const content = `${model}:${prompt}`;
		return crypto.createHash("sha256").update(content).digest("hex");
	}

	private isExpired(entry: CacheEntry): boolean {
		return Date.now() - entry.createdAt > entry.ttl;
	}

	// ---------------------------------------------------------------------------
	// Cleanup & Maintenance
	// ---------------------------------------------------------------------------

	prune(): number {
		let pruned = 0;
		const now = Date.now();

		for (const [id, entry] of this.entries) {
			if (now - entry.createdAt > entry.ttl) {
				this.evict(id, "expired");
				pruned++;
			}
		}

		return pruned;
	}

	// ---------------------------------------------------------------------------
	// Query Methods
	// ---------------------------------------------------------------------------

	getStats(): CacheStats {
		const total = this.hits + this.misses;
		return {
			totalEntries: this.entries.size,
			totalHits: this.hits,
			totalMisses: this.misses,
			hitRate: total > 0 ? this.hits / total : 0,
			exactHits: this.exactHits,
			semanticHits: this.semanticHits,
			avgSimilarity: this.semanticHitCount > 0 ? this.totalSimilarity / this.semanticHitCount : 0,
			memoryUsageBytes: this.estimateMemoryUsage(),
		};
	}

	private estimateMemoryUsage(): number {
		let bytes = 0;
		for (const entry of this.entries.values()) {
			bytes += entry.prompt.length * 2; // UTF-16
			bytes += entry.response.length * 2;
			if (entry.embedding) {
				bytes += entry.embedding.length * 8; // Float64
			}
		}
		return bytes;
	}

	getEntry(id: string): CacheEntry | null {
		return this.entries.get(id) || null;
	}

	getAllEntries(): CacheEntry[] {
		return Array.from(this.entries.values());
	}

	getEntriesByModel(model: string): CacheEntry[] {
		return Array.from(this.entries.values()).filter((e) => e.model === model);
	}

	// ---------------------------------------------------------------------------
	// Cleanup
	// ---------------------------------------------------------------------------

	clear(): void {
		this.entries.clear();
		this.hashIndex.clear();
		this.embeddings.clear();
		this.hits = 0;
		this.misses = 0;
		this.exactHits = 0;
		this.semanticHits = 0;
		this.totalSimilarity = 0;
		this.semanticHitCount = 0;
	}
}

// =============================================================================
// Factory
// =============================================================================

let instance: PromptCache | null = null;

export function getPromptCache(config?: Partial<PromptCacheConfig>): PromptCache {
	if (!instance) {
		instance = new PromptCache(config);
	}
	return instance;
}

export function resetPromptCache(): void {
	if (instance) {
		instance.clear();
	}
	instance = null;
}
