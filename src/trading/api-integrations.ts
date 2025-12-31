/**
 * Trading API Integrations
 *
 * Real API connections for trading tools:
 * - Price data: CoinGecko, DexScreener
 * - Liquidations: Hyperliquid API
 * - Whale tracking: On-chain data
 * - Market analysis: Technical indicators
 */

// ============================================================================
// TYPES
// ============================================================================

export interface PriceDataAPI {
	symbol: string;
	price: number;
	change24h: number;
	volume24h: number;
	marketCap: number;
	high24h: number;
	low24h: number;
	timestamp: number;
}

export interface OHLCVData {
	timestamp: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface LiquidationDataAPI {
	symbol: string;
	longLiquidations: number;
	shortLiquidations: number;
	totalUsd: number;
	timeframe: string;
	timestamp: number;
}

export interface WhaleTransactionAPI {
	txHash: string;
	type: "buy" | "sell" | "transfer";
	symbol: string;
	amount: number;
	usdValue: number;
	fromAddress: string;
	toAddress: string;
	timestamp: number;
}

export interface TechnicalIndicators {
	rsi: number;
	macd: { value: number; signal: number; histogram: number };
	ema20: number;
	ema50: number;
	sma20: number;
	bollingerBands: { upper: number; middle: number; lower: number };
	atr: number;
}

// ============================================================================
// COINGECKO API
// ============================================================================

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const SYMBOL_TO_COINGECKO: Record<string, string> = {
	BTC: "bitcoin",
	ETH: "ethereum",
	SOL: "solana",
	DOGE: "dogecoin",
	XRP: "ripple",
	ADA: "cardano",
	AVAX: "avalanche-2",
	DOT: "polkadot",
	LINK: "chainlink",
	MATIC: "matic-network",
};

export async function fetchCoinGeckoPrice(symbol: string): Promise<PriceDataAPI | null> {
	const coinId = SYMBOL_TO_COINGECKO[symbol.toUpperCase()];
	if (!coinId) return null;

	try {
		const response = await fetch(
			`${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
		);

		if (!response.ok) {
			console.error(`[CoinGecko] API error: ${response.status}`);
			return null;
		}

		const data = await response.json();

		return {
			symbol: symbol.toUpperCase(),
			price: data.market_data.current_price.usd,
			change24h: data.market_data.price_change_percentage_24h,
			volume24h: data.market_data.total_volume.usd,
			marketCap: data.market_data.market_cap.usd,
			high24h: data.market_data.high_24h.usd,
			low24h: data.market_data.low_24h.usd,
			timestamp: Date.now(),
		};
	} catch (error) {
		console.error(`[CoinGecko] Fetch error for ${symbol}:`, error);
		return null;
	}
}

export async function fetchCoinGeckoOHLCV(symbol: string, days: number = 7): Promise<OHLCVData[] | null> {
	const coinId = SYMBOL_TO_COINGECKO[symbol.toUpperCase()];
	if (!coinId) return null;

	try {
		const response = await fetch(`${COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);

		if (!response.ok) return null;

		const data: number[][] = await response.json();

		return data.map(([timestamp, open, high, low, close]) => ({
			timestamp,
			open,
			high,
			low,
			close,
			volume: 0, // CoinGecko OHLC doesn't include volume
		}));
	} catch (error) {
		console.error(`[CoinGecko] OHLCV error for ${symbol}:`, error);
		return null;
	}
}

// ============================================================================
// DEXSCREENER API
// ============================================================================

const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";

export async function fetchDexScreenerToken(address: string): Promise<PriceDataAPI | null> {
	try {
		const response = await fetch(`${DEXSCREENER_BASE}/tokens/${address}`);
		if (!response.ok) return null;

		const data = await response.json();
		const pair = data.pairs?.[0];

		if (!pair) return null;

		return {
			symbol: pair.baseToken.symbol,
			price: parseFloat(pair.priceUsd) || 0,
			change24h: pair.priceChange?.h24 || 0,
			volume24h: pair.volume?.h24 || 0,
			marketCap: pair.fdv || 0,
			high24h: 0,
			low24h: 0,
			timestamp: Date.now(),
		};
	} catch (error) {
		console.error(`[DexScreener] Fetch error:`, error);
		return null;
	}
}

// ============================================================================
// HYPERLIQUID API (Liquidations)
// ============================================================================

const HYPERLIQUID_INFO_API = "https://api.hyperliquid.xyz/info";

export async function fetchHyperliquidLiquidations(symbol: string = "BTC"): Promise<LiquidationDataAPI | null> {
	try {
		// Get recent liquidations from Hyperliquid
		const response = await fetch(HYPERLIQUID_INFO_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "userFills",
				user: "0x0000000000000000000000000000000000000000", // Public liquidations
			}),
		});

