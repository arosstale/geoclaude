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
	createCodeReviewButtonsExtended,
	createSessionControlButtons,
	createModelSelector,
	createQuickActionButtons,
	createGitHubButtons,
	createDiffButtons,
	createCodeSuggestionEmbed,
	createSessionEmbed,
	createStreamingEmbed,
	createEnhancedStreamingEmbed,
	createThinkingEmbed,
	createToolExecutionEmbed,
	createEditCodeModal,
	createCommitMessageModal,
	createPRDetailsModal,
	createBranchNameModal,
	createSystemPromptModal,
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
	type StreamingState,
} from "./button-collectors.js";

// Types and helpers (from reacord-components, but without React dependency)
export {
	AVAILABLE_MODELS,
	estimateTokens,
	extractCodeFromResponse,
	detectLanguage,
	generateSimpleDiff,
	type CodeSuggestion,
	type CodingSession,
	type ModelOption,
} from "./reacord-components.js";
