use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_opener::OpenerExt;
use tauri::{Emitter, Manager, WindowEvent};

// 授权：试用状态与回执验签（单一来源 docs/rocktier/license.rs，规程 FAMILY-LICENSE.md）。
// 写命令的拦截在下方 ensure_write_allowed（Sign 只拦 sign_pdf —— generate_key 绝对
// 不拦：拦 = 到期连证书都建不了 = 死锁；verify/list/set_default 全是读或元数据操作，
// 一律放行），界面在 LicenseDialog。
/// 家族内唯一的产品标识，用作试用记录的副存储命名空间。
///
/// 必须与 `tauri.conf.json` 的 `bundle.identifier` 逐字一致 ——
/// 副存储按它分文件，改了会导致老用户的试用记录读不到（等于白送 7 天）。
/// 改动时两处必须同步。
pub const APP_KEY: &str = "Rocktier.RocktierSign";

pub mod license;
pub mod trial;

/* ── 授权：试用与激活（见 license.rs 的模块说明）────────────────────── */

/// 试用与授权状态的落盘目录。由 `setup()` 注入。
///
/// 用全局而不是给 sign_pdf 再加一个参数：那会让命令签名多一个与业务无关的参数。
static LICENSE_DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

pub fn init_license_dir(dir: std::path::PathBuf) {
    let _ = LICENSE_DIR.set(dir);
}

/// 供闸门发事件用。setup 注入；即使没注入也照样能拦截，只是界面不会自动弹窗。
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub fn init_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 当前授权状态。
///
/// 目录未注入（setup 失败）时按"试用中、满额天数"处理 —— 失败方向刻意选**放行**：
/// 一个取不到的目录不该变成一次锁死。
fn current_license() -> crate::license::Status {
    let Some(dir) = LICENSE_DIR.get() else {
        return crate::license::Status::Trialing { days_left: crate::license::TRIAL_DAYS };
    };
    let now = now_secs();
/* 试用起点双写（AppData + 副存储）并按机器指纹判定，
       见 trial.rs 的模块说明。app_key 用 bundle identifier ——
       家族内唯一，避免两个产品的副存储互相覆盖。 */
    let started = crate::trial::ensure_started(
        dir,
        crate::APP_KEY,
        now,
        &crate::trial::machine_fingerprint(),
    );
    // 只认本单品与全家桶的回执：别人的回执即使验签通过，也不是本应用的授权。
    let receipt = crate::license::read_valid_receipt(dir, crate::license::PUBLIC_KEY_B64)
        .filter(crate::license::accepts);
    crate::license::status_from(Some(started), receipt.as_ref(), now)
}

