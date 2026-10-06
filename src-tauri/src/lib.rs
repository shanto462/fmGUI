//! fmGUI: a desktop app for Apple's `fm` CLI (Foundation Models, macOS 27).
//! OWNER: lead. Agents: register new commands here only through the lead.

mod app_commands;
pub mod config;
pub mod engine;
pub mod fm;
pub mod mcp;
pub mod skills;
pub mod state;
pub mod util;

use state::{AppState, Paths};
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            app.manage(AppState::new(Paths::new(data_dir)));

            // Warm the login-shell environment off the main thread (used by MCP + shell tools).
            std::thread::spawn(|| {
                let _ = util::login_env();
            });

            // Connect enabled MCP servers and autostart the public server.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let cfg = state.config();
                for server in cfg.mcp_servers.iter().filter(|s| s.enabled) {
                    if let Err(err) = state.mcp.connect(&handle, server).await {
                        eprintln!("mcp: {} failed to connect: {err}", server.name);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app
            app_commands::get_config,
            app_commands::save_config,
            app_commands::get_paths,
            app_commands::read_text_file,
            app_commands::write_text_file,
            app_commands::save_temp_file,
            app_commands::save_temp_text,
            app_commands::read_image_data_url,
            app_commands::which_command,
            // fm CLI
            fm::commands::fm_run,
            fm::commands::fm_cancel,
            fm::commands::fm_status,
            fm::commands::fm_license_text,
            fm::commands::open_in_terminal,
            fm::commands::cli_sessions_list,
            fm::commands::cli_session_read,
            fm::commands::cli_session_delete,
            fm::commands::cli_session_rename,
            fm::commands::cli_session_new_path,
            fm::commands::transcript_read,
            fm::commands::public_server_start,
            fm::commands::public_server_stop,
            fm::commands::public_server_status,
            fm::commands::public_server_request,
            // agent engine
            engine::commands::engine_status,
            engine::commands::engine_restart,
            engine::commands::chats_list,
            engine::commands::chat_get,
            engine::commands::chat_create,
            engine::commands::chat_delete,
            engine::commands::chat_rename,
            engine::commands::chat_set_instructions,
            engine::commands::chat_send,
            engine::commands::chat_cancel,
            engine::commands::approval_respond,
            engine::commands::tools_catalog,
            engine::commands::tool_test,
            engine::commands::custom_tool_test,
            engine::commands::shortcuts_list,
            // MCP
            mcp::commands::mcp_statuses,
            mcp::commands::mcp_connect,
            mcp::commands::mcp_disconnect,
            mcp::commands::mcp_test,
            // skills
            skills::commands::skills_list,
            skills::commands::skill_save,
            skills::commands::skill_delete,
            skills::commands::skills_import_candidates,
            skills::commands::skill_import,
            skills::commands::skill_token_count,
        ])
        .build(tauri::generate_context!())
        .expect("error while building fmGUI");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Stop every child process we own: private engine server, public
            // server, MCP servers.
            let state = handle.state::<AppState>();
            tauri::async_runtime::block_on(async {
                state.engine.shutdown().await;
                state.public_server.shutdown().await;
                state.mcp.shutdown().await;
            });
        }
    });
}
