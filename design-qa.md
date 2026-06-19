final result: passed

# Design QA

- Reference: Mole screenshots provided in the request.
- Prototype: http://127.0.0.1:1420/
- Viewport: 1280 x 720.

## Checks

- Top navigation matches the requested logo entry plus three compact tabs.
- Agent discovery first screen shows 19 target Agents and per-Agent Skills counts.
- Skills discovery uses left Agent filters, a dense Skills list, and a right SKILL.md detail panel.
- Sync page shows selected Skills, target scope controls, dry-run preview, and apply action.
- Browser verification found no page-level horizontal or vertical overflow at the tested viewport.

## Notes

- The Vite browser preview uses demo inventory only outside Tauri because the real scanner requires the Tauri runtime.
- The Tauri desktop app continues to use the existing Rust scan, read, preview, and apply commands.