/// 写操作的统一闸门。
///
/// 在**命令层**拦，而不是在每个界面路径上判断：界面路径会随功能增长而增加，漏掉一条
/// 就是一道缝；命令层是所有写操作的必经之路。Sign 产出新文件的命令只有 `sign_pdf`
/// 一条。⚠️ `generate_key` **绝对不拦**：拦了 = 过期用户连自签名证书都建不了 =
/// 连"激活后继续用"的最小路径都被堵死（FAMILY-LICENSE.md §2）。verify_pdf /
/// list_certs / set_default_cert / get_default_cert 是读操作或元数据操作，一律放行。
///
/// 错误码固定为 `LICENSE_EXPIRED`，前端凭它弹购买/激活框。
/// `ENFORCE=false` 期间（规程 B.9-2）本闸门只记账不拦截。
fn ensure_write_allowed() -> Result<(), String> {
    if current_license().allows_write(crate::license::enforced()) {
        return Ok(());
    }
    // 让界面主动知道"被拦下了"，而不是在每个动作的 catch 里各判一次错误码 ——
    // 那种写法漏掉一处，用户看到的就只是一个没有解释的失败。
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("license-expired", ());
    }
    Err("LICENSE_EXPIRED".to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseInfo {
    /// `trial` / `expired` / `licensed`。
    pub status: String,
    /// 仅 `trial` 时有意义。
    pub days_left: i64,
    /// 仅 `licensed` 时有值（`SG` 单品 / `FL` 全家桶）。
    pub product: Option<String>,
    /// 仅 `licensed` 时有值：回执里的交易号（吊销复检的凭据）。
    pub txn: Option<String>,
    /// 当前是否真的会拦截写操作（渠道 + 公钥 + 总开关三者决定）。
    pub enforcing: bool,
    /// `direct`（官网直链）/ `store`（微软商店）。
    pub channel: String,
    /// 本构建是否已配置验签公钥。
    ///
    /// 没配置时**任何人都激活不了**（回执必然验不过）。界面据此如实说明，而不是
    /// 拿"激活码未被接受"去搪塞一位已经付过钱的用户。
    pub activation_configured: bool,
}

/// 回执里的交易号（吊销复检用）。无有效回执时为 None。
fn receipt_txn() -> Option<String> {
    let dir = LICENSE_DIR.get()?;
    crate::license::read_valid_receipt(dir, crate::license::PUBLIC_KEY_B64).map(|r| r.txn)
}

fn license_info() -> LicenseInfo {
    let status = current_license();
    let txn = receipt_txn();
    LicenseInfo {
        status: status.as_str().to_string(),
        days_left: match &status {
            crate::license::Status::Trialing { days_left } => *days_left,
            _ => 0,
        },
        product: match &status {
            crate::license::Status::Licensed { product } => Some(product.clone()),
            _ => None,
        },
        txn,
        enforcing: crate::license::enforced(),
        channel: crate::license::channel().to_string(),
        activation_configured: !crate::license::PUBLIC_KEY_B64.trim().is_empty(),
    }
}

/// 供界面展示：剩余试用天数 / 是否已激活 / 当前渠道。
///
/// ⚠️ 不能加 `pub`：Sign 的命令都定义在 crate 根（lib.rs），而 `#[tauri::command]` 对
/// `pub` 命令会生成 `#[macro_export]`，宏被提升到 crate 根后与本地定义同名冲突
/// （E0255，MD 模板验证发现的坑）。
#[tauri::command]
async fn license_status() -> Result<LicenseInfo, String> {
    Ok(license_info())
}

/// 保存服务端签出的回执并立即验签。
///
/// 联网换回执的那一步在**前端**做（`fetch` 到 rocktier.com/api/activate），
/// 为的是不引入 HTTP 客户端依赖；但**验签与落盘必须在这里** —— 前端拿到的只是一段
/// 待验的字符串，能证明它有效与否的只有公钥。
/// 本机指纹，供前端在**激活时**上报给服务端做设备计数。
///
/// 为什么单独开一个命令而不是让前端自己算：指纹要读注册表 / ioreg，
/// 只有 Rust 侧做得到；且**试用与激活必须用同一个指纹** ——
/// 用两套标识会出现「A 说没试过、B 说试过」这种自相矛盾。
///
/// 取不到时返回空串：服务端据此不计数也不拦激活（见
/// `rocktier.com/api/devices.js` 的模块说明）。
#[tauri::command]
fn report_machine_fingerprint() -> String {
    crate::trial::machine_fingerprint()
}

#[tauri::command]
async fn store_receipt(signed: String) -> Result<LicenseInfo, String> {
    let dir = LICENSE_DIR
        .get()
        .ok_or_else(|| "no app data directory".to_string())?;
    let trimmed = signed.trim();
    let receipt = crate::license::verify_receipt(trimmed, crate::license::PUBLIC_KEY_B64)?;

    // 其它单品的码虽然签名有效，但**不属于**本应用 —— 而且不要落盘：落下去以后
    // 会被当成有效回执读回来，等于自己给自己开后门。
    if !crate::license::accepts(&receipt) {
        return Err("LICENSE_WRONG_PRODUCT".to_string());
    }

    crate::license::save_receipt(dir, trimmed)?;
    Ok(license_info())
}

/// 清除本地回执（吊销复检判定 revoked 时由前端调用）。
/// 之后 license_status 回到 trial/expired，写闸门按状态拦截。
#[tauri::command]
fn clear_receipt() -> Result<(), String> {
    let dir = LICENSE_DIR
        .get()
        .ok_or_else(|| "no app data directory".to_string())?;
    let p = dir.join("receipt.txt");
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

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

/// 启动期到达的文档队列（tao#1235：冷启动时 `application:openURLs:` 早于
/// setup/托管状态，`try_state` 拿不到任何东西，必须在进程级静态里排队，
/// setup 完成后再搬进 `InitialFile`。Chromium 的 `_startupComplete` 同款）。
static PENDING_DOCS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Cert metadata stored in the cert store directory.
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct CertInfo {
    pub name: String,
    pub created: String,
    pub path: String,
    /// 证书元数据 sidecar（inspect-cert 产出）；生成/旧证书缺 sidecar 时为 None，
    /// 序列化时省略 —— TS 侧 meta?: CertMeta。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<CertMeta>,
}

/// 证书元数据 sidecar（{name}.meta.json）。来源是引擎 inspect-cert 的 JSON：
/// 有效期/主体/链长驱动 CertPage 展示；sign_pdf 据此做过期硬确认（D-52）。
/// 所有字段带 default：sidecar 永远向后兼容（老 JSON 少字段也能读）。
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct CertMeta {
    #[serde(default)] pub subject: String,
    #[serde(default)] pub cn: String,
    #[serde(default)] pub issuer: String,
    #[serde(default)] pub not_before: String,
    #[serde(default)] pub not_after: String,
    #[serde(default)] pub key_type: String,
    #[serde(default)] pub chain_len: u32,
    #[serde(default)] pub expired: bool,
    /// 用户在证书页对**已过期**证书点过「仍要使用」后为 true —— 过期硬确认的
    /// 确认手势记忆。确认放在 CertPage（SignPage 零改动）；未过期证书永不置位。
    #[serde(default)] pub allow_expired: bool,
}

/// 前端把二进制文件按 latin1 逐字节转成字符串走 JSON（零新增依赖）；
/// Rust 侧逐 char 还原字节 —— U+0000..U+00FF 无损往返。
fn latin1_to_bytes(s: &str) -> Vec<u8> {
    s.chars().map(|c| u32::from(c) as u8).collect()
}

/// sidecar 读取。读不到/坏 JSON 返回 None（旧证书没有 meta，不影响任何路径）。
fn read_cert_meta(store: &std::path::Path, name: &str) -> Option<CertMeta> {
    let p = store.join(format!("{name}.meta.json"));
    let s = fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

fn write_cert_meta(store: &std::path::Path, name: &str, meta: &CertMeta) -> Result<(), String> {
    let p = store.join(format!("{name}.meta.json"));
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

/// 检查/导入用的临时目录（0700）—— 里面会短暂出现（可能加密的）私钥文件。
/// 调用方负责用完 remove_dir_all。
fn make_inspect_tmp() -> Result<PathBuf, String> {
    let tmp = std::env::temp_dir().join(format!(
        "rocktier-sign-import-{}-{}",
        std::process::id(),
        temp_suffix()
    ));
    fs::create_dir_all(&tmp).map_err(|e| format!("create temp: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o700));
    }
    Ok(tmp)
}

/// engine inspect-cert 的三种失败形态（退出码 7 / 8 / 6 / 其它）。
enum InspectFail {
    /// 输入是加密私钥但没给口令 → 前端弹密码框（CERT_IMPORT_PASSWORD_REQUIRED）。
    PasswordRequired,
    /// 给过口令但解不开（打错了）→ 前端提示口令不正确并保留密码框（S2）。
    PasswordWrong,
    /// 私钥与证书不配对 → 前端展示固定说明（CERT_KEY_MISMATCH）。
    KeyMismatch,
    Other(String),
}

/// 跑引擎子进程；口令（若有）经 stdin 写入后关闭，再收输出。
/// 写入口令的量只有几十字节，子进程输出也只有一行，无管道死锁风险。
fn run_engine_with_password(
    mut cmd: Command,
    password: Option<&str>,
) -> Result<std::process::Output, String> {
    if let Some(pw) = password {
        if !pw.is_empty() {
            let mut child = cmd
                .spawn()
                .map_err(|e| format!("engine exec: {e}"))?;
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write as _;
                let _ = stdin.write_all(pw.as_bytes());
                // drop 即关闭 stdin —— 引擎读到 EOF 才会继续。
            }
            return child
                .wait_with_output()
                .map_err(|e| format!("engine wait: {e}"));
        }
    }
    cmd.output().map_err(|e| format!("engine exec: {e}"))
}

fn engine_inspect(
    engine: &std::path::Path,
    key_in: &std::path::Path,
    cert_in: Option<&std::path::Path>,
    password: Option<&str>,
    tmp: &std::path::Path,
) -> Result<CertMeta, InspectFail> {
    let meta_json = tmp.join("meta.json");
    let key_out = tmp.join("out.key");
    let cert_out = tmp.join("out.crt");

    let mut cmd = Command::new(engine);
    cmd.arg("inspect-cert")
        .arg("-key").arg(key_in)
        .arg("-key-out").arg(&key_out)
        .arg("-cert-out").arg(&cert_out)
        .arg("-json-out").arg(&meta_json);
    if let Some(c) = cert_in {
        cmd.arg("-cert").arg(c);
    }
    // 口令走 stdin（S1）：命令行参数在 ps 里可见，窗口期内可被同机进程窥视。
    // stdin 写入量极小（一行口令），不存在管道死锁风险。
    if let Some(pw) = password {
        if !pw.is_empty() {
            cmd.arg("-password-stdin");
            cmd.stdin(std::process::Stdio::piped());
        }
    }
    let out = run_engine_with_password(cmd, password).map_err(InspectFail::Other)?;
    match out.status.code() {
        Some(0) => {}
        Some(7) => return Err(InspectFail::PasswordRequired),
        Some(8) => return Err(InspectFail::PasswordWrong),
        Some(6) => return Err(InspectFail::KeyMismatch),
        _ => return Err(InspectFail::Other(String::from_utf8_lossy(&out.stderr).to_string())),
    }
    let s = fs::read_to_string(&meta_json).map_err(|e| InspectFail::Other(format!("read meta: {e}")))?;
    serde_json::from_str(&s).map_err(|e| InspectFail::Other(format!("parse meta: {e}")))
}

/// PDF file extensions we handle.
const PDF_EXTS: [&str; 1] = ["pdf"];

/// OS secure-store service name for private keys.
/// On macOS this is a Keychain entry, on Windows the Credential Manager
/// (DPAPI-backed), on Linux libsecret — never a plaintext file (P0-13).
const KEYRING_SERVICE: &str = "Rocktier Sign";

/// Keychain entry username for a given certificate's private key.
fn keyring_user(name: &str) -> String {
    format!("sign-key:{name}")
}

/// Unique suffix for throwaway temp-file names (pid + nanosecond clock).
fn temp_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

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

/// 把输入 PDF 的原始字节交给前端（pdf.js 页面预览用）。
///
/// 走 tauri 二进制 IPC（ipc::Response），不经 JSON —— 大文件不膨胀。
/// 路径来自系统文件对话框的用户选择；这里只做扩展名守卫。
#[tauri::command]
fn read_pdf_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    if !path.to_lowercase().ends_with(".pdf") {
        return Err("only PDF files can be previewed".to_string());
    }
    let bytes = fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Sign a PDF file using the embedded sign-engine binary.
/// Cert identified by cert_id (stored cert name) or direct key_path/cert_path.
/// When visual_sig is true, generates a default signature appearance PNG and
/// positions it according to the `position` parameter.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn sign_pdf(
    app: tauri::AppHandle,
    input: String,
    output: String,
    name: String,
    cert_id: Option<String>,
    key_path: Option<String>,
    cert_path: Option<String>,
    visual_sig: Option<bool>,
    image_path: Option<String>,
    position: Option<String>,
    // 自由摆放（D-53 v1）："llx,lly,urx,ury"（PDF 点，左下原点）。优先于 position。
    rect: Option<String>,
    // 落页（1-based）。此前引擎虽解析 -page 但 Rust 从未传 —— 恒为第 1 页。
    page: Option<u32>,
) -> Result<String, String> {
    // 签名是 Sign 唯一"产出新文件"的写操作：受授权闸门保护（FAMILY-LICENSE.md §2）。
    // ENFORCE=false 期间只记账不拦截；官网上架可购后翻 license::ENFORCE 即生效。
    // ⚠️ generate_key 刻意不拦：过期用户必须仍能创建证书，否则激活后也无证可用。
    ensure_write_allowed()?;
    let engine = engine_path(&app)?;

    if !engine.exists() {
        return Err(format!("sign-engine not found at {engine:?}"));
    }

    // Resolve key/cert: either from cert_id lookup or direct paths.
    // For cert_id the private key lives in the OS keychain (P0-13): pull it out
    // to a throwaway temp file that is deleted before we return. Legacy installs
    // that still have a plaintext .key on disk are migrated into the keychain.
    let mut temp_key_guard: Option<std::path::PathBuf> = None;
    let (resolved_key, resolved_cert) = if let Some(id) = cert_id {
        let store = cert_store_dir(&app)?;
        let c = store.join(format!("{id}.crt"));
        if !c.exists() {
            return Err(format!("cert '{id}' not found in store"));
        }

        // 过期硬确认（D-52）：过期证书的签署必须先在证书页点过「仍要使用」。
        // 路障设在不可逆一环 —— 导入错可逆（5 秒重导），签错不可逆。没有 meta
        // 的老证书不拦：我们不知道它的有效期，宁可多放不锁人。
        if let Some(meta) = read_cert_meta(&store, &id) {
            if meta.expired && !meta.allow_expired {
                return Err(format!("CERT_EXPIRED_CONFIRM|{id}|{}", meta.not_after));
            }
        }

        let key_pem = match keyring::Entry::new(KEYRING_SERVICE, &keyring_user(&id)) {
            Ok(entry) => entry.get_password().ok(),
            Err(_) => None,
        };

        let key_pem = match key_pem {
            Some(p) => p,
            None => {
                // Fallback: older installs stored a plaintext .key — migrate it.
                let legacy = store.join(format!("{id}.key"));
                if !legacy.exists() {
                    return Err(format!(
                        "private key for '{id}' is not in the system keychain. The keychain may \
                         have been reset, or this certificate was created by an older version. \
                         Please re-create the certificate."
                    ));
                }
                let p = fs::read_to_string(&legacy)
                    .map_err(|e| format!("read legacy key: {e}"))?;
                if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &keyring_user(&id)) {
                    let _ = entry.set_password(&p);
                }
                let _ = fs::remove_file(&legacy);
                p
            }
        };

        let tmp_key = std::env::temp_dir().join(format!(
            "rocktier-sign-{}-{}",
            std::process::id(),
            temp_suffix()
        ));
        fs::write(&tmp_key, key_pem).map_err(|e| format!("write temp key: {e}"))?;
        temp_key_guard = Some(tmp_key.clone());
        (tmp_key.to_string_lossy().into_owned(), c.to_string_lossy().into_owned())
    } else {
        match (key_path, cert_path) {
            (Some(k), Some(c)) => (k, c),
            _ => return Err("provide either cert_id or both key_path and cert_path".into()),
        }
    };

    let mut cmd = Command::new(&engine);
    cmd.arg("sign")
        .arg("-input").arg(&input)
        .arg("-output").arg(&output)
        .arg("-key").arg(&resolved_key)
        .arg("-cert").arg(&resolved_cert)
        .arg("-name").arg(&name);

    // 自由摆放 + 落页（D-53 v1）：-rect 优先于 -position（引擎侧）；
    // 不依赖 visual_sig —— 不可见签名同样占据所选页的签名域。
    if let Some(r) = rect.as_deref() {
        if !r.trim().is_empty() {
            cmd.arg("-rect").arg(r);
        }
    }
    if let Some(p) = page {
        cmd.arg("-page").arg(p.to_string());
    }

    // Add visual signature appearance if requested
    if visual_sig == Some(true) {
        let pos = position.unwrap_or_else(|| "bottom-right".to_string());
        cmd.arg("-position").arg(&pos);

        // If no custom image, generate a default sig appearance
        if let Some(image_path) = image_path {
            cmd.arg("-image").arg(&image_path);
        } else {
            let data_dir = app.path().app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            let sig_path = data_dir.join("sig-appearance.png");
            let sig_str = sig_path.to_string_lossy().into_owned();

            let gen_output = Command::new(&engine)
                .arg("generate-sig-image")
                .arg("-name").arg(&name)
                .arg("-output").arg(&sig_str)
                .output()
                .map_err(|e| format!("engine exec: {e}"))?;

            if !gen_output.status.success() {
                return Err(String::from_utf8_lossy(&gen_output.stderr).to_string());
            }

            cmd.arg("-image").arg(&sig_str);
        }
    }

    let output_result = cmd.output()
        .map_err(|e| format!("engine exec: {e}"))?;

    // Best-effort: the transient private-key temp file must not linger.
    if let Some(p) = &temp_key_guard {
        let _ = fs::remove_file(p);
    }

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

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // The engine returns a non-zero exit code to separate "invalid signature"
    // (red), "valid but untrusted / self-signed" (yellow) and "no signatures"
    // from a clean pass. We forward its JSON in every case so the UI can colour
    // the verdict instead of pretending every file verifies (P0-14).
    if output.status.success() {
        Ok(stdout)
    } else if !stdout.trim().is_empty() {
        Err(stdout)
    } else {
        Err(format!("Verification failed: {}", stderr.trim()))
    }
}

/// Reject certificate names that could escape the cert store directory
/// (`../`, absolute paths, path separators, hidden files).
fn sanitize_cert_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.starts_with('.')
    {
        return Err("Invalid certificate name".to_string());
    }
    Ok(trimmed.to_string())
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

    let name = sanitize_cert_name(&name)?;
    let store = cert_store_dir(&app)?;
    let cert_out = store.join(format!("{name}.crt"));

    // Overwriting silently destroys the old private key — every signature the
    // user made with it becomes unverifiable *by them*. Refuse instead.
    if cert_out.exists() {
        return Err(format!(
            "A certificate named \"{name}\" already exists. Choose a different name."
        ));
    }

    // Generate into a temp dir, then keep *only* the public cert in the store.
    // The private key goes into the OS secure store (macOS Keychain / Windows
    // Credential Manager / libsecret) and is never persisted as a plaintext
    // file (P0-13).
    let tmp = std::env::temp_dir().join(format!(
        "rocktier-sign-gen-{}-{}",
        std::process::id(),
        temp_suffix()
    ));
    fs::create_dir_all(&tmp).map_err(|e| format!("create temp: {e}"))?;
    let key_tmp = tmp.join(format!("{name}.key"));
    let cert_tmp = tmp.join(format!("{name}.crt"));

    let output_result = Command::new(&engine)
        .arg("generate-key")
        .arg("-name").arg(&name)
        .arg("-key-out").arg(&key_tmp)
        .arg("-cert-out").arg(&cert_tmp)
        .output()
        .map_err(|e| format!("engine exec: {e}"))?;

    if !output_result.status.success() {
        let _ = fs::remove_dir_all(&tmp);
        return Err(String::from_utf8_lossy(&output_result.stderr).to_string());
    }

    // Read the freshly generated private key and store it in the OS keychain.
    let key_pem = fs::read_to_string(&key_tmp).map_err(|e| format!("read temp key: {e}"))?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_user(&name))
        .map_err(|e| format!("keychain init: {e}"))?;
    entry.set_password(&key_pem).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp);
        format!("store private key in system keychain failed: {e}")
    })?;

    // Move the public cert into the store; the private key never lands on disk.
    fs::copy(&cert_tmp, &cert_out).map_err(|e| format!("write cert: {e}"))?;

    // 生成路径也产 meta（有效期/主体进 CertPage 展示；过期闸门对生成证书同样生效）。
    // inspect 失败不该让一次成功的生成失败 —— meta 缺席只是少展示，退回 None。
    let meta = engine_inspect(&engine, &key_tmp, Some(&cert_tmp), None, &tmp).ok();
    if let Some(m) = &meta {
        let _ = write_cert_meta(&store, &name, m);
    }
    let _ = fs::remove_dir_all(&tmp);

    Ok(CertInfo {
        name: name.clone(),
        created: chrono::Local::now().to_rfc3339(),
        path: cert_out.to_string_lossy().into_owned(),
        meta,
    })
}

