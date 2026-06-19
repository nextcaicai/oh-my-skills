use crate::models::{
    AgentTarget, ApplyResult, InstallationRef, InventorySnapshot, ScanOptions, Settings,
    SkillContent, SkillRef, SyncPlan,
};
use crate::{scanner, settings, sync_plan};
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
    scanner::scan(
        &app,
        options.unwrap_or(ScanOptions {
            include_orphaned: false,
        }),
    )
}

#[tauri::command]
pub fn read_skill_content(skill_ref: SkillRef) -> Result<SkillContent, String> {
    scanner::read_skill_content(skill_ref)
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
