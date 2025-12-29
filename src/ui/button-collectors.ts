/**
 * Button Collectors for Discord Interactions
 *
 * Handles persistent button interactions for the AI coding agent.
 * Uses message mappings to maintain state across Discord messages.
 */

import {
	Client,
	ButtonInteraction,
	StringSelectMenuInteraction,
	ModalSubmitInteraction,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	StringSelectMenuBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	EmbedBuilder,
	Message,
	TextChannel,
	type Interaction,
} from "discord.js";
import { getCodingSessionDB, type CodingSessionDB } from "./coding-session-db.js";
import { AVAILABLE_MODELS } from "./reacord-components.js";

// ============================================================================
// Types
// ============================================================================

export interface ButtonHandlerContext {
	interaction: ButtonInteraction;
	db: CodingSessionDB;
	sessionId: string;
	suggestionId?: string;
}

export interface SelectHandlerContext {
	interaction: StringSelectMenuInteraction;
	db: CodingSessionDB;
	sessionId: string;
}

export interface ModalHandlerContext {
	interaction: ModalSubmitInteraction;
	db: CodingSessionDB;
	sessionId: string;
	suggestionId?: string;
}

export type ButtonHandler = (ctx: ButtonHandlerContext) => Promise<void>;
export type SelectHandler = (ctx: SelectHandlerContext) => Promise<void>;
export type ModalHandler = (ctx: ModalHandlerContext) => Promise<void>;

// ============================================================================
// Custom IDs
// ============================================================================

export const CUSTOM_IDS = {
	// Code Review
	ACCEPT_CODE: "coding_accept",
	EDIT_CODE: "coding_edit",
	REJECT_CODE: "coding_reject",
	RUN_CODE: "coding_run",

	// Session Controls
	PAUSE_SESSION: "session_pause",
	RESUME_SESSION: "session_resume",
	END_SESSION: "session_end",
	CLEAR_CONTEXT: "session_clear",

	// Model Selector
	SELECT_MODEL: "model_select",

	// Quick Actions
	EXPLAIN_CODE: "quick_explain",
	REFACTOR_CODE: "quick_refactor",
	WRITE_TESTS: "quick_tests",
	DOCUMENT_CODE: "quick_document",

	// GitHub Actions
	COMMIT_CODE: "github_commit",
	CREATE_PR: "github_pr",
	CREATE_BRANCH: "github_branch",

	// Modals
	EDIT_CODE_MODAL: "modal_edit_code",
	COMMIT_MESSAGE_MODAL: "modal_commit_message",
	PR_DETAILS_MODAL: "modal_pr_details",
	BRANCH_NAME_MODAL: "modal_branch_name",

	// Diff Viewer
	APPLY_DIFF: "diff_apply",
	DISCARD_DIFF: "diff_discard",
} as const;

// ============================================================================
// Button Row Builders
// ============================================================================

export function createCodeReviewButtons(suggestionId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.ACCEPT_CODE}:${suggestionId}`)
			.setLabel("Accept & Commit")
			.setEmoji("✅")
			.setStyle(ButtonStyle.Success)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.EDIT_CODE}:${suggestionId}`)
			.setLabel("Edit")
			.setEmoji("✏️")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.REJECT_CODE}:${suggestionId}`)
			.setLabel("Reject")
			.setEmoji("❌")
			.setStyle(ButtonStyle.Danger)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.RUN_CODE}:${suggestionId}`)
			.setLabel("Run")
			.setEmoji("🚀")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(disabled),
	);
}

export function createSessionControlButtons(sessionId: string, isPaused = false): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		isPaused
			? new ButtonBuilder()
					.setCustomId(`${CUSTOM_IDS.RESUME_SESSION}:${sessionId}`)
					.setLabel("Resume")
					.setEmoji("▶️")
					.setStyle(ButtonStyle.Success)
			: new ButtonBuilder()
					.setCustomId(`${CUSTOM_IDS.PAUSE_SESSION}:${sessionId}`)
					.setLabel("Pause")
					.setEmoji("⏸️")
					.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.CLEAR_CONTEXT}:${sessionId}`)
			.setLabel("Clear Context")
			.setEmoji("🗑️")
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.END_SESSION}:${sessionId}`)
			.setLabel("End Session")
			.setEmoji("⏹️")
			.setStyle(ButtonStyle.Danger),
	);
}

