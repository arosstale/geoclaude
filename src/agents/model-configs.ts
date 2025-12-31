/**
 * Model Configurations - Lightweight Agent Models
 *
 * Separated from lightweight-agent.ts per TAC UNIX philosophy:
 * "One file, one job - data separate from logic"
 */

// Default to GLM 4.7 for best coding quality (top-tier reasoning)
// Use "cerebras-llama" for fastest inference (2100+ tok/s, FREE)
export const DEFAULT_AGENT_MODEL = "glm-4.7";

export interface ModelConfig {
	provider: string;
	model: string;
	name: string;
	free?: boolean;
}

// Available models by provider
// FREE models marked with (FREE) - see omni-router.ts for smart routing
export const AGENT_MODELS: Record<string, ModelConfig> = {
	// ========== FREE MODELS ==========

	// Groq FREE (fastest inference - 14,400 req/day)
	"groq-llama": { provider: "groq", model: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Groq)", free: true },
	"groq-qwen": { provider: "groq", model: "qwen-qwq-32b", name: "Qwen QwQ 32B (Groq)", free: true },

	// Google AI Studio FREE (250K tokens/min)
	"gemini-flash": { provider: "google", model: "gemini-2.5-flash", name: "Gemini 2.5 Flash", free: true },

	// Cerebras FREE (fastest inference - 2100+ tok/s)
	"cerebras-llama": { provider: "cerebras", model: "llama-3.3-70b", name: "Llama 3.3 70B (Cerebras)", free: true },
	"cerebras-llama-8b": { provider: "cerebras", model: "llama3.1-8b", name: "Llama 3.1 8B (Cerebras)", free: true },

	// Hugging Face FREE (Inference API)
	"hf-qwen": { provider: "huggingface", model: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B (HF)", free: true },
	"hf-qwen3": {
		provider: "huggingface",
		model: "Qwen/Qwen3-235B-A22B-Instruct",
		name: "Qwen 3 235B (HF)",
		free: true,
	},
	"hf-llama": {
		provider: "huggingface",
		model: "meta-llama/Llama-3.3-70B-Instruct",
		name: "Llama 3.3 70B (HF)",
		free: true,
	},
	"hf-llama-405b": {
		provider: "huggingface",
		model: "meta-llama/Llama-3.1-405B-Instruct",
		name: "Llama 3.1 405B (HF)",
		free: true,
	},
	"hf-mistral": {
		provider: "huggingface",
		model: "mistralai/Mistral-7B-Instruct-v0.3",
		name: "Mistral 7B (HF)",
		free: true,
	},
	"hf-mistral-small": {
		provider: "huggingface",
		model: "mistralai/Mistral-Small-3.1-24B-Instruct",
		name: "Mistral Small 3.1 24B (HF)",
		free: true,
	},
	"hf-gemma": {
		provider: "huggingface",
		model: "google/gemma-3-27b-it",
		name: "Gemma 3 27B (HF)",
		free: true,
	},
	"hf-deepseek-v3": {
		provider: "huggingface",
		model: "deepseek-ai/DeepSeek-V3",
		name: "DeepSeek V3 (HF)",
		free: true,
	},
	"hf-deepseek-r1": {
		provider: "huggingface",
		model: "deepseek-ai/DeepSeek-R1",
		name: "DeepSeek R1 (HF)",
		free: true,
	},
	"hf-qwen-coder": {
		provider: "huggingface",
		model: "Qwen/Qwen2.5-Coder-32B-Instruct",
		name: "Qwen 2.5 Coder 32B (HF)",
		free: true,
	},
	"hf-kimi": {
		provider: "huggingface",
		model: "moonshotai/Kimi-K2-Instruct",
		name: "Kimi K2 (HF)",
		free: true,
	},

	// NVIDIA NIM FREE (build.nvidia.com)
	"nvidia-llama": {
		provider: "nvidia",
		model: "meta/llama-3.1-70b-instruct",
		name: "Llama 3.1 70B (NVIDIA)",
		free: true,
	},
	"nvidia-mistral": {
		provider: "nvidia",
		model: "mistralai/mistral-large-2-instruct",
		name: "Mistral Large 2 (NVIDIA)",
		free: true,
	},
	"nvidia-kimi-thinking": {
		provider: "nvidia",
		model: "moonshotai/kimi-k2-thinking",
		name: "Kimi K2 Thinking (NVIDIA)",
		free: true,
	},
	"nvidia-kimi": {
		provider: "nvidia",
		model: "moonshotai/kimi-k2-instruct",
		name: "Kimi K2 Instruct (NVIDIA)",
		free: true,
	},
	"nvidia-deepseek": {
		provider: "nvidia",
		model: "deepseek/deepseek-v3.2",
		name: "DeepSeek V3.2 685B (NVIDIA)",
		free: true,
	},
	"nvidia-nemotron": {
		provider: "nvidia",
		model: "nvidia/nemotron-3-nano-30b-a3b",
		name: "Nemotron 3 Nano 30B (NVIDIA)",
		free: true,
	},
	"nvidia-devstral": {
		provider: "nvidia",
		model: "mistralai/devstral-2-123b-instruct-2512",
		name: "Devstral 2 123B (NVIDIA)",
		free: true,
	},
	"nvidia-mistral-nemotron": {
		provider: "nvidia",
		model: "mistralai/mistral-nemotron",
		name: "Mistral-Nemotron (NVIDIA)",
		free: true,
	},

	// HuggingFace Router FREE (18+ providers through single API)
	// Uses HF_TOKEN - unified access to many providers through router.huggingface.co
	"hfr-gpt-oss-120b": {
		provider: "hf-router",
		model: "openai/gpt-oss-120b",
		name: "GPT-OSS 120B (HF Router)",
		free: true,
	},
	"hfr-deepseek-v3": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-V3.2",
		name: "DeepSeek V3.2 (HF Router)",
		free: true,
	},
	"hfr-glm-4.6": {
		provider: "hf-router",
		model: "zai-org/GLM-4.6",
		name: "GLM 4.6 (HF Router)",
		free: true,
	},
	"hfr-qwen3-next": {
		provider: "hf-router",
		model: "Qwen/Qwen3-Next-80B-A3B-Instruct",
		name: "Qwen 3 Next 80B (HF Router)",
		free: true,
	},
	"hfr-qwen-coder": {
		provider: "hf-router",
		model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
		name: "Qwen 3 Coder 30B (HF Router)",
		free: true,
	},
	"hfr-llama-8b": {
		provider: "hf-router",
		model: "meta-llama/Llama-3.1-8B-Instruct",
		name: "Llama 3.1 8B (HF Router)",
		free: true,
	},
	"hfr-gemma": {
		provider: "hf-router",
		model: "google/gemma-3-27b-it",
		name: "Gemma 3 27B (HF Router)",
		free: true,
	},
	"hfr-mimo": {
		provider: "hf-router",
		model: "XiaomiMiMo/MiMo-V2-Flash",
		name: "MiMo V2 Flash (HF Router)",
		free: true,
	},
	"hfr-olmo": {
		provider: "hf-router",
		model: "allenai/Olmo-3.1-32B-Think",
		name: "Olmo 3.1 32B Think (HF Router)",
		free: true,
	},
	"hfr-minimax": {
		provider: "hf-router",
		model: "MiniMaxAI/MiniMax-M2",
		name: "MiniMax M2 (HF Router)",
		free: true,
	},
	"hfr-deepseek-r1": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-R1",
		name: "DeepSeek R1 Reasoning (HF Router)",
		free: true,
	},
	"hfr-kimi-thinking": {
		provider: "hf-router",
		model: "moonshotai/Kimi-K2-Thinking",
		name: "Kimi K2 Thinking (HF Router)",
		free: true,
	},
	"hfr-qwen-235b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
		name: "Qwen 3 235B (HF Router)",
		free: true,
	},
	"hfr-qwen-coder-480b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
		name: "Qwen 3 Coder 480B (HF Router)",
		free: true,
	},
	"hfr-llama-70b": {
		provider: "hf-router",
		model: "meta-llama/Llama-3.3-70B-Instruct",
		name: "Llama 3.3 70B (HF Router)",
		free: true,
	},
	"hfr-deepseek-exp": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-V3.2-Exp",
		name: "DeepSeek V3.2 Exp (HF Router)",
		free: true,
	},
	"hfr-gpt-oss-20b": {
		provider: "hf-router",
		model: "openai/gpt-oss-20b",
		name: "GPT-OSS 20B (HF Router)",
		free: true,
	},
	"hfr-kimi": {
		provider: "hf-router",
		model: "moonshotai/Kimi-K2-Instruct",
		name: "Kimi K2 Instruct (HF Router)",
		free: true,
	},
	"hfr-deepseek-v3.1": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-V3.1",
		name: "DeepSeek V3.1 (HF Router)",
		free: true,
	},
	"hfr-qwen-qwq": {
		provider: "hf-router",
		model: "Qwen/QwQ-32B",
		name: "QwQ 32B Reasoning (HF Router)",
		free: true,
	},
	"hfr-nemotron-ultra": {
		provider: "hf-router",
		model: "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1",
		name: "Nemotron Ultra 253B (HF Router)",
		free: true,
	},
	"hfr-hermes-405b": {
		provider: "hf-router",
		model: "NousResearch/Hermes-4-405B",
		name: "Hermes 4 405B (HF Router)",
		free: true,
	},
	"hfr-hermes-70b": {
		provider: "hf-router",
		model: "NousResearch/Hermes-4-70B",
		name: "Hermes 4 70B (HF Router)",
		free: true,
	},
	"hfr-command-a": {
		provider: "hf-router",
		model: "CohereLabs/c4ai-command-a-03-2025",
		name: "Command A (HF Router)",
		free: true,
	},
	"hfr-command-reasoning": {
		provider: "hf-router",
		model: "CohereLabs/command-a-reasoning-08-2025",
		name: "Command A Reasoning (HF Router)",
		free: true,
	},
	"hfr-cogito-671b": {
		provider: "hf-router",
		model: "deepcogito/cogito-671b-v2.1",
		name: "Cogito 671B (HF Router)",
		free: true,
	},
	"hfr-qwen-thinking-235b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-235B-A22B-Thinking-2507",
		name: "Qwen 3 235B Thinking (HF Router)",
		free: true,
	},
	"hfr-qwen-thinking-30b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-30B-A3B-Thinking-2507",
		name: "Qwen 3 30B Thinking (HF Router)",
		free: true,
	},
	// Vision/Multimodal models (HF Router)
	"hfr-glm-4.6v": {
		provider: "hf-router",
		model: "zai-org/GLM-4.6V",
		name: "GLM 4.6V Vision (HF Router)",
		free: true,
	},
	"hfr-qwen-vl-8b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-VL-8B-Instruct",
		name: "Qwen 3 VL 8B (HF Router)",
		free: true,
	},
	"hfr-qwen-vl-235b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-VL-235B-A22B-Instruct",
		name: "Qwen 3 VL 235B (HF Router)",
		free: true,
	},
	"hfr-command-vision": {
		provider: "hf-router",
		model: "CohereLabs/command-a-vision-07-2025",
		name: "Command A Vision (HF Router)",
		free: true,
	},
	"hfr-aya-vision": {
		provider: "hf-router",
		model: "CohereLabs/aya-vision-32b",
		name: "Aya Vision 32B (HF Router)",
		free: true,
	},
	// Specialized models (HF Router)
	"hfr-wizardlm-8x22b": {
		provider: "hf-router",
		model: "alpindale/WizardLM-2-8x22B",
		name: "WizardLM 2 8x22B (HF Router)",
		free: true,
	},
	"hfr-apriel-thinker": {
		provider: "hf-router",
		model: "ServiceNow-AI/Apriel-1.6-15b-Thinker",
		name: "Apriel Thinker 15B (HF Router)",
		free: true,
	},
	"hfr-apertus-70b": {
		provider: "hf-router",
		model: "swiss-ai/Apertus-70B-Instruct-2509",
		name: "Apertus 70B (HF Router)",
		free: true,
	},
	"hfr-intellect-3": {
		provider: "hf-router",
		model: "PrimeIntellect/INTELLECT-3-FP8",
		name: "INTELLECT-3 (HF Router)",
		free: true,
	},
	"hfr-eurollm": {
		provider: "hf-router",
		model: "utter-project/EuroLLM-22B-Instruct-2512",
		name: "EuroLLM 22B (HF Router)",
		free: true,
	},
	"hfr-baichuan": {
		provider: "hf-router",
		model: "baichuan-inc/Baichuan-M2-32B",
		name: "Baichuan M2 32B (HF Router)",
		free: true,
	},
	"hfr-smollm3": {
		provider: "hf-router",
		model: "HuggingFaceTB/SmolLM3-3B",
		name: "SmolLM3 3B Fast (HF Router)",
		free: true,
	},

	// OpenRouter FREE models (50 req/day)
	"or-gemini": {
		provider: "openrouter",
		model: "google/gemini-2.5-flash:free",
		name: "Gemini 2.5 Flash (OR)",
		free: true,
	},
	"or-devstral": {
		provider: "openrouter",
		model: "mistralai/devstral-2512:free",
		name: "Devstral 2 (Coding)",
		free: true,
	},
	"or-deepseek": {
		provider: "openrouter",
		model: "deepseek/deepseek-chat-v3.1:free",
		name: "DeepSeek V3.1",
		free: true,
	},
	"or-llama": {
		provider: "openrouter",
		model: "meta-llama/llama-3.3-70b:free",
		name: "Llama 3.3 70B (OR)",
		free: true,
	},
	"or-qwen": { provider: "openrouter", model: "qwen/qwen3-235b:free", name: "Qwen 3 235B", free: true },
	"or-mimo": { provider: "openrouter", model: "xiaomi/mimo-v2-flash:free", name: "MiMo V2 Flash", free: true },

	// ========== PAID MODELS ==========

	// Z.ai GLM models (top coding, cheap)
	"glm-4.7": { provider: "zai", model: "glm-4.7", name: "GLM 4.7 (Top Coding)" },
	"glm-4.6": { provider: "zai", model: "glm-4.6", name: "GLM 4.6 (Stable)" },
	"glm-4.5": { provider: "zai", model: "glm-4.5", name: "GLM 4.5" },
	"glm-4.5-air": { provider: "zai", model: "glm-4.5-air", name: "GLM 4.5 Air (Fast)" },

	// Anthropic Claude models
	haiku: { provider: "anthropic", model: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
	sonnet: { provider: "anthropic", model: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },

	// OpenAI models
	"gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini", name: "GPT-4o Mini" },

	// OpenRouter paid models
	deepseek: { provider: "openrouter", model: "deepseek/deepseek-chat", name: "DeepSeek Chat" },

	// ========== LOCAL MODELS (Ollama) ==========
	// Run locally - no API limits, 100% private
	"local-phi4": { provider: "ollama", model: "phi4:latest", name: "Phi-4 (Local)", free: true },
	"local-devstral": {
		provider: "ollama",
		model: "devstral-small-2:latest",
		name: "Devstral Small 2 (Local)",
		free: true,
	},
	"local-mistral": {
		provider: "ollama",
		model: "mistral-small3.2:latest",
		name: "Mistral Small 3.2 (Local)",
		free: true,
	},
	"local-qwen": { provider: "ollama", model: "qwen3:4b", name: "Qwen 3 4B (Local)", free: true },
	"local-deepseek": { provider: "ollama", model: "deepseek-r1:1.5b", name: "DeepSeek R1 1.5B (Local)", free: true },
	"local-gemma": { provider: "ollama", model: "gemma3n:e4b", name: "Gemma 3N E4B (Local)", free: true },
	"local-llama": { provider: "ollama", model: "llama3.2:1b", name: "Llama 3.2 1B (Local)", free: true },
	"local-exaone": { provider: "ollama", model: "exaone-deep:2.4b", name: "Exaone Deep 2.4B (Local)", free: true },
};

