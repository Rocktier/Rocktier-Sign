import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";
import { localizeError } from "../services/errorText";
import type { CertInfo } from "../types";

interface Props {
  lang: Lang;
}

export default function CertPage({ lang }: Props) {
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [defaultCert, setDefaultCert] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                    </div>
                    <div className="cert-meta">
                      {t("cert.created", lang)}: {new Date(c.created).toLocaleDateString()}
                    </div>
                  </div>
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
