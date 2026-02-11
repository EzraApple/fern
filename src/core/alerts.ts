import { TwilioGateway } from "../channels/whatsapp/twilio-gateway.js";
import { getTwilioCredentials } from "../config/config.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

let alertGateway: TwilioGateway | null = null;
let alertPhone: string | null = null;
let fromNumber: string | null = null;

/** Initialize the alert system. Returns false if not configured. */
export function initAlerts(): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
  const phone = process.env["FERN_ALERT_PHONE"];
  if (!phone) {
    console.info("[Alerts] FERN_ALERT_PHONE not set — alerts disabled");
    return false;
  }

  const twilioCreds = getTwilioCredentials();
  if (!twilioCreds) {
    console.warn("[Alerts] Twilio credentials not configured — alerts disabled");
    return false;
  }

  alertGateway = new TwilioGateway({
    accountSid: twilioCreds.accountSid,
    authToken: twilioCreds.authToken,
  });
  alertPhone = phone;
  fromNumber = twilioCreds.fromNumber;

  console.info("[Alerts] Alert system initialized");
  return true;
}

/**
 * Send an alert message with retries.
 * Returns true if sent successfully, false if all retries failed.
 */
export async function sendAlert(message: string): Promise<boolean> {
  if (!alertGateway || !alertPhone || !fromNumber) {
    console.warn("[Alerts] Alert system not initialized, cannot send:", message);
    return false;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await alertGateway.sendMessage({
        to: `whatsapp:${alertPhone}`,
        from: fromNumber,
        body: message,
      });
      console.info(`[Alerts] Alert sent (attempt ${attempt}): ${message}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Alerts] Send failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  console.error("[Alerts] All alert send attempts failed");
  return false;
}

/** Reset alert state (for testing) */
export function resetAlerts(): void {
  alertGateway = null;
  alertPhone = null;
  fromNumber = null;
}
