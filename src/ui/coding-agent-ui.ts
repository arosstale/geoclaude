/**
 * AI Coding Agent UI - Main Integration
 *
 * Integrates button collectors and session management into the Discord bot
 * for interactive AI-assisted coding. Uses native discord.js components.
 * Reacord (React for Discord) is available as optional dependency.
 */

import {
	Client,
	Message,
	TextChannel,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	StringSelectMenuBuilder,
} from "discord.js";
import {
	getCodingSessionDB,
	type CodingSessionDB,
	type SessionCreateInput,
	type SuggestionCreateInput,
} from "./coding-session-db.js";
import {
	setupButtonCollectors,
	createCodeReviewButtons,
	createSessionControlButtons,
	createModelSelector,
	createQuickActionButtons,
	createGitHubButtons,
	createDiffButtons,
	createCodeSuggestionEmbed,
	createSessionEmbed,
	createStreamingEmbed,
	createEditCodeModal,
	type InteractionHandlers,
	type ButtonHandlerContext,
	type SelectHandlerContext,
	type ModalHandlerContext,
} from "./button-collectors.js";
import { AVAILABLE_MODELS, type CodeSuggestion, type CodingSession } from "./reacord-components.js";

// ============================================================================
// Types
// ============================================================================

export interface CodingAgentConfig {
	defaultModel?: string;
	enableGitHub?: boolean;
	enableSandbox?: boolean;
	maxContextItems?: number;
	streamingUpdateInterval?: number;
}

export interface StreamingOptions {
	onChunk?: (chunk: string, fullContent: string) => void;
	onComplete?: (fullContent: string) => void;
	onError?: (error: Error) => void;
	updateIntervalMs?: number;
}

export interface CodeExecutionResult {
	success: boolean;
	output?: string;
	error?: string;
	exitCode?: number;
}

export interface GitHubCommitResult {
	success: boolean;
	commitSha?: string;
	commitUrl?: string;
	error?: string;
}

export interface GitHubPRResult {
	success: boolean;
	prNumber?: number;
	prUrl?: string;
	error?: string;
}

// ============================================================================
// Callbacks Interface
// ============================================================================

export interface CodingAgentCallbacks {
	/**
	 * Called when code should be executed in a sandbox
	 */
	executeCode?: (code: string, language: string) => Promise<CodeExecutionResult>;

	/**
	 * Called when code should be committed to GitHub
	 */
	commitToGitHub?: (
		code: string,
		filePath: string,
		message: string,
		description?: string,
	) => Promise<GitHubCommitResult>;

	/**
	 * Called when a PR should be created
	 */
	createPullRequest?: (
		title: string,
		body: string,
		branch: string,
		files: Array<{ path: string; content: string }>,
	) => Promise<GitHubPRResult>;

	/**
	 * Called when a new branch should be created
	 */
	createBranch?: (name: string) => Promise<{ success: boolean; error?: string }>;

	/**
	 * Called to generate AI response for quick actions
	 */
	generateAIResponse?: (
		prompt: string,
		context: string[],
		model: string,
		onStream?: (chunk: string) => void,
	) => Promise<string>;
}

// ============================================================================
// CodingAgentUI Class
// ============================================================================

export class CodingAgentUI {
	private client: Client;
	private reacord: unknown | null = null; // Optional Reacord instance
	private db: CodingSessionDB;
	private config: Required<CodingAgentConfig>;
	private callbacks: CodingAgentCallbacks;
	private streamingMessages: Map<string, { message: Message; lastUpdate: number }> = new Map();

	constructor(client: Client, callbacks: CodingAgentCallbacks = {}, config: CodingAgentConfig = {}) {
		this.client = client;
		// Try to load Reacord if available (optional dependency)
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { Reacord } = require("reacord");
			this.reacord = new Reacord(client);
		} catch {
			// Reacord not installed - use native discord.js components only
			this.reacord = null;
		}
		this.db = getCodingSessionDB();
		this.callbacks = callbacks;
		this.config = {
			defaultModel: config.defaultModel || "gpt-4o",
			enableGitHub: config.enableGitHub ?? true,
			enableSandbox: config.enableSandbox ?? true,
			maxContextItems: config.maxContextItems || 10,
			streamingUpdateInterval: config.streamingUpdateInterval || 1000,
		};

