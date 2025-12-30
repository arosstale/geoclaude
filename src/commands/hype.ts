/**
 * Hype Command
 *
 * SRP: Only handles hype bot integration
 * Inspired by Replicate's Hype project - aggregates trending ML/AI content
 */

import { EmbedBuilder, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import { defineCommand } from "./registry.js";

// Topic to subreddit mapping
const TOPIC_SUBREDDITS: Record<string, string[]> = {
	ai: ["artificial", "MachineLearning", "LocalLLaMA", "singularity"],
	ml: ["MachineLearning", "LocalLLaMA", "deeplearning", "learnmachinelearning"],
	crypto: ["cryptocurrency", "defi", "Bitcoin", "ethereum", "solana"],
	solana: ["solana", "solanadefi", "SolanaNFT"],
	trading: ["algotrading", "quantfinance", "wallstreetbets", "daytrading"],
	security: ["netsec", "cybersecurity", "hacking", "AskNetsec"],
	gaming: ["gamedev", "Unity3D", "unrealengine", "godot", "indiegames"],
	python: ["Python", "learnpython", "madeinpython"],
	rust: ["rust", "rustgamedev", "rustjerk"],
	web3: ["web3", "ethereum", "NFT", "defi"],
	stable: ["StableDiffusion", "sdforall", "ComfyUI"],
	llm: ["LocalLLaMA", "ChatGPT", "ollama", "ClaudeAI"],
};

// Source icons
const SOURCE_ICONS: Record<string, string> = {
	GitHub: "🐙",
	Reddit: "🔴",
	HuggingFace: "🤗",
	Replicate: "🔄",
};

export const hypeCommand = defineCommand({
	name: "hype",
	category: "utilities",

	definition: new SlashCommandBuilder()
		.setName("hype")
		.setDescription("Get trending AI/ML content from GitHub, Reddit, HuggingFace")
		.addStringOption((option: SlashCommandStringOption) =>
			option
				.setName("topic")
				.setDescription("Topic: ai, ml, crypto, solana, trading, security, gaming, llm, stable")
				.setRequired(false)
		)
		.addStringOption((option: SlashCommandStringOption) =>
			option
				.setName("limit")
				.setDescription("Number of results (default: 10, max: 25)")
				.setRequired(false)
		)
		.addStringOption((option: SlashCommandStringOption) =>
			option
				.setName("source")
				.setDescription("Source to search (default: all)")
				.addChoices(
					{ name: "All", value: "all" },
					{ name: "GitHub", value: "github" },
					{ name: "Reddit", value: "reddit" },
					{ name: "HuggingFace", value: "huggingface" }
				)
				.setRequired(false)
		),

	execute: async (interaction, _context) => {
		await interaction.deferReply();

		const topic = interaction.options.getString("topic") || "ai";
		const limit = Math.min(parseInt(interaction.options.getString("limit") || "10"), 25);
		const source = interaction.options.getString("source") || "all";

		try {
			const posts = await fetchTrendingPosts(topic, source, limit);

			if (posts.length === 0) {
				await interaction.editReply({
					content: `No trending posts found for **${topic}**. Try: ai, ml, crypto, solana, trading, security, gaming, llm, stable`,
				});
				return;
			}

			// Create main embed
			const embed = new EmbedBuilder()
				.setTitle(`🔥 Trending: ${topic.toUpperCase()}`)
				.setDescription(`Top ${posts.length} from ${source === "all" ? "all sources" : source}`)
				.setColor(0xff6b35)
				.setTimestamp();

			// Add top posts
			const displayPosts = posts.slice(0, 10);
			for (let i = 0; i < displayPosts.length; i++) {
				const post = displayPosts[i];
				const icon = SOURCE_ICONS[post.source] || "📄";
				const pointsStr = formatPoints(post.points);
				embed.addFields({
					name: `${i + 1}. ${truncate(post.title, 45)}`,
					value: `${icon} [${post.source}](${post.url}) • ${pointsStr}`,
					inline: false,
				});
			}

			// Footer with source breakdown
			const sources = [...new Set(posts.map((p) => p.source))];
			embed.setFooter({
				text: `Sources: ${sources.join(", ")} | Topics: ${Object.keys(TOPIC_SUBREDDITS).join(", ")}`,
			});

			await interaction.editReply({ embeds: [embed] });
		} catch (error) {
			console.error("Hype command error:", error);
			await interaction.editReply({
				content: `Error fetching trending posts: ${error instanceof Error ? error.message : "Unknown error"}`,
			});
		}
	},
});

interface TrendingPost {
	title: string;
	url: string;
	points: number;
	source: string;
}

async function fetchTrendingPosts(topic: string, source: string, limit: number): Promise<TrendingPost[]> {
	const posts: TrendingPost[] = [];
	const topicLower = topic.toLowerCase();

	// Parallel fetch from all sources
	const fetchers: Promise<void>[] = [];

	if (source === "all" || source === "github") {
		fetchers.push(fetchGitHub(topicLower, limit, posts));
	}

	if (source === "all" || source === "reddit") {
		fetchers.push(fetchReddit(topicLower, limit, posts));
	}

	if (source === "all" || source === "huggingface") {
		fetchers.push(fetchHuggingFace(topicLower, limit, posts));
	}

	await Promise.allSettled(fetchers);

	// Sort by points and return
	return posts.sort((a, b) => b.points - a.points).slice(0, limit);
}

async function fetchGitHub(topic: string, limit: number, posts: TrendingPost[]): Promise<void> {
	try {
		// Build query based on topic
		const query = getGitHubQuery(topic);
		const response = await fetch(
			`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${Math.min(limit, 30)}`,
			{ headers: { "User-Agent": "pi-discord-hype" } }
		);

		if (response.ok) {
			const data = (await response.json()) as any;
			for (const repo of data.items?.slice(0, limit) || []) {
				posts.push({
					title: `${repo.full_name}${repo.description ? `: ${truncate(repo.description, 40)}` : ""}`,
					url: repo.html_url,
					points: repo.stargazers_count || 0,
					source: "GitHub",
				});
			}
		}
	} catch (e) {
		console.error("GitHub fetch error:", e);
	}
}

async function fetchReddit(topic: string, limit: number, posts: TrendingPost[]): Promise<void> {
	const subreddits = TOPIC_SUBREDDITS[topic] || [topic];
	const perSub = Math.ceil(limit / subreddits.length);

	for (const subreddit of subreddits.slice(0, 3)) {
		// Limit to 3 subs
		try {
			const response = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${perSub}`, {
				headers: { "User-Agent": "pi-discord-hype" },
			});

			if (response.ok) {
				const data = (await response.json()) as any;
				for (const post of data.data?.children?.slice(0, perSub) || []) {
					posts.push({
						title: post.data.title,
						url: `https://reddit.com${post.data.permalink}`,
						points: post.data.score || 0,
						source: "Reddit",
					});
				}
			}
		} catch (e) {
			console.error(`Reddit r/${subreddit} fetch error:`, e);
		}
	}
}

