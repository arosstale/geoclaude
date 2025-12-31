/**
 * Discord-LiveKit Voice Bridge
 * Bidirectional audio streaming between Discord voice channels and LiveKit rooms
 *
 * Audio Flow Architecture:
 * ========================
 *
 * Discord → LiveKit:
 * ------------------
 * Discord Voice (Opus) → prism-media Opus Decoder → PCM (48kHz stereo)
 *                                                   ↓
 *                                        LiveKit (requires server SDK or WebRTC)
 *
 * LiveKit → Discord:
 * ------------------
 * LiveKit (PCM) → prism-media Opus Encoder → Discord Voice (Opus)
 *
 * Technical Details:
 * ------------------
 * - Sample Rate: 48000 Hz (Discord standard)
 * - Channels: 2 (stereo)
 * - Frame Size: 960 samples (20ms at 48kHz)
 * - Codec: Opus (both directions)
 * - PCM Format: Signed 16-bit little-endian
 *
 * Dependencies:
 * -------------
 * - @discordjs/voice: Discord voice connection management
 * - @discordjs/opus: Opus codec bindings
 * - prism-media: Audio stream processing (Opus encoder/decoder)
 * - livekit-client: LiveKit room connection (optional)
 *
 * Production Notes:
 * -----------------
 * Publishing audio to LiveKit from Node.js requires additional setup:
 * 1. Use livekit-server-sdk instead of livekit-client for server environments
 * 2. Or implement WebRTC peer connection with node-webrtc
 * 3. Or stream through a media server that bridges to LiveKit
 *
 * The current implementation fully handles Discord ↔ PCM conversion.
 * LiveKit publishing is stubbed and requires production WebRTC setup.
 */

