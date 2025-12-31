/**
 * Tests for Trading-Rxiv Knowledge Repository
 * Tests entry management, search, and security
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the embeddings module before importing trading-rxiv
vi.mock("./embeddings.js", () => ({
	generateEmbedding: async (text: string) => {
		// Generate a deterministic mock embedding based on text
		const hash = text.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
		return new Float32Array(384).map((_, i) => Math.sin(hash + i) * 0.5);
	},
	cosineSimilarity: (a: Float32Array, b: Float32Array) => {
		let dot = 0,
			magA = 0,
			magB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			magA += a[i] * a[i];
			magB += b[i] * b[i];
		}
		return dot / (Math.sqrt(magA) * Math.sqrt(magB));
	},
}));

// Now import the module
import {
	getTradingRxiv,
	recordFailure,
	submitInsight,
	submitStrategy,
	type TradingRxiv,
	type TradingRxivEntry,
} from "./trading-rxiv.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Override the RXIV_DIR for tests
const _TEST_RXIV_DIR = join(__dirname, ".test-trading-rxiv");

describe("TradingRxiv", () => {
	// Use the singleton but track entries we create for cleanup
	let rxiv: TradingRxiv;
	const createdEntryIds: string[] = [];

	beforeEach(() => {
		rxiv = getTradingRxiv();
		createdEntryIds.length = 0;
	});

	afterEach(() => {
		// Clean up entries we created
		for (const id of createdEntryIds) {
			try {
				rxiv.delete(id);
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	// Helper to track created entries
	const trackEntry = (entry: TradingRxivEntry) => {
		createdEntryIds.push(entry.metadata.id);
		return entry;
	};

	describe("ID Generation", () => {
		it("should generate UUID-based entry IDs", async () => {
			const entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Test Strategy",
						type: "strategy",
						status: "submitted",
						author: "test-agent",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: ["test"],
						symbols: ["BTC"],
						timeframes: ["1h"],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Test abstract",
					content: "Test content",
				}),
			);

			expect(entry.metadata.id).toMatch(/^rxiv_[0-9a-f-]{36}$/);
		});

		it("should generate unique IDs for each entry", async () => {
			const entry1 = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Strategy 1",
						type: "strategy",
						status: "submitted",
						author: "test",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Abstract 1",
					content: "Content 1",
				}),
			);

			const entry2 = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Strategy 2",
						type: "strategy",
						status: "submitted",
						author: "test",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Abstract 2",
					content: "Content 2",
				}),
			);

			expect(entry1.metadata.id).not.toBe(entry2.metadata.id);
		});
	});

	describe("Path Traversal Prevention", () => {
		it("should sanitize IDs to prevent path traversal", async () => {
			// Attempt path traversal attack
			const maliciousId = "../../../etc/passwd";

			const entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: maliciousId,
						title: "Malicious Entry",
						type: "strategy",
						status: "submitted",
						author: "attacker",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Attack",
					content: "Malicious",
				}),
			);

			// The ID should be sanitized - no path separators
			expect(entry.metadata.id).not.toContain("/");
			expect(entry.metadata.id).not.toContain("..");
		});

		it("should sanitize IDs with special characters", async () => {
			const specialId = "test<script>alert('xss')</script>";

			const entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: specialId,
						title: "Test",
						type: "insight",
						status: "draft",
						author: "test",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Test",
					content: "Test",
				}),
			);

			// Special chars should be replaced with underscores
			expect(entry.metadata.id).not.toContain("<");
			expect(entry.metadata.id).not.toContain(">");
			expect(entry.metadata.id).not.toContain("'");
		});
	});

	describe("CRUD Operations", () => {
		it("should submit and retrieve an entry", async () => {
			const entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Mean Reversion Strategy",
						type: "strategy",
						status: "submitted",
						author: "quant-agent",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: ["mean-reversion", "statistical"],
						symbols: ["BTC", "ETH"],
						timeframes: ["1h", "4h"],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "A mean reversion strategy for crypto",
					content: "# Strategy Details\n\nBuy when price < lower band...",
				}),
			);

			const retrieved = rxiv.get(entry.metadata.id);

			expect(retrieved).toBeDefined();
			expect(retrieved!.metadata.title).toBe("Mean Reversion Strategy");
			expect(retrieved!.metadata.tags).toContain("mean-reversion");
			expect(retrieved!.embedding).toBeDefined();
		});

		it("should update an entry and increment version", async () => {
			const entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Original Title",
						type: "hypothesis",
						status: "draft",
						author: "test",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Original abstract",
					content: "Original content",
				}),
			);

			const updated = await rxiv.update(entry.metadata.id, {
				metadata: { title: "Updated Title" } as any,
				abstract: "Updated abstract",
			});

			expect(updated).toBeDefined();
			expect(updated!.metadata.title).toBe("Updated Title");
			expect(updated!.metadata.version).toBe(2);
			expect(updated!.metadata.previousVersion).toBe(`${entry.metadata.id}_v1`);
		});

		it("should delete an entry", async () => {
			const entry = await rxiv.submit({
				metadata: {
					id: "",
					title: "To Delete",
					type: "insight",
					status: "draft",
					author: "test",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					tags: [],
					symbols: [],
					timeframes: [],
					references: [],
					citations: [],
					version: 1,
				},
				abstract: "Delete me",
				content: "Content",
			});
			// Don't track - we're testing delete

			const deleted = rxiv.delete(entry.metadata.id);

			expect(deleted).toBe(true);
			expect(rxiv.get(entry.metadata.id)).toBeUndefined();
		});
	});

	describe("Search", () => {
		const testTag = `test-${Date.now()}`; // Unique tag for isolation

		beforeEach(async () => {
			// Add test entries with unique tag for isolation
			createdEntryIds.push(
				(
					await rxiv.submit({
						metadata: {
							id: "",
							title: "BTC Momentum Strategy",
							type: "strategy",
							status: "validated",
							author: "test-quant",
							createdAt: Date.now(),
							updatedAt: Date.now(),
							tags: ["momentum", "crypto", testTag],
							symbols: ["BTC"],
							timeframes: ["1h"],
							references: [],
							citations: [],
							version: 1,
						},
						abstract: "Momentum trading for Bitcoin",
						content: "Buy on breakout above 20 SMA",
					})
				).metadata.id,
			);

			createdEntryIds.push(
				(
					await rxiv.submit({
						metadata: {
							id: "",
							title: "ETH Mean Reversion",
							type: "strategy",
							status: "draft",
							author: "test-researcher",
							createdAt: Date.now(),
							updatedAt: Date.now(),
							tags: ["mean-reversion", "crypto", testTag],
							symbols: ["ETH"],
							timeframes: ["4h"],
							references: [],
							citations: [],
							version: 1,
						},
						abstract: "Mean reversion for Ethereum",
						content: "Fade moves beyond 2 standard deviations",
					})
				).metadata.id,
			);

			createdEntryIds.push(
				(
					await rxiv.submit({
						metadata: {
							id: "",
							title: "Failed Arbitrage Attempt",
							type: "failure",
							status: "reviewed",
							author: "test-quant",
							createdAt: Date.now(),
							updatedAt: Date.now(),
							tags: ["arbitrage", "failure", testTag],
							symbols: ["BTC", "ETH"],
							timeframes: ["1m"],
							references: [],
							citations: [],
							version: 1,
						},
						abstract: "Learned that latency kills arbitrage",
						content: "Slippage exceeded profits",
					})
				).metadata.id,
			);
		});

		it("should search by keyword", async () => {
			const results = await rxiv.search("momentum", { tags: [testTag] });

			expect(results.length).toBeGreaterThan(0);
			expect(results[0].entry.metadata.title).toContain("Momentum");
		});

		it("should filter by type", async () => {
			const results = await rxiv.search("", { type: "failure", tags: [testTag] });

			expect(results).toHaveLength(1);
			expect(results[0].entry.metadata.type).toBe("failure");
		});

		it("should filter by status", async () => {
			const results = await rxiv.search("", { status: "validated", tags: [testTag] });

			expect(results).toHaveLength(1);
			expect(results[0].entry.metadata.status).toBe("validated");
		});

		it("should filter by symbol", async () => {
			const results = await rxiv.search("", { symbols: ["ETH"], tags: [testTag] });

			expect(results.length).toBeGreaterThan(0);
			expect(results.every((r) => r.entry.metadata.symbols.includes("ETH"))).toBe(true);
		});

		it("should filter by author", async () => {
			const results = await rxiv.search("", { author: "test-quant", tags: [testTag] });

			expect(results).toHaveLength(2);
		});

		it("should apply limit", async () => {
			const results = await rxiv.search("", { limit: 1, tags: [testTag] });

			expect(results).toHaveLength(1);
		});
	});

	describe("Statistics", () => {
		it("should calculate repository statistics including new entries", async () => {
			const beforeStats = rxiv.getStats();

			const _entry1 = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Strategy 1",
						type: "strategy",
						status: "validated",
						author: "test-stats",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: ["stats-test"],
						symbols: ["BTC"],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Test",
					content: "Content",
				}),
			);

			const _entry2 = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Insight 1",
						type: "insight",
						status: "submitted",
						author: "test-stats",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: ["stats-test"],
						symbols: ["ETH"],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Test",
					content: "Content",
				}),
			);

			const afterStats = rxiv.getStats();

			// Check that totals increased by 2
			expect(afterStats.totalEntries).toBe(beforeStats.totalEntries + 2);
			// Check that type counts increased
			expect(afterStats.byType.strategy).toBeGreaterThanOrEqual(beforeStats.byType.strategy + 1);
			expect(afterStats.byType.insight).toBeGreaterThanOrEqual(beforeStats.byType.insight + 1);
		});
	});

	describe("Events", () => {
		it("should emit events on submit", async () => {
			const events: string[] = [];
			const handler = () => events.push("submitted");
			rxiv.on("submitted", handler);

			const _entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Test",
						type: "strategy",
						status: "draft",
						author: "test",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Test",
					content: "Content",
				}),
			);

			rxiv.off("submitted", handler);
			expect(events).toContain("submitted");
		});

		it("should emit events on update", async () => {
			const events: string[] = [];
			const handler = () => events.push("updated");
			rxiv.on("updated", handler);

			const entry = trackEntry(
				await rxiv.submit({
					metadata: {
						id: "",
						title: "Original",
						type: "insight",
						status: "draft",
						author: "test",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						tags: [],
						symbols: [],
						timeframes: [],
						references: [],
						citations: [],
						version: 1,
					},
					abstract: "Test",
					content: "Content",
				}),
			);

			await rxiv.update(entry.metadata.id, { abstract: "Updated" });

			rxiv.off("updated", handler);
			expect(events).toContain("updated");
		});

		it("should emit events on delete", async () => {
			const events: string[] = [];
			const handler = () => events.push("deleted");
			rxiv.on("deleted", handler);

			const entry = await rxiv.submit({
				metadata: {
					id: "",
					title: "To Delete",
					type: "insight",
					status: "draft",
					author: "test",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					tags: [],
					symbols: [],
					timeframes: [],
					references: [],
					citations: [],
					version: 1,
				},
				abstract: "Test",
				content: "Content",
			});
			// Don't track - testing delete

			rxiv.delete(entry.metadata.id);

			rxiv.off("deleted", handler);
			expect(events).toContain("deleted");
		});
	});
});

describe("Convenience Functions", () => {
	it("submitStrategy should create strategy entry", async () => {
		const entry = await submitStrategy("Test Strategy", "Abstract", "Content", {
			author: "test",
			tags: ["test"],
			symbols: ["BTC"],
		});

		expect(entry.metadata.type).toBe("strategy");
		expect(entry.metadata.status).toBe("submitted");
	});

	it("submitInsight should create insight entry", async () => {
		const entry = await submitInsight("Test Insight", "Abstract", "Content", {
			author: "test",
		});

		expect(entry.metadata.type).toBe("insight");
	});

	it("recordFailure should create failure entry with lessons", async () => {
		const entry = await recordFailure("Failed Strategy", "Abstract", "Details", {
			author: "test",
			whatWentWrong: "Latency was too high",
			lessonsLearned: ["Need faster infrastructure", "Consider slippage"],
		});

		expect(entry.metadata.type).toBe("failure");
		expect(entry.metadata.status).toBe("reviewed");
		expect(entry.content).toContain("Latency was too high");
		expect(entry.content).toContain("Need faster infrastructure");
	});
});
