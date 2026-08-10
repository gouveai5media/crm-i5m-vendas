export type ProviderMessageResult = {
  ok: boolean;
  externalMessageId?: string;
  payload: unknown;
};

export type ProviderConnectionStatus = {
  connected: boolean;
  status: string;
  deviceName?: string;
};

export type NormalizedIncomingMessage = {
  externalMessageId?: string;
  remoteJid?: string;
  phone?: string;
  type: "text" | "image" | "audio" | "video" | "document" | "other";
  text?: string;
  mediaUrl?: string;
  raw: unknown;
};

export type NormalizedMessageStatus = {
  externalMessageId?: string;
  status: "sent" | "delivered" | "read" | "failed" | "unknown";
  raw: unknown;
};

export interface WhatsAppProvider {
  sendText(number: string, text: string): Promise<ProviderMessageResult>;
  sendImage(number: string, file: string, caption?: string): Promise<ProviderMessageResult>;
  sendDocument(number: string, file: string, fileName?: string, caption?: string): Promise<ProviderMessageResult>;
  sendAudio(number: string, file: string): Promise<ProviderMessageResult>;
  getConnectionStatus(deviceName: string): Promise<ProviderConnectionStatus>;
  processIncomingMessage(payload: unknown): NormalizedIncomingMessage | null;
  processMessageStatus(payload: unknown): NormalizedMessageStatus | null;
}
