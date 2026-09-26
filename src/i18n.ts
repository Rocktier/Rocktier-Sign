import { invoke } from "@tauri-apps/api/core";

/// Build the native menu in the given UI language.
export async function buildMenu(lang: "en" | "zh"): Promise<void> {
  await invoke("build_menu", { lang });
}
