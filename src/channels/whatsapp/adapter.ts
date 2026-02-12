import { formatForChannel } from "@/channels/format.js";
import type { ChannelAdapter, ChannelCapabilities, OutboundMessage } from "@/channels/types.js";
import { TwilioGateway, type TwilioGatewayConfig } from "@/channels/whatsapp/twilio-gateway.js";

export interface WhatsAppAdapterConfig extends TwilioGatewayConfig {
  fromNumber: string;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly name = "whatsapp";
  private gateway: TwilioGateway;
  private fromNumber: string;

  constructor(config: WhatsAppAdapterConfig) {
    this.gateway = new TwilioGateway({
      accountSid: config.accountSid,
      authToken: config.authToken,
    });
    this.fromNumber = config.fromNumber;
  }

  async init(): Promise<void> {
    console.info("[WhatsApp] Adapter initialized");
  }

  async shutdown(): Promise<void> {
    // Twilio is stateless — nothing to tear down
  }

  async send(message: OutboundMessage): Promise<void> {
    const capabilities = this.getCapabilities();
    const chunks = formatForChannel(message.content, capabilities);

    for (const chunk of chunks) {
      await this.gateway.sendMessage({
        to: `whatsapp:${message.channelUserId}`,
        from: this.fromNumber,
        body: chunk,
      });
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markdown: false,
      streaming: false,
      maxMessageLength: 1600,
      supportsAttachments: true,
      supportsReply: false,
    };
  }

  /** Derive a stable session ID from a phone number */
  deriveSessionId(phoneNumber: string): string {
    const normalized = phoneNumber.replace("whatsapp:", "").replace(/[^+\d]/g, "");
    return `whatsapp_${normalized}`;
  }

  /** Validate incoming Twilio webhook signature */
  validateWebhook(signature: string, url: string, params: Record<string, string>): boolean {
    return this.gateway.validateRequest(signature, url, params);
  }
}
