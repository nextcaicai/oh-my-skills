mod commands;
mod fs_ops;
mod models;
mod registry;
mod scanner;
mod settings;
mod sync_plan;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::scan_inventory,
            commands::discover_project_workspaces,
            commands::read_skill_content,
            commands::read_skill_lock,
            commands::preview_adopt,
            commands::preview_sync,
            commands::preview_sync_from_installation,
            commands::apply_sync_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oh My Skills");
}