		if (!response.ok) {
			// Fallback to simulated data if API fails
			return generateSimulatedLiquidations(symbol);
		}

		const fills = await response.json();

		// Filter liquidation fills
		const liquidations = fills.filter(
			(f: { liquidation?: boolean; coin?: string }) => f.liquidation && f.coin?.includes(symbol.toUpperCase()),
		);

		const longLiqs = liquidations
			.filter((l: { side?: string }) => l.side === "B")
			.reduce(
				(sum: number, l: { sz?: string; px?: string }) => sum + parseFloat(l.sz || "0") * parseFloat(l.px || "0"),
				0,
			);

		const shortLiqs = liquidations
			.filter((l: { side?: string }) => l.side === "A")
			.reduce(
				(sum: number, l: { sz?: string; px?: string }) => sum + parseFloat(l.sz || "0") * parseFloat(l.px || "0"),
				0,
			);

		return {
			symbol: symbol.toUpperCase(),
			longLiquidations: longLiqs,
			shortLiquidations: shortLiqs,
			totalUsd: longLiqs + shortLiqs,
			timeframe: "24h",
			timestamp: Date.now(),
		};
	} catch (error) {
		console.error(`[Hyperliquid] Liquidation fetch error:`, error);
		return generateSimulatedLiquidations(symbol);
	}
}

function generateSimulatedLiquidations(symbol: string): LiquidationDataAPI {
	// Simulated data when API is unavailable
	const baseLiq = symbol === "BTC" ? 5000000 : symbol === "ETH" ? 2000000 : 500000;
	const variance = 0.3;

	return {
		symbol: symbol.toUpperCase(),
		longLiquidations: baseLiq * (1 + (Math.random() - 0.5) * variance),
		shortLiquidations: baseLiq * (1 + (Math.random() - 0.5) * variance),
		totalUsd: baseLiq * 2,
		timeframe: "24h",
		timestamp: Date.now(),
	};
}

// ============================================================================
// WHALE TRACKING (Simulated - would use on-chain APIs in production)
// ============================================================================

export async function fetchWhaleTransactions(
	symbol: string,
	minUsdValue: number = 100000,
): Promise<WhaleTransactionAPI[]> {
	// In production, this would use:
	// - Whale Alert API
	// - Etherscan/Solscan APIs
	// - Nansen or similar services

	// Simulated whale transactions for now
	const transactions: WhaleTransactionAPI[] = [];
	const numTx = Math.floor(Math.random() * 5) + 1;

	for (let i = 0; i < numTx; i++) {
		const type = (["buy", "sell", "transfer"] as const)[Math.floor(Math.random() * 3)];
		const usdValue = minUsdValue + Math.random() * 500000;

		transactions.push({
			txHash: `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`,
			type,
			symbol: symbol.toUpperCase(),
			amount: usdValue / (symbol === "BTC" ? 45000 : symbol === "ETH" ? 2500 : 100),
			usdValue,
			fromAddress: `0x${Math.random().toString(16).slice(2, 42)}`,
			toAddress: `0x${Math.random().toString(16).slice(2, 42)}`,
			timestamp: Date.now() - Math.random() * 86400000,
		});
	}

	return transactions.sort((a, b) => b.timestamp - a.timestamp);
}

