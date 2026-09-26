use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_opener::OpenerExt;
use tauri::{Emitter, Manager, WindowEvent};

/// Platform-specific sign-engine binary name.
/// macOS bundles use no extension; Windows uses .exe.
#[cfg(target_os = "macos")]
const ENGINE_BIN: &str = "sign-engine-macos";
#[cfg(target_os = "linux")]
const ENGINE_BIN: &str = "sign-engine-linux";
#[cfg(target_os = "windows")]
const ENGINE_BIN: &str = "sign-engine-windows.exe";

/// Frontend readiness flag for close-guard.
pub struct Ready(pub AtomicBool);

/// File path passed via OS file association on cold start.
pub struct InitialFile(pub Mutex<Option<String>>);

/// PDF file extensions we handle.
const PDF_EXTS: [&str; 1] = ["pdf"];

fn is_pdf_path(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => PDF_EXTS.contains(&ext.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// Extract first real PDF file from command line arguments.
fn file_from_args() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(std::path::PathBuf::from)
        .find(|p| is_pdf_path(p))
        .map(|p| p.to_string_lossy().into_owned())
}

/// Frontend queries whether a file was passed on startup.
#[tauri::command]
fn initial_file(state: tauri::State<InitialFile>) -> Option<String> {
    state.0.lock().ok().and_then(|slot| slot.clone())
}

/// Frontend marks itself ready (close-guard enabled).
#[tauri::command]
fn mark_ready(state: tauri::State<Ready>) {
    state.0.store(true, Ordering::Release);
}

/// Destroy the main window without re-triggering CloseRequested.
#[tauri::command]
fn force_close(window: tauri::Window) {
    let _ = window.destroy();
}

/// Sign a PDF file using the embedded sign-engine binary.
#[tauri::command]
fn sign_pdf(
    app: tauri::AppHandle,
    input: String,
    output: String,
    key_path: String,
    cert_path: String,
    name: String,
) -> Result<String, String> {
    let engine_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?
        .join(ENGINE_BIN);

    if !engine_path.exists() {
        return Err(format!("sign-engine not found at {engine_path:?}"));
    }

    let mut cmd = Command::new(&engine_path);
    cmd.arg("sign")
        .arg("-input").arg(&input)
        .arg("-output").arg(&output)
        .arg("-key").arg(&key_path)
        .arg("-cert").arg(&cert_path)
        .arg("-name").arg(&name);

    let output_result = cmd.output().map_err(|e| format!("engine exec: {e}"))?;

    if output_result.status.success() {
        Ok(String::from_utf8_lossy(&output_result.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output_result.stderr).to_string())
    }
}

/// Verify a PDF signature using the embedded sign-engine binary.
#[tauri::command]
fn verify_pdf(
    app: tauri::AppHandle,
    input: String,
) -> Result<String, String> {
    let engine_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?
        .join(ENGINE_BIN);

    if !engine_path.exists() {
        return Err(format!("sign-engine not found at {engine_path:?}"));
    }

    let output = Command::new(&engine_path)
        .arg("verify")
        .arg(&input)
        .output()
        .map_err(|e| format!("engine exec: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Generate a self-signed certificate using the sign-engine.
#[tauri::command]
fn generate_key(
    app: tauri::AppHandle,
    name: String,
    key_out: String,
    cert_out: String,
) -> Result<String, String> {
    let engine_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?
        .join(ENGINE_BIN);

    if !engine_path.exists() {
        return Err(format!("sign-engine not found at {engine_path:?}"));
    }

    let output_result = Command::new(&engine_path)
        .arg("generate-key")
        .arg("-name").arg(&name)
        .arg("-key-out").arg(&key_out)
        .arg("-cert-out").arg(&cert_out)
        .output()
        .map_err(|e| format!("engine exec: {e}"))?;

    if output_result.status.success() {
        Ok(String::from_utf8_lossy(&output_result.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output_result.stderr).to_string())
    }
}

/// Build the native application menu (family standard).
fn build_app_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<()> {
    let zh = lang.starts_with("zh");
    let l = |zhv: &'static str, en: &'static str| if zh { zhv } else { en };

    let app_menu = Submenu::with_items(
        app,
        "Rocktier Sign",
        true,
        &[
            &PredefinedMenuItem::about(
                app,
                Some(l("关于 Rocktier Sign", "About Rocktier Sign")),
                None,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", l("退出", "Quit"), true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let open_i = MenuItem::with_id(app, "open", l("打开…", "Open…"), true, Some("CmdOrCtrl+O"))?;
    let file_menu = Submenu::with_items(
        app,
        l("文件", "File"),
        true,
        &[
            &open_i,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        l("编辑", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let theme_i = MenuItem::with_id(app, "toggle-theme", l("切换日夜模式", "Toggle Theme"), true, None::<&str>)?;
    let view_menu = Submenu::with_items(
        app,
        l("显示", "View"),
        true,
        &[&theme_i],
    )?;

    let window_menu = Submenu::with_items(
        app,
        l("窗口", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let site_i = MenuItem::with_id(app, "website", l("官方网站", "Website"), true, None::<&str>)?;
    let mail_i = MenuItem::with_id(app, "feedback", l("反馈", "Feedback"), true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, l("帮助", "Help"), true, &[&site_i, &mail_i])?;

    let menu = Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )?;
    app.set_menu(menu)?;
    Ok(())
}

#[tauri::command]
fn build_menu(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    build_app_menu(&app, &lang).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    const ALLOWED: [&str; 3] =
        ["https://rocktier.com/", "https://www.rocktier.com/", "mailto:"];
    if !ALLOWED.iter().any(|p| url.starts_with(p)) {
        return Err(format!("blocked url: {url}"));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            app.manage(Ready(AtomicBool::new(false)));
            app.manage(InitialFile(Mutex::new(file_from_args())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_file,
            mark_ready,
            force_close,
            sign_pdf,
            verify_pdf,
            generate_key,
            build_menu,
            open_url,
        ])
        .on_menu_event(|app, event| {
            if event.id().0.as_str() == "quit" {
                match app.get_webview_window("main") {
                    Some(window) => { let _ = window.close(); }
                    None => app.exit(0),
                }
                return;
            }
            let _ = app.emit("menu-action", event.id().0.as_str());
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let ready = window
                    .try_state::<Ready>()
                    .map(|r| r.0.load(Ordering::Acquire))
                    .unwrap_or(false);
                if !ready {
                    return;
                }
                let _ = window.emit("app-close-requested", ());
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            for url in urls {
                let Ok(path) = url.to_file_path() else { continue };
                let Some(path) = path.to_str() else { continue };
                if !is_pdf_path(Path::new(path)) {
                    continue;
                }
                if let Some(state) = _app_handle.try_state::<InitialFile>() {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = Some(path.to_string());
                    }
                }
                let _ = _app_handle.emit("open-file", path);
                break;
            }
        }
    });
}
