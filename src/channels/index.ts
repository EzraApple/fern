export type {
  ChannelAdapter,
  InboundMessage,
  OutboundMessage,
  ChannelCapabilities,
  Attachment,
} from "@/channels/types.js";
export { formatForChannel, stripMarkdown, chunkMessage } from "@/channels/format.js";
export {
  WhatsAppAdapter,
  type WhatsAppAdapterConfig,
} from "@/channels/whatsapp/index.js";
