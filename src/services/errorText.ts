/**
 * 错误文案本地化 —— 把 Rust 侧返回的英文原文映射为当前语言的措辞。
 * 家族 L6 的一部分（拷自 PDF 的同名文件，按 Sign 的 co-located i18n 形态适配）。
 *
 * 为什么需要这一层：`lib.rs` 把错误**拍平为英文字符串**再返回，前端各页面
 * 直接 `${e}` 拼进提示框。结果：中文用户看到 `Invalid certificate name`。
 *
 * 为什么不用错误码改 Rust 侧：那要动每个返回点，且改动面比这层大得多；这里做
 * **纯前端映射**，未知文案回退到原文 —— 新增错误不需要改前端也能正常显示
 * （只是没有本地化）。这符合规范「失败必须展示底层真实错误文本」。
 *
 * ⚠️ 别把未知错误直接吞掉换成「操作失败」：那会把一个可自查的技术原因
 * （如证书重名）变成一句没有信息量的话，比显示英文更糟。
 */

import { t, type Lang } from "../i18n";

/** Rust 错误原文 → i18n 键。键须在 `translations` 里 en/zh 两侧都存在。 */
const EXACT: Record<string, string> = {
  // lib.rs: generate_key —— 重名会让旧私钥被静默覆盖，故 Rust 侧拒绝。
  "Invalid certificate name": "cert.errorNameTaken",
};

/** 归一化匹配：忽略大小写、标点与多余空白。同一句意思在 Rust 里常被写两遍。 */
const NORMALIZED: Record<string, string> = {};
for (const [raw, key] of Object.entries(EXACT)) NORMALIZED[normalize(raw)] = key;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!?'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 返回本地化后的错误文案。
 *
 * @param raw  Rust 返回的原始错误串
 * @param lang 当前语言
 */
export function localizeError(raw: string, lang: Lang): string {
  if (!raw) return raw;

  // 许可错误码走专用处理路径（对话框已分流），不该被当成普通错误改写。
  if (raw === "LICENSE_EXPIRED" || raw === "LICENSE_WRONG_PRODUCT") return raw;

  const key = EXACT[raw] ?? NORMALIZED[normalize(raw)];
  if (!key) return raw; // 未知文案 → 原样显示底层真实错误，不隐藏细节

  const translated = t(key, lang);
  // i18n 缺键时它返回键名本身；那种情况下宁可显示原文。
  return translated && translated !== key ? translated : raw;
}