mod commands;
mod fs_ops;
mod models;
mod registry;
mod scanner;
mod settings;
mod sync_plan;

use std::time::Instant;

pub fn run() {
    let started_at = Instant::now();
    println!("[OMS-startup] rust.run.start elapsedMs=0");
    tauri::Builder::default()
        .setup(move |_app| {
            println!(
                "[OMS-startup] rust.setup elapsedMs={}",
                started_at.elapsed().as_millis()
            );
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::scan_inventory,
            commands::discover_project_workspaces,
            commands::read_skill_content,
            commands::read_skill_lock,
            commands::open_path,
            commands::open_url,
            commands::check_skills_sh_update,
            commands::update_skills_sh_skill,
            commands::preview_adopt,
            commands::preview_sync,
            commands::preview_sync_from_installation,
            commands::preview_quick_migration,
            commands::apply_sync_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oh My Skills");
}
