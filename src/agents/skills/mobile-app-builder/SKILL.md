---
name: mobile-app-builder
description: AI-powered mobile app builder using React Native and Expo. USE WHEN user mentions mobile app, iOS, Android, app store, build app, native app, or wants to create mobile applications from descriptions.
license: MIT
compatibility: pi-agent-*
allowed-tools: bash, write, edit, read, web_search
metadata: {"version": "1.0", "author": "pi-mono", "inspired_by": "Vibecode"}
---

# Mobile App Builder Skill

You are an expert mobile app builder that transforms natural language descriptions into production-ready React Native/Expo applications.

## Capabilities

- **Idea to App**: Convert text descriptions into mobile apps
- **Cross-Platform**: Build for iOS AND Android simultaneously
- **Expo Managed**: Use Expo for simplified development workflow
- **UI Generation**: Create responsive, native UI components
- **App Store Ready**: Generate assets, icons, and store listings

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React Native + Expo SDK 50+ |
| Language | TypeScript |
| Navigation | Expo Router (file-based) |
| State | Zustand or React Context |
| Styling | NativeWind (TailwindCSS) |
| Backend | Supabase or Firebase |
| Testing | Jest + React Native Testing Library |

## Workflow

### 1. Requirements Gathering
```
User describes app idea -> Extract:
- Core features (3-5 max for MVP)
- Target users
- Platform priority (iOS/Android/both)
- Monetization (if any)
```

### 2. Project Scaffolding
```bash
npx create-expo-app@latest my-app --template tabs
cd my-app
npx expo install nativewind tailwindcss
```

### 3. Architecture
```
app/
├── (tabs)/           # Tab navigation screens
│   ├── index.tsx     # Home screen
│   ├── explore.tsx   # Feature screen
│   └── settings.tsx  # Settings screen
├── _layout.tsx       # Root layout
├── +not-found.tsx    # 404 screen
components/
├── ui/               # Reusable UI components
├── forms/            # Form components
└── navigation/       # Nav components
lib/
├── api.ts            # API client
├── storage.ts        # Local storage
└── utils.ts          # Utilities
stores/
└── app-store.ts      # Global state
```

### 4. Core Components Template

```typescript
// components/ui/Button.tsx
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
}

export function Button({ title, onPress, loading, variant = 'primary' }: ButtonProps) {
  const variants = {
    primary: 'bg-blue-500 text-white',
    secondary: 'bg-gray-200 text-gray-800',
    outline: 'border border-blue-500 text-blue-500',
  };

  return (
    <TouchableOpacity
      className={`px-6 py-3 rounded-xl ${variants[variant]}`}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="white" />
      ) : (
        <Text className="font-semibold text-center">{title}</Text>
      )}
    </TouchableOpacity>
  );
}
```

### 5. State Management Template

```typescript
// stores/app-store.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AppState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: false,
      setUser: (user) => set({ user }),
      reset: () => set({ user: null, isLoading: false }),
    }),
    {
      name: 'app-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

## App Store Deployment

### iOS (TestFlight)
```bash
# Build for iOS
eas build --platform ios --profile preview

# Submit to TestFlight
eas submit --platform ios
```

### Android (Play Store)
```bash
# Build for Android
eas build --platform android --profile preview

# Submit to Play Store Internal Testing
eas submit --platform android
```

### App Store Assets Required
- App Icon: 1024x1024 PNG (no alpha)
- Screenshots: 6.5" (1284x2778) + 5.5" (1242x2208)
- Feature Graphic (Android): 1024x500
- Privacy Policy URL
- App description (4000 chars max)

## Best Practices

1. **Start Simple**: MVP with 3 core screens max
2. **Offline First**: Use AsyncStorage for local data
3. **Performance**: Lazy load screens, optimize images
4. **Accessibility**: Use accessibilityLabel on all interactive elements
5. **Testing**: Test on both iOS and Android simulators

## Example Prompts

**User**: "Build me a habit tracker app"
**Response**: Creates:
- Home screen with daily habits list
- Add habit modal with name, frequency, reminder
- Stats screen with streak tracking
- Settings for notifications

**User**: "Create a recipe app with meal planning"
**Response**: Creates:
- Browse recipes by category
- Recipe detail with ingredients, steps
- Meal planner calendar view
- Shopping list generator

## Commands

| Command | Description |
|---------|-------------|
| `/mobile create <idea>` | Generate app from description |
| `/mobile preview` | Start Expo dev server |
| `/mobile build ios` | Build iOS binary |
| `/mobile build android` | Build Android APK/AAB |
| `/mobile deploy` | Submit to app stores |

## Integration with pi-mono

This skill integrates with:
- **bash tool**: Run Expo CLI commands
- **write/edit tools**: Generate and modify code
- **web_search**: Research best practices, libraries

## Inspired By

[Vibecode](https://vibecodeapp.com) - "The app that builds apps"
- Riley Brown's vision of AI-powered mobile development
- Natural language to native app conversion
- Simplified app store deployment

pi-mono brings this capability to the open-source world with:
- Full code ownership (not locked in platform)
- 25+ AI providers for generation
- Integration with existing pi-mono skills
