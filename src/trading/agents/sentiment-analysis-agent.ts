/**
 * Sentiment Analysis Agent
 * Analyzes social media, news, and market sentiment for trading signals
 *
 * Data Sources:
 * - Twitter/X API (crypto influencer sentiment)
 * - Reddit API (r/cryptocurrency, r/bitcoin sentiment)
 * - CryptoPanic API (news sentiment)
 * - Fear & Greed Index
 * - LunarCrush social metrics
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, TradingAction } from "../types.js";

// ============================================================================
// Types
// ============================================================================

interface SentimentScore {
	source: string;
	symbol: string;
	score: number; // -1 to 1 (bearish to bullish)
	confidence: number; // 0 to 1
	sampleSize: number;
	timestamp: number;
	keywords: string[];
}

interface SocialMetrics {
	symbol: string;
	mentions: number;
	mentionsChange24h: number;
	sentiment: number;
	socialVolume: number;
	socialVolumeChange24h: number;
	influencerMentions: number;
	topInfluencers: string[];
}

interface NewsItem {
	title: string;
	source: string;
	url: string;
	sentiment: "positive" | "negative" | "neutral";
	symbols: string[];
	publishedAt: number;
	votes: { positive: number; negative: number };
}

/** CryptoPanic API news item */
interface CryptoPanicNewsItem {
	title: string;
	source?: { title?: string };
	url: string;
	currencies?: Array<{ code: string }>;
	published_at: string;
	votes?: { positive?: number; negative?: number };
}

/** LunarCrush API coin data */
interface LunarCrushCoin {
	symbol: string;
	social_mentions?: number;
	social_mentions_change_24h?: number;
	average_sentiment?: number;
	social_volume?: number;
	social_volume_change_24h?: number;
	influencer_mentions?: number;
}

interface FearGreedData {
	value: number; // 0-100
	classification: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";
	timestamp: number;
}

interface SentimentAnalysisConfig extends AgentConfig {
	minConfidence: number;
	minSampleSize: number;
	fearGreedThresholds: { buy: number; sell: number };
	sentimentThresholds: { bullish: number; bearish: number };
}

// ============================================================================
// Sentiment Analysis Agent
// ============================================================================

export class SentimentAnalysisAgent extends BaseAgent {
	private sentimentHistory: Map<string, SentimentScore[]> = new Map();
	private newsCache: NewsItem[] = [];
	private fearGreedHistory: FearGreedData[] = [];
	private readonly MAX_HISTORY = 100;

	constructor(config: Partial<SentimentAnalysisConfig> = {}) {
		super({
			name: "SentimentAnalysisAgent",
			enabled: true,
			interval: 300000, // 5 minutes
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {},
			minConfidence: 0.6,
			minSampleSize: 50,
			fearGreedThresholds: { buy: 25, sell: 75 }, // Buy in fear, sell in greed
			sentimentThresholds: { bullish: 0.3, bearish: -0.3 },
			...config,
		});
	}

	protected async run(): Promise<void> {
		try {
			const cfg = this.config as SentimentAnalysisConfig;

			// Gather sentiment from all sources
			const [fearGreed, newsSentiment, socialSentiment] = await Promise.all([
				this.fetchFearGreedIndex(),
				this.fetchNewsSentiment(),
				this.fetchSocialSentiment(),
			]);

			// Analyze each symbol
			for (const symbol of this.config.symbols as string[]) {
				const aggregatedSentiment = this.aggregateSentiment(symbol, fearGreed, newsSentiment, socialSentiment);

				if (aggregatedSentiment.confidence >= cfg.minConfidence) {
					await this.generateSignal(symbol, aggregatedSentiment, fearGreed);
				}
			}
		} catch (error) {
			console.error("[SentimentAnalysisAgent] Run error:", error);
		}
	}

	// ============================================================================
	// Data Fetching
	// ============================================================================

	private async fetchFearGreedIndex(): Promise<FearGreedData | null> {
		try {
			const response = await fetch("https://api.alternative.me/fng/?limit=1");
			if (!response.ok) return null;

			const data = await response.json();
			if (!data.data?.[0]) return null;

			const item = data.data[0];
			const fearGreed: FearGreedData = {
				value: parseInt(item.value, 10),
				classification: item.value_classification,
				timestamp: parseInt(item.timestamp, 10) * 1000,
			};

			this.fearGreedHistory.push(fearGreed);
			if (this.fearGreedHistory.length > this.MAX_HISTORY) {
				this.fearGreedHistory.shift();
			}

			return fearGreed;
		} catch {
			return null;
		}
	}

