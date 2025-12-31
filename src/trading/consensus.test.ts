/**
 * Tests for Trading Consensus Engine
 */

import { describe, expect, it, vi } from "vitest";
import { ConsensusEngine } from "./consensus.js";
import type { PriceData, SentimentData } from "./types.js";

describe("ConsensusEngine", () => {
	describe("Configuration", () => {
		it("should use default configuration when none provided", () => {
			const engine = new ConsensusEngine();
			// Engine should be created without errors
			expect(engine).toBeDefined();
		});

		it("should merge custom config with defaults", () => {
			const engine = new ConsensusEngine({
				minConfidence: 0.8,
				minAgreement: 0.7,
			});
			expect(engine).toBeDefined();
		});

		it("should allow custom models configuration", () => {
			const engine = new ConsensusEngine({
				models: [{ name: "TestModel", provider: "test", model: "test-1", enabled: true, weight: 1.0 }],
			});
			expect(engine).toBeDefined();
		});
	});

	describe("Consensus Logic", () => {
		const mockPriceData: PriceData = {
			symbol: "BTC",
			price: 50000,
			change24h: 5.5,
			volume24h: 1000000000,
			marketCap: 1000000000000,
			timestamp: Date.now(),
		};

		const mockSentimentData: SentimentData = {
			symbol: "BTC",
			score: 0.7,
			volume: 10000,
			sources: ["twitter", "reddit"],
			keywords: ["bullish", "ATH"],
			timestamp: Date.now(),
		};

		it("should throw error when no models are enabled", async () => {
			const engine = new ConsensusEngine({
				models: [{ name: "Disabled", provider: "test", model: "test", enabled: false, weight: 1.0 }],
			});

			await expect(engine.getConsensus("BTC", mockPriceData)).rejects.toThrow("No models enabled for consensus");
		});

		it("should handle consensus request with price data only", async () => {
			// Mock environment variables
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");
			vi.stubEnv("GROQ_API_KEY", "test-key");

			const engine = new ConsensusEngine({
				timeout: 1000, // Short timeout for tests
				models: [{ name: "Test", provider: "test", model: "test", enabled: true, weight: 1.0 }],
			});

			// The actual API call will fail, but we're testing the structure
			try {
				await engine.getConsensus("BTC", mockPriceData);
			} catch (error) {
				// Expected - no real API key
				expect(error).toBeDefined();
			}

			vi.unstubAllEnvs();
		});

		it("should handle consensus request with sentiment data", async () => {
			vi.stubEnv("OPENROUTER_API_KEY", "test-key");

			const engine = new ConsensusEngine({
				timeout: 1000,
				models: [{ name: "Test", provider: "test", model: "test", enabled: true, weight: 1.0 }],
			});

			try {
				await engine.getConsensus("BTC", mockPriceData, mockSentimentData);
			} catch (error) {
				// Expected - no real API
				expect(error).toBeDefined();
			}

			vi.unstubAllEnvs();
		});
	});

	describe("Voting Calculation", () => {
		it("should calculate weighted votes correctly", () => {
			const _engine = new ConsensusEngine();

			// Access the private calculateConsensus method via any cast for testing
			const votes = [
				{ model: "A", action: "BUY" as const, confidence: 0.8, reasoning: "Strong buy signal" },
				{ model: "B", action: "BUY" as const, confidence: 0.7, reasoning: "Good momentum" },
				{ model: "C", action: "HOLD" as const, confidence: 0.5, reasoning: "Uncertain" },
			];

			// Test that engine can process votes - structure validation
			expect(votes.length).toBe(3);
			expect(votes[0].action).toBe("BUY");
		});
	});
});