/**
 * Get API key for provider
 */
export function getApiKey(provider: string): string {
	switch (provider) {
		case "zai":
			return process.env.ZAI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN || "";
		case "openai":
			return process.env.OPENAI_API_KEY || "";
		case "openrouter":
			return process.env.OPENROUTER_API_KEY || "";
		case "groq":
			return process.env.GROQ_API_KEY || "";
		case "google":
			return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
		case "cerebras":
			return process.env.CEREBRAS_API_KEY || "";
		case "huggingface":
			return process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "";
		case "nvidia":
			return process.env.NVIDIA_API_KEY || "";
		case "ollama":
			return "ollama"; // No API key needed for local Ollama
		case "hf-router":
			return process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "";
		default:
			return "";
	}
}

/**
 * Create a custom model config for Ollama (OpenAI-compatible local API)
 */
export function createOllamaModel(modelId: string): any {
	return {
		id: modelId,
		name: `Ollama ${modelId}`,
		api: "openai-completions",
		provider: "ollama",
		baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};
}

/**
 * Create a custom model config for HuggingFace Router
 */
export function createHFRouterModel(modelId: string, name?: string): any {
	return {
		id: modelId,
		name: name || `HF Router ${modelId}`,
		api: "openai-completions",
		provider: "hf-router",
		baseUrl: "https://router.huggingface.co/v1",
		reasoning: modelId.toLowerCase().includes("r1") || modelId.toLowerCase().includes("thinking"),
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		compat: {
			supportsStore: false,
			maxTokensField: "max_tokens",
		},
	};
}
