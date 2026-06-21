use crate::models::{
    AgentTarget, ApplyResult, InstallationRef, InventorySnapshot, ProjectWorkspaceCandidate,
    ScanOptions, Settings, SkillContent, SkillLockEntry, SkillLockFile, SkillRef, SkillUpdateCheck,
    SyncPlan,
};
use crate::{fs_ops, registry, scanner, settings, sync_plan};
use chrono::Utc;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    settings::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    settings::save_settings(&app, &settings)?;
    settings::load_settings(&app)
}

#[tauri::command]
pub fn scan_inventory(
    app: AppHandle,
    options: Option<ScanOptions>,
) -> Result<InventorySnapshot, String> {
    let snapshot = scanner::scan(
        &app,
        options.unwrap_or(ScanOptions {
            include_orphaned: false,
        }),
    )?;
    scanner::write_library_index(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn discover_project_workspaces(
    app: AppHandle,
    base_path: String,
) -> Result<Vec<ProjectWorkspaceCandidate>, String> {
    let settings = settings::load_settings(&app)?;
    registry::discover_project_workspaces(&base_path, &settings)
}

#[tauri::command]
pub fn read_skill_content(skill_ref: SkillRef) -> Result<SkillContent, String> {
    scanner::read_skill_content(skill_ref)
}

#[tauri::command]
pub fn read_skill_lock() -> Result<BTreeMap<String, SkillLockEntry>, String> {
    let path = fs_ops::expand_home("~/.agents/.skill-lock.json");
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(BTreeMap::new());
    };
    let lock = serde_json::from_str::<SkillLockFile>(&text).map_err(|error| {
        format!(
            "Unable to parse skill lock {}: {error}",
            fs_ops::path_to_string(&path)
        )
    })?;
    Ok(lock.skills)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let path = fs_ops::expand_home(&path);
    if !path.exists() {
        return Err(format!(
            "Path does not exist: {}",
            fs_ops::path_to_string(&path)
        ));
    }
    let status = Command::new("open")
        .arg(&path)
        .status()
        .map_err(|error| format!("Unable to open {}: {error}", fs_ops::path_to_string(&path)))?;
    if !status.success() {
        return Err(format!(
            "Unable to open {}: open exited with {status}",
            fs_ops::path_to_string(&path)
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("Only GitHub URLs can be opened from this view".to_string());
    }
    let status = Command::new("open")
        .arg(&url)
        .status()
        .map_err(|error| format!("Unable to open {url}: {error}"))?;
    if !status.success() {
        return Err(format!("Unable to open {url}: open exited with {status}"));
    }
    Ok(())
}

#[tauri::command]
pub fn check_skills_sh_update(
    app: AppHandle,
    slug: String,
    entry_path: String,
    source_url: String,
    skill_path: Option<String>,
) -> Result<SkillUpdateCheck, String> {
    let local_path = fs_ops::expand_home(&entry_path);
    let remote_path = checkout_skills_sh_source(&app, &slug, &source_url, skill_path.as_deref())?;
    let local_hash = fs_ops::hash_dir(&local_path)?;
    let remote_hash = fs_ops::hash_dir(&remote_path)?;
    let available = local_hash != remote_hash;

    Ok(SkillUpdateCheck {
        status: if available { "available" } else { "current" }.to_string(),
        message: None,
        local_hash: Some(local_hash),
        remote_hash: Some(remote_hash),
    })
}

#[tauri::command]
pub fn update_skills_sh_skill(
    app: AppHandle,
    slug: String,
    entry_path: String,
    source_url: String,
    skill_path: Option<String>,
) -> Result<SkillUpdateCheck, String> {
    let local_path = fs_ops::expand_home(&entry_path);
    if !is_agents_skill_path(&local_path, &slug) {
        return Err(format!(
            "Refusing to update non-skills.sh path {}",
            fs_ops::path_to_string(&local_path)
        ));
    }

    let remote_path = checkout_skills_sh_source(&app, &slug, &source_url, skill_path.as_deref())?;
    let local_hash = fs_ops::hash_dir(&local_path).ok();
    let remote_hash = fs_ops::hash_dir(&remote_path)?;

    let backup_root = crate::settings::app_data_dir(&app)?
        .join("backups")
        .join("skills-sh-updates")
        .join(Utc::now().format("%Y%m%d%H%M%S").to_string());
    fs_ops::ensure_dir(&backup_root)?;
    if local_path.exists() {
        fs_ops::copy_dir_recursive(&local_path, &backup_root.join(&slug))?;
        fs_ops::remove_entry(&local_path)?;
    }
    fs_ops::copy_dir_recursive(&remote_path, &local_path)?;

    Ok(SkillUpdateCheck {
        status: "current".to_string(),
        message: Some(format!("Updated {slug} from {source_url}")),
        local_hash,
        remote_hash: Some(remote_hash),
    })
}

#[tauri::command]
pub fn preview_adopt(app: AppHandle, source: InstallationRef) -> Result<SyncPlan, String> {
    sync_plan::preview_adopt(&app, source)
}

#[tauri::command]
pub fn preview_sync(
    app: AppHandle,
    skill_id: String,
    targets: Vec<AgentTarget>,
) -> Result<SyncPlan, String> {
    sync_plan::preview_sync(&app, skill_id, targets)
}

#[tauri::command]
pub fn preview_sync_from_installation(
    app: AppHandle,
    source: InstallationRef,
    targets: Vec<AgentTarget>,
) -> Result<SyncPlan, String> {
    sync_plan::preview_sync_from_installation(&app, source, targets)
}

#[tauri::command]
pub fn preview_quick_migration(
    app: AppHandle,
    source: InstallationRef,
    targets: Vec<AgentTarget>,
    method: String,
) -> Result<SyncPlan, String> {
    sync_plan::preview_quick_migration(&app, source, targets, method)
}

#[tauri::command]
pub fn apply_sync_plan(app: AppHandle, plan_id: String) -> Result<ApplyResult, String> {
    sync_plan::apply_plan(&app, plan_id)
}

fn checkout_skills_sh_source(
    app: &AppHandle,
    slug: &str,
    source_url: &str,
    skill_path: Option<&str>,
) -> Result<PathBuf, String> {
    let clone_url = normalize_github_url(source_url)?;
    let checkout_root = crate::settings::app_data_dir(app)?
        .join("updates")
        .join(format!("{}-{}", slug, Utc::now().timestamp_millis()));
    let repo_path = checkout_root.join("repo");
    fs_ops::ensure_dir(&checkout_root)?;

    let status = Command::new("git")
        .args(["clone", "--depth", "1", &clone_url])
        .arg(&repo_path)
        .status()
        .map_err(|error| format!("Unable to clone {clone_url}: {error}"))?;
    if !status.success() {
        return Err(format!(
            "Unable to clone {clone_url}: git exited with {status}"
        ));
    }

    let source = resolve_skill_path(&repo_path, slug, skill_path).ok_or_else(|| {
        format!(
            "Unable to find skill '{slug}' in cloned repository {}",
            fs_ops::path_to_string(&repo_path)
        )
    })?;
    if !source.join("SKILL.md").exists() {
        return Err(format!(
            "Remote skill source is missing SKILL.md: {}",
            fs_ops::path_to_string(&source)
        ));
    }
    Ok(source)
}

fn normalize_github_url(source_url: &str) -> Result<String, String> {
    let trimmed = source_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git");

    let path = if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        rest.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("github.com/") {
        rest.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest.to_string()
    } else if looks_like_github_slug(trimmed) {
        trimmed.to_string()
    } else {
        return Err("skills.sh update currently supports GitHub sources only".to_string());
    };

    Ok(format!("https://github.com/{path}.git"))
}

fn looks_like_github_slug(value: &str) -> bool {
    let parts: Vec<&str> = value.split('/').collect();
    parts.len() == 2 && parts.iter().all(|p| !p.is_empty())
}

fn resolve_skill_path(repo_path: &Path, slug: &str, skill_path: Option<&str>) -> Option<PathBuf> {
    let custom = skill_path
        .filter(|path| !path.trim().is_empty())
        .map(|path| repo_path.join(path.trim_start_matches('/')));

    std::iter::once(custom)
        .flatten()
        .chain([
            repo_path.join(slug),
            repo_path.join("skills").join(slug),
            repo_path.to_path_buf(),
        ])
        .find(|candidate| candidate.join("SKILL.md").exists())
}

fn is_agents_skill_path(path: &Path, slug: &str) -> bool {
    let expected_suffix = PathBuf::from(".agents").join("skills").join(slug);
    path.ends_with(expected_suffix)
}
