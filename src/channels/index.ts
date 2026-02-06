export type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  ChannelCapabilities,
  Attachment,
} from "./types.js";
export { formatForChannel, stripMarkdown, chunkMessage } from "./format.js";
export {
  WhatsAppAdapter,
  type WhatsAppAdapterConfig,
} from "./whatsapp/index.js";
