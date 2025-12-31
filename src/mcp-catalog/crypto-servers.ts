/**
 * CRYPTO MCP SERVERS
 * ===================
 * Pre-configured integrations for top crypto MCP servers from Smithery
 *
 * Servers included:
 * - CoinMarketCap (26 tools) - Market data, rankings, exchange info
 * - Binance (12 tools) - Real-time prices, order books, candles
 * - DexScreener (8 tools) - DEX pair discovery
 * - Coinranking (11 tools) - Crypto rankings and history
 * - Crypto Price (3 tools) - Simple price lookups
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// Server connection URLs
const CRYPTO_SERVERS = {
	coinmarketcap: {
		name: "CoinMarketCap MCP",
		url: "https://server.smithery.ai/@shinzo-labs/coinmarketcap-mcp/mcp",
		tools: 26,
	},
	binance: {
		name: "Binance Cryptocurrency Market Data Service",
		url: "https://server.smithery.ai/@snjyor/binance-mcp-data/mcp",
		tools: 12,
	},
	dexscreener: {
		name: "DexScreener Pairs",
		url: "https://server.smithery.ai/@catwhisperingninja/cat-dexscreener/mcp",
		tools: 8,
	},
	coinranking: {
		name: "Coinranking",
		url: "https://server.smithery.ai/@coinranking/coinranking-mcp/mcp",
		tools: 11,
	},
	cryptoprice: {
		name: "Crypto Price & Market Analysis Server",
		url: "https://server.smithery.ai/@truss44/mcp-crypto-price/mcp",
		tools: 3,
	},
	chainlink: {
		name: "Chainlink",
		url: "https://server.smithery.ai/@goldk3y/chainlink-mcp-server/mcp",
		tools: 31,
	},
	fmp: {
		name: "Financial Modeling Prep",
		url: "https://server.smithery.ai/@cfocoder/financial-modeling-prep-mcp-server/mcp",
		tools: 253,
	},
} as const;

type CryptoServerKey = keyof typeof CRYPTO_SERVERS;

// =============================================================================
// Schemas
// =============================================================================

const symbolSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	symbol: Type.String({ description: "Crypto symbol (e.g., BTC, ETH, SOL)" }),
});

const symbolsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	symbols: Type.String({ description: "Crypto symbols comma-separated (e.g., BTC,ETH,SOL)" }),
});

const listingSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	limit: Type.Optional(Type.Number({ description: "Number of results (default 10)" })),
	sort: Type.Optional(Type.String({ description: "Sort by: market_cap, volume, price" })),
});

const klinesSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	symbol: Type.String({ description: "Trading pair (e.g., BTCUSDT)" }),
	interval: Type.Optional(Type.String({ description: "Interval: 1m, 5m, 15m, 1h, 4h, 1d" })),
	limit: Type.Optional(Type.Number({ description: "Number of candles (default 24)" })),
});

const searchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query" }),
});

const pairSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	chain: Type.String({ description: "Chain (e.g., solana, ethereum, bsc)" }),
	pairAddress: Type.String({ description: "Pair contract address" }),
});

const tokenSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	tokenAddress: Type.String({ description: "Token contract address" }),
});

const coinIdSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	coinId: Type.String({ description: "Coin UUID or symbol" }),
	timePeriod: Type.Optional(Type.String({ description: "Time period: 3h, 24h, 7d, 30d, 1y" })),
});

const noParamsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

const gainersLosersSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	type: Type.Optional(Type.String({ description: "gainers or losers" })),
	limit: Type.Optional(Type.Number({ description: "Number of results" })),
});

const priceFeedSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	pair: Type.String({ description: "Price pair (e.g., BTC/USD, ETH/USD)" }),
	network: Type.Optional(Type.String({ description: "Network: ethereum, polygon, arbitrum" })),
});

// =============================================================================
// Helper: Execute Smithery MCP Tool
// =============================================================================

async function executeSmitheryTool(
	server: CryptoServerKey,
	toolName: string,
	params: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
	const serverConfig = CRYPTO_SERVERS[server];

	try {
		const response = await fetch(serverConfig.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Date.now(),
				method: "tools/call",
				params: {
					name: toolName,
					arguments: params,
				},
			}),
		});

		if (!response.ok) {
			return {
				success: false,
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const text = await response.text();
		const contentType = response.headers.get("content-type") || "";

		// Handle SSE format
		if (contentType.includes("text/event-stream") || text.startsWith("event:")) {
			const lines = text.split("\n");
			for (const line of lines) {
				if (line.startsWith("data:")) {
					const jsonStr = line.slice(5).trim();
					if (jsonStr) {
						try {
							const parsed = JSON.parse(jsonStr);
							return { success: true, data: parsed.result || parsed };
						} catch {}
					}
				}
			}
			return { success: false, error: "No valid data in response" };
		}

		// Regular JSON
		const result = JSON.parse(text);
		return { success: true, data: result.result || result };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

function formatResult(title: string, result: { success: boolean; data?: unknown; error?: string }) {
	if (result.success) {
		return {
			content: [
				{
					type: "text" as const,
					text: `## ${title}\n\n\`\`\`json\n${JSON.stringify(result.data, null, 2)}\n\`\`\``,
				},
			],
			details: undefined,
		};
	}
	return {
		content: [{ type: "text" as const, text: `## ${title} - Error\n\n${result.error}` }],
		details: undefined,
	};
}

function logTool(name: string, label: string): void {
	console.log(`[MCP:Crypto:${name}] ${label}`);
}

// =============================================================================
// CoinMarketCap Tools
// =============================================================================

export function createCoinMarketCapTools(): AgentTool<any>[] {
	const quotesTool: AgentTool<typeof symbolsSchema> = {
		name: "cmc_get_crypto_quotes",
		label: "cmc_get_crypto_quotes",
		description:
			"Get current price quotes for cryptocurrencies by symbol (BTC, ETH, SOL, etc). Returns price, market cap, volume, and percent changes.",
		parameters: symbolsSchema,
		execute: async (_toolCallId, { symbols, label }) => {
			logTool("cmc_quotes", label);
			const result = await executeSmitheryTool("coinmarketcap", "get_quotes", { symbol: symbols });
			return formatResult("CoinMarketCap Quotes", result);
		},
	};

	const listingsTool: AgentTool<typeof listingSchema> = {
		name: "cmc_get_listings",
		label: "cmc_get_listings",
		description:
			"Get top cryptocurrencies ranked by market cap. Use limit to control how many (default 10, max 100).",
		parameters: listingSchema,
		execute: async (_toolCallId, { limit = 10, sort = "market_cap", label }) => {
			logTool("cmc_listings", label);
			const result = await executeSmitheryTool("coinmarketcap", "get_listings", { limit, sort });
			return formatResult("CoinMarketCap Top Cryptos", result);
		},
	};

	const trendingTool: AgentTool<typeof noParamsSchema> = {
		name: "cmc_get_trending",
		label: "cmc_get_trending",
		description: "Get trending cryptocurrencies on CoinMarketCap.",
		parameters: noParamsSchema,
		execute: async (_toolCallId, { label }) => {
			logTool("cmc_trending", label);
			const result = await executeSmitheryTool("coinmarketcap", "get_trending", {});
			return formatResult("CoinMarketCap Trending", result);
		},
	};

	const gainersLosersTool: AgentTool<typeof gainersLosersSchema> = {
		name: "cmc_get_gainers_losers",
		label: "cmc_get_gainers_losers",
		description: "Get top gainers and losers in the crypto market over the past 24h.",
		parameters: gainersLosersSchema,
		execute: async (_toolCallId, { type = "gainers", limit = 10, label }) => {
			logTool("cmc_gainers_losers", label);
			const result = await executeSmitheryTool("coinmarketcap", "get_gainers_losers", { type, limit });
			return formatResult("CoinMarketCap Gainers/Losers", result);
		},
	};

	return [quotesTool, listingsTool, trendingTool, gainersLosersTool];
}

// =============================================================================
// Binance Tools
// =============================================================================

export function createBinanceTools(): AgentTool<any>[] {
	const priceTool: AgentTool<typeof symbolSchema> = {
		name: "binance_get_price",
		label: "binance_get_price",
		description: "Get current price for a trading pair on Binance (e.g., BTCUSDT, ETHUSDT, SOLUSDT).",
		parameters: symbolSchema,
		execute: async (_toolCallId, { symbol, label }) => {
			logTool("binance_price", label);
			const result = await executeSmitheryTool("binance", "get_ticker_price", { symbol: symbol.toUpperCase() });
			return formatResult("Binance Price", result);
		},
	};

	const klinesTool: AgentTool<typeof klinesSchema> = {
		name: "binance_get_klines",
		label: "binance_get_klines",
		description: "Get candlestick/OHLCV data for a symbol. Intervals: 1m, 5m, 15m, 1h, 4h, 1d, 1w.",
		parameters: klinesSchema,
		execute: async (_toolCallId, { symbol, interval = "1h", limit = 24, label }) => {
			logTool("binance_klines", label);
			const result = await executeSmitheryTool("binance", "get_klines", {
				symbol: symbol.toUpperCase(),
				interval,
				limit,
			});
			return formatResult("Binance Klines", result);
		},
	};

	const orderbookTool: AgentTool<typeof symbolSchema> = {
		name: "binance_get_orderbook",
		label: "binance_get_orderbook",
		description: "Get order book depth for a trading pair on Binance.",
		parameters: symbolSchema,
		execute: async (_toolCallId, { symbol, label }) => {
			logTool("binance_orderbook", label);
			const result = await executeSmitheryTool("binance", "get_depth", {
				symbol: symbol.toUpperCase(),
				limit: 20,
			});
			return formatResult("Binance Order Book", result);
		},
	};

	const stats24hTool: AgentTool<typeof symbolSchema> = {
		name: "binance_get_24h_stats",
		label: "binance_get_24h_stats",
		description: "Get 24h trading statistics for a symbol on Binance.",
		parameters: symbolSchema,
		execute: async (_toolCallId, { symbol, label }) => {
			logTool("binance_24h", label);
			const result = await executeSmitheryTool("binance", "get_ticker_24hr", { symbol: symbol.toUpperCase() });
			return formatResult("Binance 24h Stats", result);
		},
	};

	return [priceTool, klinesTool, orderbookTool, stats24hTool];
}

// =============================================================================
// DexScreener Tools
// =============================================================================

export function createDexScreenerTools(): AgentTool<any>[] {
	const searchTool: AgentTool<typeof searchSchema> = {
		name: "dex_search_pairs",
		label: "dex_search_pairs",
		description: "Search for trading pairs across DEXes. Find tokens by name, symbol, or address.",
		parameters: searchSchema,
		execute: async (_toolCallId, { query, label }) => {
			logTool("dex_search", label);
			const result = await executeSmitheryTool("dexscreener", "search_pairs", { q: query });
			return formatResult("DexScreener Search", result);
		},
	};

	const pairTool: AgentTool<typeof pairSchema> = {
		name: "dex_get_pair",
		label: "dex_get_pair",
		description: "Get detailed pair info by chain and pair address (e.g., solana, 0x...).",
		parameters: pairSchema,
		execute: async (_toolCallId, { chain, pairAddress, label }) => {
			logTool("dex_pair", label);
			const result = await executeSmitheryTool("dexscreener", "get_pair", { chainId: chain, pairAddress });
			return formatResult("DexScreener Pair", result);
		},
	};

	const tokenPairsTool: AgentTool<typeof tokenSchema> = {
		name: "dex_get_token_pairs",
		label: "dex_get_token_pairs",
		description: "Get all trading pairs for a token address on a specific chain.",
		parameters: tokenSchema,
		execute: async (_toolCallId, { tokenAddress, label }) => {
			logTool("dex_token_pairs", label);
			const result = await executeSmitheryTool("dexscreener", "get_token_pairs", { tokenAddresses: tokenAddress });
			return formatResult("DexScreener Token Pairs", result);
		},
	};

	return [searchTool, pairTool, tokenPairsTool];
}

// =============================================================================
// Coinranking Tools
// =============================================================================

export function createCoinrankingTools(): AgentTool<any>[] {
	const coinsTool: AgentTool<typeof listingSchema> = {
		name: "coinrank_get_coins",
		label: "coinrank_get_coins",
		description: "Get ranked list of cryptocurrencies with prices, market caps, and changes.",
		parameters: listingSchema,
		execute: async (_toolCallId, { limit = 20, sort = "marketCap", label }) => {
			logTool("coinrank_coins", label);
			const result = await executeSmitheryTool("coinranking", "get_coins", { limit, orderBy: sort });
			return formatResult("Coinranking Top Coins", result);
		},
	};

	const coinTool: AgentTool<typeof coinIdSchema> = {
		name: "coinrank_get_coin",
		label: "coinrank_get_coin",
		description: "Get detailed info for a specific coin by UUID or symbol.",
		parameters: coinIdSchema,
		execute: async (_toolCallId, { coinId, label }) => {
			logTool("coinrank_coin", label);
			const result = await executeSmitheryTool("coinranking", "get_coin", { uuid: coinId });
			return formatResult("Coinranking Coin Details", result);
		},
	};

	const historyTool: AgentTool<typeof coinIdSchema> = {
		name: "coinrank_get_history",
		label: "coinrank_get_history",
		description: "Get price history for a coin. Timeperiods: 3h, 24h, 7d, 30d, 3m, 1y, 5y.",
		parameters: coinIdSchema,
		execute: async (_toolCallId, { coinId, timePeriod = "24h", label }) => {
			logTool("coinrank_history", label);
			const result = await executeSmitheryTool("coinranking", "get_coin_history", { uuid: coinId, timePeriod });
			return formatResult("Coinranking History", result);
		},
	};

	return [coinsTool, coinTool, historyTool];
}

// =============================================================================
// Simple Crypto Price Tools
// =============================================================================

export function createCryptoPriceTools(): AgentTool<any>[] {
	const priceTool: AgentTool<typeof symbolSchema> = {
		name: "crypto_get_price",
		label: "crypto_get_price",
		description: "Get current price and 24h change for a cryptocurrency (BTC, ETH, SOL, etc).",
		parameters: symbolSchema,
		execute: async (_toolCallId, { symbol, label }) => {
			logTool("crypto_price", label);
			const result = await executeSmitheryTool("cryptoprice", "get_price", { symbol: symbol.toUpperCase() });
			return formatResult("Crypto Price", result);
		},
	};

	const marketTool: AgentTool<typeof noParamsSchema> = {
		name: "crypto_market_overview",
		label: "crypto_market_overview",
		description: "Get overall crypto market overview including total market cap and BTC dominance.",
		parameters: noParamsSchema,
		execute: async (_toolCallId, { label }) => {
			logTool("crypto_market", label);
			const result = await executeSmitheryTool("cryptoprice", "get_market_overview", {});
			return formatResult("Market Overview", result);
		},
	};

	return [priceTool, marketTool];
}

// =============================================================================
// Chainlink Oracle Tools
// =============================================================================

export function createChainlinkTools(): AgentTool<any>[] {
	const priceFeedTool: AgentTool<typeof priceFeedSchema> = {
		name: "chainlink_get_price_feed",
		label: "chainlink_get_price_feed",
		description: "Get price data from Chainlink oracle price feeds. Most accurate on-chain prices.",
		parameters: priceFeedSchema,
		execute: async (_toolCallId, { pair, network = "ethereum", label }) => {
			logTool("chainlink_feed", label);
			const result = await executeSmitheryTool("chainlink", "get_price_feed", { pair, network });
			return formatResult("Chainlink Price Feed", result);
		},
	};

	const listFeedsTool: AgentTool<typeof priceFeedSchema> = {
		name: "chainlink_list_feeds",
		label: "chainlink_list_feeds",
		description: "List available Chainlink price feeds on a network.",
		parameters: priceFeedSchema,
		execute: async (_toolCallId, { network = "ethereum", label }) => {
			logTool("chainlink_feeds", label);
			const result = await executeSmitheryTool("chainlink", "list_price_feeds", { network });
			return formatResult("Chainlink Feeds", result);
		},
	};

	return [priceFeedTool, listFeedsTool];
}

// =============================================================================
// Financial Modeling Prep Tools (Stocks + Crypto)
// =============================================================================

export function createFMPTools(): AgentTool<any>[] {
	const stockQuoteTool: AgentTool<typeof symbolSchema> = {
		name: "fmp_stock_quote",
		label: "fmp_stock_quote",
		description: "Get real-time stock quote for any ticker (AAPL, TSLA, NVDA, etc).",
		parameters: symbolSchema,
		execute: async (_toolCallId, { symbol, label }) => {
			logTool("fmp_stock", label);
			const result = await executeSmitheryTool("fmp", "get_quote", { symbol: symbol.toUpperCase() });
			return formatResult("FMP Stock Quote", result);
		},
	};

	const cryptoQuoteTool: AgentTool<typeof symbolSchema> = {
		name: "fmp_crypto_quote",
		label: "fmp_crypto_quote",
		description: "Get crypto quote from Financial Modeling Prep (BTCUSD, ETHUSD).",
		parameters: symbolSchema,
		execute: async (_toolCallId, { symbol, label }) => {
			logTool("fmp_crypto", label);
			const result = await executeSmitheryTool("fmp", "get_crypto_quote", { symbol: symbol.toUpperCase() });
			return formatResult("FMP Crypto Quote", result);
		},
	};

	const moversTool: AgentTool<typeof gainersLosersSchema> = {
		name: "fmp_market_movers",
		label: "fmp_market_movers",
		description: "Get stock market movers - gainers, losers, and most active.",
		parameters: gainersLosersSchema,
		execute: async (_toolCallId, { type = "gainers", label }) => {
			logTool("fmp_movers", label);
			const result = await executeSmitheryTool("fmp", "get_market_movers", { type });
			return formatResult("FMP Market Movers", result);
		},
	};

	return [stockQuoteTool, cryptoQuoteTool, moversTool];
}

// =============================================================================
// Export All Tools
// =============================================================================

export function getAllCryptoTools(): AgentTool<any>[] {
	return [
		...createCoinMarketCapTools(),
		...createBinanceTools(),
		...createDexScreenerTools(),
		...createCoinrankingTools(),
		...createCryptoPriceTools(),
		...createChainlinkTools(),
		...createFMPTools(),
	];
}

export function getCryptoServerInfo() {
	return CRYPTO_SERVERS;
}

export default {
	getAllCryptoTools,
	getCryptoServerInfo,
	createCoinMarketCapTools,
	createBinanceTools,
	createDexScreenerTools,
	createCoinrankingTools,
	createCryptoPriceTools,
	createChainlinkTools,
	createFMPTools,
};
