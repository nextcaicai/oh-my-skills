use crate::fs_ops::{expand_home, path_to_string};
use crate::models::{
    AgentDefinition, AgentDetectionSource, AgentRecord, CustomRoot, ResolvedRoot, Settings,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub fn known_agents() -> Vec<AgentDefinition> {
    let mut agents = vec![
        agent(
            "amp",
            "Amp",
            &["~/.config/agents/skills"],
            &[".agents/skills"],
            &["~/.config/agents"],
            &["amp"],
            &[],
            101,
        ),
        agent(
            "antigravity",
            "Antigravity",
            &["~/.gemini/antigravity/skills"],
            &[".agent/skills"],
            &["~/.gemini/antigravity"],
            &["antigravity"],
            &[
                "/Applications/Antigravity.app",
                "~/Applications/Antigravity.app",
            ],
            1,
        ),
        agent(
            "claude-code",
            "Claude Code",
            &["~/.claude/skills"],
            &[".claude/skills"],
            &["~/.claude"],
            &["claude"],
            &[],
            2,
        ),
        agent(
            "cline",
            "Cline",
            &["~/.cline/skills"],
            &[".cline/skills"],
            &["~/.cline"],
            &[],
            &[],
            3,
        ),
        agent(
            "codebuddy",
            "CodeBuddy",
            &["~/.codebuddy/skills"],
            &[".codebuddy/skills"],
            &["~/.codebuddy"],
            &["codebuddy"],
            &[
                "/Applications/CodeBuddy.app",
                "~/Applications/CodeBuddy.app",
            ],
            4,
        ),
        agent(
            "codex",
            "Codex",
            &[
                "~/.codex/skills",
                "~/.codex/skills/.system",
                "~/.skills-manager/skills",
                "~/.agents/skills",
            ],
            &[".agents/skills"],
            &["~/.codex"],
            &["codex"],
            &[],
            5,
        ),
        agent(
            "cursor",
            "Cursor",
            &["~/.cursor/skills"],
            &[".cursor/skills"],
            &["~/.cursor"],
            &["cursor"],
            &["/Applications/Cursor.app", "~/Applications/Cursor.app"],
            6,
        ),
        agent(
            "gemini-cli",
            "Gemini CLI",
            &["~/.gemini/skills"],
            &[".gemini/skills"],
            &["~/.gemini"],
            &["gemini"],
            &[],
            7,
        ),
        agent(
            "github-copilot",
            "GitHub Copilot",
            &["~/.copilot/skills"],
            &[".github/skills"],
            &["~/.copilot"],
            &[],
            &[],
            8,
        ),
        agent(
            "goose",
            "Goose",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.goose"],
            &["goose"],
            &["/Applications/Goose.app", "~/Applications/Goose.app"],
            102,
        ),
        agent(
            "grok-cli",
            "Grok CLI",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.grok"],
            &["grok"],
            &[],
            9,
        ),
        agent(
            "hermes",
            "Hermes",
            &["~/.hermes/skills"],
            &[],
            &["~/.hermes"],
            &["hermes"],
            &["/Applications/Hermes.app", "~/Applications/Hermes.app"],
            10,
        ),
        agent(
            "kilo-code",
            "Kilo Code",
            &["~/.kilocode/skills"],
            &[".kilocode/skills"],
            &["~/.kilocode"],
            &[],
            &[],
            11,
        ),
        agent(
            "kiro",
            "Kiro",
            &["~/.kiro/skills"],
            &[".kiro/skills"],
            &["~/.kiro"],
            &["kiro"],
            &["/Applications/Kiro.app", "~/Applications/Kiro.app"],
            12,
        ),
        agent(
            "openclaw",
            "OpenClaw",
            &["~/.openclaw/skills"],
            &["skills", ".agents/skills"],
            &["~/.openclaw"],
            &["openclaw"],
            &["/Applications/OpenClaw.app", "~/Applications/OpenClaw.app"],
            13,
        ),
        agent(
            "opencode",
            "OpenCode",
            &["~/.config/opencode/skills"],
            &[".opencode/skills"],
            &["~/.config/opencode"],
            &["opencode"],
            &[],
            14,
        ),
        agent(
            "qoder",
            "Qoder",
            &["~/.qoder/skills"],
            &[".qoder/skills"],
            &["~/.qoder"],
            &["qoder"],
            &["/Applications/Qoder.app", "~/Applications/Qoder.app"],
            15,
        ),
        agent(
            "roo-code",
            "Roo Code",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.roo"],
            &[],
            &[],
            103,
        ),
        agent(
            "trae",
            "TRAE",
            &["~/.trae/skills"],
            &[".trae/skills"],
            &["~/.trae"],
            &["trae"],
            &[
                "/Applications/TRAE.app",
                "/Applications/Trae.app",
                "~/Applications/TRAE.app",
                "~/Applications/Trae.app",
            ],
            16,
        ),
        agent(
            "windsurf",
            "Windsurf",
            &["~/.codeium/windsurf/skills"],
            &[".windsurf/skills"],
            &["~/.codeium/windsurf"],
            &["windsurf"],
            &["/Applications/Windsurf.app", "~/Applications/Windsurf.app"],
            17,
        ),
        agent(
            "zed",
            "Zed",
            &["~/.agents/skills"],
            &[".agents/skills"],
            &["~/.config/zed"],
            &["zed"],
            &["/Applications/Zed.app", "~/Applications/Zed.app"],
            18,
        ),
    ];

    agents.sort_by_key(|agent| (agent.priority, agent.label.clone()));
    agents
}

pub fn detect_agents(settings: &Settings, include_orphaned: bool) -> Vec<AgentRecord> {
    let definitions = known_agents();
    let install_map = definitions
        .iter()
        .map(|definition| (definition.id.clone(), detect_install_sources(definition)))
        .collect::<BTreeMap<_, _>>();
    let roots = resolve_roots_for_definitions(
        &definitions,
        settings,
        include_orphaned,
        &install_map,
        false,
    );

    definitions
        .into_iter()
        .map(|definition| {
            let detection_sources = install_map.get(&definition.id).cloned().unwrap_or_default();
            let installed = has_install_evidence(&detection_sources);
            let skill_roots = roots
                .iter()
                .filter(|root| root.agent_id == definition.id)
                .cloned()
                .collect::<Vec<_>>();
            let skill_entry_count = skill_roots
                .iter()
                .filter(|root| root.exists)
                .map(|root| count_root_entries(Path::new(&root.path)))
                .sum::<usize>();
            let status = if installed {
                "installed"
            } else if skill_entry_count > 0 || has_residual_evidence(&detection_sources) {
                "residual"
            } else {
                "not-installed"
            };

            AgentRecord {
                id: definition.id,
                label: definition.label,
                global_roots: definition.global_roots,
                project_roots: definition.project_roots,
                active_signals: definition.active_signals,
                cli_names: definition.cli_names,
                app_paths: definition.app_paths,
                symlink_support: definition.symlink_support,
                priority: definition.priority,
                installed,
                status: status.to_string(),
                detection_sources,
                skill_roots,
                skill_entry_count,
            }
        })
        .collect()
}

pub fn resolve_roots(settings: &Settings, include_orphaned: bool) -> Vec<ResolvedRoot> {
    let definitions = known_agents();
    let install_map = definitions
        .iter()
        .map(|definition| (definition.id.clone(), detect_install_sources(definition)))
        .collect::<BTreeMap<_, _>>();
    resolve_roots_for_definitions(&definitions, settings, include_orphaned, &install_map, true)
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
    cli_names: &[&str],
    app_paths: &[&str],
    priority: u16,
) -> AgentDefinition {
    AgentDefinition {
        id: id.to_string(),
        label: label.to_string(),
        global_roots: global_roots.iter().map(|root| root.to_string()).collect(),
        project_roots: project_roots.iter().map(|root| root.to_string()).collect(),
        active_signals: active_signals.iter().map(|root| root.to_string()).collect(),
        cli_names: cli_names.iter().map(|name| name.to_string()).collect(),
        app_paths: app_paths.iter().map(|path| path.to_string()).collect(),
        priority,
        symlink_support: true,
    }
}

fn resolve_roots_for_definitions(
    definitions: &[AgentDefinition],
    settings: &Settings,
    include_orphaned: bool,
    install_map: &BTreeMap<String, Vec<AgentDetectionSource>>,
    include_custom_roots: bool,
) -> Vec<ResolvedRoot> {
    let mut roots = Vec::new();

    for definition in definitions {
        let installed = install_map
            .get(&definition.id)
            .map(|sources| has_install_evidence(sources))
            .unwrap_or(false);

        for root in &definition.global_roots {
            push_root(
                &mut roots,
                definition,
                "global",
                expand_home(root),
                installed,
                include_orphaned,
                true,
            );
        }

        for folder in &settings.project_folders {
            for relative in &definition.project_roots {
                push_root(
                    &mut roots,
                    definition,
                    "project",
                    PathBuf::from(folder).join(relative),
                    installed,
                    include_orphaned,
                    false,
                );
            }
        }
    }

    for definition in definitions {
        let installed = install_map
            .get(&definition.id)
            .map(|sources| has_install_evidence(sources))
            .unwrap_or(false);

        for root in discovered_skill_roots_for_agent(&definition.id) {
            let scope = discovered_root_scope(&root);
            push_root(
                &mut roots,
                definition,
                scope,
                root,
                installed,
                include_orphaned,
                false,
            );
        }
    }

    if include_custom_roots {
        for root in &settings.custom_roots {
            push_custom_root(&mut roots, root, include_orphaned);
        }
    }

    dedupe_roots(roots)
}

fn push_root(
    roots: &mut Vec<ResolvedRoot>,
    definition: &AgentDefinition,
    scope: &str,
    path: PathBuf,
    installed: bool,
    include_orphaned: bool,
    include_missing_installed_root: bool,
) {
    let exists = path.exists();
    let active = installed && exists;
    let orphaned = exists && !installed;

    if active || (orphaned && include_orphaned) || (installed && include_missing_installed_root) {
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

fn detect_install_sources(definition: &AgentDefinition) -> Vec<AgentDetectionSource> {
    let mut sources = Vec::new();
    let mut seen = BTreeSet::new();

    for command in &definition.cli_names {
        if let Some(path) = find_binary(command) {
            push_source(
                &mut sources,
                &mut seen,
                "cli",
                command,
                path_to_string(&path),
            );
        }
    }

    for app_path in &definition.app_paths {
        let path = expand_home(app_path);
        if path.exists() {
            push_source(
                &mut sources,
                &mut seen,
                "app",
                app_path,
                path_to_string(&path),
            );
        }
    }

    for app_name in app_names_for_detection(definition) {
        if let Some(path) = find_app_bundle(&app_name) {
            push_source(
                &mut sources,
                &mut seen,
                "app",
                &app_name,
                path_to_string(&path),
            );
        }
    }

    for extension_id in extension_ids_for_agent(&definition.id) {
        if let Some(path) = find_extension_installation(extension_id) {
            push_source(
                &mut sources,
                &mut seen,
                "extension",
                extension_id,
                path_to_string(&path),
            );
        }
    }

    for signal in &definition.active_signals {
        let path = expand_home(signal);
        if path.exists() {
            push_source(
                &mut sources,
                &mut seen,
                "config",
                signal,
                path_to_string(&path),
            );
        }
    }

    for root in discovered_skill_roots_for_agent(&definition.id) {
        push_source(
            &mut sources,
            &mut seen,
            "plugin-cache",
            "installed skills",
            path_to_string(&root),
        );
    }

    sources
}

fn has_install_evidence(sources: &[AgentDetectionSource]) -> bool {
    sources.iter().any(|source| {
        matches!(
            source.kind.as_str(),
            "cli" | "app" | "extension" | "plugin-cache"
        )
    })
}

fn has_residual_evidence(sources: &[AgentDetectionSource]) -> bool {
    sources.iter().any(|source| source.kind == "config")
}

fn push_source(
    sources: &mut Vec<AgentDetectionSource>,
    seen: &mut BTreeSet<String>,
    kind: &str,
    label: &str,
    path: String,
) {
    let key = format!("{kind}:{path}");
    if seen.insert(key) {
        sources.push(AgentDetectionSource {
            kind: kind.to_string(),
            label: label.to_string(),
            path,
            exists: true,
        });
    }
}

fn find_binary(command: &str) -> Option<PathBuf> {
    binary_search_dirs()
        .into_iter()
        .map(|path| path.join(command))
        .find(|candidate| candidate.is_file())
}

fn binary_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = BTreeSet::new();

    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            push_unique_path(&mut dirs, &mut seen, path);
        }
    }

    for path in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "~/.local/bin",
        "~/.cargo/bin",
        "~/.npm-global/bin",
        "~/.bun/bin",
        "~/.volta/bin",
        "~/Library/pnpm",
        "~/.pnpm-global/bin",
    ] {
        push_unique_path(&mut dirs, &mut seen, expand_home(path));
    }

    dirs
}

