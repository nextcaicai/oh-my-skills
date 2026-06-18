# Oh My Skills

Oh My Skills is a macOS-first desktop workbench for finding, comparing, adopting, and syncing local Agent Skills across tools such as Claude Code, Codex, Cursor, CodeBuddy, Qoder, OpenCode, and Windsurf.

The MVP uses Tauri, React, and TypeScript. File mutations happen only through Rust commands, and write actions follow a preview-confirm-apply flow.

## Development

```bash
npm install
npm run tauri:dev
```

## Validation

```bash
npm run build
npm run test:rust
```