/// 导入前预览：只跑引擎 inspect-cert 读元数据，不写 store、不进 keychain。
/// UI 流程：选文件 → 预览（CN 预填 + 有效期/链长展示）→ 改名 → 导入。
#[tauri::command]
fn inspect_cert_files(
    app: tauri::AppHandle,
    key_data: String,
    cert_data: Option<String>,
    password: Option<String>,
) -> Result<CertMeta, String> {
    let engine = engine_path(&app)?;
    if !engine.exists() {
        return Err(format!("sign-engine not found at {engine:?}"));
    }
    let tmp = make_inspect_tmp()?;
    let key_in = tmp.join("in.key");
    fs::write(&key_in, latin1_to_bytes(&key_data)).map_err(|e| format!("write key input: {e}"))?;
    let cert_in = match cert_data.as_deref() {
        Some(c) if !c.trim().is_empty() => {
            let p = tmp.join("in.crt");
            fs::write(&p, latin1_to_bytes(c)).map_err(|e| format!("write cert input: {e}"))?;
            Some(p)
        }
        _ => None,
    };
    // password 是用户自己的证书口令：只作为引擎参数在内存传递，不落盘不写日志。
    let meta = engine_inspect(&engine, &key_in, cert_in.as_deref(), password.as_deref(), &tmp)
        .map_err(inspect_fail_to_err)?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(meta)
}

