/**
 * MCP CATALOG - Progressive Tool Discovery & Skill Distillation
 * ==============================================================
 *
 * Inspired by Arseny Shatokhin's "2000 Tools" experiment
 * https://www.youtube.com/watch?v=...
 *
 * Components:
 * 1. Progressive Discovery - Search 927 Smithery servers with 13k+ tools
 * 2. Smithery Client - Dynamic connection to any discovered server
 * 3. Crypto Servers - Pre-integrated crypto/trading MCP tools
 * 4. Skill Distillation - Auto-save complex workflows as skills (10x token savings)
 *
 * Usage:
 * ```typescript
 * import {
 *   getSmitheryCatalog,
 *   getAllCryptoTools,
 *   getDistillationEngine,
 *   createDiscoveryTool,
 * } from "./mcp-catalog/index.js";
 *
 * // Discover servers
 * const catalog = getSmitheryCatalog();
 * const results = catalog.discover("crypto trading", { limit: 5 });
 *
 * // Get pre-integrated crypto tools
 * const cryptoTools = getAllCryptoTools();
 *
 * // Track workflows for distillation
 * const engine = getDistillationEngine();
 * engine.startSession("session-1", "Get BTC price and analyze trend");
 * ```
 */

// Crypto Servers
export {
	createBinanceTools,
	createChainlinkTools,
	createCoinMarketCapTools,
	createCoinrankingTools,
	createCryptoPriceTools,
	createDexScreenerTools,
	createFMPTools,
	getAllCryptoTools,
	getCryptoServerInfo,
} from "./crypto-servers.js";

import { getAllCryptoTools as _getAllCryptoTools } from "./crypto-servers.js";

// Metrics Tracker - MCP-Bench aligned performance tracking
export {
	createMetricsWrapper,
	getMetricsTracker,
	type MetricsConfig,
	type ServerMetrics,
	type ToolMetric,
	type ToolPerformance,
	wrapToolWithMetrics,
} from "./metrics-tracker.js";
// Progressive Discovery
export {
	createCatalogStatsTool,
	createDiscoveryTool,
	type DiscoveryResult,
	getSmitheryCatalog,
	type MCPServer,
	type MCPTool,
	SERVER_CATEGORIES,
} from "./progressive-discovery.js";

import {
	createCatalogStatsTool as _createCatalogStatsTool,
	createDiscoveryTool as _createDiscoveryTool,
} from "./progressive-discovery.js";

// Skill Distillation
export {
	createDistillationTools,
	type DistilledSkill,
	getDistillationEngine,
	type ToolCall,
	type WorkflowSession,
} from "./skill-distillation.js";

import { createDistillationTools as _createDistillationTools } from "./skill-distillation.js";

// Smithery Client
export {
	createSmitheryExecuteTool,
	getSmitheryClient,
} from "./smithery-client.js";

import { createSmitheryExecuteTool as _createSmitheryExecuteTool } from "./smithery-client.js";

// Verification Preprocessor - Test-time compute verification
export {
	createVerificationPreprocessor,
	DEFAULT_VERIFICATION_CONFIG,
	getVerificationPreprocessor,
	type ToolVerification,
	type VerificationConfig,
	type VerificationContext,
} from "./verification-preprocessor.js";

/**
 * Get all MCP Catalog tools for agent integration
 */
export function getAllMcpCatalogTools() {
	return [
		// Discovery
		_createDiscoveryTool(),
		_createCatalogStatsTool(),

		// Dynamic execution
		_createSmitheryExecuteTool(),

		// Pre-integrated crypto tools
		..._getAllCryptoTools(),

		// Skill distillation
		..._createDistillationTools(),
	];
}

/**
 * Summary of capabilities
 */
export const MCP_CATALOG_INFO = {
	totalServers: 927,
	totalTools: 13062,
	categories: [
		"crypto",
		"finance",
		"productivity",
		"communication",
		"development",
		"ai",
		"search",
		"database",
		"cloud",
	],
	preIntegrated: {
		coinmarketcap: 26,
		binance: 12,
		dexscreener: 8,
		coinranking: 11,
		cryptoprice: 3,
		chainlink: 31,
		fmp: 253,
	},
	features: [
		"Progressive tool discovery",
		"Dynamic server connection",
		"Skill distillation (10x token savings)",
		"Pre-integrated crypto/finance tools",
		"MCP-Bench aligned metrics tracking",
		"Test-time verification preprocessor",
	],
};
