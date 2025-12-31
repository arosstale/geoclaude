/**
 * Omni Router - Unified Smart Model Selection
 * Routes to best model across all providers:
 * - OpenCode Zen (FREE): Grok, MiniMax, Big Pickle
 * - Z.ai: GLM-4.7, GLM-4.6, GLM-4.5, GLM-4.5-air
 * - Anthropic: Claude Haiku, Sonnet
 * - OpenAI: GPT-4o-mini
 * - OpenRouter: DeepSeek
 */

import { type AgentResult, runAgent } from "./lightweight-agent.js";
import { type OpenCodeResult, runOpenCodeAgent } from "./opencode-agent.js";

// All available models across all providers
export const OMNI_MODELS = {
	// ========== FREE MODELS ==========

	// OpenCode Zen FREE
	grok: { provider: "opencode", model: "grok-code-fast-1", name: "Grok Code Fast 1", free: true, strength: "code" },
	pickle: { provider: "opencode", model: "big-pickle", name: "Big Pickle", free: true, strength: "experimental" },

	// OpenRouter FREE models (25+ available)
	"gemini-flash": {
		provider: "openrouter",
		model: "google/gemini-2.5-flash:free",
		name: "Gemini 2.5 Flash",
		free: true,
		strength: "general",
	},
	"gpt-oss": {
		provider: "openrouter",
		model: "openai/gpt-oss-120b:free",
		name: "GPT-OSS 120B",
		free: true,
		strength: "quality",
	},
	devstral: {
		provider: "openrouter",
		model: "mistralai/devstral-2512:free",
		name: "Devstral 2 (Coding)",
		free: true,
		strength: "code",
	},
	"deepseek-free": {
		provider: "openrouter",
		model: "deepseek/deepseek-chat-v3.1:free",
		name: "DeepSeek V3.1",
		free: true,
		strength: "code",
	},
	mimo: {
		provider: "openrouter",
		model: "xiaomi/mimo-v2-flash:free",
		name: "MiMo V2 Flash",
		free: true,
		strength: "reasoning",
	},
	"llama-free": {
		provider: "openrouter",
		model: "meta-llama/llama-3.3-70b:free",
		name: "Llama 3.3 70B",
		free: true,
		strength: "general",
	},
	"qwen-free": {
		provider: "openrouter",
		model: "qwen/qwen3-235b:free",
		name: "Qwen 3 235B",
		free: true,
		strength: "multilingual",
	},
	minimax: {
		provider: "openrouter",
		model: "minimax/minimax-m2.1",
		name: "MiniMax M2.1",
		free: true,
		strength: "creative",
	},
	devstral2: {
		provider: "openrouter",
		model: "mistralai/devstral-2512:free",
		name: "Devstral 2 2512",
		free: true,
		strength: "general",
	},

	// Groq FREE (fastest inference - 14,400 req/day)
	"groq-llama": {
		provider: "groq",
		model: "llama-3.3-70b-versatile",
		name: "Llama 3.3 70B (Groq)",
		free: true,
		strength: "fast",
	},
	"groq-qwen": {
		provider: "groq",
		model: "qwen-qwq-32b",
		name: "Qwen QwQ 32B (Groq)",
		free: true,
		strength: "reasoning",
	},

	// Google AI Studio FREE (250K tokens/min)
	"gemini-google": {
		provider: "google",
		model: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash (Direct)",
		free: true,
		strength: "multimodal",
	},

	// Cerebras FREE (fastest inference - 2100+ tok/s)
	"cerebras-llama": {
		provider: "cerebras",
		model: "llama-3.3-70b",
		name: "Llama 3.3 70B (Cerebras)",
		free: true,
		strength: "ultra-fast",
	},
	"cerebras-llama-8b": {
		provider: "cerebras",
		model: "llama3.1-8b",
		name: "Llama 3.1 8B (Cerebras)",
		free: true,
		strength: "ultra-fast",
	},

	// Hugging Face FREE (Inference API)
	"hf-qwen": {
		provider: "huggingface",
		model: "Qwen/Qwen2.5-72B-Instruct",
		name: "Qwen 2.5 72B (HF)",
		free: true,
		strength: "reasoning",
	},
	"hf-qwen3": {
		provider: "huggingface",
		model: "Qwen/Qwen3-235B-A22B-Instruct",
		name: "Qwen 3 235B (HF)",
		free: true,
		strength: "reasoning",
	},
	"hf-llama": {
		provider: "huggingface",
		model: "meta-llama/Llama-3.3-70B-Instruct",
		name: "Llama 3.3 70B (HF)",
		free: true,
		strength: "general",
	},
	"hf-llama-405b": {
		provider: "huggingface",
		model: "meta-llama/Llama-3.1-405B-Instruct",
		name: "Llama 3.1 405B (HF)",
		free: true,
		strength: "quality",
	},
	"hf-mistral": {
		provider: "huggingface",
		model: "mistralai/Mistral-7B-Instruct-v0.3",
		name: "Mistral 7B (HF)",
		free: true,
		strength: "fast",
	},
	"hf-mistral-small": {
		provider: "huggingface",
		model: "mistralai/Mistral-Small-3.1-24B-Instruct",
		name: "Mistral Small 3.1 24B (HF)",
		free: true,
		strength: "code",
	},
	"hf-gemma": {
		provider: "huggingface",
		model: "google/gemma-3-27b-it",
		name: "Gemma 3 27B (HF)",
		free: true,
		strength: "general",
	},
	"hf-deepseek-v3": {
		provider: "huggingface",
		model: "deepseek-ai/DeepSeek-V3",
		name: "DeepSeek V3 (HF)",
		free: true,
		strength: "reasoning",
	},
	"hf-deepseek-r1": {
		provider: "huggingface",
		model: "deepseek-ai/DeepSeek-R1",
		name: "DeepSeek R1 (HF)",
		free: true,
		strength: "reasoning",
	},
	"hf-qwen-coder": {
		provider: "huggingface",
		model: "Qwen/Qwen2.5-Coder-32B-Instruct",
		name: "Qwen 2.5 Coder 32B (HF)",
		free: true,
		strength: "code",
	},
	"hf-kimi": {
		provider: "huggingface",
		model: "moonshotai/Kimi-K2-Instruct",
		name: "Kimi K2 (HF)",
		free: true,
		strength: "agentic",
	},

	// NVIDIA NIM FREE (build.nvidia.com)
	"nvidia-llama": {
		provider: "nvidia",
		model: "meta/llama-3.1-70b-instruct",
		name: "Llama 3.1 70B (NVIDIA)",
		free: true,
		strength: "general",
	},
	"nvidia-mistral": {
		provider: "nvidia",
		model: "mistralai/mistral-large-2-instruct",
		name: "Mistral Large 2 (NVIDIA)",
		free: true,
		strength: "code",
	},
	"nvidia-kimi-thinking": {
		provider: "nvidia",
		model: "moonshotai/kimi-k2-thinking",
		name: "Kimi K2 Thinking (NVIDIA)",
		free: true,
		strength: "reasoning",
	},
	"nvidia-kimi": {
		provider: "nvidia",
		model: "moonshotai/kimi-k2-instruct",
		name: "Kimi K2 Instruct (NVIDIA)",
		free: true,
		strength: "agentic",
	},
	"nvidia-deepseek": {
		provider: "nvidia",
		model: "deepseek/deepseek-v3.2",
		name: "DeepSeek V3.2 685B (NVIDIA)",
		free: true,
		strength: "reasoning",
	},
	"nvidia-nemotron": {
		provider: "nvidia",
		model: "nvidia/nemotron-3-nano-30b-a3b",
		name: "Nemotron 3 Nano 30B (NVIDIA)",
		free: true,
		strength: "agentic",
	},
	"nvidia-devstral": {
		provider: "nvidia",
		model: "mistralai/devstral-2-123b-instruct-2512",
		name: "Devstral 2 123B (NVIDIA)",
		free: true,
		strength: "code",
	},
	"nvidia-mistral-nemotron": {
		provider: "nvidia",
		model: "mistralai/mistral-nemotron",
		name: "Mistral-Nemotron (NVIDIA)",
		free: true,
		strength: "agentic",
	},

	// ========== LOCAL MODELS (Ollama) ==========
	// Run locally - no API limits, 100% private
	"local-phi4": {
		provider: "ollama",
		model: "phi4:latest",
		name: "Phi-4 (Local)",
		free: true,
		strength: "reasoning",
	},
	"local-devstral": {
		provider: "ollama",
		model: "devstral-small-2:latest",
		name: "Devstral Small 2 (Local)",
		free: true,
		strength: "code",
	},
	"local-mistral": {
		provider: "ollama",
		model: "mistral-small3.2:latest",
		name: "Mistral Small 3.2 (Local)",
		free: true,
		strength: "code",
	},
	"local-qwen": {
		provider: "ollama",
		model: "qwen3:4b",
		name: "Qwen 3 4B (Local)",
		free: true,
		strength: "fast",
	},
	"local-deepseek": {
		provider: "ollama",
		model: "deepseek-r1:1.5b",
		name: "DeepSeek R1 1.5B (Local)",
		free: true,
		strength: "reasoning",
	},
	"local-gemma": {
		provider: "ollama",
		model: "gemma3n:e4b",
		name: "Gemma 3N E4B (Local)",
		free: true,
		strength: "general",
	},
	"local-llama": {
		provider: "ollama",
		model: "llama3.2:1b",
		name: "Llama 3.2 1B (Local)",
		free: true,
		strength: "fast",
	},
	"local-exaone": {
		provider: "ollama",
		model: "exaone-deep:2.4b",
		name: "Exaone Deep 2.4B (Local)",
		free: true,
		strength: "reasoning",
	},

	// ========== HF ROUTER (18+ providers through single API) ==========
	// Uses HF_TOKEN - unified access to many providers through router.huggingface.co
	"hfr-gpt-oss-120b": {
		provider: "hf-router",
		model: "openai/gpt-oss-120b",
		name: "GPT-OSS 120B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-deepseek-v3": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-V3.2",
		name: "DeepSeek V3.2 (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-glm-4.6": {
		provider: "hf-router",
		model: "zai-org/GLM-4.6",
		name: "GLM 4.6 (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-qwen3-next": {
		provider: "hf-router",
		model: "Qwen/Qwen3-Next-80B-A3B-Instruct",
		name: "Qwen 3 Next 80B (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-qwen-coder": {
		provider: "hf-router",
		model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
		name: "Qwen 3 Coder 30B (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-llama-8b": {
		provider: "hf-router",
		model: "meta-llama/Llama-3.1-8B-Instruct",
		name: "Llama 3.1 8B (HF Router)",
		free: true,
		strength: "fast",
	},
	"hfr-gemma": {
		provider: "hf-router",
		model: "google/gemma-3-27b-it",
		name: "Gemma 3 27B (HF Router)",
		free: true,
		strength: "general",
	},
	"hfr-mimo": {
		provider: "hf-router",
		model: "XiaomiMiMo/MiMo-V2-Flash",
		name: "MiMo V2 Flash (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-olmo": {
		provider: "hf-router",
		model: "allenai/Olmo-3.1-32B-Think",
		name: "Olmo 3.1 32B Think (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-minimax": {
		provider: "hf-router",
		model: "MiniMaxAI/MiniMax-M2",
		name: "MiniMax M2 (HF Router)",
		free: true,
		strength: "creative",
	},
	"hfr-deepseek-r1": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-R1",
		name: "DeepSeek R1 Reasoning (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-kimi-thinking": {
		provider: "hf-router",
		model: "moonshotai/Kimi-K2-Thinking",
		name: "Kimi K2 Thinking (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-qwen-235b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-235B-A22B-Instruct-2507",
		name: "Qwen 3 235B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-qwen-coder-480b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
		name: "Qwen 3 Coder 480B (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-llama-70b": {
		provider: "hf-router",
		model: "meta-llama/Llama-3.3-70B-Instruct",
		name: "Llama 3.3 70B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-deepseek-exp": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-V3.2-Exp",
		name: "DeepSeek V3.2 Exp (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-gpt-oss-20b": {
		provider: "hf-router",
		model: "openai/gpt-oss-20b",
		name: "GPT-OSS 20B (HF Router)",
		free: true,
		strength: "fast",
	},
	"hfr-kimi": {
		provider: "hf-router",
		model: "moonshotai/Kimi-K2-Instruct",
		name: "Kimi K2 Instruct (HF Router)",
		free: true,
		strength: "general",
	},
	"hfr-deepseek-v3.1": {
		provider: "hf-router",
		model: "deepseek-ai/DeepSeek-V3.1",
		name: "DeepSeek V3.1 (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-qwen-qwq": {
		provider: "hf-router",
		model: "Qwen/QwQ-32B",
		name: "QwQ 32B Reasoning (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-nemotron-ultra": {
		provider: "hf-router",
		model: "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1",
		name: "Nemotron Ultra 253B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-hermes-405b": {
		provider: "hf-router",
		model: "NousResearch/Hermes-4-405B",
		name: "Hermes 4 405B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-hermes-70b": {
		provider: "hf-router",
		model: "NousResearch/Hermes-4-70B",
		name: "Hermes 4 70B (HF Router)",
		free: true,
		strength: "general",
	},
	"hfr-command-a": {
		provider: "hf-router",
		model: "CohereLabs/c4ai-command-a-03-2025",
		name: "Command A (HF Router)",
		free: true,
		strength: "general",
	},
	"hfr-command-reasoning": {
		provider: "hf-router",
		model: "CohereLabs/command-a-reasoning-08-2025",
		name: "Command A Reasoning (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-cogito-671b": {
		provider: "hf-router",
		model: "deepcogito/cogito-671b-v2.1",
		name: "Cogito 671B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-qwen-thinking-235b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-235B-A22B-Thinking-2507",
		name: "Qwen 3 235B Thinking (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-qwen-thinking-30b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-30B-A3B-Thinking-2507",
		name: "Qwen 3 30B Thinking (HF Router)",
		free: true,
		strength: "reasoning",
	},
	// Vision/Multimodal models (HF Router)
	"hfr-glm-4.6v": {
		provider: "hf-router",
		model: "zai-org/GLM-4.6V",
		name: "GLM 4.6V Vision (HF Router)",
		free: true,
		strength: "vision",
	},
	"hfr-qwen-vl-8b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-VL-8B-Instruct",
		name: "Qwen 3 VL 8B (HF Router)",
		free: true,
		strength: "vision",
	},
	"hfr-qwen-vl-235b": {
		provider: "hf-router",
		model: "Qwen/Qwen3-VL-235B-A22B-Instruct",
		name: "Qwen 3 VL 235B (HF Router)",
		free: true,
		strength: "vision",
	},
	"hfr-command-vision": {
		provider: "hf-router",
		model: "CohereLabs/command-a-vision-07-2025",
		name: "Command A Vision (HF Router)",
		free: true,
		strength: "vision",
	},
	"hfr-aya-vision": {
		provider: "hf-router",
		model: "CohereLabs/aya-vision-32b",
		name: "Aya Vision 32B (HF Router)",
		free: true,
		strength: "vision",
	},
	// Specialized models (HF Router)
	"hfr-wizardlm-8x22b": {
		provider: "hf-router",
		model: "alpindale/WizardLM-2-8x22B",
		name: "WizardLM 2 8x22B (HF Router)",
		free: true,
		strength: "code",
	},
	"hfr-apriel-thinker": {
		provider: "hf-router",
		model: "ServiceNow-AI/Apriel-1.6-15b-Thinker",
		name: "Apriel Thinker 15B (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-apertus-70b": {
		provider: "hf-router",
		model: "swiss-ai/Apertus-70B-Instruct-2509",
		name: "Apertus 70B (HF Router)",
		free: true,
		strength: "quality",
	},
	"hfr-intellect-3": {
		provider: "hf-router",
		model: "PrimeIntellect/INTELLECT-3-FP8",
		name: "INTELLECT-3 (HF Router)",
		free: true,
		strength: "reasoning",
	},
	"hfr-eurollm": {
		provider: "hf-router",
		model: "utter-project/EuroLLM-22B-Instruct-2512",
		name: "EuroLLM 22B (HF Router)",
		free: true,
		strength: "general",
	},
	"hfr-baichuan": {
		provider: "hf-router",
		model: "baichuan-inc/Baichuan-M2-32B",
		name: "Baichuan M2 32B (HF Router)",
		free: true,
		strength: "general",
	},
	"hfr-smollm3": {
		provider: "hf-router",
		model: "HuggingFaceTB/SmolLM3-3B",
		name: "SmolLM3 3B Fast (HF Router)",
		free: true,
		strength: "fast",
	},

	// ========== PAID MODELS ==========

	// Z.ai models (cheap)
	"glm-4.7": { provider: "zai", model: "glm-4.7", name: "GLM 4.7", free: false, strength: "code" },
	"glm-4.6": { provider: "zai", model: "glm-4.6", name: "GLM 4.6", free: false, strength: "code" },
	"glm-4.5": { provider: "zai", model: "glm-4.5", name: "GLM 4.5", free: false, strength: "general" },
	"glm-4.5-air": { provider: "zai", model: "glm-4.5-air", name: "GLM 4.5 Air", free: false, strength: "fast" },

	// Anthropic (paid)
	haiku: { provider: "anthropic", model: "claude-haiku-4-5", name: "Claude Haiku 4.5", free: false, strength: "fast" },
	sonnet: {
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		free: false,
		strength: "quality",
	},

	// OpenAI (paid)
	"gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini", name: "GPT-4o Mini", free: false, strength: "balanced" },

	// OpenRouter (paid)
	deepseek: {
		provider: "openrouter",
		model: "deepseek/deepseek-chat",
		name: "DeepSeek Chat",
		free: false,
		strength: "code",
	},
} as const;

export type OmniModelKey = keyof typeof OMNI_MODELS;

// Routing patterns
const ROUTING_PATTERNS = {
	code: [
		/\b(code|function|class|implement|debug|fix|refactor|typescript|javascript|python|rust|go|java)\b/i,
		/\b(api|endpoint|server|database|query|sql|schema|migration)\b/i,
		/\b(test|unit|integration|coverage|assert|mock|stub)\b/i,
		/\b(build|compile|deploy|docker|kubernetes|ci|cd)\b/i,
		/\b(algorithm|data structure|optimize|performance|memory)\b/i,
	],
	creative: [
		/\b(write|story|poem|creative|imagine|describe|narrative|fiction)\b/i,
		/\b(marketing|copy|content|blog|article|post|email)\b/i,
		/\b(design|ux|ui|layout|style|visual|aesthetic)\b/i,
		/\b(brainstorm|ideas|suggest|recommend|inspire)\b/i,
	],
	analysis: [
		/\b(analyze|analysis|research|study|examine|investigate)\b/i,
		/\b(trading|market|stock|crypto|price|trend|signal)\b/i,
		/\b(data|statistics|metrics|report|insight)\b/i,
	],
	fast: [/\b(quick|fast|brief|short|simple|easy)\b/i, /\b(tldr|summary|summarize|explain briefly)\b/i],
};

export type TaskType = "code" | "creative" | "analysis" | "fast" | "general";

/**
 * Map Omni model to lightweight-agent compatible key
 * For models not in AGENT_MODELS, returns the full model ID for OpenRouter
 */
function mapToLightweightModel(omniKey: OmniModelKey, config: (typeof OMNI_MODELS)[OmniModelKey]): string {
	// Direct mappings to lightweight-agent keys
	const directMappings: Record<string, string> = {
		"glm-4.6": "glm-4.6",
		"glm-4.5": "glm-4.5",
		"glm-4.5-air": "glm-4.5-air",
		haiku: "haiku",
		sonnet: "sonnet",
		"gpt-4o-mini": "gpt-4o-mini",
		deepseek: "deepseek",
		// Local Ollama models
		"local-phi4": "local-phi4",
		"local-devstral": "local-devstral",
		"local-mistral": "local-mistral",
		"local-qwen": "local-qwen",
		"local-deepseek": "local-deepseek",
		"local-gemma": "local-gemma",
		"local-llama": "local-llama",
		"local-exaone": "local-exaone",
		// HF Router models
		"hfr-gpt-oss-120b": "hfr-gpt-oss-120b",
		"hfr-deepseek-v3": "hfr-deepseek-v3",
		"hfr-glm-4.6": "hfr-glm-4.6",
		"hfr-qwen3-next": "hfr-qwen3-next",
		"hfr-qwen-coder": "hfr-qwen-coder",
		"hfr-llama-8b": "hfr-llama-8b",
		"hfr-gemma": "hfr-gemma",
		"hfr-mimo": "hfr-mimo",
		"hfr-olmo": "hfr-olmo",
		"hfr-minimax": "hfr-minimax",
		"hfr-deepseek-r1": "hfr-deepseek-r1",
		"hfr-kimi-thinking": "hfr-kimi-thinking",
		"hfr-qwen-235b": "hfr-qwen-235b",
		"hfr-qwen-coder-480b": "hfr-qwen-coder-480b",
		"hfr-llama-70b": "hfr-llama-70b",
		"hfr-deepseek-exp": "hfr-deepseek-exp",
		"hfr-gpt-oss-20b": "hfr-gpt-oss-20b",
		"hfr-kimi": "hfr-kimi",
		"hfr-deepseek-v3.1": "hfr-deepseek-v3.1",
		"hfr-qwen-qwq": "hfr-qwen-qwq",
		"hfr-nemotron-ultra": "hfr-nemotron-ultra",
		"hfr-hermes-405b": "hfr-hermes-405b",
		"hfr-hermes-70b": "hfr-hermes-70b",
		"hfr-command-a": "hfr-command-a",
		"hfr-command-reasoning": "hfr-command-reasoning",
		"hfr-cogito-671b": "hfr-cogito-671b",
		"hfr-qwen-thinking-235b": "hfr-qwen-thinking-235b",
		"hfr-qwen-thinking-30b": "hfr-qwen-thinking-30b",
		// Vision models
		"hfr-glm-4.6v": "hfr-glm-4.6v",
		"hfr-qwen-vl-8b": "hfr-qwen-vl-8b",
		"hfr-qwen-vl-235b": "hfr-qwen-vl-235b",
		"hfr-command-vision": "hfr-command-vision",
		"hfr-aya-vision": "hfr-aya-vision",
		// Specialized models
		"hfr-wizardlm-8x22b": "hfr-wizardlm-8x22b",
		"hfr-apriel-thinker": "hfr-apriel-thinker",
		"hfr-apertus-70b": "hfr-apertus-70b",
		"hfr-intellect-3": "hfr-intellect-3",
		"hfr-eurollm": "hfr-eurollm",
		"hfr-baichuan": "hfr-baichuan",
		"hfr-smollm3": "hfr-smollm3",
	};

	if (directMappings[omniKey]) {
		return directMappings[omniKey];
	}

	// For OpenRouter free models, use full model ID
	if (config.provider === "openrouter") {
		return config.model;
	}

	// For Groq/Google, use model ID directly
	return config.model;
}

/**
 * Detect task type from prompt
 */
export function detectTaskType(prompt: string): TaskType {
	for (const pattern of ROUTING_PATTERNS.code) {
		if (pattern.test(prompt)) return "code";
	}
	for (const pattern of ROUTING_PATTERNS.creative) {
		if (pattern.test(prompt)) return "creative";
	}
	for (const pattern of ROUTING_PATTERNS.analysis) {
		if (pattern.test(prompt)) return "analysis";
	}
	for (const pattern of ROUTING_PATTERNS.fast) {
		if (pattern.test(prompt)) return "fast";
	}
	return "general";
}

export interface OmniRouteOptions {
	preferFree?: boolean; // Prefer free models (default: true)
	preferQuality?: boolean; // Prefer quality over speed
	preferSpeed?: boolean; // Prefer speed over quality
	allowedProviders?: string[]; // Only use these providers
	excludeProviders?: string[]; // Exclude these providers
}

/**
 * Omni Route - Select best model based on prompt and preferences
 */
export function omniRouteAdvanced(prompt: string, options: OmniRouteOptions = {}): OmniModelKey {
	const { preferFree = true, preferQuality = false, preferSpeed = false } = options;

	const taskType = detectTaskType(prompt);

	// Free-first routing (best free models)
	if (preferFree) {
		switch (taskType) {
			case "code":
				return "devstral"; // Mistral Devstral - best free for coding
			case "creative":
				return "minimax"; // MiniMax M2.1 - best free for creative
			case "fast":
				return "groq-llama"; // Groq - fastest inference
			case "analysis":
				return "deepseek-free"; // DeepSeek V3.1 - great for analysis
			default:
				return "gemini-flash"; // Gemini 2.5 Flash - best general free
		}
	}

	// Quality-first routing
	if (preferQuality) {
		switch (taskType) {
			case "code":
				return "glm-4.7"; // Top coding model
			case "creative":
				return "sonnet"; // Best creative quality
			case "analysis":
				return "sonnet"; // Best analysis
			default:
				return "sonnet"; // Best overall quality
		}
	}

	// Speed-first routing
	if (preferSpeed) {
		switch (taskType) {
			case "code":
				return "cerebras-llama"; // Fastest inference (2100+ tok/s)
			case "creative":
				return "haiku"; // Fast Claude
			default:
				return "cerebras-llama"; // Fastest inference (2100+ tok/s)
		}
	}

	// Balanced routing (cost-effective with good quality)
	switch (taskType) {
		case "code":
			return "glm-4.7"; // Best coding
		case "creative":
			return "minimax"; // Free creative
		case "analysis":
			return "grok"; // Free analysis
		case "fast":
			return "glm-4.5-air"; // Fast
		default:
			return "grok"; // Free default
	}
}

export interface OmniResult {
	success: boolean;
	output: string;
	error?: string;
	duration: number;
	model: string;
	provider: string;
	taskType: TaskType;
	free: boolean;
}

export interface OmniOptions {
	prompt: string;
	model?: OmniModelKey; // Override auto-selection
	systemPrompt?: string;
	timeout?: number;
	preferFree?: boolean;
	preferQuality?: boolean;
	preferSpeed?: boolean;
}

/**
 * Run with Omni - Unified execution across all providers
 */
export async function runOmni(options: OmniOptions): Promise<OmniResult> {
	const {
		prompt,
		model: modelOverride,
		systemPrompt,
		timeout = 60000,
		preferFree = true,
		preferQuality = false,
		preferSpeed = false,
	} = options;

	const taskType = detectTaskType(prompt);
	const selectedModel = modelOverride || omniRouteAdvanced(prompt, { preferFree, preferQuality, preferSpeed });
	const modelConfig = OMNI_MODELS[selectedModel];

	const startTime = Date.now();

	try {
		let result: AgentResult | OpenCodeResult;

		// Route to appropriate executor based on provider
		switch (modelConfig.provider) {
			case "opencode":
				// Use OpenCode SDK for Zen free models
				result = await runOpenCodeAgent({
					prompt,
					model: selectedModel as "grok" | "minimax" | "pickle",
					systemPrompt,
					timeout,
				});
				break;
			default: {
				// Use pi-agent-core for all other providers
				// Map to lightweight-agent model key or use direct model ID
				const lightweightKey = mapToLightweightModel(selectedModel, modelConfig);
				result = await runAgent({
					prompt,
					model: lightweightKey,
					systemPrompt,
					timeout,
				});
				break;
			}
		}

		return {
			success: result.success,
			output: result.output,
			error: result.error,
			duration: result.duration,
			model: modelConfig.model,
			provider: modelConfig.provider,
			taskType,
			free: modelConfig.free,
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: error instanceof Error ? error.message : String(error),
			duration: Date.now() - startTime,
			model: modelConfig.model,
			provider: modelConfig.provider,
			taskType,
			free: modelConfig.free,
		};
	}
}

/**
 * Get model info
 */
export function getOmniModelInfo(model: OmniModelKey) {
	return OMNI_MODELS[model];
}

/**
 * List all available models
 */
export function listOmniModels() {
	return Object.entries(OMNI_MODELS).map(([key, config]) => ({
		key,
		...config,
	}));
}

/**
 * List free models only
 */
export function listFreeModels() {
	return listOmniModels().filter((m) => m.free);
}

/**
 * Omni Presets
 */
export const OmniPresets = {
	/** Auto-route with free preference */
	auto: (prompt: string): OmniOptions => ({
		prompt,
		preferFree: true,
	}),

	/** Best quality (paid models) */
	quality: (prompt: string): OmniOptions => ({
		prompt,
		preferFree: false,
		preferQuality: true,
	}),

	/** Fastest response */
	fast: (prompt: string): OmniOptions => ({
		prompt,
		preferSpeed: true,
	}),

	/** Ultra-fast with Cerebras (2100+ tok/s) */
	ultrafast: (prompt: string): OmniOptions => ({
		prompt,
		model: "cerebras-llama",
	}),

	/** Force free models only */
	free: (prompt: string): OmniOptions => ({
		prompt,
		preferFree: true,
	}),

	/** Code with GLM-4.7 (best coding) */
	code: (task: string): OmniOptions => ({
		prompt: task,
		model: "glm-4.7",
	}),

	/** Creative with MiniMax (free) */
	creative: (prompt: string): OmniOptions => ({
		prompt,
		model: "minimax",
	}),

	/** Trading analysis */
	trading: (symbol: string, data: string): OmniOptions => ({
		prompt: `Analyze trading data for ${symbol}:\n\n${data}`,
		model: "grok",
		systemPrompt: "You are a quantitative trading analyst. Provide data-driven insights.",
	}),

	/** Local model with Phi-4 (best local reasoning) */
	local: (prompt: string): OmniOptions => ({
		prompt,
		model: "local-phi4",
	}),

	/** Local code with Devstral */
	localCode: (prompt: string): OmniOptions => ({
		prompt,
		model: "local-devstral",
	}),

	/** HF Router with GPT-OSS-120B (quality) */
	hfRouter: (prompt: string): OmniOptions => ({
		prompt,
		model: "hfr-gpt-oss-120b",
	}),

	/** HF Router DeepSeek V3 (code) */
	hfrCode: (prompt: string): OmniOptions => ({
		prompt,
		model: "hfr-deepseek-v3",
	}),

	/** HF Router Qwen3 Next (reasoning) */
	hfrReasoning: (prompt: string): OmniOptions => ({
		prompt,
		model: "hfr-qwen3-next",
	}),

	/** HF Router Llama 8B (fast) */
	hfrFast: (prompt: string): OmniOptions => ({
		prompt,
		model: "hfr-llama-8b",
	}),
};

/**
 * Check if HuggingFace Router is available (requires HF_TOKEN with Inference Providers permission)
 */
export async function isHFRouterAvailable(): Promise<boolean> {
	try {
		const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
		if (!token) return false;

		// Test with a simple models endpoint
		const response = await fetch("https://router.huggingface.co/v1/models", {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(5000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Check if Ollama is available locally
 */
export async function isOllamaAvailable(): Promise<boolean> {
	try {
		const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
		const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * List available local Ollama models
 */
export async function listLocalModels(): Promise<string[]> {
	try {
		const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
		const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) return [];
		const data = (await response.json()) as { models?: Array<{ name: string }> };
		return data.models?.map((m) => m.name) || [];
	} catch {
		return [];
	}
}