export function createModelSelector(sessionId: string, currentModel: string): ActionRowBuilder<StringSelectMenuBuilder> {
	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId(`${CUSTOM_IDS.SELECT_MODEL}:${sessionId}`)
			.setPlaceholder("Select AI Model")
			.addOptions(
				AVAILABLE_MODELS.map((model) => ({
					label: model.name,
					description: `${model.provider} - ${model.description}`,
					value: model.id,
					default: model.id === currentModel,
				})),
			),
	);
}

export function createQuickActionButtons(sessionId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.EXPLAIN_CODE}:${sessionId}`)
			.setLabel("Explain")
			.setEmoji("💡")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.REFACTOR_CODE}:${sessionId}`)
			.setLabel("Refactor")
			.setEmoji("🔧")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.WRITE_TESTS}:${sessionId}`)
			.setLabel("Tests")
			.setEmoji("🧪")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.DOCUMENT_CODE}:${sessionId}`)
			.setLabel("Document")
			.setEmoji("📝")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(disabled),
	);
}

export function createGitHubButtons(sessionId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.COMMIT_CODE}:${sessionId}`)
			.setLabel("Commit")
			.setEmoji("💾")
			.setStyle(ButtonStyle.Success)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.CREATE_PR}:${sessionId}`)
			.setLabel("Create PR")
			.setEmoji("🔀")
			.setStyle(ButtonStyle.Primary)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.CREATE_BRANCH}:${sessionId}`)
			.setLabel("New Branch")
			.setEmoji("🌿")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(disabled),
	);
}

export function createDiffButtons(suggestionId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.APPLY_DIFF}:${suggestionId}`)
			.setLabel("Apply Changes")
			.setEmoji("✅")
			.setStyle(ButtonStyle.Success)
			.setDisabled(disabled),
		new ButtonBuilder()
			.setCustomId(`${CUSTOM_IDS.DISCARD_DIFF}:${suggestionId}`)
			.setLabel("Discard")
			.setEmoji("❌")
			.setStyle(ButtonStyle.Danger)
			.setDisabled(disabled),
	);
}

// ============================================================================
// Modal Builders
// ============================================================================

export function createEditCodeModal(suggestionId: string, currentCode: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`${CUSTOM_IDS.EDIT_CODE_MODAL}:${suggestionId}`)
		.setTitle("Edit Code")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("code")
					.setLabel("Code")
					.setStyle(TextInputStyle.Paragraph)
					.setValue(currentCode)
					.setRequired(true),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("explanation")
					.setLabel("Explanation (optional)")
					.setStyle(TextInputStyle.Short)
					.setRequired(false),
			),
		);
}

export function createCommitMessageModal(sessionId: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`${CUSTOM_IDS.COMMIT_MESSAGE_MODAL}:${sessionId}`)
		.setTitle("Commit Changes")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("message")
					.setLabel("Commit Message")
					.setStyle(TextInputStyle.Short)
					.setPlaceholder("feat: add new feature")
					.setRequired(true),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("description")
					.setLabel("Description (optional)")
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(false),
			),
		);
}

export function createPRDetailsModal(sessionId: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`${CUSTOM_IDS.PR_DETAILS_MODAL}:${sessionId}`)
		.setTitle("Create Pull Request")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("title")
					.setLabel("PR Title")
					.setStyle(TextInputStyle.Short)
					.setPlaceholder("feat: implement new feature")
					.setRequired(true),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("body")
					.setLabel("Description")
					.setStyle(TextInputStyle.Paragraph)
					.setPlaceholder("Describe your changes...")
					.setRequired(true),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("branch")
					.setLabel("Target Branch")
					.setStyle(TextInputStyle.Short)
					.setValue("main")
					.setRequired(true),
			),
		);
}

export function createBranchNameModal(sessionId: string): ModalBuilder {
	return new ModalBuilder()
		.setCustomId(`${CUSTOM_IDS.BRANCH_NAME_MODAL}:${sessionId}`)
		.setTitle("Create New Branch")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("name")
					.setLabel("Branch Name")
					.setStyle(TextInputStyle.Short)
					.setPlaceholder("feature/my-new-feature")
					.setRequired(true),
			),
		);
}