import { pipeline, Transform } from "node:stream";
import { promisify } from "node:util";
import {
	type AudioPlayer,
	AudioPlayerStatus,
	type AudioReceiveStream,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
	StreamType,
	type VoiceConnection,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import * as prism from "prism-media";

const _pipelineAsync = promisify(pipeline);

// LiveKit types - will be available if livekit-client is installed
interface LiveKitRoom {
	connect(url: string, token: string): Promise<void>;
	disconnect(): Promise<void>;
	localParticipant: LiveKitLocalParticipant;
	participants: Map<string, LiveKitRemoteParticipant>;
	on(event: string, handler: (...args: unknown[]) => void): void;
	off(event: string, handler: (...args: unknown[]) => void): void;
}

interface LiveKitLocalParticipant {
	publishTrack(track: LiveKitLocalAudioTrack): Promise<void>;
	unpublishTrack(track: LiveKitLocalAudioTrack): Promise<void>;
}

interface LiveKitRemoteParticipant {
	identity: string;
	audioTracks: Map<string, LiveKitRemoteTrackPublication>;
}

interface LiveKitRemoteTrackPublication {
	track: LiveKitRemoteAudioTrack | null;
}

interface LiveKitRemoteAudioTrack {
	attach(): HTMLMediaElement;
	detach(): void;
	on(event: string, handler: (...args: unknown[]) => void): void;
}

interface LiveKitLocalAudioTrack {
	stop(): void;
}

export interface BridgeOptions {
	/** Discord voice channel to bridge */
	discordChannel: VoiceChannel;
	/** LiveKit room name */
	livekitRoom: string;
	/** LiveKit server URL */
	livekitUrl?: string;
	/** LiveKit access token */
	livekitToken?: string;
	/** Enable bidirectional audio (default: true) */
	bidirectional?: boolean;
	/** Debug logging (default: false) */
	debug?: boolean;
}

export interface BridgeStatus {
	connected: boolean;
	discordUsers: number;
	livekitParticipants: number;
	error?: string;
}

export class DiscordLiveKitBridge {
	private options: Required<BridgeOptions>;
	private discordConnection: VoiceConnection | null = null;
	private audioPlayer: AudioPlayer | null = null;
	private livekitRoom: LiveKitRoom | null = null;
	private livekitAvailable = false;
	private userStreams: Map<string, AudioReceiveStream> = new Map();
	private opusDecoders: Map<string, prism.opus.Decoder> = new Map();
	private activeParticipants = new Set<string>();
	private isRunning = false;

	// Audio processing
	private readonly SAMPLE_RATE = 48000;
	private readonly CHANNELS = 2;
	private readonly FRAME_SIZE = 960; // 20ms at 48kHz

	constructor(options: BridgeOptions) {
		this.options = {
			livekitUrl: process.env.LIVEKIT_URL || "wss://livekit.example.com",
			livekitToken: process.env.LIVEKIT_TOKEN || "",
			bidirectional: true,
			debug: false,
			...options,
		};

		// Check LiveKit availability
		try {
			// Try to import livekit-client (dynamic import for optional dependency)
			require.resolve("livekit-client");
			this.livekitAvailable = true;
		} catch {
			this.livekitAvailable = false;
			console.warn("[Bridge] livekit-client not installed. Install with: npm install livekit-client");
		}
	}

	/**
	 * Start bridging audio between Discord and LiveKit
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error("Bridge already running");
		}

		if (!this.livekitAvailable) {
			throw new Error("LiveKit client not available. Install livekit-client package to enable bridging.");
		}

		this.log("Starting bridge...");

		try {
			// Join Discord voice channel
			await this.connectDiscord();

			// Connect to LiveKit room
			await this.connectLiveKit();

			// Set up audio bridging
			if (this.options.bidirectional) {
				this.setupDiscordToLiveKit();
				this.setupLiveKitToDiscord();
			} else {
				// Unidirectional: Discord → LiveKit only
				this.setupDiscordToLiveKit();
			}

			this.isRunning = true;
			this.log("Bridge started successfully");
		} catch (error) {
			this.log("Failed to start bridge:", error);
			await this.cleanup();
			throw error;
		}
	}

	/**
	 * Stop bridging and cleanup resources
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.log("Stopping bridge...");
		await this.cleanup();
		this.isRunning = false;
		this.log("Bridge stopped");
	}

	/**
	 * Get current bridge status
	 */
	getStatus(): BridgeStatus {
		if (!this.isRunning) {
			return {
				connected: false,
				discordUsers: 0,
				livekitParticipants: 0,
			};
		}

		return {
			connected: true,
			discordUsers: this.userStreams.size,
			livekitParticipants: this.activeParticipants.size,
		};
	}

	/**
	 * Connect to Discord voice channel
	 */
	private async connectDiscord(): Promise<void> {
		this.log("Connecting to Discord voice channel...");

		this.discordConnection = joinVoiceChannel({
			channelId: this.options.discordChannel.id,
			guildId: this.options.discordChannel.guild.id,
			adapterCreator: this.options.discordChannel.guild.voiceAdapterCreator,
			selfDeaf: false,
			selfMute: false,
		});

		// Wait for connection to be ready
		await entersState(this.discordConnection, VoiceConnectionStatus.Ready, 10000);

		// Create audio player for playback
		this.audioPlayer = createAudioPlayer();
		this.discordConnection.subscribe(this.audioPlayer);

		// Handle disconnection
		this.discordConnection.on(VoiceConnectionStatus.Disconnected, async () => {
			this.log("Discord connection lost, attempting to reconnect...");
			try {
				await Promise.race([
					entersState(this.discordConnection!, VoiceConnectionStatus.Signalling, 5000),
					entersState(this.discordConnection!, VoiceConnectionStatus.Connecting, 5000),
				]);
			} catch {
				this.log("Discord reconnection failed, stopping bridge");
				await this.stop();
			}
		});

		this.log("Connected to Discord voice channel");
	}

	/**
	 * Connect to LiveKit room
	 */
	private async connectLiveKit(): Promise<void> {
		if (!this.livekitAvailable) {
			throw new Error("LiveKit client not available");
		}

		this.log("Connecting to LiveKit room...");

		try {
			// Dynamic import since livekit-client may not be installed
			const { Room } = await import("livekit-client");

			// Room constructor accepts RoomOptions (optional)
			this.livekitRoom = new Room() as unknown as LiveKitRoom;

			// Set up event handlers
			this.livekitRoom.on("participantConnected", (...args: unknown[]) => {
				const participant = args[0] as LiveKitRemoteParticipant;
				this.log(`LiveKit participant joined: ${participant.identity}`);
				this.activeParticipants.add(participant.identity);
			});

			this.livekitRoom.on("participantDisconnected", (...args: unknown[]) => {
				const participant = args[0] as LiveKitRemoteParticipant;
				this.log(`LiveKit participant left: ${participant.identity}`);
				this.activeParticipants.delete(participant.identity);
			});

			this.livekitRoom.on("disconnected", () => {
				this.log("LiveKit room disconnected");
				this.stop();
			});

			// Connect to room
			await this.livekitRoom.connect(this.options.livekitUrl, this.options.livekitToken);

			this.log("Connected to LiveKit room");
		} catch (error) {
			this.log("Failed to connect to LiveKit:", error);
			throw error;
		}
	}

	/**
	 * Set up Discord → LiveKit audio forwarding
	 */
	private setupDiscordToLiveKit(): void {
		if (!this.discordConnection || !this.livekitRoom) {
			return;
		}

		this.log("Setting up Discord → LiveKit audio forwarding");

		const receiver = this.discordConnection.receiver;

		// Listen for users speaking
		receiver.speaking.on("start", (userId) => {
			this.log(`Discord user started speaking: ${userId}`);

			// Subscribe to user's audio stream
			const audioStream = receiver.subscribe(userId, {
				end: {
					behavior: 1, // EndBehaviorType.AfterSilence
					duration: 100,
				},
			});

			this.userStreams.set(userId, audioStream);

			// Forward audio to LiveKit
			this.forwardDiscordAudioToLiveKit(userId, audioStream);
		});

		receiver.speaking.on("end", (userId) => {
			this.log(`Discord user stopped speaking: ${userId}`);

			// Clean up stream
			const stream = this.userStreams.get(userId);
			if (stream) {
				stream.destroy();
				this.userStreams.delete(userId);
			}

			// Clean up decoder
			const decoder = this.opusDecoders.get(userId);
			if (decoder && !decoder.destroyed) {
				decoder.destroy();
				this.opusDecoders.delete(userId);
			}
		});
	}

	/**
	 * Set up LiveKit → Discord audio forwarding
	 */
	private setupLiveKitToDiscord(): void {
		if (!this.livekitRoom || !this.audioPlayer) {
			return;
		}

		this.log("Setting up LiveKit → Discord audio forwarding");

		// Handle track subscribed
		this.livekitRoom.on("trackSubscribed", (...args: unknown[]) => {
			const track = args[0] as LiveKitRemoteAudioTrack;
			const participant = args[2] as LiveKitRemoteParticipant;
			this.log(`LiveKit track subscribed from: ${participant.identity}`);

			// Forward audio to Discord
			this.forwardLiveKitAudioToDiscord(track, participant.identity);
		});
	}

	/**
	 * Forward Discord user audio to LiveKit
	 */
	private async forwardDiscordAudioToLiveKit(userId: string, stream: AudioReceiveStream): Promise<void> {
		if (!this.livekitRoom) return;

		try {
			// Discord provides Opus-encoded audio stream
			// We need to decode it to PCM for LiveKit
			const opusDecoder = new prism.opus.Decoder({
				rate: this.SAMPLE_RATE,
				channels: this.CHANNELS,
				frameSize: this.FRAME_SIZE,
			});

			// Store decoder for cleanup
			this.opusDecoders.set(userId, opusDecoder);

			// Collect PCM chunks for batching
			const pcmChunks: Buffer[] = [];
			let isProcessing = false;

			// Pipe Discord Opus stream through decoder
			stream.pipe(opusDecoder);

			opusDecoder.on("data", (pcmChunk: Buffer) => {
				pcmChunks.push(pcmChunk);

				// Batch processing to reduce overhead (accumulate ~200ms of audio)
				if (!isProcessing && pcmChunks.length >= 10) {
					isProcessing = true;
					setImmediate(() => {
						if (pcmChunks.length > 0) {
							const batchedPCM = Buffer.concat(pcmChunks.splice(0));
							this.publishPCMToLiveKit(userId, batchedPCM).catch((error) => {
								this.log(`Error publishing PCM to LiveKit:`, error);
							});
						}
						isProcessing = false;
					});
				}
			});

			opusDecoder.on("end", async () => {
				// Flush remaining chunks
				if (pcmChunks.length > 0) {
					const finalPCM = Buffer.concat(pcmChunks);
					await this.publishPCMToLiveKit(userId, finalPCM);
				}
				this.log(`Discord audio stream ended for user ${userId}`);

				// Clean up decoder reference
				this.opusDecoders.delete(userId);
			});

			opusDecoder.on("error", (error) => {
				this.log(`Error decoding Discord audio for ${userId}:`, error);
				this.opusDecoders.delete(userId);
			});

			stream.on("error", (error) => {
				this.log(`Error in Discord audio stream for ${userId}:`, error);
				if (!opusDecoder.destroyed) {
					opusDecoder.destroy();
				}
				this.opusDecoders.delete(userId);
			});
		} catch (error) {
			this.log(`Failed to forward Discord audio to LiveKit:`, error);
			this.opusDecoders.delete(userId);
		}
	}

	/**
	 * Publish PCM audio to LiveKit
	 */
	private async publishPCMToLiveKit(userId: string, pcmData: Buffer): Promise<void> {
		if (!this.livekitRoom) return;

		// Note: Publishing audio to LiveKit from Node.js requires creating a LocalAudioTrack
		// This is complex because LiveKit expects browser MediaStreamTrack objects
		// In a server environment, you'd typically:
		// 1. Use livekit-server-sdk instead of livekit-client
		// 2. Or use a WebRTC library that supports Node.js (like node-webrtc)
		// 3. Or stream through a media server

		this.log(`Would publish ${pcmData.length} bytes of PCM from Discord user ${userId} to LiveKit`);

		// For production, consider:
		// - Using LiveKit server SDK's track publishing
		// - Creating a WebRTC peer connection with node-webrtc
		// - Streaming to a media server that bridges to LiveKit

		// Placeholder for actual implementation
		// const audioTrack = await createLocalAudioTrack(pcmData);
		// await this.livekitRoom.localParticipant.publishTrack(audioTrack);
	}

	/**
	 * Forward LiveKit participant audio to Discord
	 */
	private forwardLiveKitAudioToDiscord(track: LiveKitRemoteAudioTrack, participantId: string): void {
		if (!this.audioPlayer) return;

		try {
			// Create a passthrough stream to collect PCM data
			const pcmStream = new Transform({
				transform(chunk: Buffer, _encoding, callback) {
					callback(null, chunk);
				},
			});

			// Create Opus encoder for Discord
			const opusEncoder = new prism.opus.Encoder({
				rate: this.SAMPLE_RATE,
				channels: this.CHANNELS,
				frameSize: this.FRAME_SIZE,
			});

			// Handle encoder errors
			opusEncoder.on("error", (error) => {
				this.log(`Opus encoder error for LiveKit participant ${participantId}:`, error);
			});

			// Listen for audio data from LiveKit
			track.on("audiodata", (...args: unknown[]) => {
				const pcmData = args[0] as Buffer;
				this.log(`Received ${pcmData.length} bytes from LiveKit participant ${participantId}`);

				// Write PCM data to stream
				if (!pcmStream.destroyed) {
					pcmStream.write(pcmData);
				}
			});

			// Handle track end
			track.on("ended", () => {
				this.log(`LiveKit track ended for participant ${participantId}`);
				if (!pcmStream.destroyed) {
					pcmStream.end();
				}
			});

			// Pipe PCM through Opus encoder
			pcmStream.pipe(opusEncoder);

			// Create audio resource from Opus stream
			const resource = createAudioResource(opusEncoder, {
				inputType: StreamType.Opus,
			});

			// Handle player state changes
			this.audioPlayer!.on(AudioPlayerStatus.Idle, () => {
				this.log(`Audio player idle, ready for next track`);
			});

			this.audioPlayer!.on("error", (error) => {
				this.log(`Audio player error:`, error);
				// Clean up streams on error
				if (!pcmStream.destroyed) pcmStream.destroy();
				if (!opusEncoder.destroyed) opusEncoder.destroy();
			});

			// Play the audio
			this.audioPlayer!.play(resource);
			this.log(`Started playing LiveKit audio from ${participantId}`);
		} catch (error) {
			this.log(`Failed to forward LiveKit audio to Discord:`, error);
		}
	}

	/**
	 * Cleanup all resources
	 */
	private async cleanup(): Promise<void> {
		// Clean up Discord connection
		if (this.discordConnection) {
			this.discordConnection.destroy();
			this.discordConnection = null;
		}

		this.audioPlayer = null;

		// Clean up user streams
		this.userStreams.forEach((stream) => {
			stream.destroy();
		});
		this.userStreams.clear();

		// Clean up opus decoders
		this.opusDecoders.forEach((decoder) => {
			if (!decoder.destroyed) {
				decoder.destroy();
			}
		});
		this.opusDecoders.clear();

		// Clean up LiveKit connection
		if (this.livekitRoom) {
			try {
				await this.livekitRoom.disconnect();
			} catch (error) {
				this.log("Error disconnecting from LiveKit:", error);
			}
			this.livekitRoom = null;
		}

		this.activeParticipants.clear();
	}

	/**
	 * Debug logging
	 */
	private log(message: string, ...args: unknown[]): void {
		if (this.options.debug) {
			console.log(`[DiscordLiveKitBridge] ${message}`, ...args);
		}
	}
}

/**
 * Create a new Discord-LiveKit bridge instance
 */
export function createBridge(options: BridgeOptions): DiscordLiveKitBridge {
	return new DiscordLiveKitBridge(options);
}

/**
 * Check if LiveKit client is available
 */
export function isLiveKitAvailable(): boolean {
	try {
		require.resolve("livekit-client");
		return true;
	} catch {
		return false;
	}
}
