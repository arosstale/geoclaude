# GeoClaude - Geospatial AI Insights

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://github.com/arosstale/geoclaude-extension)

> 🌍 Get AI-powered insights about any location on the web, powered by Anthropic's Claude.

## Features

✨ **Real Geospatial Intelligence**
- Automatic location detection using browser Geolocation API
- Reverse geocoding via OpenStreetMap (no API key required)
- Location context automatically included in AI conversations

🤖 **Powered by Claude 3 Haiku**
- Fast, intelligent responses from Anthropic's Claude
- Context-aware responses based on your current location
- Natural language conversations about places

💬 **Beautiful Chat Interface**
- Side panel chat with message history
- Quick action buttons for common queries
- Loading states and error handling
- Dark mode UI by default

🔒 **Privacy First**
- API key stored locally in browser
- Chat history saved locally (last 100 messages)
- No external tracking or analytics

## Installation

1. **Clone the repository**
```bash
git clone https://github.com/arosstale/geoclaude-extension.git
cd geoclaude-extension
```

2. **Open Chrome Extensions**
   - Go to `chrome://extensions/`
   - Enable **Developer Mode** (top right toggle)

3. **Load the extension**
   - Click **"Load unpacked"**
   - Select the cloned `geoclaude-extension` folder

## Setup

### 1. Get an Anthropic API Key

1. Visit [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Navigate to **API Keys**
4. Click **"Create Key"**
5. Copy the key (starts with `sk-ant-`)

### 2. Configure GeoClaude

1. Click the GeoClaude icon in your browser toolbar
2. Click **⚙️ Settings** button
3. Paste your API key
4. Click **Save API Key**

### 3. Enable Location

1. When prompted, allow location access
2. GeoClaude will automatically detect your coordinates

## Usage

### Open the Side Panel

- Click the GeoClaude extension icon
- Click **"Open Side Panel"**

### Chat with Claude

**Quick Actions:**
- 🔍 Explore area
- 🍽️ Restaurants
- 🎯 Attractions
- 🎨 Culture

**Or type any question about your location!**

## License

MIT License - see [LICENSE](LICENSE) file for details

---

Made with ❤️ by the GeoClaude team