// ============================================================================
// Embed Builders
// ============================================================================

// Overload: accept either individual params or an object
export function createCodeSuggestionEmbed(
	suggestionOrCode: { id: string; language: string; code: string; explanation?: string; filePath?: string; status?: string } | string,
	languageOrModel?: string,
	explanation?: string,
	filePath?: string,
	status: "pending" | "accepted" | "rejected" | "running" = "pending",
): EmbedBuilder {
	let code: string;
	let language: string;
	let explText: string | undefined;
	let file: string | undefined;
	let statusVal: "pending" | "accepted" | "rejected" | "running";

	if (typeof suggestionOrCode === "object") {
		// Object form (from CodingSession DB)
		code = suggestionOrCode.code;
		language = suggestionOrCode.language;
		explText = suggestionOrCode.explanation;
		file = suggestionOrCode.filePath;
		statusVal = (suggestionOrCode.status as "pending" | "accepted" | "rejected" | "running") || "pending";
	} else {
		// Individual params form
		code = suggestionOrCode;
		language = languageOrModel || "text";
		explText = explanation;
		file = filePath;
		statusVal = status;
	}

	const colors = {
		pending: 0x5865f2,
		accepted: 0x00ff00,
		rejected: 0xff0000,
		running: 0xffa500,
	};

	// Truncate code for Discord embed limit
	const maxCodeLen = 3500;
	const truncatedCode = code.length > maxCodeLen ? `${code.slice(0, maxCodeLen)}\n// ... truncated ...` : code;

	const embed = new EmbedBuilder()
		.setTitle(file ? `Code for ${file}` : "Code Suggestion")
		.setDescription(`${explText ? `${explText}\n\n` : ""}\`\`\`${language}\n${truncatedCode}\n\`\`\``)
		.setColor(colors[statusVal])
		.addFields({ name: "Language", value: language, inline: true }, { name: "Status", value: statusVal.toUpperCase(), inline: true });

	return embed;
}

// Overload: accept either individual params or a session object
export function createSessionEmbed(
	sessionOrId: { id: string; model: string; status: string; suggestions: unknown[]; context: string[] } | string,
	model?: string,
	status?: "active" | "paused" | "completed",
	suggestionsCount?: number,
	contextCount?: number,
): EmbedBuilder {
	let sessionId: string;
	let modelVal: string;
	let statusVal: "active" | "paused" | "completed";
	let suggestCount: number;
	let ctxCount: number;

	if (typeof sessionOrId === "object") {
		// Object form (from CodingSession DB)
		sessionId = sessionOrId.id;
		modelVal = sessionOrId.model;
		statusVal = sessionOrId.status as "active" | "paused" | "completed";
		suggestCount = sessionOrId.suggestions?.length || 0;
		ctxCount = sessionOrId.context?.length || 0;
	} else {
		// Individual params form
		sessionId = sessionOrId;
		modelVal = model || "unknown";
		statusVal = status || "active";
		suggestCount = suggestionsCount || 0;
		ctxCount = contextCount || 0;
	}

	const colors = {
		active: 0x00ff00,
		paused: 0xffa500,
		completed: 0x888888,
	};

	return new EmbedBuilder()
		.setTitle("Coding Session")
		.setDescription(`Session ID: \`${sessionId}\``)
		.setColor(colors[statusVal])
		.addFields(
			{ name: "Status", value: statusVal.toUpperCase(), inline: true },
			{ name: "Model", value: modelVal, inline: true },
			{ name: "Suggestions", value: suggestCount.toString(), inline: true },
			{ name: "Context Items", value: ctxCount.toString(), inline: true },
		);
}

export function createStreamingEmbed(content: string, model: string, isStreaming: boolean, tokensUsed?: number): EmbedBuilder {
	return new EmbedBuilder()
		.setTitle("AI Coding Agent")
		.setDescription(content + (isStreaming ? "\n\n_Generating..._" : ""))
		.setColor(isStreaming ? 0xffa500 : 0x00ff00)
		.setFooter({ text: `Model: ${model}${tokensUsed ? ` | Tokens: ${tokensUsed}` : ""}` });
}

