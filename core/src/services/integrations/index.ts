/**
 * Unified Integration Layer
 *
 * Single import for external service integrations.
 * Stripped down for local-first operation - only GitHub and OpenCode remain.
 *
 * Usage:
 *   import { github, opencode } from "@/integrations";
 */

export * as github from "@/services/integrations/github.js";
export * as opencode from "@/services/integrations/opencode.js";

import * as github from "@/services/integrations/github.js";
import * as opencode from "@/services/integrations/opencode.js";

const integrations = {
  github,
  opencode,
} as const;

type Integrations = typeof integrations;
