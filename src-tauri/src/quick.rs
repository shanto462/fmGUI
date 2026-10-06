//! The menu bar icon and the Quick Chat window.
//!
//! Quick Chat is a frameless, always-on-top window with two sizes:
//! - **overlay**: a chat near the top of the screen, like Spotlight;
//! - **pip**: a small pill in the bottom-right corner (picture in picture).
//!
//! Losing focus (a click outside) shrinks the overlay to the pill; clicking the
//! pill grows it back. Closing hides the window, and the UI starts an empty
//! chat the next time it opens. The UI side lives in `src/quick/`.

use crate::util::LockExt;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

/// Window label of the Quick Chat window (the UI picks its root by label).
pub const LABEL: &str = "quick";
/// Logical size of the overlay.
const OVERLAY: (f64, f64) = (680.0, 560.0);
/// Logical size of the pill.
const PIP: (f64, f64) = (320.0, 64.0);
/// Space between the pill and the screen edges.
const MARGIN: f64 = 20.0;
/// A tray click this soon after the overlay shrank (the click itself took the
/// focus away) means "close it", not "open it again".
const TRAY_DEBOUNCE: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Hidden,
    Overlay,
    Pip,
}

pub struct QuickState {
    mode: Mutex<Mode>,
    /// When the overlay last shrank because it lost focus.
    shrunk_at: Mutex<Option<Instant>>,
    /// While true, losing focus does not shrink the overlay (a file dialog is open).
    hold: AtomicBool,
}

impl Default for QuickState {
    fn default() -> Self {
        Self { mode: Mutex::new(Mode::Hidden), shrunk_at: Mutex::new(None), hold: AtomicBool::new(false) }
    }
}

/// Liquid Glass (macOS 26+). `interactive` adds the glass response to clicks
/// (macOS 27+), which suits the pill.
fn effects(radius: f64, interactive: bool) -> WindowEffectsConfig {
    WindowEffectsConfig {
        effects: vec![Effect::LiquidGlassRegular],
        state: Some(EffectState::Active),
        radius: Some(radius),
        color: None,
        interactive,
    }
}

/// The Quick Chat window, created hidden on first use.
pub fn ensure_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Quick Chat")
        .inner_size(OVERLAY.0, OVERLAY.1)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .effects(effects(22.0, false))
        .build()?;

    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            let state = handle.state::<QuickState>();
            let overlay = *state.mode.lock_safe() == Mode::Overlay;
            if overlay && !state.hold.load(Ordering::SeqCst) {
                *state.shrunk_at.lock_safe() = Some(Instant::now());
                let _ = set_mode(&handle, Mode::Pip);
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = close(&handle);
        }
        _ => {}
    });
    Ok(window)
}

/// The monitor under the mouse, else the window's monitor, else the primary one.
fn target_monitor(app: &AppHandle, window: &WebviewWindow) -> Option<Monitor> {
    let under_cursor = app.cursor_position().ok().and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    under_cursor.or_else(|| window.current_monitor().ok().flatten()).or_else(|| app.primary_monitor().ok().flatten())
}

/// Work area of a monitor in logical units: (x, y, width, height).
fn work_area(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    (
        f64::from(area.position.x) / scale,
        f64::from(area.position.y) / scale,
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    )
}

/// Overlay: centered, a bit below the top edge (where Spotlight opens).
fn overlay_position(area: (f64, f64, f64, f64)) -> (f64, f64) {
    let (x, y, w, h) = area;
    (x + (w - OVERLAY.0).max(0.0) / 2.0, y + (h * 0.14).max(MARGIN))
}

/// Pill: bottom-right corner of the work area (above the Dock).
fn pip_position(area: (f64, f64, f64, f64)) -> (f64, f64) {
    let (x, y, w, h) = area;
    (x + w - PIP.0 - MARGIN, y + h - PIP.1 - MARGIN)
}