async function fetchHuggingFace(topic: string, limit: number, posts: TrendingPost[]): Promise<void> {
	try {
		// Build search query for HF
		const searchQuery = getHuggingFaceQuery(topic);
		const response = await fetch(
			`https://huggingface.co/api/models?search=${encodeURIComponent(searchQuery)}&sort=likes&direction=-1&limit=${Math.min(limit, 20)}`,
			{ headers: { "User-Agent": "pi-discord-hype" } }
		);

		if (response.ok) {
			const models = (await response.json()) as any[];
			for (const model of models.slice(0, limit)) {
				if (model.likes < 1) continue;
				posts.push({
					title: `${model.id}${model.pipeline_tag ? ` (${model.pipeline_tag})` : ""}`,
					url: `https://huggingface.co/${model.id}`,
					points: model.likes || 0,
					source: "HuggingFace",
				});
			}
		}
	} catch (e) {
		console.error("HuggingFace fetch error:", e);
	}
}

function getGitHubQuery(topic: string): string {
	const queries: Record<string, string> = {
		ai: "artificial intelligence machine learning",
		ml: "machine learning deep learning",
		llm: "llm language model transformer",
		stable: "stable diffusion image generation",
		crypto: "cryptocurrency blockchain",
		solana: "solana blockchain",
		trading: "trading bot algo quantitative",
		security: "security pentesting",
		gaming: "game engine unity unreal godot",
		python: "language:python",
		rust: "language:rust",
		web3: "web3 ethereum",
	};
	return queries[topic] || topic;
}

function getHuggingFaceQuery(topic: string): string {
	const queries: Record<string, string> = {
		ai: "transformer",
		ml: "pytorch",
		llm: "llama mistral",
		stable: "diffusion",
		crypto: "crypto",
		trading: "finance",
		python: "python",
	};
	return queries[topic] || topic;
}

function formatPoints(points: number): string {
	if (points >= 1000000) return `${(points / 1000000).toFixed(1)}M`;
	if (points >= 1000) return `${(points / 1000).toFixed(1)}K`;
	return `${points}`;
}

function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return str.substring(0, maxLength - 3) + "...";
}
