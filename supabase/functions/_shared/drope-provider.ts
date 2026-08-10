import type {
  NormalizedIncomingMessage,
  NormalizedMessageStatus,
  ProviderConnectionStatus,
  ProviderMessageResult,
  WhatsAppProvider,
} from "./whatsapp-provider.ts";

const DROPE_BASE_URL = "https://dropestore.com/wp-json/wdm/v1";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

const stringValue = (...values: unknown[]) => {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : undefined;
};

export class DropeWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly apiKey: string,
    private readonly deviceToken?: string,
  ) {}

  private async request(path: string, options: RequestInit, useDeviceToken = true) {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body) headers.set("Content-Type", "application/json");
    if (useDeviceToken) {
      if (!this.deviceToken) throw new Error("Token do dispositivo DROPE não configurado");
      headers.set("token", this.deviceToken);
    } else {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }

    const response = await fetch(`${DROPE_BASE_URL}${path}`, { ...options, headers });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
    if (!response.ok) throw new Error(`DROPE respondeu HTTP ${response.status}`);
    return payload;
  }

  async listDevices() {
    const payload = await this.request("/devices", { method: "GET" }, false);
    const rows = Array.isArray(payload) ? payload : Array.isArray(record(payload)?.devices) ? record(payload)?.devices as unknown[] : [];
    return rows.map((item) => record(item)).filter(Boolean).map((item) => ({
      name: stringValue(item?.name, item?.id) ?? "Dispositivo",
      token: stringValue(item?.token),
    }));
  }

  async getConnectionStatus(deviceName: string): Promise<ProviderConnectionStatus> {
    const payload = await this.request(`/devices/${encodeURIComponent(deviceName)}/status`, { method: "GET" }, false);
    const body = record(payload);
    const instance = record(body?.instance);
    const status = stringValue(body?.status, instance?.status) ?? (body?.connected === true ? "connected" : "unknown");
    const connected = body?.connected === true || body?.loggedIn === true || ["connected", "open", "online"].includes(status.toLowerCase());
    return { connected, status, deviceName };
  }

  private async send(path: string, body: JsonRecord): Promise<ProviderMessageResult> {
    const payload = await this.request(path, { method: "POST", body: JSON.stringify(body) });
    const data = record(payload);
    const nested = record(data?.data);
    return {
      ok: data?.success !== false,
      externalMessageId: stringValue(data?.id, data?.messageId, nested?.id, nested?.messageId),
      payload,
    };
  }

  sendText(number: string, text: string) {
    return this.send("/send/text", { number, text, track_source: "crm-i5media" });
  }

  sendImage(number: string, file: string, caption = "") {
    return this.send("/send/media", { number, type: "image", file, text: caption, track_source: "crm-i5media" });
  }

  sendDocument(number: string, file: string, fileName = "documento", caption = "") {
    return this.send("/send/media", { number, type: "document", file, docName: fileName, text: caption, track_source: "crm-i5media" });
  }

  sendAudio(number: string, file: string) {
    return this.send("/send/media", { number, type: "ptt", file, track_source: "crm-i5media" });
  }

  processIncomingMessage(payload: unknown): NormalizedIncomingMessage | null {
    const root = record(payload);
    const data = record(root?.data) ?? root;
    const message = record(data?.message) ?? data;
    const key = record(data?.key) ?? record(message?.key);
    const fromMe = key?.fromMe === true || data?.fromMe === true;
    if (fromMe) return null;

    const remoteJid = stringValue(key?.remoteJid, data?.remoteJid, data?.from, data?.chatId);
    const phone = remoteJid?.replace(/\D/g, "").replace(/0+$/, "");
    const image = record(message?.imageMessage);
    const audio = record(message?.audioMessage);
    const video = record(message?.videoMessage);
    const document = record(message?.documentMessage);
    const type: NormalizedIncomingMessage["type"] = image ? "image" : audio ? "audio" : video ? "video" : document ? "document" : stringValue(message?.conversation, record(message?.extendedTextMessage)?.text, data?.text) ? "text" : "other";
    const media = image ?? audio ?? video ?? document;
    return {
      externalMessageId: stringValue(key?.id, data?.id, message?.id),
      remoteJid,
      phone,
      type,
      text: stringValue(message?.conversation, record(message?.extendedTextMessage)?.text, image?.caption, video?.caption, document?.caption, data?.text),
      mediaUrl: stringValue(media?.url, data?.mediaUrl),
      raw: payload,
    };
  }

  processMessageStatus(payload: unknown): NormalizedMessageStatus | null {
    const root = record(payload);
    const data = record(root?.data) ?? root;
    const externalMessageId = stringValue(data?.id, data?.messageId, record(data?.key)?.id);
    const rawStatus = (stringValue(data?.status, root?.status) ?? "unknown").toLowerCase();
    const status: NormalizedMessageStatus["status"] = rawStatus.includes("read") ? "read" : rawStatus.includes("deliver") ? "delivered" : rawStatus.includes("fail") || rawStatus.includes("error") ? "failed" : rawStatus.includes("sent") ? "sent" : "unknown";
    return externalMessageId ? { externalMessageId, status, raw: payload } : null;
  }
}
