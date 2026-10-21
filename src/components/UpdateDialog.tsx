import { t, type Lang } from "../i18n";
// 检查更新对话框。入口只在帮助菜单「检查更新…」—— 点击才联网，
// 启动时、工作中、后台都不检查，见 services/updates.ts 头注。
// 结果一律在这里展示：侧栏底部的常驻入口已移除（用户要求入口全部收进
// 菜单，Compressor v0.1.10 的右下角悬浮入口实测还会盖住底部内容），
// 全部改为菜单 + 弹框。
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UpdateResult, UpdateState } from "../services/updates";

interface UpdateDialogProps {
  state: UpdateState;
  result: UpdateResult | null;
  /** 当前安装版本，取自 package.json（与 tag 同源）。 */
  currentVersion: string;
  lang: Lang;
  onClose: () => void;
}

/** 打开发布页：桌面端走 Rust 白名单入口，浏览器 dev 直接开新窗口。 */
function open(url: string) {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    invoke("open_url", { url }).catch(() => {});
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export function UpdateDialog({ state, result, currentVersion, lang, onClose }: UpdateDialogProps) {
  // Esc 关闭（与 LicenseDialog 一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="update-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="update-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("update.check", lang)}
      >
        <div className="update-header">
          <h3>{t("update.check", lang)}</h3>
          <button type="button" className="update-close" onClick={onClose} aria-label={t("update.close", lang)}>
            ×
          </button>
        </div>
        <div className="update-body">
          {state === "checking" && (
            <p>
              {t("update.checking", lang)}
              <br />
              <small>{t("update.privacyNote", lang)}</small>
            </p>
          )}
          {state === "uptodate" && (
            <p>
              {t("update.upToDate", lang)}
              <br />
              <small>{`v${currentVersion}`}</small>
            </p>
          )}
          {state === "failed" && (
            <p>
              {t("update.failed", lang)}
              <br />
              <small>{t("update.openReleasesHint", lang)}</small>
            </p>
          )}
          {state === "available" && result && (
            <p>
              {t("update.available", lang, { v: result.latest })}
              <br />
              <small>{`v${currentVersion} → v${result.latest}`}</small>
            </p>
          )}
        </div>
        <div className="update-footer">
          <button type="button" onClick={onClose}>
            {t("update.close", lang)}
          </button>
          <span className="update-footer-spacer" />
          {state === "failed" && (
            <button type="button" onClick={() => open("https://github.com/Rocktier/Rocktier-Sign/releases/latest")}>
              {t("update.openReleases", lang)}
            </button>
          )}
          {state === "available" && result && (
            <button type="button" className="update-get-btn" onClick={() => open(result.url)}>
              {t("update.download", lang, { v: result.latest })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
