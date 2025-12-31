#!/usr/bin/env python3
"""
LiveKit Voice AI Agent Runner
Uses livekit-agents framework for real-time voice interactions.

Features:
- Multi-mode support: general, trading, coding, research
- Function tools: crypto prices, sentiment analysis
- Graceful fallback for missing API keys
- OpenAI TTS/STT and Deepgram STT support

Usage:
    python livekit-voice-runner.py --room <room_name> --mode <mode> --voice <voice>
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Annotated

# Check for LiveKit agents installation
try:
    from livekit import agents, rtc
    from livekit.agents import JobContext, WorkerOptions, cli
    from livekit.plugins import openai as openai_plugin
    LIVEKIT_AVAILABLE = True
except ImportError:
    LIVEKIT_AVAILABLE = False
    # Create dummy types for graceful fallback
    JobContext = None  # type: ignore
    WorkerOptions = None  # type: ignore
    logging.warning("LiveKit agents not installed. Run: pip install -r requirements-livekit.txt")

# Check for Deepgram
try:
    from livekit.plugins import deepgram
    DEEPGRAM_AVAILABLE = True
except ImportError:
    DEEPGRAM_AVAILABLE = False

# Check for Silero VAD
try:
    from livekit.plugins import silero
    SILERO_AVAILABLE = True
except ImportError:
    SILERO_AVAILABLE = False

logger = logging.getLogger("livekit-voice-agent")
logger.setLevel(logging.INFO)


# =============================================================================
# FUNCTION TOOLS
# =============================================================================

async def get_crypto_price(symbol: Annotated[str, "Cryptocurrency symbol (e.g., BTC, ETH, SOL)"]) -> str:
    """Get current cryptocurrency price (mock implementation)."""
    # TODO: Integrate with real API (CoinGecko, DexScreener, etc.)
    mock_prices = {
        "BTC": "43250.50",
        "ETH": "2280.75",
        "SOL": "98.32",
        "USDT": "1.00",
        "BNB": "312.45",
        "ADA": "0.52",
        "DOGE": "0.08",
    }

    symbol_upper = symbol.upper()
    if symbol_upper in mock_prices:
        return f"{symbol_upper} is currently ${mock_prices[symbol_upper]} USD"
    else:
        return f"Sorry, I don't have price data for {symbol}. Available: {', '.join(mock_prices.keys())}"


async def analyze_sentiment(
    text: Annotated[str, "Text to analyze for sentiment"]
) -> str:
    """Analyze sentiment of text (basic implementation)."""
    text_lower = text.lower()

    # Simple keyword-based sentiment
    positive_keywords = ["bullish", "moon", "pump", "good", "great", "excellent", "profit", "gain"]
    negative_keywords = ["bearish", "dump", "bad", "terrible", "loss", "crash", "rekt"]

    positive_count = sum(1 for kw in positive_keywords if kw in text_lower)
    negative_count = sum(1 for kw in negative_keywords if kw in text_lower)

    if positive_count > negative_count:
        return f"Sentiment: POSITIVE ({positive_count} positive indicators)"
    elif negative_count > positive_count:
        return f"Sentiment: NEGATIVE ({negative_count} negative indicators)"
    else:
        return "Sentiment: NEUTRAL"


# =============================================================================
# MODE CONFIGURATIONS
# =============================================================================

MODE_INSTRUCTIONS = {
    "general": """You are Pi, a helpful AI voice assistant. Be friendly, conversational, and concise.
Keep responses brief since this is a voice conversation. Ask clarifying questions when needed.""",

    "trading": """You are Pi, an AI trading assistant specializing in cryptocurrency markets.
Help users analyze crypto prices, market trends, and sentiment. Use the get_crypto_price tool to check prices.
Use analyze_sentiment to evaluate market sentiment from news or social media.
Keep responses concise and actionable. Focus on risk management and data-driven insights.""",

    "coding": """You are Pi, an AI coding assistant. Help with programming questions, debugging,
code review, and software architecture. Be technical but clear. Provide code examples when relevant.
Keep explanations concise for voice interaction.""",

    "research": """You are Pi, an AI research assistant. Help users explore topics, find information,
