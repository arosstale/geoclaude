/**
 * Voice & Audio Tools
 * - Text-to-speech (ElevenLabs, VibeVoice)
 * - Speech-to-text (Whisper)
 * - Voice channel operations
 * - Audio effects
 * - LiveKit real-time communication
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createAudioEffectsTool,
	createElevenLabsTTSTool,
	createLiveKitAgentTool,
	createLiveKitEgressTool,
	createLiveKitRoomTool,
	createLiveKitTokenTool,
	createTranscribeTool,
	createVibeVoiceTool,
	createVoiceJoinTool,
	createVoiceTTSTool,
} from "../../mcp-tools.js";

export function getAllVoiceTools(): AgentTool<any>[] {
	return [
		createTranscribeTool(), // Whisper STT
		createVoiceJoinTool(), // Join voice channel
		createVoiceTTSTool(), // Basic TTS
		createElevenLabsTTSTool(), // ElevenLabs TTS
		createAudioEffectsTool(), // Audio processing
		createVibeVoiceTool(), // Microsoft VibeVoice
		createLiveKitRoomTool(), // LiveKit room
		createLiveKitTokenTool(), // LiveKit token
		createLiveKitEgressTool(), // LiveKit egress
		createLiveKitAgentTool(), // LiveKit agent
	];
}
