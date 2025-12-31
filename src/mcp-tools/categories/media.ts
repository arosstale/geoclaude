/**
 * Media Generation Tools
 * - Image generation & manipulation
 * - Video creation
 * - Music generation
 * - 3D model creation
 * - GIF creation
 * - Style transfer & upscaling
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import {
	createArtDesignTool,
	createDirectorTool,
	createFaceRestoreTool,
	createFalImageTool,
	createFalVideoTool,
	createGeminiImageTool,
	createGifGenerateTool,
	createHFVideoTool,
	createImageAnalyzeTool,
	createImageGenerateTool,
	createImageInpaintTool,
	createImageUpscaleTool,
	createLumaVideoTool,
	createMubertMusicTool,
	createShapE3DTool,
	createStyleTransferTool,
	createSunoMusicTool,
	createTripoSR3DTool,
} from "../../mcp-tools.js";

export function getAllMediaTools(): AgentTool<any>[] {
	return [
		// Image
		createImageGenerateTool(), // Basic image gen
		createImageAnalyzeTool(), // Vision analysis
		createImageInpaintTool(), // Inpainting
		createImageUpscaleTool(), // Upscaling
		createStyleTransferTool(), // Style transfer
		createFaceRestoreTool(), // Face restoration
		createGeminiImageTool(), // Gemini image
		createFalImageTool(), // Fal.ai image
		createGifGenerateTool(), // GIF generation
		// Video
		createFalVideoTool(), // Fal.ai video
		createHFVideoTool(), // HuggingFace video
		createLumaVideoTool(), // Luma video
		// Music
		createSunoMusicTool(), // Suno music
		createMubertMusicTool(), // Mubert music
		// Creative
		createDirectorTool(), // Director mode
		createArtDesignTool(), // Art design
		// 3D
		createTripoSR3DTool(), // TripoSR 3D
		createShapE3DTool(), // ShapE 3D
	];
}
