import { invoke } from "@tauri-apps/api/core";
import type { MeterPayload, DeviceCodeInfo } from "./types";

/** Initiate the GitHub Device Authorization Flow. Returns the user code to display. */
export async function startDeviceFlow(): Promise<DeviceCodeInfo> {
  return invoke<DeviceCodeInfo>("start_device_flow");
}

/** Poll GitHub for the access token. Blocks until success, error, or cancellation. */
export async function pollDeviceToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  return invoke<string>("poll_device_token", { deviceCode, interval, expiresIn });
}

/** Cancel an in-progress device flow poll. */
export async function cancelDeviceFlow(): Promise<void> {
  return invoke<void>("cancel_device_flow");
}

export async function ghCliToken(): Promise<string> {
  return invoke<string>("gh_cli_token");
}

export async function loadSavedToken(): Promise<string> {
  return invoke<string>("load_saved_token");
}

export async function storeToken(token: string): Promise<void> {
  return invoke<void>("store_token", { token });
}

export async function logout(): Promise<void> {
  return invoke<void>("logout");
}

export async function fetchBilling(): Promise<MeterPayload> {
  return invoke<MeterPayload>("fetch_billing");
}

export async function setOpacity(opacity: number): Promise<void> {
  return invoke<void>("set_opacity", { opacity });
}

export async function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}
