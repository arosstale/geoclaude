/**
 * UI Module Index
 *
 * Exports all Discord UI components for the AI coding agent.
 * Uses native discord.js components (no Reacord dependency).
 */

// Button Collectors & Builders
export {
	type ButtonHandler,
	type ButtonHandlerContext,
	CUSTOM_IDS,
	createBranchNameModal,
	createCodeReviewButtons,
	createCodeReviewButtonsExtended,
	createCodeSuggestionEmbed,
	createCommitMessageModal,
	createDiffButtons,
	createEditCodeModal,
	createEnhancedStreamingEmbed,
	createGitHubButtons,
	createModelSelector,
	createPRDetailsModal,
	createQuickActionButtons,
	createSessionControlButtons,
	createSessionEmbed,
	createStreamingEmbed,
	createSystemPromptModal,
	createThinkingEmbed,
	createToolExecutionEmbed,
	disableAllButtons,
	type InteractionHandlers,
	type ModalHandler,
	type ModalHandlerContext,
	parseCustomId,
	type SelectHandler,
	type SelectHandlerContext,
	type StreamingState,
	setupButtonCollectors,
	updateMessageWithButtons,
} from "./button-collectors.js";
// Main integration
export {
	type CodeExecutionResult,
	type CodingAgentCallbacks,
	type CodingAgentConfig,
	CodingAgentUI,
	type GitHubCommitResult,
	type GitHubPRResult,
	getCodingAgentUI,
	type StreamingOptions,
} from "./coding-agent-ui.js";
// Session Database
export {
	CodingSessionDB,
	closeCodingSessionDB,
	getCodingSessionDB,
	type MessageMapping,
	type SessionCreateInput,
	type SessionUpdateInput,
	type SuggestionCreateInput,
} from "./coding-session-db.js";

// Types and helpers (from reacord-components, but without React dependency)
export {
	AVAILABLE_MODELS,
	type CodeSuggestion,
	type CodingSession,
	detectLanguage,
	estimateTokens,
	extractCodeFromResponse,
	generateSimpleDiff,
	type ModelOption,
} from "./reacord-components.js";