	private async fetchNewsSentiment(): Promise<NewsItem[]> {
		try {
			// CryptoPanic API (free tier available)
			const apiKey = process.env.CRYPTOPANIC_API_KEY;
			const url = apiKey
				? `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&public=true&kind=news`
				: "https://cryptopanic.com/api/v1/posts/?public=true&kind=news";

			const response = await fetch(url);
			if (!response.ok) return [];

			const data = await response.json();
			if (!data.results) return [];

			const newsItems = data.results as CryptoPanicNewsItem[];
			const news: NewsItem[] = newsItems.slice(0, 20).map((item) => ({
				title: item.title,
				source: item.source?.title || "Unknown",
				url: item.url,
				sentiment: this.analyzeTitleSentiment(item.title),
				symbols: item.currencies?.map((c) => c.code) || [],
				publishedAt: new Date(item.published_at).getTime(),
				votes: {
					positive: item.votes?.positive || 0,
					negative: item.votes?.negative || 0,
				},
			}));

			this.newsCache = news;
			return news;
		} catch {
			return [];
		}
	}

	private async fetchSocialSentiment(): Promise<SocialMetrics[]> {
		const metrics: SocialMetrics[] = [];

		// Try multiple sources
		try {
			// LunarCrush (if API key available)
			const lunarMetrics = await this.fetchLunarCrush();
			metrics.push(...lunarMetrics);
		} catch {
			// Silent fail
		}

		try {
			// Twitter sentiment via free proxies
			const twitterMetrics = await this.fetchTwitterSentiment();
			metrics.push(...twitterMetrics);
		} catch {
			// Silent fail
		}

		return metrics;
	}

	private async fetchLunarCrush(): Promise<SocialMetrics[]> {
		const apiKey = process.env.LUNARCRUSH_API_KEY;
		if (!apiKey) return [];

		try {
			const symbols = (this.config.symbols as string[]).join(",");
			const response = await fetch(`https://lunarcrush.com/api3/coins/list?symbols=${symbols}`, {
				headers: { Authorization: `Bearer ${apiKey}` },
			});

			if (!response.ok) return [];

			const data = await response.json();
			if (!data.data) return [];

			const coins = data.data as LunarCrushCoin[];
			return coins.map((coin) => ({
				symbol: coin.symbol,
				mentions: coin.social_mentions || 0,
				mentionsChange24h: coin.social_mentions_change_24h || 0,
				sentiment: coin.average_sentiment || 0,
				socialVolume: coin.social_volume || 0,
				socialVolumeChange24h: coin.social_volume_change_24h || 0,
				influencerMentions: coin.influencer_mentions || 0,
				topInfluencers: [],
			}));
		} catch {
			return [];
		}
	}

	private async fetchTwitterSentiment(): Promise<SocialMetrics[]> {
		// Use Twitter API if available
		const bearerToken = process.env.TWITTER_BEARER_TOKEN;
		if (!bearerToken) {
			// Fallback: estimate from other sources
			return [];
		}

		const metrics: SocialMetrics[] = [];

		for (const symbol of this.config.symbols as string[]) {
			try {
				// Recent tweets about the symbol
				const query = encodeURIComponent(`$${symbol} OR #${symbol} crypto`);
				const response = await fetch(
					`https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=100&tweet.fields=public_metrics,created_at`,
					{
						headers: { Authorization: `Bearer ${bearerToken}` },
					},
				);

				if (!response.ok) continue;

				const data = await response.json();
				if (!data.data) continue;

				// Analyze sentiment of tweets
				let totalSentiment = 0;
				let engagementWeightedSentiment = 0;
				let totalEngagement = 0;

				for (const tweet of data.data) {
					const sentiment = this.analyzeTextSentiment(tweet.text);
					const engagement =
						(tweet.public_metrics?.like_count || 0) + (tweet.public_metrics?.retweet_count || 0) * 2;

					totalSentiment += sentiment;
					engagementWeightedSentiment += sentiment * engagement;
					totalEngagement += engagement;
				}

				metrics.push({
					symbol,
					mentions: data.data.length,
					mentionsChange24h: 0, // Would need historical data
					sentiment:
						totalEngagement > 0
							? engagementWeightedSentiment / totalEngagement
							: totalSentiment / data.data.length,
					socialVolume: totalEngagement,
					socialVolumeChange24h: 0,
					influencerMentions: 0,
					topInfluencers: [],
				});
			} catch {}
		}

		return metrics;
	}