fn inspect_fail_to_err(f: InspectFail) -> String {
    match f {
        InspectFail::PasswordRequired => "CERT_IMPORT_PASSWORD_REQUIRED".to_string(),
        InspectFail::PasswordWrong => "CERT_IMPORT_PASSWORD_WRONG".to_string(),
        InspectFail::KeyMismatch => {
            "CERT_KEY_MISMATCH: the private key does not match this certificate".to_string()
        }
        InspectFail::Other(e) => e,
    }
}

/// 导入外部证书 + 私钥（阶段 69 / D-52 方案，v1 全格式）。
///
/// 格式支持在 Go 引擎（inspect-cert）：裸 PEM / 口令加密 PEM / PFX·P12 / DER /
/// 证书链。本命令纪律与 generate_key 一致：
///   - 私钥归一化后**只进 OS keychain**，临时文件即用即删，绝不进 store；
///   - **不受授权闸门拦截**（过期用户必须仍能导入，否则激活后也无证可用）；
///   - 同名 .crt 已存在 → 拒绝（静默覆盖会毁掉旧私钥）。
/// 过期证书允许导入（导入警告放行），签署时的硬确认在 sign_pdf + 证书页。
#[tauri::command]
fn import_cert(
    app: tauri::AppHandle,
    name: String,
    key_data: String,
    cert_data: Option<String>,
    password: Option<String>,
) -> Result<CertMeta, String> {
    let engine = engine_path(&app)?;
    if !engine.exists() {
        return Err(format!("sign-engine not found at {engine:?}"));
    }
    let name = sanitize_cert_name(&name)?;
    let store = cert_store_dir(&app)?;
    let cert_out_path = store.join(format!("{name}.crt"));
    if cert_out_path.exists() {
        return Err(format!(
            "A certificate named \"{name}\" already exists. Choose a different name."
        ));
    }

    let tmp = make_inspect_tmp()?;
    let key_in = tmp.join("in.key");
    fs::write(&key_in, latin1_to_bytes(&key_data)).map_err(|e| format!("write key input: {e}"))?;
    let cert_in = match cert_data.as_deref() {
        Some(c) if !c.trim().is_empty() => {
            let p = tmp.join("in.crt");
            fs::write(&p, latin1_to_bytes(c)).map_err(|e| format!("write cert input: {e}"))?;
            Some(p)
        }
        _ => None,
    };
    let meta = engine_inspect(&engine, &key_in, cert_in.as_deref(), password.as_deref(), &tmp)
        .map_err(inspect_fail_to_err)?;

    // 私钥进 keychain（generate_key 同款）；keychain 失败则整体失败，不留半态。
    let key_pem = fs::read_to_string(tmp.join("out.key"))
        .map_err(|e| format!("read normalized key: {e}"))?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_user(&name))
        .map_err(|e| {
            let _ = fs::remove_dir_all(&tmp);
            format!("keychain init: {e}")
        })?;
    entry.set_password(&key_pem).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp);
        format!("store private key in system keychain failed: {e}")
    })?;

    // 证书链进 store；meta sidecar 记有效期与确认状态（allow_expired 此时必为 false：
    // 「签署时硬确认」的手势在证书页做，导入不代签）。
    fs::copy(tmp.join("out.crt"), &cert_out_path).map_err(|e| format!("write cert: {e}"))?;
    write_cert_meta(&store, &name, &meta)?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(meta)
}

