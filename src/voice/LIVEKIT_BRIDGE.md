# Discord-LiveKit Bridge

Bidirectional audio streaming between Discord voice channels and LiveKit rooms.

## Installation

```bash
# Required: Install LiveKit client SDK
npm install livekit-client

# The bridge also requires @discordjs/voice (already installed)
```

## Quick Start

```typescript
import { createBridge, isLiveKitAvailable } from "./voice/index.js";
import type { VoiceChannel } from "discord.js";

// Check availability
if (!isLiveKitAvailable()) {
  console.error("LiveKit client not installed");
  process.exit(1);
}

// Create and start bridge
const bridge = createBridge({
  discordChannel: myVoiceChannel,
  livekitRoom: "my-room",
  livekitUrl: "wss://livekit.example.com",
  livekitToken: "your-token",
  bidirectional: true,
  debug: true,
});

await bridge.start();

// Get status
const status = bridge.getStatus();
console.log(status);
// { connected: true, discordUsers: 3, livekitParticipants: 5 }

// Stop bridge
await bridge.stop();
```

## Features

### Bidirectional Audio
- **Discord → LiveKit**: Forward Discord users' voice to LiveKit room
- **LiveKit → Discord**: Forward LiveKit participants' audio to Discord channel
- **Unidirectional Mode**: Disable bidirectional for broadcast-only scenarios

### Real-time Monitoring
- Track connected Discord users
- Track LiveKit participants
- Connection status monitoring
- Automatic reconnection handling

### Resource Management
- Automatic cleanup on disconnect
- Proper stream disposal
- Memory-efficient audio buffering
- Graceful shutdown

## API Reference

### `createBridge(options: BridgeOptions): DiscordLiveKitBridge`

Creates a new bridge instance.

**Options:**
```typescript
interface BridgeOptions {
  // Required
  discordChannel: VoiceChannel;  // Discord voice channel
  livekitRoom: string;           // LiveKit room name

  // Optional (defaults shown)
  livekitUrl?: string;           // LiveKit server URL (from LIVEKIT_URL env)
  livekitToken?: string;         // Access token (from LIVEKIT_TOKEN env)
  bidirectional?: boolean;       // Enable two-way audio (default: true)
  debug?: boolean;               // Debug logging (default: false)
}
```

### `isLiveKitAvailable(): boolean`

Checks if `livekit-client` package is installed.

```typescript
if (!isLiveKitAvailable()) {
  console.log("Please install: npm install livekit-client");
}
```

### Bridge Methods

#### `async start(): Promise<void>`

Starts the bridge. Throws error if:
- LiveKit client not available
- Bridge already running
- Connection fails

```typescript
try {
  await bridge.start();
  console.log("Bridge started");
} catch (error) {
  console.error("Failed to start:", error);
}
```

#### `async stop(): Promise<void>`

Stops the bridge and cleans up all resources.

```typescript
await bridge.stop();
```

#### `getStatus(): BridgeStatus`

Returns current bridge status.

```typescript
interface BridgeStatus {
  connected: boolean;
  discordUsers: number;
  livekitParticipants: number;
  error?: string;
}

const status = bridge.getStatus();
if (status.connected) {
  console.log(`Users: ${status.discordUsers}, Participants: ${status.livekitParticipants}`);
}
```

## Usage Examples

### Basic Bridge

```typescript
const bridge = createBridge({
  discordChannel: voiceChannel,
  livekitRoom: "general-chat",
});

await bridge.start();
```

### Unidirectional (Discord → LiveKit)

```typescript
const bridge = createBridge({
  discordChannel: voiceChannel,
  livekitRoom: "broadcast-room",
  bidirectional: false,  // Only Discord → LiveKit
});

await bridge.start();
```

### With Custom LiveKit Server

```typescript
const bridge = createBridge({
  discordChannel: voiceChannel,
  livekitRoom: "custom-room",
  livekitUrl: "wss://livekit.myserver.com",
  livekitToken: await generateLiveKitToken(),
});

await bridge.start();
```

### Status Monitoring

```typescript
const bridge = createBridge({
  discordChannel: voiceChannel,
  livekitRoom: "monitored-room",
  debug: true,
});

await bridge.start();

// Monitor every 10 seconds
const monitor = setInterval(() => {
  const status = bridge.getStatus();

  if (!status.connected) {
    console.log("Bridge disconnected!");
    clearInterval(monitor);
    return;
  }

  console.log(`Discord: ${status.discordUsers} users`);
  console.log(`LiveKit: ${status.livekitParticipants} participants`);
}, 10000);
```

### Error Handling with Retry

