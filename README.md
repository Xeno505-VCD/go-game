# Gomoku Game (五子棋)

A feature-rich Gomoku (Five in a Row) game built with TypeScript, Vite, and Canvas 2D. Play against AI or challenge a friend locally.

![Gomoku Game](https://img.shields.io/badge/status-MVP-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)
![Vite](https://img.shields.io/badge/Vite-5.4-purple)

## Features

- 🎮 **Two Game Modes**: AI battle & local two-player
- 🤖 **5 AI Difficulty Levels**: Novice / Easy / Medium / Hard / Master
- 🎨 **Canvas 2D Rendering**: Gradient stones, grid lines, star points
- ✨ **Win Detection**: Horizontal, vertical, and diagonal five-in-a-row
- 🏆 **Last Move Marker** & **Win Line Highlight**
- ↩️ **Undo / Surrender / Draw** operations
- 📱 **Responsive Layout**: Works on both desktop and mobile
- 💾 **Local Storage**: Game stats persistence

## Quick Start

### Play Now
Open `play.html` in any browser - no build required!

### Development
```bash
npm install
npm run dev
```

### Build for Production
```bash
npm run build
npm run preview
```

## Project Structure

```
gomoku-game/
├── play.html                 # Standalone playable game
├── index.html                # Vite entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── enums.ts              # Game enums
    ├── types.ts              # Type definitions
    ├── constants.ts          # Configuration constants
    ├── main.ts               # App entry (Vite)
    ├── core/                 # Core game logic
    │   ├── board.ts          # Board state management
    │   ├── judge.ts          # Win detection
    │   ├── rules.ts          # Move validation
    │   ├── draw-judge.ts     # Draw condition detection
    │   └── history.ts        # Move history stack
    ├── ai/                   # AI module
    │   ├── evaluator.ts      # Pattern scoring engine
    │   └── ai-manager.ts     # AI scheduler (factory pattern)
    ├── ui/                   # Rendering
    │   ├── renderer.ts       # Canvas board renderer
    │   └── layout.ts         # Responsive layout
    ├── input/                # Input handling
    │   └── input-handler.ts  # Mouse & touch unified input
    ├── storage/              # Data persistence
    │   └── stats.ts          # Game statistics
    ├── utils/                # Utilities
    │   ├── chess-helper.ts   # Coordinate conversion
    │   ├── time.ts           # Timer & cooldown
    │   ├── event-bus.ts      # Pub/sub event system
    │   └── validate.ts       # Parameter validation
    └── styles/
        └── main.css          # Global styles
```

## Game Rules

- 15×15 standard board
- Black moves first, white second
- Five consecutive stones in a row (horizontal, vertical, or diagonal) wins
- Board full without winner results in a draw

## Tech Stack

- **TypeScript** - Type-safe development
- **Vite** - Fast build tool
- **Canvas 2D** - Custom game rendering
- **localStorage** - Client-side data persistence

## Deployment

Deployed on [Netlify](https://www.netlify.com/) for seamless static hosting.

## License

MIT