// ============================================================================
// Interaction Handler
// ============================================================================

export interface InteractionHandlers {
	onAcceptCode?: (ctx: ButtonHandlerContext) => Promise<void>;
	onEditCode?: (ctx: ButtonHandlerContext) => Promise<void>;
	onRejectCode?: (ctx: ButtonHandlerContext) => Promise<void>;
	onRunCode?: (ctx: ButtonHandlerContext) => Promise<void>;
	onPauseSession?: (ctx: ButtonHandlerContext) => Promise<void>;
	onResumeSession?: (ctx: ButtonHandlerContext) => Promise<void>;
	onEndSession?: (ctx: ButtonHandlerContext) => Promise<void>;
	onClearContext?: (ctx: ButtonHandlerContext) => Promise<void>;
	onModelChange?: (ctx: SelectHandlerContext, newModel: string) => Promise<void>;
	onExplain?: (ctx: ButtonHandlerContext) => Promise<void>;
	onRefactor?: (ctx: ButtonHandlerContext) => Promise<void>;
	onWriteTests?: (ctx: ButtonHandlerContext) => Promise<void>;
	onDocument?: (ctx: ButtonHandlerContext) => Promise<void>;
	onCommit?: (ctx: ModalHandlerContext, message: string, description?: string) => Promise<void>;
	onCreatePR?: (ctx: ModalHandlerContext, title: string, body: string, branch: string) => Promise<void>;
	onCreateBranch?: (ctx: ModalHandlerContext, name: string) => Promise<void>;
	onApplyDiff?: (ctx: ButtonHandlerContext) => Promise<void>;
	onDiscardDiff?: (ctx: ButtonHandlerContext) => Promise<void>;
	onEditCodeSubmit?: (ctx: ModalHandlerContext, code: string, explanation?: string) => Promise<void>;
}

