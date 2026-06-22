<div align="center">
  <img src="oms_logo.svg" alt="Oh My Skills" width="120" />
  <h1>Oh My Skills</h1>
  <p><b>macOS-first desktop workbench for Agent Skills</b></p>
</div>

**Oh My Skills** is a local workbench to discover, compare, adopt, and safely sync Agent Skills across AI coding tools such as Claude Code, Cursor, Windsurf, Zed, Codex, and many others.

All filesystem mutations go through a strict **Preview → Confirm → Apply** flow. The actual file operations are handled by a Rust backend for safety and reliability.

<p align="center">
  <img src="screenshots/main-window.png" width="720" alt="Main window - Skills inventory">
</p>

<p align="center">
  <img src="screenshots/sync-preview.png" width="720" alt="Sync preview and execution">
</p>

---

## Features

- **Automatic Agent Discovery** — Detect installed AI tools and scan their Skills directories
- **Central Library** — Collect high-quality Skills into your own managed library
- **Powerful Sync Engine**
  - Global and per-project scope
  - Multiple strategies: copy, symlink, quick migration
- **Safety First** — Every write operation generates a detailed Sync Plan with backup and conflict detection
- **Health Checks** — Automatically detects broken symlinks, orphaned directories, content conflicts, and invalid SKILL.md files
- **Native macOS Experience** — Built with Tauri + macOS Private APIs (transparent windows, popover effects)
- **Broad Tool Support** — 20+ agents including Claude Code, Cursor, Windsurf, Zed, Codex, Cline, Gemini CLI, OpenCode, TRAE, etc.

## Supported Agents (partial)

Claude Code, Cursor, Windsurf, Zed, Codex, Cline, Gemini CLI, GitHub Copilot, OpenCode, TRAE, Warp, Qoder, and many more emerging tools.

See the app for the full live detection list.

## Installation

### macOS (Recommended)

1. Download the latest `Oh My Skills_*.dmg` from GitHub Releases
2. Open the DMG and drag the app to your Applications folder
3. On first launch, you may need to allow it in **System Settings → Privacy & Security**

> This is an early MVP release (v0.1.0). Signed + notarized builds and auto-update will be added in future releases.

### Build from Source

**Prerequisites**

- Node.js ≥ 18
- Rust (via rustup recommended)
- macOS (primary target for now)

```bash
git clone https://github.com/your-username/oh-my-skills.git
cd oh-my-skills
npm install
npm run tauri:dev
```

Build a production release (produces both `.app` and `.dmg`):

```bash
npm run tauri:build
```

Output locations:

```
src-tauri/target/release/bundle/dmg/Oh My Skills_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/Oh My Skills.app
```

## Workflow

1. **Scan** — App automatically detects installed agents and their skills on launch
2. **Browse** — Search, filter by agent, see coverage matrix in the Skills view
3. **Sync**
   - Select skills in the Skills view
   - Go to the Sync view
   - Choose target agents + scope (Global or Project)
   - Click **Preview** to inspect the exact operations (create folders, copy files, create symlinks, backups, etc.)
   - Confirm and **Apply Plan**

## Development

```bash
# Development with hot reload
npm run tauri:dev

# Frontend only
npm run dev

# Run Rust tests
npm run test:rust

# Full smoke test (build + Rust tests)
npm run smoke
```

Project layout:

- `src/` — React + TypeScript frontend
- `src-tauri/` — Tauri v2 + Rust backend (core filesystem & sync logic)
- `src-tauri/icons/` — App icons (regenerate with `npx tauri icon`)

## Building & Releasing

```bash
npm run tauri:build
```

The resulting DMG can be distributed directly.

### Automated Releases (Planned)

A basic CI workflow (`.github/workflows/ci.yml`) is already included:

- Runs frontend build + Rust tests on every push / PR to `main`
- A full release workflow will be added later: pushing a version tag will automatically build the DMG on GitHub-hosted runners and attach it to GitHub Releases

This lets users download ready-to-run binaries without setting up Rust locally.

## Why .github/workflows/?

Tauri desktop apps require a full system toolchain (Rust, Node, platform SDKs). Moving builds to GitHub Actions provides several major benefits:

- Users can **download pre-built DMGs** directly instead of cloning + installing Rust + running `tauri build`
- Builds are reproducible and happen in a clean CI environment
- Easy to expand to Windows and Linux later
- Enables GitHub Releases + future auto-update support
- CI can also enforce tests, type checking, and linting on every PR

The official Tauri team recommends the `tauri-apps/tauri-action` for this exact purpose.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Lucide React
- **Desktop**: Tauri v2 (Rust)
- **Core Logic**: Rust (walkdir, serde, custom sync planner)
- **UI Philosophy**: Quiet, high-density, native macOS tool feel (inspired by Raycast-style efficiency tools)

## Status

MVP (v0.1.0). Core functionality is working:

- Agent + Skills discovery
- Central library + safe preview/apply sync
- Native macOS interface

Roadmap ideas:
- Better update detection and conflict resolution
- GitHub-based skill sources
- Multi-platform CI builds + auto-update
- More agent adapters and project workspace UX improvements

## Screenshots

<p align="center">
  <img src="screenshots/main-window.png" width="700" alt="Main interface">
</p>

**Skills Inventory**: See all discovered skills, which agents they cover, and their status.

<p align="center">
  <img src="screenshots/sync-preview.png" width="700" alt="Sync preview">
</p>

**Sync Preview**: Select skills and generate a detailed plan (create folders, copy, symlink, backup, etc.) before applying any changes.

<p align="center">
  <img src="screenshots/agent-list.png" width="700" alt="Agent detection">
</p>

**Agent Detection**: Automatically scans installed AI tools and their skill locations on your machine.

> Replace the images in the `screenshots/` folder with real ones (recommended PNG width 700-900px).

## Contributing

Issues and PRs are welcome!

Before contributing UI changes, please look at `design.md` (design principles) and the audit notes in `docs/`.

## License

TBD (likely MIT / Apache-2.0).

---

**Oh My Skills** — Stop letting your Agent Skills scatter across dozens of tools.
