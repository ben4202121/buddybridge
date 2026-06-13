# BuddyBridge

> Connect Obsidian to CodeBuddy/WorkBuddy CLI for AI chat

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

- Chat panel in Obsidian sidebar with multi-turn conversation
- Streaming output with real-time text display
- Thinking process visualization
- Tool call display (file reads, searches, etc.)
- Vault-aware context injection
- Session management for conversation continuity
- Auto-discovery of CodeBuddy CLI and Node.js paths
- Configurable CLI path in settings

## Prerequisites

- WorkBuddy/CodeBuddy installed with codebuddy CLI available
- Obsidian >= 0.15.0

## Install

1. Download main.js, manifest.json, styles.css
2. Copy to .obsidian/plugins/buddybridge/
3. Restart Obsidian
4. Enable BuddyBridge in Community Plugins

## Settings

| Setting | Description | Default |
|---------|-------------|---------
| CodeBuddy Path | CLI path (blank for auto-detect) | Auto |
| Max Conversations | Maximum saved conversations | 20 |

Auto-detection covers: Windows WorkBuddy install, npm global, Program Files, macOS/Linux ~/.local/bin, Homebrew, NVM.

## Dev

```bash
npm run dev    # Dev build
npm run build  # Production build
npm test       # Run tests
```

## License

MIT