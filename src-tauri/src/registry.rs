use crate::fs_ops::{expand_home, path_to_string};
use crate::models::{AgentDefinition, CustomRoot, ResolvedRoot, Settings};
use std::fs;
use std::path::{Path, PathBuf};

pub fn known_agents() -> Vec<AgentDefinition> {
    vec![
        agent(
            "amp",
            "Amp",
            &["~/.config/agents/skills"],
            &[".agents/skills"],
            &["~/.config/agents"],
        ),
        agent(
            "antigravity",
            "Antigravity",
            &["~/.gemini/antigravity/skills"],
            &[".agent/skills"],
            &["~/.gemini/antigravity"],
        ),
        agent(
            "claude-code",
            "Claude Code",
            &["~/.claude/skills"],
            &[".claude/skills"],
            &["~/.claude"],
        ),
        agent(
            "cline",
            "Cline",
            &["~/.cline/skills"],
            &[".cline/skills"],
            &["~/.cline"],
        ),
        agent(
            "codebuddy",
            "CodeBuddy",
            &["~/.codebuddy/skills"],
            &[".codebuddy/skills"],
            &["~/.codebuddy"],
        ),
        agent(
            "codex",
            "Codex",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.codex", "~/.agents"],
        ),
        agent(
            "cursor",
            "Cursor",
            &["~/.cursor/skills"],
            &[".cursor/skills"],
            &["~/.cursor"],
        ),
        agent(
            "gemini-cli",
            "Gemini CLI",
            &["~/.gemini/skills"],
            &[".gemini/skills"],
            &["~/.gemini"],
        ),
        agent(
            "github-copilot",
            "GitHub Copilot",
            &["~/.copilot/skills"],
            &[".github/skills"],
            &["~/.copilot"],
        ),
        agent(
            "goose",
            "Goose",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.goose", "~/.agents"],
        ),
        agent(
            "grok-cli",
            "Grok CLI",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.grok", "~/.agents"],
        ),
        agent(
            "hermes",
            "Hermes Agent",
            &["~/.hermes/skills"],
            &[],
            &["~/.hermes"],
        ),
        agent(
            "kilo-code",
            "Kilo Code",
            &["~/.kilocode/skills"],
            &[".kilocode/skills"],
            &["~/.kilocode"],
        ),
        agent(
            "kiro",
            "Kiro",
            &["~/.kiro/skills"],
            &[".kiro/skills"],
            &["~/.kiro"],
        ),
        agent(
            "openclaw",
            "OpenClaw",
            &["~/.openclaw/skills"],
            &["skills", ".agents/skills"],
            &["~/.openclaw"],
        ),
        agent(
            "opencode",
            "OpenCode",
            &["~/.config/opencode/skills"],
            &[".opencode/skills"],
            &["~/.config/opencode"],
        ),
        agent(
            "qoder",
            "Qoder",
            &["~/.qoder/skills"],
            &[".qoder/skills"],
            &["~/.qoder"],
        ),
        agent(
            "roo-code",
            "Roo Code",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.roo", "~/.agents"],
        ),
        agent(
            "trae",
            "TRAE IDE",
            &["~/.trae/skills"],
            &[".trae/skills"],
            &["~/.trae"],
        ),
        agent(
            "windsurf",
            "Windsurf",
            &["~/.codeium/windsurf/skills"],
            &[".windsurf/skills"],
            &["~/.codeium/windsurf"],
        ),
        agent(
            "zed",
            "Zed",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.config/zed", "~/.agents"],
        ),
    ]
}

pub fn resolve_roots(settings: &Settings, include_orphaned: bool) -> Vec<ResolvedRoot> {
    let mut roots = Vec::new();

    for definition in known_agents() {
        for root in &definition.global_roots {
            push_root(
                &mut roots,
                &definition,
                "global",
                expand_home(root),
                include_orphaned,
            );
        }

        for folder in &settings.project_folders {
            for relative in &definition.project_roots {
                push_root(
                    &mut roots,
                    &definition,
                    "project",
                    PathBuf::from(folder).join(relative),
                    include_orphaned,
                );
            }
        }
    }

    for root in &settings.custom_roots {
        push_custom_root(&mut roots, root, include_orphaned);
    }

    dedupe_roots(roots)
}

pub fn find_agent(id: &str) -> Option<AgentDefinition> {
    known_agents().into_iter().find(|agent| agent.id == id)
}

fn agent(
    id: &str,
    label: &str,
    global_roots: &[&str],
    project_roots: &[&str],
    active_signals: &[&str],
) -> AgentDefinition {
    AgentDefinition {
        id: id.to_string(),
        label: label.to_string(),
        global_roots: global_roots.iter().map(|root| root.to_string()).collect(),
        project_roots: project_roots.iter().map(|root| root.to_string()).collect(),
        active_signals: active_signals.iter().map(|root| root.to_string()).collect(),
        symlink_support: true,
    }
}

fn push_root(
    roots: &mut Vec<ResolvedRoot>,
    definition: &AgentDefinition,
    scope: &str,
    path: PathBuf,
    include_orphaned: bool,
) {
    let exists = path.exists();
    let active = exists && (has_entries(&path) || has_active_signal(definition));
    let orphaned = exists && !active;

    if exists && (include_orphaned || !orphaned) {
        roots.push(ResolvedRoot {
            agent_id: definition.id.clone(),
            agent_label: definition.label.clone(),
            scope: scope.to_string(),
            path: path_to_string(&path),
            exists,
            active,
            orphaned,
        });
    }
}

fn push_custom_root(roots: &mut Vec<ResolvedRoot>, root: &CustomRoot, include_orphaned: bool) {
    let path = expand_home(&root.path);
    let exists = path.exists();
    let active = exists && has_entries(&path);
    let orphaned = exists && !active;

    if exists && (include_orphaned || !orphaned) {
        roots.push(ResolvedRoot {
            agent_id: root.id.clone(),
            agent_label: root.label.clone(),
            scope: "custom".to_string(),
            path: path_to_string(&path),
            exists,
            active,
            orphaned,
        });
    }
}

fn has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.any(|entry| entry.is_ok()))
        .unwrap_or(false)
}

fn has_active_signal(definition: &AgentDefinition) -> bool {
    definition
        .active_signals
        .iter()
        .map(|signal| expand_home(signal))
        .any(|path| path.exists())
}

fn dedupe_roots(roots: Vec<ResolvedRoot>) -> Vec<ResolvedRoot> {
    let mut seen = std::collections::BTreeSet::new();
    let mut unique = Vec::new();
    for root in roots {
        let key = format!("{}:{}:{}", root.agent_id, root.scope, root.path);
        if seen.insert(key) {
            unique.push(root);
        }
    }
    unique
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agents_include_core_tools() {
        let labels: Vec<String> = known_agents()
            .into_iter()
            .map(|agent| agent.label)
            .collect();
        assert!(labels.contains(&"Claude Code".to_string()));
        assert!(labels.contains(&"Codex".to_string()));
        assert!(labels.contains(&"Cursor".to_string()));
        assert!(labels.contains(&"Qoder".to_string()));
    }
}
