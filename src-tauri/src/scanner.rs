use crate::fs_ops::{hash_dir, path_to_string, skill_slug_from_path};
use crate::models::{
    InventorySnapshot, ResolvedRoot, ScanOptions, SkillContent, SkillFrontmatter,
    SkillInstallation, SkillIssue, SkillRecord,
};
use crate::registry::{known_agents, resolve_roots};
use crate::settings::{app_data_dir, load_settings};
use chrono::Utc;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub fn scan(app: &AppHandle, options: ScanOptions) -> Result<InventorySnapshot, String> {
    let settings = load_settings(app)?;
    let app_data = app_data_dir(app)?;
    let library_path = PathBuf::from(&settings.library_path);
    let roots = resolve_roots(&settings, options.include_orphaned);
    let agents = known_agents();

    let mut all_issues = Vec::new();
    let canonical = scan_canonical_library(&library_path, &mut all_issues)?;
    let mut grouped: BTreeMap<String, Vec<SkillInstallation>> = BTreeMap::new();

    for root in &roots {
        scan_root(root, &library_path, &mut grouped, &mut all_issues)?;
    }

    let mut slugs: BTreeSet<String> = canonical.keys().cloned().collect();
    slugs.extend(grouped.keys().cloned());

    let mut skills = Vec::new();
    for slug in slugs {
        let installations = grouped.remove(&slug).unwrap_or_default();
        let canonical_install = canonical.get(&slug);
        let mut issues = installations
            .iter()
            .flat_map(|installation| installation.issues.clone())
            .collect::<Vec<_>>();

        let mut hashes = installations
            .iter()
            .filter_map(|installation| installation.hash.clone())
            .collect::<BTreeSet<_>>();
        if let Some(canonical_install) = canonical_install {
            if let Some(hash) = &canonical_install.hash {
                hashes.insert(hash.clone());
            }
        }
        let conflict = hashes.len() > 1;
        if conflict {
            let issue = SkillIssue {
                code: "content-conflict".to_string(),
                severity: "warning".to_string(),
                message: format!("Multiple content hashes found for skill '{slug}'"),
                path: None,
                agent_id: None,
            };
            issues.push(issue.clone());
            all_issues.push(issue);
        }

        let installed_agent_ids = installations
            .iter()
            .map(|installation| installation.agent_id.clone())
            .collect::<BTreeSet<_>>();
        let missing_agents = agents
            .iter()
            .filter(|agent| !installed_agent_ids.contains(&agent.id))
            .map(|agent| agent.id.clone())
            .collect::<Vec<_>>();

        let display_name = canonical_install
            .and_then(|installation| installation.frontmatter.as_ref())
            .and_then(|frontmatter| frontmatter.name.clone())
            .or_else(|| {
                installations
                    .iter()
                    .find_map(|installation| installation.frontmatter.as_ref()?.name.clone())
            })
            .unwrap_or_else(|| slug.clone());

        let description = canonical_install
            .and_then(|installation| installation.frontmatter.as_ref())
            .and_then(|frontmatter| frontmatter.description.clone())
            .or_else(|| {
                installations
                    .iter()
                    .find_map(|installation| installation.frontmatter.as_ref()?.description.clone())
            });

        skills.push(SkillRecord {
            id: slug.clone(),
            slug,
            display_name,
            description,
            canonical_status: if canonical_install.is_some() {
                "imported".to_string()
            } else {
                "not-imported".to_string()
            },
            canonical_path: canonical_install.map(|installation| installation.entry_path.clone()),
            canonical_hash: canonical_install.and_then(|installation| installation.hash.clone()),
            installations,
            missing_agents,
            issues,
            conflict,
        });
    }

    Ok(InventorySnapshot {
        agents,
        roots,
        skills,
        issues: all_issues,
        scanned_at: Utc::now().to_rfc3339(),
        app_data_path: path_to_string(&app_data),
        library_path: path_to_string(&library_path),
    })
}

pub fn read_skill_content(skill_ref: crate::models::SkillRef) -> Result<SkillContent, String> {
    let entry_path = skill_ref
        .path
        .ok_or_else(|| "read_skill_content requires a path in this MVP".to_string())?;
    let entry_path = PathBuf::from(entry_path);
    let skill_md = entry_path.join("SKILL.md");
    let text = fs::read_to_string(&skill_md)
        .map_err(|error| format!("Unable to read {}: {error}", path_to_string(&skill_md)))?;
    let (frontmatter, body) = parse_skill_markdown(&text);
    let title = frontmatter
        .as_ref()
        .and_then(|frontmatter| frontmatter.name.clone())
        .or_else(|| skill_slug_from_path(&entry_path).ok())
        .unwrap_or_else(|| "Untitled Skill".to_string());

    Ok(SkillContent {
        path: path_to_string(&entry_path),
        title,
        frontmatter,
        content: text,
        markdown_body: body,
    })
}

