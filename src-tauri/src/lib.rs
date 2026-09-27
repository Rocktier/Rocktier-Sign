use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::Builder as UpdaterBuilder;
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

/// Cert metadata stored in the cert store directory.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct CertInfo {
    pub name: String,
    pub created: String,
    pub path: String,
}

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

/// Get the cert store directory under app data.
fn cert_store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let cert_dir = data_dir.join("certs");
    if !cert_dir.exists() {
        fs::create_dir_all(&cert_dir)
            .map_err(|e| format!("create certs dir: {e}"))?;
    }
    Ok(cert_dir)
}

/// Get the default cert path under cert store (in JSON).
fn default_cert_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(cert_store_dir(app)?.join("default.json"))
}

/// Resolve the sign-engine binary path from bundled resources.
fn engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|d| d.join(ENGINE_BIN))
        .map_err(|e| format!("resource dir: {e}"))
}

// ---- IPC commands ----

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
/// Cert identified by cert_id (stored cert name) or direct key_path/cert_path.
#[tauri::command]
fn sign_pdf(
    app: tauri::AppHandle,
    input: String,
    output: String,
    name: String,
    cert_id: Option<String>,
    key_path: Option<String>,
    cert_path: Option<String>,
) -> Result<String, String> {
    let engine = engine_path(&app)?;

    if !engine.exists() {
        return Err(format!("sign-engine not found at {engine:?}"));
    }

    // Resolve key/cert: either from cert_id lookup or direct paths
    let (resolved_key, resolved_cert) = if let Some(id) = cert_id {
        let store = cert_store_dir(&app)?;
        let k = store.join(format!("{id}.key"));
        let c = store.join(format!("{id}.crt"));
        if !k.exists() || !c.exists() {
            return Err(format!("cert '{id}' not found in store"));
        }
        (k.to_string_lossy().into_owned(), c.to_string_lossy().into_owned())
    } else {
        match (key_path, cert_path) {
            (Some(k), Some(c)) => (k, c),
            _ => return Err("provide either cert_id or both key_path and cert_path".into()),
        }
    };

    let output_result = Command::new(&engine)
        .arg("sign")
        .arg("-input").arg(&input)
        .arg("-output").arg(&output)
        .arg("-key").arg(&resolved_key)
        .arg("-cert").arg(&resolved_cert)
        .arg("-name").arg(&name)
        .output()
        .map_err(|e| format!("engine exec: {e}"))?;

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
    let engine = engine_path(&app)?;

    if !engine.exists() {
        return Err(format!("sign-engine not found at {engine:?}"));
    }

    let output = Command::new(&engine)
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
) -> Result<CertInfo, String> {
    let engine = engine_path(&app)?;

    if !engine.exists() {
        return Err(format!("sign-engine not found at {engine:?}"));
    }

    let store = cert_store_dir(&app)?;
    let key_out = store.join(format!("{name}.key"));
    let cert_out = store.join(format!("{name}.crt"));

    let output_result = Command::new(&engine)
        .arg("generate-key")
        .arg("-name").arg(&name)
        .arg("-key-out").arg(&key_out)
        .arg("-cert-out").arg(&cert_out)
        .output()
        .map_err(|e| format!("engine exec: {e}"))?;

    if !output_result.status.success() {
        return Err(String::from_utf8_lossy(&output_result.stderr).to_string());
    }

    Ok(CertInfo {
        name: name.clone(),
        created: chrono::Local::now().to_rfc3339(),
        path: key_out.to_string_lossy().into_owned(),
    })
}

/// List all certificates in the store.
#[tauri::command]
fn list_certs(app: tauri::AppHandle) -> Result<Vec<CertInfo>, String> {
    let store = cert_store_dir(&app)?;
    let mut certs: Vec<CertInfo> = Vec::new();

    if let Ok(entries) = fs::read_dir(&store) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("key") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    let crt = store.join(format!("{stem}.crt"));
                    if crt.exists() {
                        let created = entry
                            .metadata()
                            .and_then(|m| m.created())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .and_then(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0))
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default();
                        certs.push(CertInfo {
                            name: stem.to_string(),
                            created,
                            path: path.to_string_lossy().into_owned(),
                        });
                    }
                }
            }
        }
    }

    // Sort by created date descending
    certs.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(certs)
}

/// Set a certificate as the default.
#[tauri::command]
fn set_default_cert(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let store = cert_store_dir(&app)?;
    let key = store.join(format!("{name}.key"));
    let crt = store.join(format!("{name}.crt"));
    if !key.exists() || !crt.exists() {
        return Err(format!("cert '{name}' not found"));
    }

    let default_path = default_cert_path(&app)?;
    let json = serde_json::json!({ "default": name });
    fs::write(&default_path, json.to_string())
        .map_err(|e| format!("write default : {e}"))?;
    Ok(())
}

/// Get the current default certificate name.
#[tauri::command]
fn get_default_cert(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let default_path = default_cert_path(&app)?;
    if !default_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&default_path)
        .map_err(|e| format!("read default: {e}"))?;
    let val: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("parse default: {e}"))?;
    Ok(val.get("default").and_then(|v| v.as_str()).map(String::from))
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
        .plugin(UpdaterBuilder::new().build())
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
            list_certs,
            set_default_cert,
            get_default_cert,
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
