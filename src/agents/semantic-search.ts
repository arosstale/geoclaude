/**
 * Semantic Search Service
 * Provides vector-based semantic memory with SQLite persistence
 * Enables natural language search over agent memories
 */

import { randomUUID } from "crypto";
import type { BotDatabase } from "../database.js";
import { cosineSimilarity, generateEmbedding } from "./embeddings.js";

/** Semantic memory entry with vector embedding */
export interface SemanticMemory {
	id: string;
	agentId: string;
	content: string;
	embedding: Float32Array;
	metadata?: Record<string, any>;
	createdAt: Date;
}

/** Search result with relevance score */
export interface SemanticSearchResult extends SemanticMemory {
	similarity: number;
}

/** Search options */
export interface SearchOptions {
	/** Number of results to return */
	topK?: number;
	/** Minimum similarity threshold (0-1) */
	threshold?: number;
	/** Filter by metadata fields */
	metadata?: Record<string, any>;
}

/**
 * Semantic Search Service
 * Stores and retrieves memories using vector embeddings
 */
export class SemanticSearchService {
	constructor(private db: BotDatabase) {}

	/**
	 * Add a new memory with semantic embedding
	 * @param agentId Agent identifier
	 * @param content Text content to remember
	 * @param metadata Optional metadata for filtering
	 * @returns Memory ID
	 */
	async addMemory(agentId: string, content: string, metadata?: Record<string, any>): Promise<string> {
		const id = randomUUID();
		const embedding = await generateEmbedding(content);

		this.db.saveSemanticMemory({
			id,
			agent_id: agentId,
			content,
			embedding: Buffer.from(embedding.buffer),
			metadata: metadata ? JSON.stringify(metadata) : null,
		});

		return id;
	}

	/**
	 * Add multiple memories in batch
	 * More efficient than calling addMemory() multiple times
	 */
	async addMemoriesBatch(
		agentId: string,
		items: Array<{ content: string; metadata?: Record<string, any> }>,
	): Promise<string[]> {
		const ids: string[] = [];

		for (const item of items) {
			const id = await this.addMemory(agentId, item.content, item.metadata);
			ids.push(id);
		}

		return ids;
	}

	/**
	 * Search memories by semantic similarity
	 * @param agentId Agent identifier
	 * @param query Natural language query
	 * @param options Search options (topK, threshold, metadata filter)
	 * @returns Ordered results by similarity (highest first)
	 */
	async search(agentId: string, query: string, options: SearchOptions = {}): Promise<SemanticSearchResult[]> {
		const { topK = 5, threshold = 0.0, metadata } = options;

		// Generate query embedding
		const queryEmbedding = await generateEmbedding(query);

		// Get all memories for agent
		const memories = this.db.getSemanticMemories(agentId, metadata);

		// Calculate similarities and sort
		const results: SemanticSearchResult[] = memories
			.map((mem) => {
				// Convert Buffer back to Float32Array correctly
				const buffer = mem.embedding;
				const embedding = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
				const similarity = cosineSimilarity(queryEmbedding, embedding);

				return {
					id: mem.id,
					agentId: mem.agent_id,
					content: mem.content,
					embedding,
					metadata: mem.metadata ? JSON.parse(mem.metadata) : undefined,
					createdAt: new Date(mem.created_at),
					similarity,
				};
			})
			.filter((r) => r.similarity >= threshold)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, topK);

		return results;
	}

	/**
	 * Get memory by ID
	 */
	async getMemory(id: string): Promise<SemanticMemory | null> {
		const mem = this.db.getSemanticMemory(id);
		if (!mem) return null;

		// Convert Buffer back to Float32Array correctly
		const buffer = mem.embedding;
		const embedding = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

		return {
			id: mem.id,
			agentId: mem.agent_id,
			content: mem.content,
			embedding,
			metadata: mem.metadata ? JSON.parse(mem.metadata) : undefined,
			createdAt: new Date(mem.created_at),
		};
	}

	/**
	 * Delete a memory by ID
	 */
	async deleteMemory(id: string): Promise<void> {
		this.db.deleteSemanticMemory(id);
	}

	/**
	 * Delete all memories for an agent
	 */
	async deleteAllMemories(agentId: string): Promise<number> {
		return this.db.deleteAllSemanticMemories(agentId);
	}

	/**
	 * Update memory content and re-generate embedding
	 */
	async updateMemory(id: string, content: string, metadata?: Record<string, any>): Promise<void> {
		const embedding = await generateEmbedding(content);

		this.db.updateSemanticMemory(id, {
			content,
			embedding: Buffer.from(embedding.buffer),
			metadata: metadata ? JSON.stringify(metadata) : null,
		});
	}

	/**
	 * Get memory count for agent
	 */
	getMemoryCount(agentId: string): number {
		return this.db.getSemanticMemoryCount(agentId);
	}

	/**
	 * Get total memory stats across all agents
	 */
	getStats(): {
		totalMemories: number;
		agentCounts: Array<{ agentId: string; count: number }>;
	} {
		return this.db.getSemanticMemoryStats();
	}

	/**
	 * Prune old memories (keep most recent N per agent)
	 */
	async pruneOldMemories(agentId: string, keepRecent: number = 100): Promise<number> {
		return this.db.pruneOldSemanticMemories(agentId, keepRecent);
	}
}

/** Singleton instance */
let serviceInstance: SemanticSearchService | null = null;

/**
 * Get singleton semantic search service
 */
export function getSemanticSearchService(db: BotDatabase): SemanticSearchService {
	if (!serviceInstance) {
		serviceInstance = new SemanticSearchService(db);
	}
	return serviceInstance;
}

/**
 * Dispose singleton instance
 */
export function disposeSemanticSearchService(): void {
	serviceInstance = null;
}
