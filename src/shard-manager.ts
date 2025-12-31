#!/usr/bin/env node
/**
 * Discord Bot Sharding Manager
 * Handles automatic sharding for scaling to 2500+ guilds
 *
 * Usage: node dist/shard-manager.js
 *
 * When to use sharding:
 * - Required when bot is in 2500+ guilds (Discord limit per shard)
 * - Recommended for 1000+ guilds for better performance
 * - Improves memory distribution across processes
 */

import { ShardingManager, type ShardingManagerOptions } from "discord.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TOTAL_SHARDS = process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT, 10) : "auto";
const SHARDS_PER_CLUSTER = parseInt(process.env.SHARDS_PER_CLUSTER || "4", 10);

if (!BOT_TOKEN) {
	console.error("❌ DISCORD_BOT_TOKEN not set");
	process.exit(1);
}

// Create sharding manager
const managerOptions: ShardingManagerOptions = {
	token: BOT_TOKEN,
	totalShards: TOTAL_SHARDS,
	respawn: true, // Auto-restart crashed shards
	shardArgs: process.argv.slice(2), // Pass CLI args to shards
	execArgv: ["--enable-source-maps"], // Enable source maps in shards
};

const manager = new ShardingManager(join(__dirname, "main.js"), managerOptions);

// Shard events
manager.on("shardCreate", (shard) => {
	console.log(`[SHARD ${shard.id}] Launched`);

	shard.on("ready", () => {
		console.log(`[SHARD ${shard.id}] Ready`);
	});

	shard.on("disconnect", () => {
		console.warn(`[SHARD ${shard.id}] Disconnected`);
	});

	shard.on("reconnecting", () => {
		console.log(`[SHARD ${shard.id}] Reconnecting...`);
	});

	shard.on("death", (process) => {
		const exitCode = "exitCode" in process ? process.exitCode : "unknown";
		console.error(`[SHARD ${shard.id}] Died (exit code: ${exitCode})`);
	});

	shard.on("error", (error) => {
		console.error(`[SHARD ${shard.id}] Error:`, error);
	});

	shard.on("message", (message) => {
		// Handle cross-shard communication
		if (typeof message === "object" && message.type) {
			handleShardMessage(shard.id, message);
		}
	});
});

// Cross-shard message handling
interface ShardMessage {
	type: string;
	data?: unknown;
}

function handleShardMessage(shardId: number, message: ShardMessage): void {
	switch (message.type) {
		case "stats":
			console.log(`[SHARD ${shardId}] Stats:`, message.data);
			break;
		case "broadcast":
			// Broadcast to all shards
			manager.broadcast(message.data);
			break;
		case "guild_count":
			// Log guild count from shard
			console.log(`[SHARD ${shardId}] Guilds: ${message.data}`);
			break;
		default:
			console.log(`[SHARD ${shardId}] Unknown message:`, message);
	}
}

// Get stats from all shards
async function getGlobalStats(): Promise<{
	totalGuilds: number;
	totalMembers: number;
	shardCount: number;
}> {
	try {
		const results = await manager.fetchClientValues("guilds.cache.size");
		const guildCounts = results as number[];
		const totalGuilds = guildCounts.reduce((a, b) => a + b, 0);

		return {
			totalGuilds,
			totalMembers: 0, // Would need separate fetch
			shardCount: manager.shards.size,
		};
	} catch (error) {
		console.error("Failed to fetch global stats:", error);
		return { totalGuilds: 0, totalMembers: 0, shardCount: 0 };
	}
}

// Graceful shutdown
async function shutdown(): Promise<void> {
	console.log("\n[MANAGER] Shutting down...");

	for (const [id, shard] of manager.shards) {
		console.log(`[SHARD ${id}] Killing...`);
		shard.kill();
	}

	console.log("[MANAGER] All shards terminated");
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start sharding
console.log("╔═══════════════════════════════════════════╗");
console.log("║     Pi Discord Bot - Sharding Manager     ║");
console.log("╚═══════════════════════════════════════════╝");
console.log(`Total Shards: ${TOTAL_SHARDS}`);
console.log(`Shards per Cluster: ${SHARDS_PER_CLUSTER}`);
console.log("");

manager
	.spawn({ timeout: 60000 })
	.then(() => {
		console.log(`\n✅ All ${manager.shards.size} shards spawned successfully!`);

		// Log stats every 5 minutes
		setInterval(async () => {
			const stats = await getGlobalStats();
			console.log(`[STATS] Guilds: ${stats.totalGuilds} | Shards: ${stats.shardCount}`);
		}, 300000);
	})
	.catch((error) => {
		console.error("❌ Failed to spawn shards:", error);
		process.exit(1);
	});

export { manager, getGlobalStats };