	// ============================================================================
	// Sentiment Analysis
	// ============================================================================

	private analyzeTitleSentiment(title: string): "positive" | "negative" | "neutral" {
		const score = this.analyzeTextSentiment(title);
		if (score > 0.2) return "positive";
		if (score < -0.2) return "negative";
		return "neutral";
	}

	private analyzeTextSentiment(text: string): number {
		const lower = text.toLowerCase();

		// Bullish keywords (positive score)
		const bullishKeywords = [
			"bullish",
			"moon",
			"pump",
			"rally",
			"surge",
			"breakout",
			"ath",
			"all-time high",
			"buy",
			"long",
			"accumulate",
			"undervalued",
			"growth",
			"adoption",
			"partnership",
			"upgrade",
			"launch",
			"innovation",
			"institutional",
			"whale",
			"diamond hands",
			"hodl",
			"fomo",
			"green",
			"profit",
			"gains",
		];

		// Bearish keywords (negative score)
		const bearishKeywords = [
			"bearish",
			"crash",
			"dump",
			"plunge",
			"drop",
			"fall",
			"sell",
			"short",
			"overvalued",
			"bubble",
			"scam",
			"rug",
			"hack",
			"exploit",
			"ban",
			"regulation",
			"lawsuit",
			"sec",
			"fear",
			"panic",
			"red",
			"loss",
			"liquidation",
			"rekt",
			"dead",
			"ponzi",
		];

		let score = 0;
		let matches = 0;

		for (const keyword of bullishKeywords) {
			if (lower.includes(keyword)) {
				score += 0.15;
				matches++;
			}
		}

		for (const keyword of bearishKeywords) {
			if (lower.includes(keyword)) {
				score -= 0.15;
				matches++;
			}
		}

		// Normalize
		return matches > 0 ? Math.max(-1, Math.min(1, score)) : 0;
	}

	private aggregateSentiment(
		symbol: string,
		fearGreed: FearGreedData | null,
		news: NewsItem[],
		social: SocialMetrics[],
	): SentimentScore {
		const scores: number[] = [];
		const weights: number[] = [];
		const keywords: string[] = [];

		// Fear & Greed Index (global sentiment)
		if (fearGreed) {
			// Normalize 0-100 to -1 to 1
			const fgScore = (fearGreed.value - 50) / 50;
			scores.push(fgScore);
			weights.push(0.3); // 30% weight
			keywords.push(`FearGreed:${fearGreed.value}`);
		}

		// News sentiment for this symbol
		const symbolNews = news.filter((n) => n.symbols.includes(symbol) || n.symbols.length === 0);
		if (symbolNews.length > 0) {
			let newsScore = 0;
			for (const item of symbolNews) {
				if (item.sentiment === "positive") newsScore += 0.3;
				else if (item.sentiment === "negative") newsScore -= 0.3;
			}
			newsScore = Math.max(-1, Math.min(1, newsScore / symbolNews.length));
			scores.push(newsScore);
			weights.push(0.35); // 35% weight
			keywords.push(`News:${symbolNews.length}articles`);
		}

		// Social sentiment
		const symbolSocial = social.find((s) => s.symbol === symbol);
		if (symbolSocial) {
			scores.push(symbolSocial.sentiment);
			weights.push(0.35); // 35% weight
			keywords.push(`Social:${symbolSocial.mentions}mentions`);
		}

		// Calculate weighted average
		let weightedSum = 0;
		let totalWeight = 0;
		for (let i = 0; i < scores.length; i++) {
			weightedSum += scores[i] * weights[i];
			totalWeight += weights[i];
		}

		const aggregatedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
		const confidence = Math.min(totalWeight, 1);

		const sentimentScore: SentimentScore = {
			source: "aggregated",
			symbol,
			score: aggregatedScore,
			confidence,
			sampleSize: symbolNews.length + (symbolSocial?.mentions || 0),
			timestamp: Date.now(),
			keywords,
		};

		// Store in history
		if (!this.sentimentHistory.has(symbol)) {
			this.sentimentHistory.set(symbol, []);
		}
		const history = this.sentimentHistory.get(symbol)!;
		history.push(sentimentScore);
		if (history.length > this.MAX_HISTORY) {
			history.shift();
		}

		return sentimentScore;
	}