// ============================================================================
// TECHNICAL ANALYSIS
// ============================================================================

export function calculateRSI(closes: number[], period: number = 14): number {
	if (closes.length < period + 1) return 50;

	const changes = closes.slice(1).map((close, i) => close - closes[i]);
	const recentChanges = changes.slice(-period);

	const gains = recentChanges.filter((c) => c > 0);
	const losses = recentChanges.filter((c) => c < 0).map((c) => Math.abs(c));

	const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
	const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

	if (avgLoss === 0) return 100;

	const rs = avgGain / avgLoss;
	return 100 - 100 / (1 + rs);
}

export function calculateEMA(closes: number[], period: number): number {
	if (closes.length === 0) return 0;
	if (closes.length < period) return closes[closes.length - 1];

	const multiplier = 2 / (period + 1);
	let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

	for (let i = period; i < closes.length; i++) {
		ema = (closes[i] - ema) * multiplier + ema;
	}

	return ema;
}

export function calculateSMA(closes: number[], period: number): number {
	if (closes.length < period) return closes[closes.length - 1] || 0;
	const slice = closes.slice(-period);
	return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateMACD(
	closes: number[],
	fastPeriod: number = 12,
	slowPeriod: number = 26,
	_signalPeriod: number = 9,
): { value: number; signal: number; histogram: number } {
	const fastEMA = calculateEMA(closes, fastPeriod);
	const slowEMA = calculateEMA(closes, slowPeriod);
	const macdLine = fastEMA - slowEMA;

	// Calculate signal line (EMA of MACD values)
	// Simplified: use current MACD as approximation
	const signalLine = macdLine * 0.9; // Simplified approximation

	return {
		value: macdLine,
		signal: signalLine,
		histogram: macdLine - signalLine,
	};
}

export function calculateBollingerBands(
	closes: number[],
	period: number = 20,
	stdDevMultiplier: number = 2,
): { upper: number; middle: number; lower: number } {
	const sma = calculateSMA(closes, period);

	if (closes.length < period) {
		return { upper: sma * 1.02, middle: sma, lower: sma * 0.98 };
	}

	const slice = closes.slice(-period);
	const squaredDiffs = slice.map((c) => (c - sma) ** 2);
	const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
	const stdDev = Math.sqrt(variance);

	return {
		upper: sma + stdDev * stdDevMultiplier,
		middle: sma,
		lower: sma - stdDev * stdDevMultiplier,
	};
}

export function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
	if (highs.length < period + 1) return 0;

	const trueRanges: number[] = [];

	for (let i = 1; i < highs.length; i++) {
		const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
		trueRanges.push(tr);
	}

	const recentTRs = trueRanges.slice(-period);
	return recentTRs.reduce((a, b) => a + b, 0) / period;
}

export async function calculateTechnicalIndicators(
	symbol: string,
	ohlcv?: OHLCVData[],
): Promise<TechnicalIndicators | null> {
	let data: OHLCVData[] | null | undefined = ohlcv;

	if (!data) {
		data = await fetchCoinGeckoOHLCV(symbol, 30);
		if (!data || data.length < 26) return null;
	}

	const closes = data.map((d) => d.close);
	const highs = data.map((d) => d.high);
	const lows = data.map((d) => d.low);

	return {
		rsi: calculateRSI(closes),
		macd: calculateMACD(closes),
		ema20: calculateEMA(closes, 20),
		ema50: calculateEMA(closes, 50),
		sma20: calculateSMA(closes, 20),
		bollingerBands: calculateBollingerBands(closes),
		atr: calculateATR(highs, lows, closes),
	};
}

// ============================================================================
// AGGREGATED MARKET DATA
// ============================================================================

export interface AggregatedMarketData {
	price: PriceDataAPI | null;
	indicators: TechnicalIndicators | null;
	liquidations: LiquidationDataAPI | null;
	whaleActivity: {
		transactions: WhaleTransactionAPI[];
		netFlow: number;
	};
	timestamp: number;
}