```typescript
async function startWithRetry(bridge, maxAttempts = 3) {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      await bridge.start();
      console.log("Bridge started successfully");
      return;
    } catch (error) {
      attempts++;
      console.error(`Attempt ${attempts} failed:`, error);

      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  throw new Error("Failed to start bridge after max attempts");
}

await startWithRetry(bridge);
```

### Integration with Discord Bot

```typescript
// Store active bridges per guild
const bridges = new Map();

// /bridge start <room> command
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === "bridge") {
    const room = interaction.options.getString("room");
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply("Join a voice channel first!");
      return;
    }

    const bridge = createBridge({
      discordChannel: voiceChannel,
      livekitRoom: room,
    });

    await bridge.start();
    bridges.set(interaction.guildId, bridge);

    await interaction.reply(`Bridge to ${room} started!`);
  }
});

// Cleanup on shutdown
process.on("SIGINT", async () => {
  for (const bridge of bridges.values()) {
    await bridge.stop();
  }
  process.exit(0);
});
```

## Environment Variables

```bash
# LiveKit server URL (optional - can pass in options)
LIVEKIT_URL=wss://livekit.example.com

# LiveKit access token (optional - can pass in options)
LIVEKIT_TOKEN=your-access-token-here
```

## Audio Processing

The bridge handles audio format conversion:

- **Discord**: Opus codec (48kHz, stereo)
- **LiveKit**: PCM format (configurable)

### Current Implementation

The bridge currently includes:
- ✅ Connection management (Discord ↔ LiveKit)
- ✅ Participant tracking
- ✅ Event handling
- ⚠️ Audio forwarding (stub - needs implementation)

### Audio Conversion TODO

For full audio bridging, implement:

1. **Opus Decoding** (Discord → PCM)
   - Use `@discordjs/opus` or `opusscript`
   - Decode Opus packets to PCM samples

2. **PCM → MediaStreamTrack** (for LiveKit publishing)
   - Create MediaStream from PCM data
   - Requires Web Audio API or equivalent in Node.js
   - Consider using `node-webrtc` or similar

3. **LiveKit Audio → Opus** (LiveKit → Discord)
   - Receive PCM from LiveKit participants
   - Encode to Opus for Discord playback
   - Use `@discordjs/opus` encoder

### Example Audio Pipeline

```
Discord User Speaks:
  Opus Stream → Decode to PCM → Create MediaStreamTrack → Publish to LiveKit

LiveKit Participant Speaks:
  Receive PCM → Encode to Opus → Create Audio Resource → Play in Discord
```

## Limitations

1. **LiveKit Client Required**: Must install `livekit-client` separately
2. **Audio Conversion**: Current implementation includes conversion stubs
3. **Node.js Environment**: Web Audio APIs not directly available
4. **Latency**: Real-time bridging has inherent network latency

## Troubleshooting

### "LiveKit client not available"
Install the package:
```bash
npm install livekit-client
```

### Connection Fails
- Verify `livekitUrl` and `livekitToken` are correct
- Check LiveKit server is accessible
- Ensure token has required permissions

### No Audio Forwarding
- Current implementation includes audio conversion stubs
- Implement Opus ↔ PCM conversion for full functionality
- Check `debug: true` for detailed logs

### Bridge Disconnects
- Check network stability
- Monitor Discord connection status
- Verify LiveKit room still exists

## Advanced Usage

### Multiple Rooms

```typescript
const bridges = [
  createBridge({
    discordChannel: channel1,
    livekitRoom: "room-1",
  }),
  createBridge({
    discordChannel: channel2,
    livekitRoom: "room-2",
  }),
];

await Promise.all(bridges.map(b => b.start()));
```

### Dynamic Room Switching

```typescript
let currentBridge = null;

async function switchRoom(channel, newRoom) {
  if (currentBridge) {
    await currentBridge.stop();
  }

  currentBridge = createBridge({
    discordChannel: channel,
    livekitRoom: newRoom,
  });

  await currentBridge.start();
}
```

### Metrics Collection

```typescript
const bridge = createBridge({ /* ... */ });

await bridge.start();

// Collect metrics
setInterval(() => {
  const status = bridge.getStatus();

  // Send to monitoring service
  metrics.gauge("discord.users", status.discordUsers);
  metrics.gauge("livekit.participants", status.livekitParticipants);
  metrics.gauge("bridge.connected", status.connected ? 1 : 0);
}, 60000);
```

## License

MIT

## See Also

- [LiveKit Documentation](https://docs.livekit.io/)
- [Discord.js Voice Guide](https://discordjs.guide/voice/)
- [@discordjs/voice](https://www.npmjs.com/package/@discordjs/voice)
- [livekit-client](https://www.npmjs.com/package/livekit-client)