/// Moves the window between hidden, overlay and pill, and tells its UI.
pub fn set_mode(app: &AppHandle, mode: Mode) -> tauri::Result<()> {
    let window = ensure_window(app)?;
    // Record the mode first: hiding or resizing can fire focus events.
    *app.state::<QuickState>().mode.lock_safe() = mode;
    let area = target_monitor(app, &window).as_ref().map(work_area);
    match mode {
        Mode::Hidden => window.hide()?,
        Mode::Overlay => {
            window.set_effects(effects(22.0, false))?;
            window.set_size(LogicalSize::new(OVERLAY.0, OVERLAY.1))?;
            if let Some((x, y)) = area.map(overlay_position) {
                window.set_position(LogicalPosition::new(x, y))?;
            }
            window.show()?;
            window.set_focus()?;
        }
        Mode::Pip => {
            window.set_effects(effects(PIP.1 / 2.0, true))?;
            window.set_size(LogicalSize::new(PIP.0, PIP.1))?;
            if let Some((x, y)) = area.map(pip_position) {
                window.set_position(LogicalPosition::new(x, y))?;
            }
            window.show()?;
        }
    }
    let _ = app.emit_to(LABEL, "quick-mode", mode);
    Ok(())
}

/// Hides the window; the UI clears its chat so the next open starts empty.
pub fn close(app: &AppHandle) -> tauri::Result<()> {
    set_mode(app, Mode::Hidden)?;
    let _ = app.emit_to(LABEL, "quick-reset", ());
    Ok(())
}

/// Tray click: open the overlay, or put it away if it is already open.
pub fn toggle(app: &AppHandle) {
    let state = app.state::<QuickState>();
    let mode = *state.mode.lock_safe();
    let just_shrunk = state.shrunk_at.lock_safe().is_some_and(|t| t.elapsed() < TRAY_DEBOUNCE);
    let next = match mode {
        Mode::Overlay => Mode::Pip,
        Mode::Pip if just_shrunk => return,
        Mode::Hidden | Mode::Pip => Mode::Overlay,
    };
    let _ = set_mode(app, next);
}

/// Shows the main window (it is hidden, not closed, when the user closes it).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The menu bar icon: left click toggles Quick Chat, the menu has the rest.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let quick = MenuItem::with_id(app, "quick", "Quick Chat", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open fmGUI", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit fmGUI", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&quick, &open, &separator, &quit])?;

    TrayIconBuilder::with_id("fmgui")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("fmGUI Quick Chat")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quick" => {
                let _ = set_mode(app, Mode::Overlay);
            }
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn parse_mode(mode: &str) -> Result<Mode, String> {
    match mode {
        "hidden" => Ok(Mode::Hidden),
        "overlay" => Ok(Mode::Overlay),
        "pip" => Ok(Mode::Pip),
        other => Err(format!("Unknown Quick Chat mode \"{other}\". Use overlay, pip or hidden.")),
    }
}

/// "overlay" | "pip" | "hidden".
#[tauri::command]
pub fn quick_set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    set_mode(&app, parse_mode(&mode)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn quick_mode(app: AppHandle) -> Mode {
    *app.state::<QuickState>().mode.lock_safe()
}

/// Hides Quick Chat and resets it to an empty chat.
#[tauri::command]
pub fn quick_close(app: AppHandle) -> Result<(), String> {
    close(&app).map_err(|e| e.to_string())
}

/// While `hold` is true (a file dialog is open), losing focus keeps the overlay.
#[tauri::command]
pub fn quick_hold(app: AppHandle, hold: bool) {
    app.state::<QuickState>().hold.store(hold, Ordering::SeqCst);
}

/// Shows the main window, optionally on a chat (from Quick Chat "Open in fmGUI").
#[tauri::command]
pub fn open_main_window(app: AppHandle, chat_id: Option<String>) {
    show_main(&app);
    if let Some(id) = chat_id {
        let _ = app.emit_to("main", "open-chat", id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modes() {
        assert_eq!(parse_mode("pip"), Ok(Mode::Pip));
        assert_eq!(parse_mode("overlay"), Ok(Mode::Overlay));
        assert!(parse_mode("big").is_err());
    }

    #[test]
    fn places_windows_inside_the_work_area() {
        // A 1512x944 logical work area starting below a 38 pt menu bar.
        let area = (0.0, 38.0, 1512.0, 944.0);
        let (ox, oy) = overlay_position(area);
        assert_eq!(ox, (1512.0 - OVERLAY.0) / 2.0);
        assert!(oy > 38.0 && oy + OVERLAY.1 < 38.0 + 944.0);
        let (px, py) = pip_position(area);
        assert_eq!(px + PIP.0 + MARGIN, 1512.0);
        assert_eq!(py + PIP.1 + MARGIN, 38.0 + 944.0);
    }

    #[test]
    fn mode_serializes_for_the_ui() {
        assert_eq!(serde_json::to_string(&Mode::Pip).unwrap(), "\"pip\"");
    }
}