fn app_names_for_detection(definition: &AgentDefinition) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = BTreeSet::new();

    for app_path in &definition.app_paths {
        if let Some(name) = Path::new(app_path)
            .file_name()
            .and_then(|name| name.to_str())
        {
            push_unique_name(&mut names, &mut seen, normalize_app_name(name));
        }
    }

    if !definition.app_paths.is_empty() {
        push_unique_name(&mut names, &mut seen, normalize_app_name(&definition.label));
    }

    names
}

fn normalize_app_name(name: &str) -> String {
    if name.to_ascii_lowercase().ends_with(".app") {
        name.to_string()
    } else {
        format!("{name}.app")
    }
}

fn find_app_bundle(app_name: &str) -> Option<PathBuf> {
    let expected = normalize_app_name(app_name);

    for root in app_search_roots() {
        let direct = root.join(&expected);
        if direct.exists() {
            return Some(direct);
        }

        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(|name| name.to_string()) else {
                continue;
            };
            if name.eq_ignore_ascii_case(&expected) {
                return Some(path);
            }
        }
    }

    None
}

fn app_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = BTreeSet::new();

    for path in [
        "/Applications",
        "~/Applications",
        "/System/Applications",
        "/Applications/Utilities",
    ] {
        push_unique_path(&mut roots, &mut seen, expand_home(path));
    }

    roots
}

