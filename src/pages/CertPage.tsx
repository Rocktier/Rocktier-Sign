import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";
import { localizeError } from "../services/errorText";
import type { CertInfo, CertMeta } from "../types";

/**
 * 把文件按 latin1 逐字节转成字符串：每个字节 → 一个 U+0000..U+00FF 字符。
 * Rust 侧 latin1_to_bytes 逐 char 还原 —— 二进制无损过 JSON，零新增依赖。
 */
function readAsLatin1(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const bytes = new Uint8Array(r.result as ArrayBuffer);
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      resolve(s);
    };
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

interface Props {
  lang: Lang;
}

export default function CertPage({ lang }: Props) {
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [defaultCert, setDefaultCert] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ── 导入外部证书（D-52 v1）──
  const [importKeyName, setImportKeyName] = useState<string | null>(null);
  const [importKeyData, setImportKeyData] = useState<string | null>(null);
  const [importCertName, setImportCertName] = useState<string | null>(null);
  const [importCertData, setImportCertData] = useState<string | null>(null);
  const [importPw, setImportPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [preview, setPreview] = useState<CertMeta | null>(null);

  const pickFile = async (
    file: File | null,
    set: (name: string | null, data: string | null) => void,
  ) => {
    setPreview(null);
    if (!file) { set(null, null); return; }
    const data = await readAsLatin1(file);
    set(file.name, data);
    // .p12/.pfx 几乎必然加密 —— 直接亮出口令框，省一轮「检查才发现」。
    if (/\.(p12|pfx)$/i.test(file.name)) setShowPw(true);
  };

  const handlePreviewImport = async () => {
    if (!importKeyData) return;
    setError(null);
    setBusy(true);
    try {
      const meta = await invoke<CertMeta>("inspect_cert_files", {
        keyData: importKeyData,
        certData: importCertData ?? undefined,
        password: importPw ? importPw : undefined,
      });
      setPreview(meta);
      setShowPw(false);
      // CN 预填（阶段 69 方案）—— 用户可改名。
      if (!newName.trim()) setNewName(meta.cn);
    } catch (e) {
      const raw = String(e);
      if (raw.includes("CERT_IMPORT_PASSWORD_REQUIRED")) {
        setShowPw(true);
        setPreview(null);
        setError(t("cert.import.passwordRequired", lang));
      } else {
        setPreview(null);
        setError(localizeError(raw, lang));
      }
    }
    setBusy(false);
  };

  const handleImport = async () => {
    const name = newName.trim();
    if (!name || !importKeyData || !preview) return;
    setError(null);
    setBusy(true);
    try {
      const first = certs.length === 0;
      await invoke<CertMeta>("import_cert", {
        name,
        keyData: importKeyData,
        certData: importCertData ?? undefined,
        password: importPw ? importPw : undefined,
      });
      if (first) await invoke("set_default_cert", { name });
      setImportKeyName(null); setImportKeyData(null);
      setImportCertName(null); setImportCertData(null);
      setImportPw(""); setShowPw(false); setPreview(null);
      await load();
    } catch (e) {
      setError(`${t("cert.error", lang)}: ${localizeError(String(e), lang)}`);
    }
    setBusy(false);
  };

  const handleAllowExpired = async (name: string) => {
    try {
      await invoke("allow_expired_cert", { name });
      await load();
    } catch (e) {
      setError(localizeError(String(e), lang));
    }
  };

  const load = async () => {
    try {
      const list = await invoke<CertInfo[]>("list_certs");
      setCerts(list);
      const def = await invoke<string | null>("get_default_cert");
      setDefaultCert(def);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const handleGenerate = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);

    setBusy(true);
    try {
      await invoke<CertInfo>("generate_key", { name });
      setNewName("");
      const list = await invoke<CertInfo[]>("list_certs");
      if (list.length === 1) {
        await invoke("set_default_cert", { name });
      }
      await load();
    } catch (e) {
      // Rust 侧 generate_key 拒绝同名证书（静默覆盖会毁掉旧私钥）。
      // 此前端 window.confirm 问一遍「是否覆盖」再被 Rust 拒绝，是死路——
      // 现直接把 Rust 的错误信息（含「换一个名字」提示）原样展示出来。
      setError(`${t("cert.error", lang)}: ${localizeError(String(e), lang)}`);
    }
    setBusy(false);
  };

  const handleSetDefault = async (name: string) => {
    try {
      await invoke("set_default_cert", { name });
      setDefaultCert(name);
    } catch (e) {
      setError(localizeError(String(e), lang));
    }
  };

  return (
    <div className="page">
      <h2 className="page-title">{t("cert.heading", lang)}</h2>
      <p className="page-intro">{t("cert.intro", lang)}</p>
      <div className="page-body">
        <div className="form-row form-row-inline">
          <input
            className="form-input"
            type="text"
            placeholder={t("cert.namePlaceholder", lang)}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleGenerate(); }}
          />
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={!newName.trim() || busy}
          >
            {busy ? t("common.loading", lang) : t("cert.generate", lang)}
          </button>
        </div>

        {error && <div className="result result-error">{error}</div>}

        {/* ── 导入外部证书（D-52 v1：全格式，检查 → 预览 → 导入）── */}
        <div className="form-row form-row-inline">
          <input
            className="form-input"
            type="file"
            accept=".pem,.key,.p12,.pfx,.der,.crt,.cer"
            aria-label={t("cert.import.keyFile", lang)}
            title={importKeyName ?? t("cert.import.keyFile", lang)}
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null, (n, d) => { setImportKeyName(n); setImportKeyData(d); })}
          />
          <input
            className="form-input"
            type="file"
            accept=".pem,.crt,.cer,.der"
            aria-label={t("cert.import.certFile", lang)}
            title={importCertName ?? t("cert.import.certFile", lang)}
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null, (n, d) => { setImportCertName(n); setImportCertData(d); })}
          />
          {showPw && (
            <input
              className="form-input"
              type="password"
              placeholder={t("cert.import.password", lang)}
              value={importPw}
              onChange={(e) => setImportPw(e.target.value)}
            />
          )}
        </div>
        <div className="form-row form-row-inline">
          <button
            className="btn-small"
            onClick={() => void handlePreviewImport()}
            disabled={!importKeyData || busy}
          >
            {t("cert.import.preview", lang)}
          </button>
          <button
            className="btn-primary"
            onClick={() => void handleImport()}
            disabled={!preview || !newName.trim() || busy}
          >
            {busy ? t("common.loading", lang) : t("cert.import.do", lang)}
          </button>
        </div>
        {preview && (
          <div className="cert-meta">
            {t("cert.import.subject", lang)}: {preview.subject} · {t("cert.import.issuer", lang)}: {preview.issuer} ·{" "}
            {t("cert.import.validUntil", lang)}: {new Date(preview.not_after).toLocaleDateString()} ·{" "}
            {t("cert.import.keyType", lang)}: {preview.key_type} · {t("cert.import.chain", lang)}: {preview.chain_len}
            {preview.expired && ` · ${t("cert.expired", lang)}`}
          </div>
        )}

        {certs.length === 0 ? (
          <div className="empty-state">{t("cert.empty", lang)}</div>
        ) : (
          <div className="cert-list">
            {certs.map((c) => {
              const isDefault = defaultCert === c.name;
              return (
                <div key={c.name} className={`cert-card${isDefault ? " cert-default" : ""}`}>
                  <div className="cert-info">
                    <div className="cert-name">
                      {c.name}
                      {isDefault && (
                        <span className="cert-badge">{t("cert.default", lang)}</span>
                      )}
                      {c.meta?.expired && (
                        <span className="cert-badge">{t("cert.expired", lang)}</span>
                      )}
                    </div>
                    <div className="cert-meta">
                      {t("cert.created", lang)}: {new Date(c.created).toLocaleDateString()}
                      {c.meta?.not_after && ` · ${t("cert.import.validUntil", lang)}: ${new Date(c.meta.not_after).toLocaleDateString()}`}
                    </div>
                  </div>
                  {c.meta?.expired && !c.meta.allow_expired && (
                    <button
                      className="btn-small"
                      onClick={() => void handleAllowExpired(c.name)}
                    >
                      {t("cert.allowExpired", lang)}
                    </button>
                  )}
                  {!isDefault && (
                    <button
                      className="btn-small"
                      onClick={() => handleSetDefault(c.name)}
                    >
                      {t("cert.setDefault", lang)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
