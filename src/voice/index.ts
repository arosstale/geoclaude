/**
 * Voice Module Exports
 * Open-source TTS (VibeVoice) + STT (Whisper) for Discord
 */

// Discord-LiveKit Bridge
export {
	type BridgeOptions,
	type BridgeStatus,
	createBridge,
	DiscordLiveKitBridge,
	isLiveKitAvailable,
} from "./discord-livekit-bridge.js";
// Expressive TTS (paralinguistic tags)
export {
	addExpression,
	type ExpressionOptions,
	getSupportedTags,
	hasExpressibleContent,
	previewExpression,
	stripUnsupportedTags,
} from "./expressive-tts.js";
// Types
export * from "./types.js";
// VibeVoice TTS (Microsoft open-source)
export { getVibeVoiceTTS, VibeVoiceTTS } from "./vibevoice.js";
// Voice Session
export {
	getAllVoiceSessions,
	getVoiceSession,
	removeVoiceSession,
	VoiceSession,
} from "./voice-session.js";
// Whisper Local STT (open-source)
export { getWhisperLocalSTT, WhisperLocalSTT } from "./whisper-local.js";