/// 过期证书的签署确认（D-52「签署时硬确认」的确认手势，在证书页点）。
/// 未过期证书直接 Ok（无需也不应置位）；没有 meta 的老证书同样 Ok（闸门本来就不拦）。
#[tauri::command]
fn allow_expired_cert(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let name = sanitize_cert_name(&name)?;
    let store = cert_store_dir(&app)?;
    if !store.join(format!("{name}.crt")).exists() {
        return Err(format!("cert '{name}' not found in store"));
    }
    let mut meta = match read_cert_meta(&store, &name) {
        Some(m) => m,
        None => return Ok(()),
    };
    if !meta.expired {
        return Ok(());
    }
    meta.allow_expired = true;
    write_cert_meta(&store, &name, &meta)
}

/// List all certificates in the store.
#[tauri::command]
fn list_certs(app: tauri::AppHandle) -> Result<Vec<CertInfo>, String> {
    let store = cert_store_dir(&app)?;
    let mut certs: Vec<CertInfo> = Vec::new();

    // A certificate is present iff its public .crt lives in the store; the
    // private key is held in the OS keychain (P0-13), not as a .key file.
    if let Ok(entries) = fs::read_dir(&store) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("crt") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
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
                    meta: read_cert_meta(&store, stem),
                });
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
    let name = sanitize_cert_name(&name)?;
    let store = cert_store_dir(&app)?;
    let crt = store.join(format!("{name}.crt"));
    if !crt.exists() {
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
/// Menu labels for one language.
///
/// Same approach as PDF's and CAD's `menu.rs`: a struct per language instead
/// of widening the old `l(zh, en)` closure to eight arguments — with eight
/// positional string arguments, swapping `ja` and `ko` compiles cleanly and
/// silently shows the wrong language.
///
/// Unknown codes fall back to English rather than panicking, so a stale
/// `localStorage` value degrades to a usable menu.
struct MenuStrings {
    open: &'static str,
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    help: &'static str,
    toggle_theme: &'static str,
    quit: &'static str,
    website: &'static str,
    feedback: &'static str,
    about: &'static str,
    license: &'static str,
    check_updates: &'static str,
}

impl MenuStrings {
    fn for_lang(lang: &str) -> Self {
        // Primary subtag, so "zh-CN" and "zh-Hans" both land on zh.
        let code = lang.split(['-', '_']).next().unwrap_or("");
        match code {
            "zh" => Self {
                open: "打开…", file: "文件", edit: "编辑", view: "显示", window: "窗口",
                help: "帮助", toggle_theme: "切换日夜模式", quit: "退出",
                website: "官方网站", feedback: "反馈",
                about: "关于 Rocktier Sign", check_updates: "检查更新…", license: "许可与激活…",
            },
            "ja" => Self {
                open: "開く…", file: "ファイル", edit: "編集", view: "表示", window: "ウインドウ",
                help: "ヘルプ", toggle_theme: "テーマを切り替え", quit: "終了",
                website: "公式サイト", feedback: "フィードバック",
                about: "Rocktier Sign について", check_updates: "アップデートを確認…", license: "ライセンス…",
            },
            "ko" => Self {
                open: "열기…", file: "파일", edit: "편집", view: "보기", window: "창",
                help: "도움말", toggle_theme: "테마 전환", quit: "종료",
                website: "공식 웹사이트", feedback: "피드백",
                about: "Rocktier Sign 정보", check_updates: "업데이트 확인…", license: "라이선스…",
            },
            "de" => Self {
                open: "Öffnen…", file: "Datei", edit: "Bearbeiten", view: "Ansicht", window: "Fenster",
                help: "Hilfe", toggle_theme: "Design wechseln", quit: "Beenden",
                website: "Website", feedback: "Feedback",
                about: "Über Rocktier Sign", check_updates: "Nach Updates suchen…", license: "Lizenz…",
            },
            "es" => Self {
                open: "Abrir…", file: "Archivo", edit: "Editar", view: "Ver", window: "Ventana",
                help: "Ayuda", toggle_theme: "Cambiar tema", quit: "Salir",
                website: "Sitio web", feedback: "Comentarios",
                about: "Acerca de Rocktier Sign", check_updates: "Buscar actualizaciones…", license: "Licencia…",
            },
            "pt" => Self {
                open: "Abrir…", file: "Arquivo", edit: "Editar", view: "Exibir", window: "Janela",
                help: "Ajuda", toggle_theme: "Alternar tema", quit: "Sair",
                website: "Site", feedback: "Comentários",
                about: "Sobre o Rocktier Sign", check_updates: "Verificar atualizações…", license: "Licença…",
            },
            "ar" => Self {
                open: "فتح…", file: "ملف", edit: "تحرير", view: "عرض", window: "نافذة",
                help: "مساعدة", toggle_theme: "تبديل المظهر", quit: "إنهاء",
                website: "الموقع", feedback: "ملاحظات",
                about: "حول Rocktier Sign", check_updates: "التحقق من التحديثات…", license: "الترخيص…",
            },
            // English is both the family default and the fallback.
            _ => Self {
                open: "Open…", file: "File", edit: "Edit", view: "View", window: "Window",
                help: "Help", toggle_theme: "Toggle Theme", quit: "Quit",
                website: "Website", feedback: "Feedback",
                about: "About Rocktier Sign", check_updates: "Check for Updates…", license: "License…",
            },
        }
    }
}

fn build_app_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<()> {
    let m = MenuStrings::for_lang(lang);

    let app_menu = Submenu::with_items(
        app,
        "Rocktier Sign",
        true,
        &[
            &PredefinedMenuItem::about(
                app,
                Some(m.about),
                                Some(AboutMetadata {
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    copyright: Some("Copyright 2026 Rocktier".to_string()),
                    ..Default::default()
                }),
            )?,
            &PredefinedMenuItem::separator(app)?,
            // Windows 上 muda 的 hide_others 落进 `_ => {}` 点了无反应、hide 是
            // SW_HIDE 窗口消失召不回（findings D-42）——仅 macOS 显示这两项。
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::hide(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", m.quit, true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let open_i = MenuItem::with_id(app, "open", m.open, true, Some("CmdOrCtrl+O"))?;
    let file_menu = Submenu::with_items(
        app,
        m.file,
        true,
        &[
            &open_i,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        m.edit,
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

    let theme_i = MenuItem::with_id(app, "toggle-theme", m.toggle_theme, true, None::<&str>)?;
    let view_menu = Submenu::with_items(
        app,
        m.view,
        true,
        &[&theme_i],
    )?;

    let window_menu = Submenu::with_items(
        app,
        m.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            // macOS 原生全屏有效；Windows 上 muda 的 fullscreen 落进 `_ => {}` 点了
            // 无反应，改用自定义 win-fullscreen 项，由 on_menu_event 调 set_fullscreen。
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(app, None)?,
            #[cfg(target_os = "windows")]
            &MenuItem::with_id(app, "win-fullscreen", "Toggle Full Screen", true, None::<&str>)?,
        ],
    )?;

    let site_i = MenuItem::with_id(app, "website", m.website, true, None::<&str>)?;
    let mail_i = MenuItem::with_id(app, "feedback", m.feedback, true, None::<&str>)?;
    // 购买页面上写着"打开应用 → 帮助 → License → 输入激活码"，所以应用里必须真有一个
    // 能到那儿的常驻入口（侧栏授权胶囊在已激活/商店版下会隐藏，这里是兜底入口）。
    let license_i = MenuItem::with_id(app, "license", m.license, true, None::<&str>)?;
    // 检查更新。它只 emit "check-updates"，联网由前端 services/updates.ts 做 ——
    // 应用启动时不检查，只有用户点这里或侧栏底部的版本号才发那一次请求。
    let update_i = MenuItem::with_id(app, "check-updates", m.check_updates, true, None::<&str>)?;
    let help_menu = Submenu::with_items(
        app,
        m.help,
        true,
        &[&update_i, &license_i, &site_i, &mail_i],
    )?;

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
            // tao#1235：把冷启动队列里的文档搬进托管状态（setup 晚于
            // application:openURLs:，此刻托管状态与窗口才真正可用）。
            let queued: Vec<String> = PENDING_DOCS
                .lock()
                .expect("PENDING_DOCS poisoned")
                .drain(..)
                .collect();
            if let Some(first) = queued.first() {
                if let Some(state) = app.try_state::<InitialFile>() {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = Some(first.clone());
                    }
                }
            }
            // 授权状态的落盘目录。取不到就留空，current_license() 会按"不拦截"处理
            // —— 宁可少拦一次，也不能因为一个目录取不到把用户锁在外面（与 PDF/MD 同款）。
            if let Ok(dir) = app.path().app_data_dir() {
                init_license_dir(dir);
            }
            init_app_handle(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_file,
            mark_ready,
            force_close,
            sign_pdf,
            verify_pdf,
            generate_key,
            read_pdf_bytes,
            list_certs,
            inspect_cert_files,
            import_cert,
            allow_expired_cert,
            set_default_cert,
            get_default_cert,
            build_menu,
            open_url,
            license_status,
            report_machine_fingerprint,
            store_receipt,
            clear_receipt,
        ])
        .on_menu_event(|app, event| {
            if event.id().0.as_str() == "quit" {
                match app.get_webview_window("main") {
                    Some(window) => { let _ = window.close(); }
                    None => app.exit(0),
                }
                return;
            }
            // Windows 真全屏（替代 muda 在 Win 上无效的 PredefinedMenuItem::fullscreen）
            if event.id().0.as_str() == "win-fullscreen" {
                if let Some(win) = app.webview_windows().values().next().cloned() {
                    let _ = win.set_fullscreen(!win.is_fullscreen().unwrap_or(false));
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
        // 冷启动竞态补发：Opened 事件可能落在「前端查询 initial_file 之后、
        // 监听器挂载之前」的空窗里。页面加载完成时若仍有待开文档，再补发一次 ——
        // 前端 toPdf 幂等（只 setState），重复送达无副作用。
        .on_page_load(|window, payload| {
            if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                return;
            }
            if let Some(state) = window.app_handle().try_state::<InitialFile>() {
                if let Ok(slot) = state.0.lock() {
                    if let Some(path) = slot.as_ref() {
                        let _ = window.emit("open-file", path.clone());
                    }
                }
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
                // tao#1235：冷启动时该事件在 setup/托管状态存在之前直达，所以先入
                // 进程级队列，setup 再搬运。热启动先排空队列：队列只在 setup 里
                // drain 一次，不排则每打开一个文件就多残留一条（缓慢内存泄漏）。
                if let Ok(mut q) = PENDING_DOCS.lock() {
                    q.clear();
                    q.push(path.to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 验收（FAMILY-LICENSE.md §6 / B-P4）：试用过期后 `current_license()` 必须**记账**
    /// 为 Expired（记账与 ENFORCE 无关）；闸门行为随总开关走 —— ENFORCE=true（官网
    /// 上架可购后翻开关）时必须拦并返回固定错误码 LICENSE_EXPIRED；ENFORCE=false
    /// （当前线上状态，规程 B.9-2）时只记账不拦截。
    /// 构造法照 license.rs 既有测试：直接往状态目录里写起始时间戳。
    #[test]
    fn an_expired_trial_is_recorded_and_the_gate_tracks_enforce() {
        let dir = std::env::temp_dir().join(format!("rt-sign-license-gate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // LICENSE_DIR 是进程级单例：本测试是唯一设置它的测试。若将来有人加第二条，
        // 后到的 set 会失败 —— 那时合并两条测试，不要让闸门测试静默跑偏。
        if LICENSE_DIR.set(dir.clone()).is_err() {
            panic!("LICENSE_DIR 已被其他测试设置，闸门测试无法控制状态目录");
        }

        // 试用期第一天：无论开关，写操作都放行，状态记账为 Trialing。
        let now = now_secs();
        // 文件名即 license.rs 的 STATE_FILE（模块私有常量，这里按值写）。
        std::fs::write(dir.join("state.bin"), now.to_string()).unwrap();
        assert_eq!(ensure_write_allowed(), Ok(()), "试用期内写操作必须放行");
        assert!(
            matches!(current_license(), crate::license::Status::Trialing { .. }),
            "试用状态应记账为 Trialing"
        );

        // 把试用起始时间改到 30 天前：记账必须判 Expired（与 ENFORCE 无关）。
        std::fs::write(dir.join("state.bin"), (now - 30 * 86_400).to_string()).unwrap();
        assert!(
            matches!(current_license(), crate::license::Status::Expired),
            "过期状态应记账为 Expired —— ENFORCE=false 也要记账，翻开关前状态可查"
        );

        // 闸门行为随总开关：ENFORCE=false 时放行（只记账）；翻 true 后必须拦。
        if crate::license::enforced() {
            let err = ensure_write_allowed().unwrap_err();
            assert!(
                err.contains("LICENSE_EXPIRED"),
                "过期后写操作应返回 LICENSE_EXPIRED，实际为 {err}"
            );
        } else {
            assert_eq!(
                ensure_write_allowed(),
                Ok(()),
                "ENFORCE=false（规程 B.9-2）只记账不拦截；官网上架可购后改 true，本分支即变为拦截断言"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
