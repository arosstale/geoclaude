/**
 * Semantic Search Tests
 * Tests vector embeddings and semantic memory functionality
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BotDatabase } from "../database.js";
import { cosineSimilarity, generateEmbedding } from "./embeddings.js";
import { SemanticSearchService } from "./semantic-search.js";

describe("Vector Embeddings", () => {
	it("should generate embeddings for text", async () => {
		const text = "This is a test sentence for embedding generation";
		const embedding = await generateEmbedding(text);

		expect(embedding).toBeInstanceOf(Float32Array);
		expect(embedding.length).toBe(384); // all-MiniLM-L6-v2 dimension
	});

	it("should calculate cosine similarity correctly", async () => {
		const text1 = "Bitcoin is a cryptocurrency";
		const text2 = "BTC is a digital currency";
		const text3 = "I like pizza";

		const emb1 = await generateEmbedding(text1);
		const emb2 = await generateEmbedding(text2);
		const emb3 = await generateEmbedding(text3);

		const similaritySame = cosineSimilarity(emb1, emb2);
		const similarityDifferent = cosineSimilarity(emb1, emb3);

		// Related sentences should have higher similarity
		expect(similaritySame).toBeGreaterThan(similarityDifferent);
		expect(similaritySame).toBeGreaterThan(0.5);
		expect(similarityDifferent).toBeLessThan(0.5);
	});
});

describe("Semantic Search Service", () => {
	let tmpDir: string;
	let db: BotDatabase;
	let service: SemanticSearchService;

	beforeAll(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "semantic-test-"));
		db = new BotDatabase(join(tmpDir, "test.db"));
		service = new SemanticSearchService(db);
	});

	afterAll(() => {
		db.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should add and retrieve memories", async () => {
		const agentId = "test-agent";
		const content = "Bitcoin reached $50,000 today";

		const id = await service.addMemory(agentId, content);
		expect(id).toBeDefined();

		const memory = await service.getMemory(id);
		expect(memory).toBeDefined();
		expect(memory?.content).toBe(content);
		expect(memory?.agentId).toBe(agentId);
		expect(memory?.embedding).toBeInstanceOf(Float32Array);
	});

	it("should search memories by semantic similarity", async () => {
		const agentId = "test-agent";

		// Add related memories
		await service.addMemory(agentId, "Bitcoin price increased significantly");
		await service.addMemory(agentId, "Ethereum smart contracts are revolutionary");
		await service.addMemory(agentId, "I ate pizza for dinner");

		// Search for crypto-related content
		const results = await service.search(agentId, "cryptocurrency prices", {
			topK: 2,
			threshold: 0.3,
		});

		expect(results.length).toBeGreaterThan(0);
		expect(results.length).toBeLessThanOrEqual(2);

		// First result should be most similar
		expect(results[0].similarity).toBeGreaterThanOrEqual(results[1]?.similarity || 0);

		// Results should be crypto-related
		expect(results[0].content).toMatch(/Bitcoin|Ethereum/i);
	});

	it("should filter by metadata", async () => {
		const agentId = "test-agent-2";

		await service.addMemory(agentId, "Trading signal: BUY", { type: "signal", action: "BUY" });
		await service.addMemory(agentId, "Trading signal: SELL", { type: "signal", action: "SELL" });
		await service.addMemory(agentId, "Market analysis: Bullish", { type: "analysis" });

		const results = await service.search(agentId, "trading", {
			metadata: { type: "signal", action: "BUY" },
		});

		expect(results.length).toBe(1);
		expect(results[0].content).toContain("BUY");
	});

	it("should delete memories", async () => {
		const agentId = "test-agent-3";
		const id = await service.addMemory(agentId, "Test memory to delete");

		await service.deleteMemory(id);

		const memory = await service.getMemory(id);
		expect(memory).toBeNull();
	});

	it("should prune old memories", async () => {
		const agentId = "test-agent-4";

		// Add 5 memories
		for (let i = 0; i < 5; i++) {
			await service.addMemory(agentId, `Memory ${i}`);
		}

		const initialCount = service.getMemoryCount(agentId);
		expect(initialCount).toBe(5);

		// Prune to keep only 2
		const deleted = await service.pruneOldMemories(agentId, 2);
		expect(deleted).toBe(3);

		const finalCount = service.getMemoryCount(agentId);
		expect(finalCount).toBe(2);
	});

	it("should provide stats", async () => {
		const stats = service.getStats();
		expect(stats.totalMemories).toBeGreaterThan(0);
		expect(stats.agentCounts.length).toBeGreaterThan(0);
	});
});