		this.setupButtonHandlers();
	}

	// -------------------------------------------------------------------------
	// Setup
	// -------------------------------------------------------------------------

	private setupButtonHandlers(): void {
		const handlers: InteractionHandlers = {
			onAcceptCode: async (ctx) => {
				await ctx.interaction.deferUpdate();
				const suggestion = ctx.suggestionId ? this.db.getSuggestion(ctx.suggestionId) : null;
				if (!suggestion) {
					await ctx.interaction.followUp({ content: "Suggestion not found.", ephemeral: true });
					return;
				}

				this.db.updateSuggestionStatus(suggestion.id, "accepted");

				// If GitHub is enabled and we have a callback, commit the code
				if (this.config.enableGitHub && this.callbacks.commitToGitHub && suggestion.filePath) {
					const result = await this.callbacks.commitToGitHub(
						suggestion.code,
						suggestion.filePath,
						`Add ${suggestion.filePath}`,
					);

					if (result.success) {
						await ctx.interaction.editReply({
							embeds: [
								createCodeSuggestionEmbed(suggestion.code, suggestion.language, suggestion.explanation, suggestion.filePath, "accepted")
									.setFooter({ text: `Committed: ${result.commitSha?.slice(0, 7)}` }),
							],
							components: [],
						});
					} else {
						await ctx.interaction.followUp({ content: `Failed to commit: ${result.error}`, ephemeral: true });
					}
				} else {
					await ctx.interaction.editReply({
						embeds: [createCodeSuggestionEmbed(suggestion.code, suggestion.language, suggestion.explanation, suggestion.filePath, "accepted")],
						components: [],
					});
				}
			},

			onEditCode: async (ctx) => {
				const suggestion = ctx.suggestionId ? this.db.getSuggestion(ctx.suggestionId) : null;
				if (!suggestion) {
					await ctx.interaction.reply({ content: "Suggestion not found.", ephemeral: true });
					return;
				}

				await ctx.interaction.showModal(createEditCodeModal(suggestion.id, suggestion.code));
			},

			onRejectCode: async (ctx) => {
				await ctx.interaction.deferUpdate();
				if (ctx.suggestionId) {
					this.db.updateSuggestionStatus(ctx.suggestionId, "rejected");
				}

				const suggestion = ctx.suggestionId ? this.db.getSuggestion(ctx.suggestionId) : null;
				if (suggestion) {
					await ctx.interaction.editReply({
						embeds: [createCodeSuggestionEmbed(suggestion.code, suggestion.language, suggestion.explanation, suggestion.filePath, "rejected")],
						components: [],
					});
				}
			},

			onRunCode: async (ctx) => {
				await ctx.interaction.deferUpdate();
				const suggestion = ctx.suggestionId ? this.db.getSuggestion(ctx.suggestionId) : null;
				if (!suggestion) {
					await ctx.interaction.followUp({ content: "Suggestion not found.", ephemeral: true });
					return;
				}

				if (!this.callbacks.executeCode) {
					await ctx.interaction.followUp({ content: "Code execution not available.", ephemeral: true });
					return;
				}

				// Update embed to show running state
				await ctx.interaction.editReply({
					embeds: [createCodeSuggestionEmbed(suggestion.code, suggestion.language, suggestion.explanation, suggestion.filePath, "running")],
					components: [createCodeReviewButtons(suggestion.id, true)],
				});

				const result = await this.callbacks.executeCode(suggestion.code, suggestion.language);

				const outputEmbed = new EmbedBuilder()
					.setTitle(result.success ? "Execution Result" : "Execution Error")
					.setDescription(`\`\`\`\n${result.output || result.error || "No output"}\n\`\`\``)
					.setColor(result.success ? 0x00ff00 : 0xff0000)
					.addFields({ name: "Exit Code", value: (result.exitCode ?? 0).toString(), inline: true });

				await ctx.interaction.followUp({ embeds: [outputEmbed] });

				// Restore buttons
				await ctx.interaction.editReply({
					embeds: [createCodeSuggestionEmbed(suggestion.code, suggestion.language, suggestion.explanation, suggestion.filePath, "pending")],
					components: [createCodeReviewButtons(suggestion.id)],
				});
			},

			onPauseSession: async (ctx) => {
				await ctx.interaction.deferUpdate();
				this.db.pauseSession(ctx.sessionId);
				const session = this.db.getSession(ctx.sessionId);
				if (session) {
					await ctx.interaction.editReply({
						embeds: [createSessionEmbed(session.id, session.model, session.status, session.suggestions.length, session.context.length)],
						components: [createSessionControlButtons(session.id, true)],
					});
				}
			},

			onResumeSession: async (ctx) => {
				await ctx.interaction.deferUpdate();
				this.db.resumeSession(ctx.sessionId);
				const session = this.db.getSession(ctx.sessionId);
				if (session) {
					await ctx.interaction.editReply({
						embeds: [createSessionEmbed(session.id, session.model, session.status, session.suggestions.length, session.context.length)],
						components: [createSessionControlButtons(session.id, false)],
					});
				}
			},

			onEndSession: async (ctx) => {
				await ctx.interaction.deferUpdate();
				this.db.endSession(ctx.sessionId);
				const session = this.db.getSession(ctx.sessionId);
				if (session) {
					await ctx.interaction.editReply({
						embeds: [createSessionEmbed(session.id, session.model, "completed", session.suggestions.length, session.context.length)],
						components: [],
					});
				}
			},

			onClearContext: async (ctx) => {
				await ctx.interaction.deferUpdate();
				this.db.clearContext(ctx.sessionId);
				await ctx.interaction.followUp({ content: "Context cleared.", ephemeral: true });
			},

			onModelChange: async (ctx, newModel) => {
				await ctx.interaction.deferUpdate();
				this.db.updateSession(ctx.sessionId, { model: newModel });
				const session = this.db.getSession(ctx.sessionId);
				if (session) {
					await ctx.interaction.editReply({
						embeds: [createSessionEmbed(session.id, session.model, session.status, session.suggestions.length, session.context.length)],
						components: [
							createModelSelector(session.id, session.model),
							createSessionControlButtons(session.id, session.status === "paused"),
						],
					});
				}
			},

			onExplain: async (ctx) => await this.handleQuickAction(ctx, "explain"),
			onRefactor: async (ctx) => await this.handleQuickAction(ctx, "refactor"),
			onWriteTests: async (ctx) => await this.handleQuickAction(ctx, "tests"),
			onDocument: async (ctx) => await this.handleQuickAction(ctx, "document"),

			onCommit: async (ctx, message, description) => {
				await ctx.interaction.deferReply({ ephemeral: true });
				// Get latest suggestion from session
				const session = this.db.getSession(ctx.sessionId);
				if (!session || session.suggestions.length === 0) {
					await ctx.interaction.editReply("No code to commit.");
					return;
				}

				const latestSuggestion = session.suggestions[session.suggestions.length - 1];
				if (!latestSuggestion.filePath) {
					await ctx.interaction.editReply("No file path specified for commit.");
					return;
				}

				if (!this.callbacks.commitToGitHub) {
					await ctx.interaction.editReply("GitHub integration not available.");
					return;
				}

				const result = await this.callbacks.commitToGitHub(
					latestSuggestion.code,
					latestSuggestion.filePath,
					message,
					description,
				);

				if (result.success) {
					await ctx.interaction.editReply(`Committed successfully! [View commit](${result.commitUrl})`);
				} else {
					await ctx.interaction.editReply(`Failed to commit: ${result.error}`);
				}
			},

			onCreatePR: async (ctx, title, body, branch) => {
				await ctx.interaction.deferReply({ ephemeral: true });
				const session = this.db.getSession(ctx.sessionId);
				if (!session || session.suggestions.length === 0) {
					await ctx.interaction.editReply("No code changes to create PR.");
					return;
				}

				if (!this.callbacks.createPullRequest) {
					await ctx.interaction.editReply("GitHub integration not available.");
					return;
				}

				const files = session.suggestions
					.filter((s) => s.filePath)
					.map((s) => ({ path: s.filePath!, content: s.code }));

				const result = await this.callbacks.createPullRequest(title, body, branch, files);

				if (result.success) {
					await ctx.interaction.editReply(`PR created! [View PR #${result.prNumber}](${result.prUrl})`);
				} else {
					await ctx.interaction.editReply(`Failed to create PR: ${result.error}`);
				}
			},

			onCreateBranch: async (ctx, name) => {
				await ctx.interaction.deferReply({ ephemeral: true });
				if (!this.callbacks.createBranch) {
					await ctx.interaction.editReply("GitHub integration not available.");
					return;
				}

				const result = await this.callbacks.createBranch(name);
				if (result.success) {
					await ctx.interaction.editReply(`Branch \`${name}\` created successfully!`);
				} else {
					await ctx.interaction.editReply(`Failed to create branch: ${result.error}`);
				}
			},

			onApplyDiff: async (ctx) => {
				await ctx.interaction.deferUpdate();
				const suggestion = ctx.suggestionId ? this.db.getSuggestion(ctx.suggestionId) : null;
				if (!suggestion) {
					await ctx.interaction.followUp({ content: "Suggestion not found.", ephemeral: true });
					return;
				}

				this.db.updateSuggestionStatus(suggestion.id, "accepted");
				await ctx.interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(`Changes Applied to ${suggestion.filePath}`)
							.setDescription(`\`\`\`diff\n${suggestion.diff}\n\`\`\``)
							.setColor(0x00ff00),
					],
					components: [],
				});
			},

			onDiscardDiff: async (ctx) => {
				await ctx.interaction.deferUpdate();
				if (ctx.suggestionId) {
					this.db.updateSuggestionStatus(ctx.suggestionId, "rejected");
				}

				await ctx.interaction.editReply({
					embeds: [new EmbedBuilder().setTitle("Changes Discarded").setColor(0xff0000)],
					components: [],
				});
			},

			onEditCodeSubmit: async (ctx, code, explanation) => {
				await ctx.interaction.deferReply({ ephemeral: true });
				// Create new suggestion with edited code
				const session = this.db.getSession(ctx.sessionId);
				if (!session) {
					await ctx.interaction.editReply("Session not found.");
					return;
				}

				const originalSuggestion = ctx.suggestionId ? this.db.getSuggestion(ctx.suggestionId) : null;
				const newSuggestion = this.db.createSuggestion({
					sessionId: ctx.sessionId,
					language: originalSuggestion?.language || "typescript",
					code,
					explanation,
					filePath: originalSuggestion?.filePath,
				});

				await ctx.interaction.editReply("Code updated!");

				// Send new code review message
				const channel = ctx.interaction.channel as TextChannel;
				if (channel) {
					await this.sendCodeSuggestion(channel, newSuggestion, ctx.sessionId);
				}
			},
		};

		setupButtonCollectors(this.client, handlers);
	}

	private async handleQuickAction(ctx: ButtonHandlerContext, action: "explain" | "refactor" | "tests" | "document"): Promise<void> {
		await ctx.interaction.deferReply();

		if (!this.callbacks.generateAIResponse) {
			await ctx.interaction.editReply("AI generation not available.");
			return;
		}

		const session = this.db.getSession(ctx.sessionId);
		if (!session) {
			await ctx.interaction.editReply("Session not found.");
			return;
		}

		const prompts = {
			explain: "Explain this code in detail, including what it does and how it works:",
			refactor: "Refactor this code to be cleaner, more efficient, and follow best practices:",
			tests: "Write comprehensive unit tests for this code:",
			document: "Add detailed documentation comments to this code:",
		};

		const latestSuggestion = session.suggestions[session.suggestions.length - 1];
		const codeContext = latestSuggestion ? `\`\`\`${latestSuggestion.language}\n${latestSuggestion.code}\n\`\`\`` : "";

		let content = "";
		const response = await this.callbacks.generateAIResponse(
			`${prompts[action]}\n\n${codeContext}`,
			session.context,
			session.model,
			(chunk) => {
				content += chunk;
				// Rate-limited updates
				this.updateStreamingMessage(ctx.interaction.id, content, session.model, true);
			},
		);

		await ctx.interaction.editReply({
			embeds: [createStreamingEmbed(response, session.model, false)],
		});
	}

	private async updateStreamingMessage(id: string, content: string, model: string, isStreaming: boolean): Promise<void> {
		const cached = this.streamingMessages.get(id);
		if (!cached) return;

		const now = Date.now();
		if (now - cached.lastUpdate < this.config.streamingUpdateInterval) return;

		cached.lastUpdate = now;
		try {
			await cached.message.edit({
				embeds: [createStreamingEmbed(content, model, isStreaming)],
			});
		} catch {
			// Ignore rate limit errors
		}
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Start a new coding session
	 */
	async startSession(channel: TextChannel, userId: string, model?: string): Promise<CodingSession> {
		const prefs = this.db.getUserPreferences(userId);
		const session = this.db.createSession({
			userId,
			channelId: channel.id,
			model: model || prefs.defaultModel,
		});

		const message = await channel.send({
			embeds: [createSessionEmbed(session.id, session.model, session.status, 0, 0)],
			components: [createModelSelector(session.id, session.model), createSessionControlButtons(session.id)],
		});

		this.db.createMessageMapping({
			messageId: message.id,
			sessionId: session.id,
			componentType: "session_controls",
		});

		return session;
	}

	/**
	 * Get or create active session for user in channel
	 */
	getOrCreateSession(channel: TextChannel, userId: string): Promise<CodingSession> {
		const existing = this.db.getActiveSession(userId, channel.id);
		if (existing) return Promise.resolve(existing);
		return this.startSession(channel, userId);
	}

	/**
	 * Send a code suggestion with interactive buttons
	 */
	async sendCodeSuggestion(
		channel: TextChannel,
		suggestion: CodeSuggestion,
		sessionId: string,
	): Promise<Message> {
		// Store suggestion in DB
		const storedSuggestion = this.db.createSuggestion({
			sessionId,
			...suggestion,
		});

		const components: ActionRowBuilder<ButtonBuilder>[] = [createCodeReviewButtons(storedSuggestion.id)];

		if (this.config.enableGitHub) {
			components.push(createGitHubButtons(sessionId));
		}

		const message = await channel.send({
			embeds: [
				createCodeSuggestionEmbed(
					suggestion.code,
					suggestion.language,
					suggestion.explanation,
					suggestion.filePath,
				),
			],
			components,
		});

		this.db.createMessageMapping({
			messageId: message.id,
			sessionId,
			suggestionId: storedSuggestion.id,
			componentType: "code_review",
		});

		return message;
	}

	/**
	 * Send a diff view with apply/discard buttons
	 */
	async sendDiffView(
		channel: TextChannel,
		diff: string,
		filePath: string,
		sessionId: string,
	): Promise<Message> {
		const suggestion = this.db.createSuggestion({
			sessionId,
			language: "diff",
			code: diff,
			filePath,
			diff,
		});

		const message = await channel.send({
			embeds: [
				new EmbedBuilder()
					.setTitle(`Changes to ${filePath}`)
					.setDescription(`\`\`\`diff\n${diff}\n\`\`\``)
					.setColor(0x5865f2),
			],
			components: [createDiffButtons(suggestion.id)],
		});

		this.db.createMessageMapping({
			messageId: message.id,
			sessionId,
			suggestionId: suggestion.id,
			componentType: "diff_viewer",
		});

		return message;
	}

	/**
	 * Send quick action buttons
	 */
	async sendQuickActions(channel: TextChannel, sessionId: string): Promise<Message> {
		const message = await channel.send({
			content: "**Quick Actions**",
			components: [createQuickActionButtons(sessionId)],
		});

		this.db.createMessageMapping({
			messageId: message.id,
			sessionId,
			componentType: "quick_actions",
		});

		return message;
	}

	/**
	 * Stream AI response with live updates
	 */
	async streamResponse(
		channel: TextChannel,
		sessionId: string,
		prompt: string,
		options: StreamingOptions = {},
	): Promise<string> {
		const session = this.db.getSession(sessionId);
		if (!session) throw new Error("Session not found");

		if (!this.callbacks.generateAIResponse) {
			throw new Error("AI generation not available");
		}

		// Create initial message
		const message = await channel.send({
			embeds: [createStreamingEmbed("", session.model, true)],
		});

		this.streamingMessages.set(message.id, { message, lastUpdate: Date.now() });

		let fullContent = "";

		try {
			const response = await this.callbacks.generateAIResponse(
				prompt,
				session.context,
				session.model,
				(chunk) => {
					fullContent += chunk;
					options.onChunk?.(chunk, fullContent);

					// Rate-limited update
					const cached = this.streamingMessages.get(message.id);
					if (cached) {
						const now = Date.now();
						if (now - cached.lastUpdate >= (options.updateIntervalMs || this.config.streamingUpdateInterval)) {
							cached.lastUpdate = now;
							message.edit({ embeds: [createStreamingEmbed(fullContent, session.model, true)] }).catch(() => {});
						}
					}
				},
			);

			// Final update
			await message.edit({ embeds: [createStreamingEmbed(response, session.model, false)] });
			options.onComplete?.(response);

			// Add to context
			this.db.addContext(sessionId, `User: ${prompt}`);
			this.db.addContext(sessionId, `Assistant: ${response}`);

			return response;
		} catch (error) {
			options.onError?.(error as Error);
			await message.edit({
				embeds: [
					new EmbedBuilder()
						.setTitle("Error")
						.setDescription(String(error))
						.setColor(0xff0000),
				],
			});
			throw error;
		} finally {
			this.streamingMessages.delete(message.id);
		}
	}

	/**
	 * Clean up resources
	 */
	cleanup(): void {
		this.db.cleanupOldSessions();
	}
}

// ============================================================================
// Factory Function
// ============================================================================

let codingAgentUI: CodingAgentUI | null = null;

export function getCodingAgentUI(
	client: Client,
	callbacks?: CodingAgentCallbacks,
	config?: CodingAgentConfig,
): CodingAgentUI {
	if (!codingAgentUI) {
		codingAgentUI = new CodingAgentUI(client, callbacks, config);
	}
	return codingAgentUI;
}

// ============================================================================
// Exports
// ============================================================================

export {
	CodingSessionDB,
	getCodingSessionDB,
	closeCodingSessionDB,
} from "./coding-session-db.js";

export {
	AVAILABLE_MODELS,
	type CodeSuggestion,
	type CodingSession,
	type ModelOption,
} from "./reacord-components.js";

export {
	CUSTOM_IDS,
	createCodeReviewButtons,
	createSessionControlButtons,
	createModelSelector,
	createQuickActionButtons,
	createGitHubButtons,
	createDiffButtons,
	createCodeSuggestionEmbed,
	createSessionEmbed,
	createStreamingEmbed,
} from "./button-collectors.js";
