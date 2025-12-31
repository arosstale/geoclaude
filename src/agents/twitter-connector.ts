/**
 * TWITTER/X CONNECTOR
 *
 * Learned from Agentis Framework - Cross-platform reach
 * Enables agents to:
 * - Post tweets and threads
 * - Monitor mentions and keywords
 * - Respond to interactions
 * - Analyze sentiment and trends
 * - Cross-post from Discord to Twitter
 */

import { EventEmitter } from "events";
import type { AgentDomain } from "./agentic-properties.js";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TwitterCredentials {
	apiKey: string;
	apiSecret: string;
	accessToken: string;
	accessSecret: string;
	bearerToken?: string;
}

export interface Tweet {
	id: string;
	text: string;
	authorId: string;
	authorUsername: string;
	createdAt: Date;
	metrics?: TweetMetrics;
	replyToId?: string;
	threadId?: string;
	media?: TweetMedia[];
	entities?: TweetEntities;
}

export interface TweetMetrics {
	likes: number;
	retweets: number;
	replies: number;
	quotes: number;
	impressions?: number;
	engagementRate?: number;
}

export interface TweetMedia {
	type: "photo" | "video" | "gif";
	url: string;
	altText?: string;
}

export interface TweetEntities {
	mentions: string[];
	hashtags: string[];
	urls: string[];
	cashtags: string[];
}

export interface TwitterUser {
	id: string;
	username: string;
	displayName: string;
	bio?: string;
	followers: number;
	following: number;
	verified: boolean;
	profileImageUrl?: string;
}

export interface TwitterSearchResult {
	tweets: Tweet[];
	nextToken?: string;
	resultCount: number;
}

export interface TwitterConfig {
	credentials: TwitterCredentials;
	pollingInterval: number; // ms
	maxTweetLength: number;
	enableAutoReply: boolean;
	mentionKeywords: string[];
	blockedUsers: string[];
	rateLimitBuffer: number; // seconds to wait between API calls
}

export interface CrossPostRequest {
	content: string;
	source: "discord" | "agent" | "manual";
	sourceId?: string;
	media?: TweetMedia[];
	replyToTweetId?: string;
	schedule?: Date;
}

export interface CrossPostResult {
	success: boolean;
	tweetId?: string;
	tweetUrl?: string;
	error?: string;
}

export interface MentionAlert {
	tweet: Tweet;
	sentiment: "positive" | "negative" | "neutral";
	urgency: "low" | "medium" | "high";
	suggestedResponse?: string;
}

// ============================================================================
// TWITTER CONNECTOR
// ============================================================================

export class TwitterConnector extends EventEmitter {
	private config: TwitterConfig;
	private isConnected: boolean = false;
	private pollingTimer?: NodeJS.Timeout;
	private lastMentionId?: string;
	private rateLimitRemaining: number = 100;
	private rateLimitReset: number = 0;
	private queue: CrossPostRequest[] = [];

	constructor(config: Partial<TwitterConfig> & { credentials: TwitterCredentials }) {
		super();
		this.config = {
			pollingInterval: 60000, // 1 minute
			maxTweetLength: 280,
			enableAutoReply: false,
			mentionKeywords: [],
			blockedUsers: [],
			rateLimitBuffer: 2,
			...config,
		};
	}

	// --------------------------------------------------------------------------
	// CONNECTION MANAGEMENT
	// --------------------------------------------------------------------------

	/**
	 * Connect to Twitter API
	 */
	async connect(): Promise<boolean> {
		try {
			// Validate credentials by fetching authenticated user
			const user = await this.getAuthenticatedUser();
			if (user) {
				this.isConnected = true;
				this.emit("connected", { user });
				return true;
			}
			return false;
		} catch (error) {
			this.emit("error", { type: "connection_failed", error });
			return false;
		}
	}

	/**
	 * Disconnect from Twitter API
	 */
	disconnect(): void {
		this.stopPolling();
		this.isConnected = false;
		this.emit("disconnected");
	}

