/**
 * UI Module Index
 *
 * Exports all Discord UI components for the AI coding agent.
 * Uses native discord.js components (no Reacord dependency).
 */

// Main integration
export {
	CodingAgentUI,
	getCodingAgentUI,
	type CodingAgentConfig,
	type CodingAgentCallbacks,
	type StreamingOptions,
	type CodeExecutionResult,
	type GitHubCommitResult,
	type GitHubPRResult,
} from "./coding-agent-ui.js";

// Session Database
export {
	CodingSessionDB,
	getCodingSessionDB,
	closeCodingSessionDB,
	type SessionCreateInput,
	type SessionUpdateInput,
	type SuggestionCreateInput,
	type MessageMapping,
} from "./coding-session-db.js";

// Button Collectors & Builders
export {
	setupButtonCollectors,
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
	createEditCodeModal,
	createCommitMessageModal,
	createPRDetailsModal,
	createBranchNameModal,
	parseCustomId,
	updateMessageWithButtons,
	disableAllButtons,
	type InteractionHandlers,
	type ButtonHandlerContext,
	type SelectHandlerContext,
	type ModalHandlerContext,
	type ButtonHandler,
	type SelectHandler,
	type ModalHandler,
} from "./button-collectors.js";

// Types (from reacord-components, but without React dependency)
export {
	AVAILABLE_MODELS,
	type CodeSuggestion,
	type CodingSession,
	type ModelOption,
} from "./reacord-components.js";