fn scan_canonical_library(
    library_path: &Path,
    issues: &mut Vec<SkillIssue>,
) -> Result<BTreeMap<String, SkillInstallation>, String> {
    let mut canonical = BTreeMap::new();
    if !library_path.exists() {
        return Ok(canonical);
    }

    for entry in fs::read_dir(library_path).map_err(|error| {
        format!(
            "Unable to read central library {}: {error}",
            path_to_string(library_path)
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Unable to read central library entry in {}: {error}",
                path_to_string(library_path)
            )
        })?;
        let path = entry.path();
        if !entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let slug = skill_slug_from_path(&path)?;
        let installation = inspect_installation(
            "library",
            "Central Library",
            "library",
            library_path,
            &path,
            library_path,
        );
        for issue in &installation.issues {
            issues.push(issue.clone());
        }
        canonical.insert(slug, installation);
    }
    Ok(canonical)
}

fn scan_root(
    root: &ResolvedRoot,
    library_path: &Path,
    grouped: &mut BTreeMap<String, Vec<SkillInstallation>>,
    issues: &mut Vec<SkillIssue>,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root.path);
    if !root_path.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&root_path)
        .map_err(|error| format!("Unable to read root {}: {error}", root.path))?
    {
        let entry =
            entry.map_err(|error| format!("Unable to read entry in {}: {error}", root.path))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Unable to inspect {}: {error}", path_to_string(&path)))?;
        if !(metadata.is_dir() || metadata.file_type().is_symlink()) {
            continue;
        }

        let slug = skill_slug_from_path(&path)?;
        let installation = inspect_installation(
            &root.agent_id,
            &root.agent_label,
            &root.scope,
            &root_path,
            &path,
            library_path,
        );
        for issue in &installation.issues {
            issues.push(issue.clone());
        }
        grouped.entry(slug).or_default().push(installation);
    }

    Ok(())
}

pub fn inspect_installation(
    agent_id: &str,
    agent_label: &str,
    scope: &str,
    root_path: &Path,
    entry_path: &Path,
    library_path: &Path,
) -> SkillInstallation {
    let metadata = fs::symlink_metadata(entry_path);
    let is_symlink = metadata
        .as_ref()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    let symlink_target = if is_symlink {
        fs::read_link(entry_path)
            .ok()
            .map(|target| path_to_string(&target))
    } else {
        None
    };
    let canonicalized = fs::canonicalize(entry_path);
    let broken_symlink = is_symlink && canonicalized.is_err();
    let real_path = canonicalized.as_ref().ok().map(|path| path_to_string(path));
    let inspect_path = canonicalized
        .as_ref()
        .map_or(entry_path, |path| path.as_path());
    let skill_md = inspect_path.join("SKILL.md");
    let slug = skill_slug_from_path(entry_path).unwrap_or_else(|_| "unknown".to_string());

    let mut issues = Vec::new();
    let mut frontmatter = None;
    let mut hash = None;
    let mut status = if is_symlink {
        "external-link"
    } else {
        "installed"
    }
    .to_string();

    if broken_symlink {
        status = "broken".to_string();
        issues.push(issue(
            "broken-symlink",
            "error",
            "This skill entry is a broken symlink",
            Some(entry_path),
            Some(agent_id),
        ));
    } else if !skill_md.exists() {
        status = "invalid".to_string();
        issues.push(issue(
            "missing-skill-md",
            "warning",
            "This folder is not a valid skill because SKILL.md is missing",
            Some(entry_path),
            Some(agent_id),
        ));
    } else {
        match fs::read_to_string(&skill_md) {
            Ok(text) => {
                let (parsed, _) = parse_skill_markdown(&text);
                if let Some(parsed) = parsed {
                    if parsed.name.as_deref().is_some_and(|name| name != slug) {
                        issues.push(issue(
                            "name-mismatch",
                            "warning",
                            "Frontmatter name does not match the folder name",
                            Some(entry_path),
                            Some(agent_id),
                        ));
                    }
                    frontmatter = Some(parsed);
                } else {
                    issues.push(issue(
                        "missing-frontmatter",
                        "warning",
                        "SKILL.md does not start with valid frontmatter",
                        Some(entry_path),
                        Some(agent_id),
                    ));
                }
            }
            Err(error) => issues.push(issue(
                "unreadable-skill-md",
                "error",
                &format!("Unable to read SKILL.md: {error}"),
                Some(entry_path),
                Some(agent_id),
            )),
        }

        hash = hash_dir(inspect_path).ok();
        if is_symlink && inspect_path.starts_with(library_path) {
            status = "linked".to_string();
        }
    }

    SkillInstallation {
        id: format!("{agent_id}:{scope}:{}", path_to_string(entry_path)),
        agent_id: agent_id.to_string(),
        agent_label: agent_label.to_string(),
        scope: scope.to_string(),
        root_path: path_to_string(root_path),
        entry_path: path_to_string(entry_path),
        real_path,
        symlink_target,
        is_symlink,
        broken_symlink,
        hash,
        frontmatter,
        status,
        issues,
    }
}

