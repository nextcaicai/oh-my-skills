use crate::models::{
    AgentTarget, ApplyResult, InstallationRef, InventorySnapshot, ProjectWorkspaceCandidate,
    ScanOptions, Settings, SkillContent, SkillLockEntry, SkillLockFile, SkillRef, SyncPlan,
};
use crate::{fs_ops, registry, scanner, settings, sync_plan};
use std::collections::BTreeMap;
use std::fs;
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
pub fn apply_sync_plan(app: AppHandle, plan_id: String) -> Result<ApplyResult, String> {
    sync_plan::apply_plan(&app, plan_id)
}
