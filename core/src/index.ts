#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { runChatAgent } from "@/agents/chat-agent.js";
import { logger, getConfig } from "@/config/index.js";
import * as github from "@/services/integrations/github.js";
import { unloadOllamaModel } from "@/services/integrations/ollama.js";
import { startWebhookServer } from "@/webhook-server.js";

const program = new Command();

program
  .name("jarvis")
  .description("Jarvis - Local-first AI assistant for software development")
  .version("1.0.0");

program
  .command("health")
  .description("Check connectivity to services")
  .action(async () => {
    logger.info("Running health checks...");

    const results = {
      github: false,
    };

    try {
      results.github = await github.isAuthenticated();
    } catch {
      results.github = false;
    }

    console.log("\nHealth Check Results:");
    console.log("=====================");
    console.log(`GitHub API: ${results.github ? "OK" : "FAILED"}`);

    const allHealthy = Object.values(results).every((v) => v);
    if (!allHealthy) {
      console.log("\nSome services are not healthy. Check the logs above.");
      process.exit(1);
    }

    console.log("\nAll services are healthy!");
  });

program
  .command("config")
  .description("Validate configuration")
  .action(async () => {
    try {
      const config = getConfig();

      console.log("\nConfiguration:");
      console.log("==============");
      console.log(`Ollama Base URL: ${config.ollama.baseUrl}`);
      console.log(`Ollama Model: ${config.ollama.model}`);
      console.log(`OpenAI API Key: ${config.openai.apiKey ? "✓ Set (fallback)" : "✗ Not set"}`);
      console.log(`GitHub Token: ${config.github.token ? "✓ Set" : "✗ Missing"}`);
      console.log(`\nWebhook:`);
      console.log(`  Port: ${config.webhook.port}`);
      console.log("\nConfiguration is valid!");
    } catch (error) {
      logger.error("Configuration error:", error);
      process.exit(1);
    }
  });

program
  .command("ask <message...>")
  .description("Ask Jarvis to do anything")
  .option("-r, --repo <repo>", "Repository in owner/repo format")
  .action(async (messageParts: string[], options) => {
    try {
      const message = messageParts.join(" ");

      let context = "";
      if (options.repo) {
        context = `Repository: ${options.repo}`;
      }

      logger.info(`Running: ${message}`);

      const result = await runChatAgent({
        message,
        source: {
          type: "cli",
        },
        context: context || undefined,
      });

      if (!result.success) {
        logger.error(`Failed: ${result.error}`);
        await unloadOllamaModel();
        process.exit(1);
      }

      logger.info("Done!");
      await unloadOllamaModel();
    } catch (error) {
      logger.error("Fatal error:", error);
      await unloadOllamaModel();
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Start the local API server")
  .option("-p, --port <port>", "Server port", "7829")
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    if (isNaN(port)) {
      logger.error("Invalid port number");
      process.exit(1);
    }
    startWebhookServer(port);
  });

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