	/**
	 * Get the authenticated user
	 */
	async getAuthenticatedUser(): Promise<TwitterUser | null> {
		return this.makeRequest<TwitterUser>("/2/users/me", {
			"user.fields": "id,username,name,description,public_metrics,verified,profile_image_url",
		});
	}

	// --------------------------------------------------------------------------
	// TWEET OPERATIONS
	// --------------------------------------------------------------------------

	/**
	 * Post a tweet
	 */
	async postTweet(
		text: string,
		options?: {
			replyToId?: string;
			media?: TweetMedia[];
			quoteTweetId?: string;
		},
	): Promise<Tweet | null> {
		// Enforce character limit
		if (text.length > this.config.maxTweetLength) {
			text = `${text.slice(0, this.config.maxTweetLength - 3)}...`;
		}

		const payload: Record<string, unknown> = { text };

		if (options?.replyToId) {
			payload.reply = { in_reply_to_tweet_id: options.replyToId };
		}

		if (options?.quoteTweetId) {
			payload.quote_tweet_id = options.quoteTweetId;
		}

		// TODO: Handle media upload separately
		if (options?.media && options.media.length > 0) {
			// Media upload requires separate endpoint
			this.emit("warning", { type: "media_not_implemented" });
		}

		const result = await this.makeRequest<{ data: { id: string; text: string } }>(
			"/2/tweets",
			undefined,
			"POST",
			payload,
		);

		if (result) {
			const tweet: Tweet = {
				id: result.data.id,
				text: result.data.text,
				authorId: "self",
				authorUsername: "self",
				createdAt: new Date(),
			};
			this.emit("tweetPosted", tweet);
			return tweet;
		}

		return null;
	}

	/**
	 * Post a thread of tweets
	 */
	async postThread(tweets: string[]): Promise<Tweet[]> {
		const posted: Tweet[] = [];
		let replyToId: string | undefined;

		for (const text of tweets) {
			const tweet = await this.postTweet(text, { replyToId });
			if (tweet) {
				posted.push(tweet);
				replyToId = tweet.id;
			} else {
				this.emit("error", { type: "thread_interrupted", posted });
				break;
			}

			// Rate limit buffer
			await this.sleep(this.config.rateLimitBuffer * 1000);
		}

		if (posted.length === tweets.length) {
			this.emit("threadPosted", { tweets: posted, threadId: posted[0]?.id });
		}

		return posted;
	}

	/**
	 * Delete a tweet
	 */
	async deleteTweet(tweetId: string): Promise<boolean> {
		const result = await this.makeRequest<{ data: { deleted: boolean } }>(
			`/2/tweets/${tweetId}`,
			undefined,
			"DELETE",
		);
		return result?.data?.deleted || false;
	}

	/**
	 * Get a specific tweet
	 */
	async getTweet(tweetId: string): Promise<Tweet | null> {
		const result = await this.makeRequest<{ data: Tweet }>(`/2/tweets/${tweetId}`, {
			"tweet.fields": "id,text,author_id,created_at,public_metrics,entities,in_reply_to_user_id",
			expansions: "author_id",
			"user.fields": "username",
		});

		if (result?.data) {
			return this.normalizeTweet(result.data);
		}
		return null;
	}

	// --------------------------------------------------------------------------
	// SEARCH & MONITORING
	// --------------------------------------------------------------------------

	/**
	 * Search for tweets
	 */
	async searchTweets(query: string, maxResults: number = 10): Promise<TwitterSearchResult> {
		const result = await this.makeRequest<{
			data: Tweet[];
			meta: { next_token?: string; result_count: number };
		}>("/2/tweets/search/recent", {
			query,
			max_results: Math.min(maxResults, 100).toString(),
			"tweet.fields": "id,text,author_id,created_at,public_metrics,entities",
			expansions: "author_id",
			"user.fields": "username",
		});

		if (result?.data) {
			return {
				tweets: result.data.map((t) => this.normalizeTweet(t)),
				nextToken: result.meta?.next_token,
				resultCount: result.meta?.result_count || 0,
			};
		}

		return { tweets: [], resultCount: 0 };
	}