	private async generateSignal(
		symbol: string,
		sentiment: SentimentScore,
		fearGreed: FearGreedData | null,
	): Promise<void> {
		const cfg = this.config as SentimentAnalysisConfig;

		let action: TradingAction | null = null;
		let reason = "";

		// Fear & Greed based signals (contrarian)
		if (fearGreed) {
			if (fearGreed.value <= cfg.fearGreedThresholds.buy) {
				action = "BUY";
				reason = `Extreme Fear (${fearGreed.value}) - contrarian buy signal`;
			} else if (fearGreed.value >= cfg.fearGreedThresholds.sell) {
				action = "SELL";
				reason = `Extreme Greed (${fearGreed.value}) - contrarian sell signal`;
			}
		}

		// Sentiment based signals
		if (!action) {
			if (sentiment.score >= cfg.sentimentThresholds.bullish) {
				action = "BUY";
				reason = `Bullish sentiment (${(sentiment.score * 100).toFixed(0)}%) - ${sentiment.keywords.join(", ")}`;
			} else if (sentiment.score <= cfg.sentimentThresholds.bearish) {
				action = "SELL";
				reason = `Bearish sentiment (${(sentiment.score * 100).toFixed(0)}%) - ${sentiment.keywords.join(", ")}`;
			}
		}

		if (action) {
			await this.emitSignal({
				symbol,
				action,
				confidence: sentiment.confidence,
				price: 0, // Will be filled by orchestrator
				reason,
				source: this.name,
				timestamp: Date.now(),
				metadata: {
					sentimentScore: sentiment.score,
					fearGreedValue: fearGreed?.value,
					sampleSize: sentiment.sampleSize,
					keywords: sentiment.keywords,
				},
			});
		}
	}

	// ============================================================================
	// Public API
	// ============================================================================

	getCurrentSentiment(symbol: string): SentimentScore | null {
		const history = this.sentimentHistory.get(symbol);
		return history?.[history.length - 1] || null;
	}

	getSentimentHistory(symbol: string, limit = 20): SentimentScore[] {
		const history = this.sentimentHistory.get(symbol) || [];
		return history.slice(-limit);
	}

	getFearGreedHistory(limit = 20): FearGreedData[] {
		return this.fearGreedHistory.slice(-limit);
	}

	getLatestNews(limit = 10): NewsItem[] {
		return this.newsCache.slice(0, limit);
	}

	getStats(): {
		trackedSymbols: number;
		totalSentimentReadings: number;
		avgSentiment: number;
		latestFearGreed: number | null;
		newsArticles: number;
	} {
		let totalReadings = 0;
		let totalSentiment = 0;

		for (const [_, history] of this.sentimentHistory) {
			totalReadings += history.length;
			for (const reading of history) {
				totalSentiment += reading.score;
			}
		}

		return {
			trackedSymbols: this.sentimentHistory.size,
			totalSentimentReadings: totalReadings,
			avgSentiment: totalReadings > 0 ? totalSentiment / totalReadings : 0,
			latestFearGreed:
				this.fearGreedHistory.length > 0 ? this.fearGreedHistory[this.fearGreedHistory.length - 1].value : null,
			newsArticles: this.newsCache.length,
		};
	}

	getFormattedStats(): string {
		const stats = this.getStats();
		const latestFG = this.fearGreedHistory[this.fearGreedHistory.length - 1];

		const lines = [
			`**📊 Sentiment Analysis Stats**`,
			``,
			`**Market Sentiment**`,
			`Fear & Greed: ${latestFG ? `${latestFG.value} (${latestFG.classification})` : "N/A"}`,
			`Avg Sentiment: ${(stats.avgSentiment * 100).toFixed(1)}%`,
			``,
			`**Data Sources**`,
			`Tracked Symbols: ${stats.trackedSymbols}`,
			`Sentiment Readings: ${stats.totalSentimentReadings}`,
			`News Articles: ${stats.newsArticles}`,
			``,
			`**Per-Symbol Sentiment**`,
		];

		for (const symbol of this.config.symbols as string[]) {
			const current = this.getCurrentSentiment(symbol);
			if (current) {
				const emoji = current.score > 0.2 ? "🟢" : current.score < -0.2 ? "🔴" : "🟡";
				lines.push(`${emoji} ${symbol}: ${(current.score * 100).toFixed(0)}% (${current.keywords.join(", ")})`);
			}
		}

		return lines.join("\n");
	}
}

// ============================================================================
// Export
// ============================================================================

export type { SentimentScore, SocialMetrics, NewsItem, FearGreedData, SentimentAnalysisConfig };
