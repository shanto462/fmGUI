//! fmGUI: a desktop app for Apple's `fm` CLI (Foundation Models, macOS 27).
//!
//! The Rust side runs every `fm` process, the private `fm serve` used by the
//! agent engine, MCP servers and tools. The React UI (in `src/`) talks to it
//! only through the Tauri commands registered below.

mod app_commands;
pub mod config;
pub mod engine;
pub mod fm;
pub mod mcp;
pub mod procs;
pub mod quick;
pub mod skills;
pub mod state;
pub mod util;

#[cfg(not(target_os = "macos"))]
compile_error!("fmGUI only supports macOS 27 or later: it drives Apple's /usr/bin/fm.");

use state::{AppState, Paths};
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

/// Stops every child process the app owns: the private engine server, the
/// public server and the MCP servers. Safe to call more than once.
async fn stop_children(handle: &AppHandle) {
    let Some(state) = handle.try_state::<AppState>() else { return };
    state.engine.shutdown().await;
    state.public_server.shutdown().await;
    state.mcp.shutdown().await;
}

/// `kill <pid>`, Ctrl+C in a terminal, or a closed terminal: stop the
/// children like a normal quit, then exit.
fn exit_on_signals(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let (Ok(mut term), Ok(mut int), Ok(mut hup)) =
            (signal(SignalKind::terminate()), signal(SignalKind::interrupt()), signal(SignalKind::hangup()))
        else {
            eprintln!("fmGUI: could not listen for quit signals");
            return;
        };
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
            _ = hup.recv() => {}
        }
        stop_children(&handle).await;
        handle.exit(0);
        // Normally the line above ends the process. If the event loop is stuck,
        // do not leave the user with an app that ignores the signal.
        tokio::time::sleep(Duration::from_secs(5)).await;
        std::process::exit(0);
    });
}

/// A second launch of the app shows the running window instead.
fn focus_main_window(app: &AppHandle) {
    quick::show_main(app);
}

pub fn run() {
    let builder = tauri::Builder::default()
        // First: a second instance must exit before it starts anything.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| focus_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let paths = Paths::new(data_dir);

            // Children left by an earlier run that was killed (crash, Force
            // Quit, `tauri dev` restart) are stopped before anything starts.
            let fm_path = config::AppConfig::load(&paths.config_file).fm_path;
            let stopped = AppState::leftovers(&paths, &fm_path).clean();
            if stopped > 0 {
                eprintln!("fmGUI: stopped {stopped} process(es) left over from an earlier run");
            }

            app.manage(AppState::new(paths));
            app.manage(quick::QuickState::default());
            exit_on_signals(app.handle().clone());

            // Menu bar icon + Quick Chat. The window is created hidden now so
            // the first open is instant.
            quick::setup_tray(app.handle())?;
            quick::ensure_window(app.handle())?;
            quick::watch_main_window(app.handle());

            // Warm the login-shell environment off the main thread (used by MCP + shell tools).
            std::thread::spawn(|| {
                let _ = util::login_env();
            });

            // Connect enabled MCP servers and autostart the public server.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let cfg = state.config();
                if cfg.public_server.autostart {
                    if let Err(err) = state.public_server.start(&handle, &cfg.fm_path, &cfg.public_server).await {
                        eprintln!("public server: autostart failed: {err}");
                    }
                }
                // In parallel: a first `npx -y` start can take up to a minute per server.
                let connects = cfg.mcp_servers.iter().filter(|s| s.enabled).map(|server| {
                    let (state, handle) = (&state, &handle);
                    async move {
                        if let Err(err) = state.mcp.connect(handle, server).await {
                            eprintln!("mcp: {} failed to connect: {err}", server.name);
                        }
                    }
                });
                futures_util::future::join_all(connects).await;
            });
            Ok(())
        })
        // Closing the main window hides it: the menu bar icon and Quick Chat
        // keep working. Quit with Cmd+Q or the menu bar menu.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    quick::sync_tray(window.app_handle());
                }
            }
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
            // Quick Chat (menu bar)
            quick::quick_set_mode,
            quick::quick_mode,
            quick::quick_close,
            quick::quick_hold,
            quick::open_main_window,
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
        ]);

    let app = match builder.build(tauri::generate_context!()) {
        Ok(app) => app,
        Err(err) => {
            eprintln!("fmGUI could not start: {err}");
            std::process::exit(1);
        }
    };

    app.run(|handle, event| match event {
        // Dock icon clicked: bring back the (hidden) main window.
        RunEvent::Reopen { .. } => quick::show_main(handle),
        RunEvent::Exit => tauri::async_runtime::block_on(stop_children(handle)),
        _ => {}
    });
}