and synthesize knowledge. Ask probing questions to understand research goals.
Provide structured, concise answers suitable for voice conversation.""",
}


# =============================================================================
# AGENT IMPLEMENTATION
# =============================================================================

class PiVoiceAgent:
    """Pi Voice AI Agent for LiveKit rooms."""

    def __init__(
        self,
        mode: str = "general",
        voice: str = "alloy",
    ):
        self.mode = mode
        self.voice = voice
        self.instructions = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["general"])

        # Check API keys
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.deepgram_key = os.getenv("DEEPGRAM_API_KEY")

        if not self.openai_key:
            logger.warning("OPENAI_API_KEY not set. TTS/LLM will not work.")
        if not self.deepgram_key:
            logger.warning("DEEPGRAM_API_KEY not set. Fallback to OpenAI STT.")

    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent."""
        logger.info(f"Starting Pi Voice Agent in '{self.mode}' mode")
        logger.info(f"Room: {ctx.room.name}")

        # Connect to room
        await ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)

        # Wait for participant
        participant = await ctx.wait_for_participant()
        logger.info(f"Participant joined: {participant.identity}")

        # Configure STT (Speech-to-Text)
        if self.deepgram_key and DEEPGRAM_AVAILABLE:
            logger.info("Using Deepgram for STT")
            stt = deepgram.STT()
        elif self.openai_key:
            logger.info("Using OpenAI Whisper for STT")
            stt = openai_plugin.STT()
        else:
            logger.error("No STT provider available!")
            return

        # Configure TTS (Text-to-Speech)
        if self.openai_key:
            logger.info(f"Using OpenAI TTS with voice: {self.voice}")
            tts = openai_plugin.TTS(voice=self.voice)
        else:
            logger.error("No TTS provider available!")
            return

        # Configure LLM
        if self.openai_key:
            logger.info("Using OpenAI LLM")
            llm = openai_plugin.LLM(model="gpt-4o-mini")
        else:
            logger.error("No LLM provider available!")
            return

        # Function context with tools
        fnc_ctx = openai_plugin.FunctionContext()
        fnc_ctx.ai_callable(get_crypto_price)
        fnc_ctx.ai_callable(analyze_sentiment)

        # Create assistant
        assistant = agents.VoiceAssistant(
            vad=silero.VAD.load() if SILERO_AVAILABLE else agents.vad.BuiltinVAD(),
            stt=stt,
            llm=llm,
            tts=tts,
            fnc_ctx=fnc_ctx,
            chat_ctx=agents.ChatContext(
                messages=[
                    agents.ChatMessage(
                        role="system",
                        content=self.instructions,
                    )
                ]
            ),
        )

        # Start the assistant
        assistant.start(ctx.room, participant)

        # Greeting
        await assistant.say(f"Hello! I'm Pi, your {self.mode} assistant. How can I help you today?")

        logger.info("Voice assistant started successfully")


# =============================================================================
# CLI
# =============================================================================

async def main_async(args):
    """Async main function."""
    if not LIVEKIT_AVAILABLE:
        print(json.dumps({
            "success": False,
            "error": "LiveKit agents not installed. Run: pip install -r requirements-livekit.txt"
        }))
        return 1

    # Validate environment
    livekit_url = os.getenv("LIVEKIT_URL")
    livekit_api_key = os.getenv("LIVEKIT_API_KEY")
    livekit_api_secret = os.getenv("LIVEKIT_API_SECRET")

    if not all([livekit_url, livekit_api_key, livekit_api_secret]):
        print(json.dumps({
            "success": False,
            "error": "Missing LiveKit credentials. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET"
        }))
        return 1

    if args.mode == "status":
        # Status check
        status = {
            "livekit_available": LIVEKIT_AVAILABLE,
            "deepgram_available": DEEPGRAM_AVAILABLE,
            "silero_available": SILERO_AVAILABLE,
            "openai_key": bool(os.getenv("OPENAI_API_KEY")),
            "deepgram_key": bool(os.getenv("DEEPGRAM_API_KEY")),
            "livekit_configured": bool(livekit_url and livekit_api_key and livekit_api_secret),
        }
        print(json.dumps(status))
        return 0

    # Create agent
    agent = PiVoiceAgent(mode=args.agent_mode, voice=args.voice)

    # Start worker
    logger.info(f"Starting LiveKit agent worker for room: {args.room}")

    try:
        # Run the agent
        await cli.run_app(
            WorkerOptions(
                entrypoint_fnc=agent.entrypoint,
                request_fnc=None,  # Auto-accept all jobs
                prewarm_fnc=None,
            )
        )

        print(json.dumps({
            "success": True,
            "room": args.room,
            "mode": args.agent_mode,
            "voice": args.voice,
        }))
        return 0

    except Exception as e:
        logger.error(f"Agent error: {e}", exc_info=True)
        print(json.dumps({
            "success": False,
            "error": str(e),
        }))
        return 1


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="LiveKit Voice AI Agent")
    parser.add_argument("--mode", choices=["start", "status"], default="start")
    parser.add_argument("--room", type=str, help="Room name to join")
    parser.add_argument("--agent-mode", type=str, default="general",
                       choices=["general", "trading", "coding", "research"],
                       help="Agent mode/personality")
    parser.add_argument("--voice", type=str, default="alloy",
                       choices=["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
                       help="OpenAI TTS voice")

    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    if args.mode == "status":
        # Status check (sync)
        asyncio.run(main_async(args))
        return

    if not args.room:
        print(json.dumps({
            "success": False,
            "error": "Room name required for start mode",
        }))
        sys.exit(1)

    # Run async
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        logger.info("Shutting down gracefully...")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