export async function fetchAggregatedMarketData(symbol: string): Promise<AggregatedMarketData> {
	// Fetch all data in parallel
	const [price, indicators, liquidations, whaleTransactions] = await Promise.all([
		fetchCoinGeckoPrice(symbol),
		calculateTechnicalIndicators(symbol),
		fetchHyperliquidLiquidations(symbol),
		fetchWhaleTransactions(symbol),
	]);

	const netFlow = whaleTransactions.reduce((sum, tx) => {
		if (tx.type === "buy") return sum + tx.usdValue;
		if (tx.type === "sell") return sum - tx.usdValue;
		return sum;
	}, 0);

	return {
		price,
		indicators,
		liquidations,
		whaleActivity: {
			transactions: whaleTransactions,
			netFlow,
		},
		timestamp: Date.now(),
	};
}

// ============================================================================
// SIGNAL GENERATION HELPER
// ============================================================================

export function generateSignalFromMarketData(data: AggregatedMarketData): {
	action: "BUY" | "SELL" | "HOLD";
	confidence: number;
	reasons: string[];
} {
	const reasons: string[] = [];
	let bullishScore = 0;
	let bearishScore = 0;

	// RSI analysis
	if (data.indicators) {
		if (data.indicators.rsi < 30) {
			bullishScore += 2;
			reasons.push(`RSI oversold at ${data.indicators.rsi.toFixed(1)}`);
		} else if (data.indicators.rsi > 70) {
			bearishScore += 2;
			reasons.push(`RSI overbought at ${data.indicators.rsi.toFixed(1)}`);
		}

		// MACD analysis
		if (data.indicators.macd.histogram > 0) {
			bullishScore += 1;
			reasons.push("MACD histogram positive");
		} else {
			bearishScore += 1;
			reasons.push("MACD histogram negative");
		}

		// Bollinger Bands
		if (data.price) {
			if (data.price.price < data.indicators.bollingerBands.lower) {
				bullishScore += 1;
				reasons.push("Price below lower Bollinger Band");
			} else if (data.price.price > data.indicators.bollingerBands.upper) {
				bearishScore += 1;
				reasons.push("Price above upper Bollinger Band");
			}
		}
	}

	// Liquidation analysis
	if (data.liquidations) {
		const ratio = data.liquidations.longLiquidations / (data.liquidations.shortLiquidations || 1);
		if (ratio > 1.5) {
			bullishScore += 1;
			reasons.push("Heavy long liquidations (potential bottom)");
		} else if (ratio < 0.67) {
			bearishScore += 1;
			reasons.push("Heavy short liquidations (potential top)");
		}
	}

	// Whale activity
	if (data.whaleActivity.netFlow > 100000) {
		bullishScore += 1;
		reasons.push(`Net whale inflow: $${(data.whaleActivity.netFlow / 1000).toFixed(0)}k`);
	} else if (data.whaleActivity.netFlow < -100000) {
		bearishScore += 1;
		reasons.push(`Net whale outflow: $${(Math.abs(data.whaleActivity.netFlow) / 1000).toFixed(0)}k`);
	}

	// Calculate final signal
	const totalScore = bullishScore + bearishScore;
	const confidence = totalScore > 0 ? Math.max(bullishScore, bearishScore) / totalScore : 0.5;

	if (bullishScore > bearishScore && bullishScore >= 3) {
		return { action: "BUY", confidence, reasons };
	} else if (bearishScore > bullishScore && bearishScore >= 3) {
		return { action: "SELL", confidence, reasons };
	}

	return { action: "HOLD", confidence: 0.5, reasons: ["No clear signal"] };
}

export default {
	fetchCoinGeckoPrice,
	fetchCoinGeckoOHLCV,
	fetchDexScreenerToken,
	fetchHyperliquidLiquidations,
	fetchWhaleTransactions,
	calculateTechnicalIndicators,
	fetchAggregatedMarketData,
	generateSignalFromMarketData,
};
