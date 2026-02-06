import twilio from "twilio";

export interface TwilioSendInput {
  to: string;
  from: string;
  body: string;
}

export interface TwilioGatewayConfig {
  accountSid: string;
  authToken: string;
}

export class TwilioGateway {
  private client: ReturnType<typeof twilio>;
  private authToken: string;

  constructor(config: TwilioGatewayConfig) {
    this.client = twilio(config.accountSid, config.authToken);
    this.authToken = config.authToken;
  }

  async sendMessage(input: TwilioSendInput): Promise<{ sid: string }> {
    const message = await this.client.messages.create({
      to: input.to,
      from: input.from,
      body: input.body,
    });
    return { sid: message.sid };
  }

  /** Validate that an incoming webhook request is from Twilio */
  validateRequest(signature: string, url: string, params: Record<string, string>): boolean {
    return twilio.validateRequest(this.authToken, signature, url, params);
  }
}
