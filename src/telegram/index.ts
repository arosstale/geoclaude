/**
 * Pi Remote Agent - Telegram Module
 * Exports for Telegram bot integration
 */

export {
	bridgeMessage,
	type CrossPlatformMessage,
	createTelegramBot,
	EXPERT_MODES,
	getSession,
	// Webhook support
	getTelegramWebhookHandler,
	getWebhookPath,
	sessions,
	setDiscordClient,
	setupTelegramWebhook,
	shouldUseWebhook,
	TELEGRAM_USE_WEBHOOK,
	TELEGRAM_WEBHOOK_PATH,
} from "./telegram-bot.js";