	/**
	 * Get mentions of the authenticated user
	 */
	async getMentions(sinceId?: string): Promise<Tweet[]> {
		const user = await this.getAuthenticatedUser();
		if (!user) return [];

		const params: Record<string, string> = {
			"tweet.fields": "id,text,author_id,created_at,public_metrics,entities,in_reply_to_user_id",
			expansions: "author_id",
			"user.fields": "username",
			max_results: "100",
		};

		if (sinceId) {
			params.since_id = sinceId;
		}

		const result = await this.makeRequest<{ data: Tweet[] }>(`/2/users/${user.id}/mentions`, params);

		if (result?.data) {
			return result.data.map((t) => this.normalizeTweet(t));
		}

		return [];
	}

	/**
	 * Start polling for mentions
	 */
	startPolling(): void {
		if (this.pollingTimer) return;

		this.pollingTimer = setInterval(async () => {
			await this.pollMentions();
		}, this.config.pollingInterval);

		this.emit("pollingStarted");
	}

	/**
	 * Stop polling for mentions
	 */
	stopPolling(): void {
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
			this.pollingTimer = undefined;
			this.emit("pollingStopped");
		}
	}

	private async pollMentions(): Promise<void> {
		const mentions = await this.getMentions(this.lastMentionId);

		if (mentions.length > 0) {
			// Update last seen ID
			this.lastMentionId = mentions[0].id;

			// Filter blocked users
			const filtered = mentions.filter((t) => !this.config.blockedUsers.includes(t.authorUsername));

			for (const mention of filtered) {
				const alert = await this.analyzeMention(mention);
				this.emit("mention", alert);

				// Auto-reply if enabled
				if (this.config.enableAutoReply && alert.suggestedResponse) {
					await this.postTweet(alert.suggestedResponse, { replyToId: mention.id });
				}
			}
		}
	}

	private async analyzeMention(tweet: Tweet): Promise<MentionAlert> {
		// Simple sentiment analysis (in production, use ML model)
		const text = tweet.text.toLowerCase();
		let sentiment: MentionAlert["sentiment"] = "neutral";
		let urgency: MentionAlert["urgency"] = "low";

		const positiveWords = ["love", "great", "awesome", "thanks", "amazing", "helpful"];
		const negativeWords = ["hate", "bad", "terrible", "awful", "broken", "bug", "issue"];
		const urgentWords = ["urgent", "help", "emergency", "asap", "critical", "immediately"];

		if (positiveWords.some((w) => text.includes(w))) sentiment = "positive";
		if (negativeWords.some((w) => text.includes(w))) sentiment = "negative";
		if (urgentWords.some((w) => text.includes(w))) urgency = "high";
		if (tweet.metrics?.impressions && tweet.metrics.impressions > 1000) {
			urgency = urgency === "low" ? "medium" : "high";
		}

		return {
			tweet,
			sentiment,
			urgency,
			suggestedResponse: undefined, // Let the agent decide
		};
	}

	// --------------------------------------------------------------------------
	// CROSS-POSTING
	// --------------------------------------------------------------------------

	/**
	 * Cross-post content from another platform
	 */
	async crossPost(request: CrossPostRequest): Promise<CrossPostResult> {
		// Handle scheduling
		if (request.schedule && request.schedule > new Date()) {
			this.queue.push(request);
			this.emit("scheduledPost", { request, position: this.queue.length });
			return { success: true, error: "scheduled" };
		}

		// Adapt content for Twitter
		const adaptedContent = this.adaptContent(request.content);

		// Check if it needs to be a thread
		if (adaptedContent.length > this.config.maxTweetLength) {
			const chunks = this.splitIntoThread(adaptedContent);
			const tweets = await this.postThread(chunks);

			if (tweets.length > 0) {
				return {
					success: true,
					tweetId: tweets[0].id,
					tweetUrl: `https://twitter.com/i/web/status/${tweets[0].id}`,
				};
			}
			return { success: false, error: "Thread posting failed" };
		}

		// Single tweet
		const tweet = await this.postTweet(adaptedContent, {
			replyToId: request.replyToTweetId,
			media: request.media,
		});

		if (tweet) {
			return {
				success: true,
				tweetId: tweet.id,
				tweetUrl: `https://twitter.com/i/web/status/${tweet.id}`,
			};
		}

		return { success: false, error: "Tweet posting failed" };
	}

	/**
	 * Adapt content for Twitter format
	 */
	private adaptContent(content: string): string {
		// Remove Discord-specific formatting
		let adapted = content
			.replace(/<@!?\d+>/g, "") // Remove Discord user mentions
			.replace(/<#\d+>/g, "") // Remove Discord channel mentions
			.replace(/<:\w+:\d+>/g, "") // Remove Discord custom emojis
			.replace(/```[\s\S]*?```/g, "[code]") // Replace code blocks
			.replace(/\*\*(.+?)\*\*/g, "$1") // Remove bold
			.replace(/__(.+?)__/g, "$1") // Remove underline
			.replace(/~~(.+?)~~/g, "$1"); // Remove strikethrough

		// Trim whitespace
		adapted = adapted.trim().replace(/\s+/g, " ");

		return adapted;
	}

	/**
	 * Split long content into thread-sized chunks
	 */
	private splitIntoThread(content: string): string[] {
		const maxLength = this.config.maxTweetLength - 10; // Reserve space for numbering
		const chunks: string[] = [];
		const words = content.split(" ");
		let current = "";

		for (const word of words) {
			if (`${current} ${word}`.trim().length <= maxLength) {
				current = `${current} ${word}`.trim();
			} else {
				if (current) chunks.push(current);
				current = word;
			}
		}
		if (current) chunks.push(current);

		// Add thread numbering
		if (chunks.length > 1) {
			return chunks.map((chunk, i) => `${i + 1}/${chunks.length} ${chunk}`);
		}

		return chunks;
	}

	// --------------------------------------------------------------------------
	// USER OPERATIONS
	// --------------------------------------------------------------------------

	/**
	 * Get user by username
	 */
	async getUser(username: string): Promise<TwitterUser | null> {
		const result = await this.makeRequest<{ data: TwitterUser }>(`/2/users/by/username/${username}`, {
			"user.fields": "id,username,name,description,public_metrics,verified,profile_image_url",
		});

		if (result?.data) {
			return this.normalizeUser(result.data);
		}
		return null;
	}

	/**
	 * Get user's recent tweets
	 */
	async getUserTweets(userId: string, maxResults: number = 10): Promise<Tweet[]> {
		const result = await this.makeRequest<{ data: Tweet[] }>(`/2/users/${userId}/tweets`, {
			max_results: Math.min(maxResults, 100).toString(),
			"tweet.fields": "id,text,author_id,created_at,public_metrics,entities",
		});

		if (result?.data) {
			return result.data.map((t) => this.normalizeTweet(t));
		}
		return [];
	}

	/**
	 * Follow a user
	 */
	async followUser(targetUserId: string): Promise<boolean> {
		const user = await this.getAuthenticatedUser();
		if (!user) return false;

		const result = await this.makeRequest<{ data: { following: boolean } }>(
			`/2/users/${user.id}/following`,
			undefined,
			"POST",
			{ target_user_id: targetUserId },
		);

		return result?.data?.following || false;
	}

	/**
	 * Unfollow a user
	 */
	async unfollowUser(targetUserId: string): Promise<boolean> {
		const user = await this.getAuthenticatedUser();
		if (!user) return false;

		const result = await this.makeRequest<{ data: { following: boolean } }>(
			`/2/users/${user.id}/following/${targetUserId}`,
			undefined,
			"DELETE",
		);

		return result?.data?.following === false;
	}

	// --------------------------------------------------------------------------
	// ANALYTICS
	// --------------------------------------------------------------------------

	/**
	 * Get engagement stats for recent tweets
	 */
	async getEngagementStats(days: number = 7): Promise<{
		totalTweets: number;
		totalLikes: number;
		totalRetweets: number;
		totalReplies: number;
		avgEngagementRate: number;
		topTweet?: Tweet;
	}> {
		const user = await this.getAuthenticatedUser();
		if (!user) {
			return {
				totalTweets: 0,
				totalLikes: 0,
				totalRetweets: 0,
				totalReplies: 0,
				avgEngagementRate: 0,
			};
		}

		const tweets = await this.getUserTweets(user.id, 100);

		// Filter to requested time range
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		const recentTweets = tweets.filter((t) => t.createdAt.getTime() > cutoff);

		let totalLikes = 0;
		let totalRetweets = 0;
		let totalReplies = 0;
		let topTweet: Tweet | undefined;
		let maxEngagement = 0;

		for (const tweet of recentTweets) {
			const metrics = tweet.metrics || { likes: 0, retweets: 0, replies: 0, quotes: 0 };
			totalLikes += metrics.likes;
			totalRetweets += metrics.retweets;
			totalReplies += metrics.replies;

			const engagement = metrics.likes + metrics.retweets * 2 + metrics.replies * 3;
			if (engagement > maxEngagement) {
				maxEngagement = engagement;
				topTweet = tweet;
			}
		}

		const avgEngagementRate =
			recentTweets.length > 0 ? (totalLikes + totalRetweets + totalReplies) / recentTweets.length : 0;

		return {
			totalTweets: recentTweets.length,
			totalLikes,
			totalRetweets,
			totalReplies,
			avgEngagementRate,
			topTweet,
		};
	}

	// --------------------------------------------------------------------------
	// INTERNAL HELPERS
	// --------------------------------------------------------------------------

	private async makeRequest<T>(
		endpoint: string,
		params?: Record<string, string>,
		method: "GET" | "POST" | "DELETE" = "GET",
		body?: unknown,
	): Promise<T | null> {
		// Check rate limits
		if (this.rateLimitRemaining <= 1 && Date.now() < this.rateLimitReset) {
			const waitTime = this.rateLimitReset - Date.now();
			this.emit("rateLimited", { waitTime });
			await this.sleep(waitTime);
		}

		try {
			const url = new URL(`https://api.twitter.com${endpoint}`);
			if (params) {
				for (const [key, value] of Object.entries(params)) {
					url.searchParams.set(key, value);
				}
			}

			const headers: Record<string, string> = {
				Authorization: `Bearer ${this.config.credentials.bearerToken || this.config.credentials.accessToken}`,
				"Content-Type": "application/json",
			};

			const options: RequestInit = {
				method,
				headers,
			};

			if (body) {
				options.body = JSON.stringify(body);
			}

			const response = await fetch(url.toString(), options);

			// Update rate limit tracking
			const remaining = response.headers.get("x-rate-limit-remaining");
			const reset = response.headers.get("x-rate-limit-reset");
			if (remaining) this.rateLimitRemaining = parseInt(remaining, 10);
			if (reset) this.rateLimitReset = parseInt(reset, 10) * 1000;

			if (!response.ok) {
				const error = await response.text();
				this.emit("apiError", { status: response.status, error });
				return null;
			}

			return await response.json();
		} catch (error) {
			this.emit("error", { type: "request_failed", error });
			return null;
		}
	}

	private normalizeTweet(raw: unknown): Tweet {
		const t = raw as Record<string, unknown>;
		return {
			id: t.id as string,
			text: t.text as string,
			authorId: t.author_id as string,
			authorUsername: ((t as Record<string, unknown>).username as string) || "unknown",
			createdAt: new Date(t.created_at as string),
			metrics: t.public_metrics as TweetMetrics,
			replyToId: t.in_reply_to_user_id as string | undefined,
			entities: t.entities as TweetEntities | undefined,
		};
	}

	private normalizeUser(raw: unknown): TwitterUser {
		const u = raw as Record<string, unknown>;
		const metrics = (u.public_metrics as Record<string, number>) || {};
		return {
			id: u.id as string,
			username: u.username as string,
			displayName: u.name as string,
			bio: u.description as string | undefined,
			followers: metrics.followers_count || 0,
			following: metrics.following_count || 0,
			verified: (u.verified as boolean) || false,
			profileImageUrl: u.profile_image_url as string | undefined,
		};
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// --------------------------------------------------------------------------
	// STATUS & UTILITIES
	// --------------------------------------------------------------------------

	/**
	 * Check if connected to Twitter
	 */
	isActive(): boolean {
		return this.isConnected;
	}

	/**
	 * Get connection status
	 */
	getStatus(): {
		connected: boolean;
		polling: boolean;
		rateLimitRemaining: number;
		queuedPosts: number;
	} {
		return {
			connected: this.isConnected,
			polling: !!this.pollingTimer,
			rateLimitRemaining: this.rateLimitRemaining,
			queuedPosts: this.queue.length,
		};
	}
}

// ============================================================================
// AGENT INTEGRATION
// ============================================================================

export interface TwitterAgentConfig {
	credentials: TwitterCredentials;
	domain?: AgentDomain;
	autoPost?: boolean;
	postFrequency?: number; // Max posts per hour
	contentFilter?: (content: string) => boolean;
}

/**
 * Create a Twitter-integrated agent connector
 */
export function createTwitterAgent(config: TwitterAgentConfig): {
	connector: TwitterConnector;
	postIfRelevant: (content: string, source: string) => Promise<CrossPostResult | null>;
	respondToMention: (tweet: Tweet, response: string) => Promise<Tweet | null>;
} {
	const connector = new TwitterConnector({
		credentials: config.credentials,
		enableAutoReply: false,
	});

	let postsThisHour = 0;
	const maxPostsPerHour = config.postFrequency || 10;

	// Reset counter every hour
	setInterval(
		() => {
			postsThisHour = 0;
		},
		60 * 60 * 1000,
	);

	return {
		connector,

		async postIfRelevant(content: string, source: string): Promise<CrossPostResult | null> {
			// Check rate limit
			if (postsThisHour >= maxPostsPerHour) {
				return { success: false, error: "Rate limit reached" };
			}

			// Apply content filter
			if (config.contentFilter && !config.contentFilter(content)) {
				return null; // Content not relevant
			}

			if (!config.autoPost) {
				return null; // Auto-post disabled
			}

			const result = await connector.crossPost({
				content,
				source: source as "discord" | "agent",
			});

			if (result.success) {
				postsThisHour++;
			}

			return result;
		},

		async respondToMention(tweet: Tweet, response: string): Promise<Tweet | null> {
			// Check rate limit
			if (postsThisHour >= maxPostsPerHour) {
				return null;
			}

			const result = await connector.postTweet(`@${tweet.authorUsername} ${response}`, { replyToId: tweet.id });

			if (result) {
				postsThisHour++;
			}

			return result;
		},
	};
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

let globalConnector: TwitterConnector | null = null;

/**
 * Get or create the global Twitter connector
 */
export function getTwitterConnector(credentials?: TwitterCredentials): TwitterConnector | null {
	if (!globalConnector && credentials) {
		globalConnector = new TwitterConnector({ credentials });
	}
	return globalConnector;
}

/**
 * Create a new Twitter connector
 */
export function createTwitterConnector(
	config: Partial<TwitterConfig> & { credentials: TwitterCredentials },
): TwitterConnector {
	return new TwitterConnector(config);
}

export default TwitterConnector;