fn extension_ids_for_agent(agent_id: &str) -> &'static [&'static str] {
    match agent_id {
        "cline" => &["cline.cline", "saoudrizwan.claude-dev"],
        "github-copilot" => &["github.copilot", "github.copilot-chat"],
        "kilo-code" => &[
            "kilocode.kilo-code",
            "kilo-code.kilo-code",
            "kilocode.kilocode",
        ],
        "roo-code" => &[
            "rooveterinaryinc.roo-cline",
            "rooveterinaryinc.roo-code",
            "roo-cline.roo-cline",
        ],
        _ => &[],
    }
}

fn find_extension_installation(extension_id: &str) -> Option<PathBuf> {
    let expected = extension_id.to_ascii_lowercase();

    for root in extension_search_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };

        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name == expected || name.starts_with(&format!("{expected}-")) {
                return Some(entry.path());
            }
        }
    }

    None
}

fn extension_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = BTreeSet::new();

    for path in [
        "~/.vscode/extensions",
        "~/.vscode-insiders/extensions",
        "~/.cursor/extensions",
        "~/.cursor-insiders/extensions",
        "~/.windsurf/extensions",
        "~/.codeium/windsurf/extensions",
        "~/.trae/extensions",
        "~/.kiro/extensions",
    ] {
        push_unique_path(&mut roots, &mut seen, expand_home(path));
    }

    roots
}

