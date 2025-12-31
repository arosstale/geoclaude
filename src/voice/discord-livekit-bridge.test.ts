/**
 * Tests for Discord-LiveKit Bridge
 */

import { describe, expect, it } from "vitest";
import { createBridge, isLiveKitAvailable } from "./discord-livekit-bridge.js";

describe("DiscordLiveKitBridge", () => {
	describe("isLiveKitAvailable", () => {
		it("should return true when livekit-client is installed", () => {
			// livekit-client is now installed as an optional dependency
			expect(isLiveKitAvailable()).toBe(true);
		});
	});

	describe("createBridge", () => {
		it("should create bridge instance with default options", () => {
			const mockChannel = {
				id: "channel-123",
				guild: {
					id: "guild-123",
					name: "Test Guild",
					voiceAdapterCreator: {} as any,
				},
				name: "Test Channel",
			} as any;

			const bridge = createBridge({
				discordChannel: mockChannel,
				livekitRoom: "test-room",
			});

			expect(bridge).toBeDefined();
			expect(bridge.getStatus).toBeDefined();
			expect(bridge.start).toBeDefined();
			expect(bridge.stop).toBeDefined();
		});

		it("should return disconnected status before starting", () => {
			const mockChannel = {
				id: "channel-123",
				guild: {
					id: "guild-123",
					name: "Test Guild",
					voiceAdapterCreator: {} as any,
				},
				name: "Test Channel",
			} as any;

			const bridge = createBridge({
				discordChannel: mockChannel,
				livekitRoom: "test-room",
			});

			const status = bridge.getStatus();
			expect(status.connected).toBe(false);
			expect(status.discordUsers).toBe(0);
			expect(status.livekitParticipants).toBe(0);
		});

		it("should handle invalid voice adapter", async () => {
			const mockChannel = {
				id: "channel-123",
				guild: {
					id: "guild-123",
					name: "Test Guild",
					voiceAdapterCreator: null, // Invalid adapter
				},
				name: "Test Channel",
			} as any;

			const bridge = createBridge({
				discordChannel: mockChannel,
				livekitRoom: "test-room",
			});

			// Should throw due to invalid adapter, not missing livekit-client
			await expect(bridge.start()).rejects.toThrow();
		});

		it("should accept custom options", () => {
			const mockChannel = {
				id: "channel-123",
				guild: {
					id: "guild-123",
					name: "Test Guild",
					voiceAdapterCreator: {} as any,
				},
				name: "Test Channel",
			} as any;

			const bridge = createBridge({
				discordChannel: mockChannel,
				livekitRoom: "custom-room",
				livekitUrl: "wss://custom.livekit.com",
				livekitToken: "custom-token",
				bidirectional: false,
				debug: true,
			});

			expect(bridge).toBeDefined();
		});
	});
});