pub fn parse_skill_markdown(text: &str) -> (Option<SkillFrontmatter>, String) {
    let Some(rest) = text.strip_prefix("---") else {
        return (None, text.to_string());
    };
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let Some(end) = rest.find("\n---") else {
        return (None, text.to_string());
    };

    let raw = &rest[..end];
    let body = rest[end + "\n---".len()..]
        .strip_prefix('\n')
        .unwrap_or(&rest[end + "\n---".len()..])
        .to_string();

    (Some(parse_frontmatter(raw)), body)
}

fn parse_frontmatter(raw: &str) -> SkillFrontmatter {
    let mut fm = SkillFrontmatter {
        name: None,
        description: None,
        license: None,
        allowed_tools: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut section: Option<String> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(section_name) = &section {
            if trimmed.starts_with("- ") {
                if section_name == "allowed-tools" {
                    fm.allowed_tools
                        .push(clean_scalar(trimmed.trim_start_matches("- ")));
                }
                continue;
            }
            if line.starts_with(' ') || line.starts_with('\t') {
                if section_name == "metadata" {
                    if let Some((key, value)) = split_key_value(trimmed) {
                        fm.metadata.insert(key.to_string(), clean_scalar(value));
                    }
                }
                continue;
            }
        }

        section = None;
        let Some((key, value)) = split_key_value(trimmed) else {
            continue;
        };

        match key {
            "name" => fm.name = Some(clean_scalar(value)),
            "description" => fm.description = Some(clean_scalar(value)),
            "license" => fm.license = Some(clean_scalar(value)),
            "allowed-tools" => {
                if value.is_empty() {
                    section = Some("allowed-tools".to_string());
                } else {
                    fm.allowed_tools = parse_inline_list(value);
                }
            }
            "metadata" => {
                section = Some("metadata".to_string());
                if !value.is_empty() {
                    fm.metadata.insert("value".to_string(), clean_scalar(value));
                }
            }
            _ => {}
        }
    }

    fm
}

fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    Some((key.trim(), value.trim()))
}

fn parse_inline_list(value: &str) -> Vec<String> {
    let value = value.trim();
    let value = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(value);
    value
        .split(',')
        .map(clean_scalar)
        .filter(|item| !item.is_empty())
        .collect()
}

fn clean_scalar(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn issue(
    code: &str,
    severity: &str,
    message: &str,
    path: Option<&Path>,
    agent_id: Option<&str>,
) -> SkillIssue {
    SkillIssue {
        code: code.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        path: path.map(path_to_string),
        agent_id: agent_id.map(|agent_id| agent_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parses_frontmatter_and_body() {
        let input = "---\nname: blog-translator\ndescription: Translate blogs\nmetadata:\n  tags: writing, translation\n---\n# Body";
        let (frontmatter, body) = parse_skill_markdown(input);
        let frontmatter = frontmatter.expect("frontmatter");
        assert_eq!(frontmatter.name.as_deref(), Some("blog-translator"));
        assert_eq!(frontmatter.description.as_deref(), Some("Translate blogs"));
        assert_eq!(
            frontmatter.metadata.get("tags").map(String::as_str),
            Some("writing, translation")
        );
        assert_eq!(body, "# Body");
    }

    #[test]
    fn detects_name_mismatch() {
        let temp = tempfile::tempdir().expect("temp dir");
        let skill = temp.path().join("folder-name");
        fs::create_dir_all(&skill).expect("skill dir");
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: other-name\ndescription: Test\n---\nBody",
        )
        .expect("skill md");

        let installation =
            inspect_installation("test", "Test", "global", temp.path(), &skill, temp.path());
        assert!(installation
            .issues
            .iter()
            .any(|issue| issue.code == "name-mismatch"));
    }
}