fn discovered_skill_roots_for_agent(agent_id: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = BTreeSet::new();

    match agent_id {
        "claude-code" => {
            discover_plugin_skill_roots(
                &mut roots,
                &mut seen,
                &expand_home("~/.claude/plugins/cache"),
            );
        }
        "codex" => {
            for root in [
                "~/.codex/vendor_imports/skills/skills/.curated",
                "~/.codex/vendor_imports/skills/skills/.system",
            ] {
                push_existing_skill_collection_root(&mut roots, &mut seen, expand_home(root));
            }
            discover_plugin_skill_roots(
                &mut roots,
                &mut seen,
                &expand_home("~/.codex/plugins/cache"),
            );
        }
        _ => {}
    }

    roots
}

fn discovered_root_scope(path: &Path) -> &'static str {
    let value = path_to_string(path);
    if value.contains("/plugins/cache/") {
        "plugin"
    } else if value.contains("/vendor_imports/") {
        "vendor"
    } else {
        "global"
    }
}

fn discover_plugin_skill_roots(
    roots: &mut Vec<PathBuf>,
    seen: &mut BTreeSet<String>,
    cache_root: &Path,
) {
    if !cache_root.exists() {
        return;
    }

    for namespace in read_dir_paths(cache_root) {
        for plugin in read_dir_paths(&namespace) {
            for version in read_dir_paths(&plugin) {
                push_existing_skill_collection_root(roots, seen, version.join("skills"));
            }
        }
    }
}

fn push_existing_skill_collection_root(
    roots: &mut Vec<PathBuf>,
    seen: &mut BTreeSet<String>,
    path: PathBuf,
) {
    if path.is_dir() && has_skill_entries(&path) {
        push_unique_path(roots, seen, path);
    }
}

fn read_dir_paths(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

fn push_unique_name(names: &mut Vec<String>, seen: &mut BTreeSet<String>, name: String) {
    if seen.insert(name.to_ascii_lowercase()) {
        names.push(name);
    }
}

fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut BTreeSet<String>, path: PathBuf) {
    if seen.insert(path_to_string(&path)) {
        paths.push(path);
    }
}

fn has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.any(|entry| entry.is_ok()))
        .unwrap_or(false)
}