export function setupButtonCollectors(client: Client, handlers: InteractionHandlers): void {
	const db = getCodingSessionDB();

	client.on("interactionCreate", async (interaction: Interaction) => {
		try {
			// Handle Button Interactions
			if (interaction.isButton()) {
				const [action, id] = interaction.customId.split(":");
				if (!id) return;

				const mapping = db.getMessageMapping(interaction.message.id);
				const ctx: ButtonHandlerContext = {
					interaction,
					db,
					sessionId: mapping?.sessionId || id,
					suggestionId: mapping?.suggestionId || id,
				};

				switch (action) {
					case CUSTOM_IDS.ACCEPT_CODE:
						await handlers.onAcceptCode?.(ctx);
						break;
					case CUSTOM_IDS.EDIT_CODE:
						await handlers.onEditCode?.(ctx);
						break;
					case CUSTOM_IDS.REJECT_CODE:
						await handlers.onRejectCode?.(ctx);
						break;
					case CUSTOM_IDS.RUN_CODE:
						await handlers.onRunCode?.(ctx);
						break;
					case CUSTOM_IDS.PAUSE_SESSION:
						await handlers.onPauseSession?.(ctx);
						break;
					case CUSTOM_IDS.RESUME_SESSION:
						await handlers.onResumeSession?.(ctx);
						break;
					case CUSTOM_IDS.END_SESSION:
						await handlers.onEndSession?.(ctx);
						break;
					case CUSTOM_IDS.CLEAR_CONTEXT:
						await handlers.onClearContext?.(ctx);
						break;
					case CUSTOM_IDS.EXPLAIN_CODE:
						await handlers.onExplain?.(ctx);
						break;
					case CUSTOM_IDS.REFACTOR_CODE:
						await handlers.onRefactor?.(ctx);
						break;
					case CUSTOM_IDS.WRITE_TESTS:
						await handlers.onWriteTests?.(ctx);
						break;
					case CUSTOM_IDS.DOCUMENT_CODE:
						await handlers.onDocument?.(ctx);
						break;
					case CUSTOM_IDS.COMMIT_CODE:
						// Show modal for commit message
						await interaction.showModal(createCommitMessageModal(ctx.sessionId));
						break;
					case CUSTOM_IDS.CREATE_PR:
						// Show modal for PR details
						await interaction.showModal(createPRDetailsModal(ctx.sessionId));
						break;
					case CUSTOM_IDS.CREATE_BRANCH:
						// Show modal for branch name
						await interaction.showModal(createBranchNameModal(ctx.sessionId));
						break;
					case CUSTOM_IDS.APPLY_DIFF:
						await handlers.onApplyDiff?.(ctx);
						break;
					case CUSTOM_IDS.DISCARD_DIFF:
						await handlers.onDiscardDiff?.(ctx);
						break;
				}
			}

			// Handle Select Menu Interactions
			if (interaction.isStringSelectMenu()) {
				const [action, sessionId] = interaction.customId.split(":");
				if (!sessionId) return;

				const ctx: SelectHandlerContext = {
					interaction,
					db,
					sessionId,
				};

				if (action === CUSTOM_IDS.SELECT_MODEL) {
					const newModel = interaction.values[0];
					await handlers.onModelChange?.(ctx, newModel);
				}
			}

			// Handle Modal Submissions
			if (interaction.isModalSubmit()) {
				const [action, id] = interaction.customId.split(":");
				if (!id) return;

				const mapping = db.getMessageMapping(interaction.message?.id || "");
				const ctx: ModalHandlerContext = {
					interaction,
					db,
					sessionId: mapping?.sessionId || id,
					suggestionId: mapping?.suggestionId,
				};

				switch (action) {
					case CUSTOM_IDS.EDIT_CODE_MODAL: {
						const code = interaction.fields.getTextInputValue("code");
						const explanation = interaction.fields.getTextInputValue("explanation") || undefined;
						await handlers.onEditCodeSubmit?.(ctx, code, explanation);
						break;
					}
					case CUSTOM_IDS.COMMIT_MESSAGE_MODAL: {
						const message = interaction.fields.getTextInputValue("message");
						const description = interaction.fields.getTextInputValue("description") || undefined;
						await handlers.onCommit?.(ctx, message, description);
						break;
					}
					case CUSTOM_IDS.PR_DETAILS_MODAL: {
						const title = interaction.fields.getTextInputValue("title");
						const body = interaction.fields.getTextInputValue("body");
						const branch = interaction.fields.getTextInputValue("branch");
						await handlers.onCreatePR?.(ctx, title, body, branch);
						break;
					}
					case CUSTOM_IDS.BRANCH_NAME_MODAL: {
						const name = interaction.fields.getTextInputValue("name");
						await handlers.onCreateBranch?.(ctx, name);
						break;
					}
				}
			}
		} catch (error) {
			console.error("[ButtonCollector] Error handling interaction:", error);
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: "An error occurred processing your request.", ephemeral: true }).catch(() => {});
			}
		}
	});
}

// ============================================================================
// Helper Functions
// ============================================================================

export function parseCustomId(customId: string): { action: string; id: string } {
	const [action, id] = customId.split(":");
	return { action, id };
}

export async function updateMessageWithButtons(
	message: Message,
	embed: EmbedBuilder,
	buttons: ActionRowBuilder<ButtonBuilder>,
): Promise<void> {
	await message.edit({ embeds: [embed], components: [buttons] });
}

export async function disableAllButtons(message: Message): Promise<void> {
	const disabledComponents: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

	for (const row of message.components) {
		// Only process ActionRow components
		if (row.type !== 1) continue; // ComponentType.ActionRow = 1

		const newRow = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();

		for (const component of row.components) {
			if (component.type === 2) {
				// ComponentType.Button = 2
				const btn = ButtonBuilder.from(component as unknown as Parameters<typeof ButtonBuilder.from>[0]);
				btn.setDisabled(true);
				newRow.addComponents(btn);
			} else if (component.type === 3) {
				// ComponentType.StringSelect = 3
				const select = StringSelectMenuBuilder.from(component as unknown as Parameters<typeof StringSelectMenuBuilder.from>[0]);
				select.setDisabled(true);
				newRow.addComponents(select);
			}
		}

		if (newRow.components.length > 0) {
			disabledComponents.push(newRow);
		}
	}

	await message.edit({ components: disabledComponents });
}