fn count_root_entries(path: &Path) -> usize {
    if path.join("SKILL.md").exists() {
        return 1;
    }

    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    fs::symlink_metadata(entry.path())
                        .map(|metadata| metadata.is_dir() || metadata.file_type().is_symlink())
                        .unwrap_or(false)
                        && entry.path().join("SKILL.md").exists()
                })
                .count()
        })
        .unwrap_or(0)
}

fn has_skill_entries(path: &Path) -> bool {
    count_root_entries(path) > 0
}

fn dedupe_roots(roots: Vec<ResolvedRoot>) -> Vec<ResolvedRoot> {
    let mut seen = BTreeSet::new();
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
    fn known_agents_include_all_default_tools() {
        let agents = known_agents();
        let labels: Vec<String> = agents.iter().map(|agent| agent.label.clone()).collect();
        assert_eq!(agents.len(), 21);
        assert!(labels.contains(&"Antigravity".to_string()));
        assert!(labels.contains(&"Claude Code".to_string()));
        assert!(labels.contains(&"Cline".to_string()));
        assert!(labels.contains(&"CodeBuddy".to_string()));
        assert!(labels.contains(&"Codex".to_string()));
        assert!(labels.contains(&"Cursor".to_string()));
        assert!(labels.contains(&"Gemini CLI".to_string()));
        assert!(labels.contains(&"GitHub Copilot".to_string()));
        assert!(labels.contains(&"Grok CLI".to_string()));
        assert!(labels.contains(&"Hermes".to_string()));
        assert!(labels.contains(&"Kilo Code".to_string()));
        assert!(labels.contains(&"Kiro".to_string()));
        assert!(labels.contains(&"OpenClaw".to_string()));
        assert!(labels.contains(&"OpenCode".to_string()));
        assert!(labels.contains(&"Qoder".to_string()));
        assert!(labels.contains(&"TRAE".to_string()));
        assert!(labels.contains(&"Windsurf".to_string()));
        assert!(labels.contains(&"Zed".to_string()));
    }

    #[test]
    fn shared_agents_root_does_not_mark_agents_installed() {
        let agents = known_agents();
        for id in ["grok-cli", "goose", "roo-code", "zed"] {
            let agent = agents.iter().find(|agent| agent.id == id).expect("agent");
            assert!(!agent.active_signals.contains(&"~/.agents".to_string()));
        }
    }

    #[test]
    fn config_source_is_not_install_evidence() {
        let sources = vec![AgentDetectionSource {
            kind: "config".to_string(),
            label: "~/.example".to_string(),
            path: "/Users/example/.example".to_string(),
            exists: true,
        }];

        assert!(!has_install_evidence(&sources));
        assert!(has_residual_evidence(&sources));
    }

    #[test]
    fn extension_source_is_install_evidence() {
        let sources = vec![AgentDetectionSource {
            kind: "extension".to_string(),
            label: "cline.cline".to_string(),
            path: "/Users/example/.vscode/extensions/cline.cline-1.0.0".to_string(),
            exists: true,
        }];

        assert!(has_install_evidence(&sources));
        assert!(!has_residual_evidence(&sources));
    }

    #[test]
    fn app_names_are_derived_from_explicit_app_paths() {
        let agent = known_agents()
            .into_iter()
            .find(|agent| agent.id == "trae")
            .expect("trae");
        let names = app_names_for_detection(&agent);

        assert!(names.contains(&"TRAE.app".to_string()));
        assert_eq!(
            names
                .iter()
                .filter(|name| name.eq_ignore_ascii_case("trae.app"))
                .count(),
            1
        );
    }

    #[test]
    fn discovers_plugin_skill_collection_roots() {
        let temp = tempfile::tempdir().expect("temp dir");
        let skills = temp
            .path()
            .join("publisher")
            .join("plugin")
            .join("1.0.0")
            .join("skills");
        let skill = skills.join("example-skill");
        fs::create_dir_all(&skill).expect("skill dir");
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: example-skill\ndescription: Example\n---\nBody",
        )
        .expect("skill md");

        let mut roots = Vec::new();
        let mut seen = BTreeSet::new();
        discover_plugin_skill_roots(&mut roots, &mut seen, temp.path());

        assert_eq!(roots, vec![skills]);
    }

    #[test]
    fn counts_root_that_is_itself_a_skill() {
        let temp = tempfile::tempdir().expect("temp dir");
        fs::write(
            temp.path().join("SKILL.md"),
            "---\nname: root-skill\ndescription: Root\n---\nBody",
        )
        .expect("skill md");

        assert_eq!(count_root_entries(temp.path()), 1);
        assert!(has_skill_entries(temp.path()));
    }
}
