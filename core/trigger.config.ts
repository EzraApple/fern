import DopplerSDK from "@dopplerhq/node-sdk";
import { BuildExtension } from "@trigger.dev/build";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { syncEnvVars, additionalFiles, additionalPackages, aptGet, ffmpeg } from "@trigger.dev/build/extensions/core";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { defineConfig } from "@trigger.dev/sdk/v3";
import * as esbuild from "esbuild";
import * as fs from "fs";
import { resolve } from "path";
import { z } from "zod";
import { MAX_TASK_DURATION_SECONDS } from "./src/constants/timeouts.js";

// Note (Kevin, 2026-01-06): Constants for OpenCode binary setup in Trigger.dev
// Trigger.dev runs on Linux x64, so we target that platform specifically
const OPENCODE_BINARY_NAME = "opencode";
const OPENCODE_LINUX_PACKAGE = "opencode-linux-x64";
// Note (Kevin, 2026-01-06): Use /app/node_modules path since build runs as node user (not root)
// Can't write to /usr/local/bin, so we add the package's bin dir to PATH directly
const OPENCODE_BIN_DIR = `/app/node_modules/${OPENCODE_LINUX_PACKAGE}/bin`;

/**
 * Pre-bundle OpenCode tool files during build.
 * Note (Kevin, 2026-01-06): Tool files in src/.opencode/tool/ use @/ path aliases
 * which don't resolve at runtime when loaded by OpenCode. This extension bundles
 * each tool file with esbuild, resolving imports, and outputs .js files.
 *
 * Output goes to src/.opencode/tool-bundled/ so additionalFiles can copy them.
 */
function openCodeToolsBundler(): BuildExtension {
  return {
    name: "opencode-tools-bundler",
    onBuildStart: async (context) => {
      const toolDir = resolve("./src/.opencode/tool");
      // Note (Kevin, 2026-01-06): Output to .opencode-runtime/tool/ so OpenCode auto-discovers
      // OpenCode looks for tools in ${OPENCODE_CONFIG_DIR}/tool/ - we set OPENCODE_CONFIG_DIR in opencode.ts
      const outDir = resolve("./src/.opencode-runtime/tool");

      console.log(`[opencode-tools-bundler] Starting bundle process...`);
      console.log(`[opencode-tools-bundler] Input dir: ${toolDir}`);
      console.log(`[opencode-tools-bundler] Output dir: ${outDir}`);

      // Create output directory
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      // Find all tool files
      if (!fs.existsSync(toolDir)) {
        console.error(`[opencode-tools-bundler] Tool directory not found: ${toolDir}`);
        return;
      }

      const toolFiles = fs.readdirSync(toolDir).filter(f => f.endsWith(".ts"));
      console.log(`[opencode-tools-bundler] Found ${toolFiles.length} tool files to bundle: ${toolFiles.join(", ")}`);

      // Bundle each tool file
      for (const file of toolFiles) {
        const inputPath = resolve(toolDir, file);
        const outputPath = resolve(outDir, file.replace(".ts", ".js"));

        try {
          await esbuild.build({
            entryPoints: [inputPath],
            outfile: outputPath,
            bundle: true,
            platform: "node",
            target: "node20",
            format: "esm",
            // Resolve @/ path aliases
            plugins: [{
              name: "path-alias",
              setup(build) {
                build.onResolve({ filter: /^@\// }, (args) => {
                  let importPath = args.path.replace(/^@\//, "");
                  importPath = importPath.replace(/\.js$/, ".ts");
                  return { path: resolve("./src", importPath) };
                });
              },
            }],
            // Keep @opencode-ai/plugin external (loaded from node_modules at runtime)
            external: ["@opencode-ai/plugin"],
          });
          console.log(`[opencode-tools-bundler] Bundled ${file} -> ${file.replace(".ts", ".js")}`);
        } catch (err) {
          console.error(`[opencode-tools-bundler] Failed to bundle ${file}:`, err);
          throw err;
        }
      }

      // Verify output
      const outputFiles = fs.readdirSync(outDir);
      console.log(`[opencode-tools-bundler] Output directory contains: ${outputFiles.join(", ")}`);
      console.log(`[opencode-tools-bundler] Successfully bundled ${toolFiles.length} tools`);

      // Copy agent files to runtime directory
      const agentSrcDir = resolve("./src/.opencode/agent");
      const agentOutDir = resolve("./src/.opencode-runtime/agent");
      if (fs.existsSync(agentSrcDir)) {
        if (!fs.existsSync(agentOutDir)) {
          fs.mkdirSync(agentOutDir, { recursive: true });
        }
        const agentFiles = fs.readdirSync(agentSrcDir);
        for (const file of agentFiles) {
          fs.copyFileSync(resolve(agentSrcDir, file), resolve(agentOutDir, file));
        }
        console.log(`[opencode-tools-bundler] Copied ${agentFiles.length} agent files: ${agentFiles.join(", ")}`);
      }
    },
  };
}


/**
 * Custom extension to install pnpm globally in the Trigger.dev container.
 * Note (Kevin, 2026-01-08): Follows Gabe's pattern for additionalFiles workaround.
 * Required because npm is the only package manager available in the Trigger.dev container by default.
 */
function pnpmSetup(): BuildExtension {
  return {
    name: "pnpm-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "pnpm-setup",
        image: {
          instructions: [
            'RUN npm install -g pnpm@10.17.1 && pnpm --version',
          ],
        },
      });
    },
  };
}

/**
 * Custom extension to set Node.js memory options for the Trigger.dev container.
 * Note (Kevin, 2026-01-09): Increases max heap size to 7GB to prevent OOM crashes
 * during memory-intensive operations like pnpm install on large repos.
 * Using 7GB (not 8GB) to leave headroom for OS and other processes.
 */
function nodeMemorySetup(): BuildExtension {
  return {
    name: "node-memory-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "node-memory-setup",
        image: {
          instructions: [
            'ENV NODE_OPTIONS="--max-old-space-size=7168"',
          ],
        },
      });
    },
  };
}

/**
 * Custom extension to configure global pnpm settings for the Trigger.dev container.
 * Note (Kevin, 2026-01-09): Sets resolve-peers-from-workspace-root=true globally
 * to reduce memory usage during pnpm install by resolving peer deps once at root.
 */
function pnpmConfigSetup(): BuildExtension {
  return {
    name: "pnpm-config-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "pnpm-config-setup",
        image: {
          instructions: [
            'RUN pnpm config set resolve-peers-from-workspace-root true --global',
          ],
        },
      });
    },
  };
}

/**
 * Custom extension to install TypeScript globally in the Trigger.dev container.
 * Note (Kevin, 2026-01-08): Provides tsc for type checking during development.
 */
function typescriptSetup(): BuildExtension {
  return {
    name: "typescript-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "typescript-setup",
        image: {
          instructions: [
            'RUN npm install -g typescript && tsc --version',
          ],
        },
      });
    },
  };
}

/**
 * Custom extension to install GitHub CLI (gh) in the Trigger.dev container.
 * Note (Kevin, 2026-01-07): Installs gh from official GitHub CLI apt repository.
 * Required for OpenCode to interact with GitHub PRs, issues, and repos.
 */
function ghCliSetup(): BuildExtension {
  return {
    name: "gh-cli-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "gh-cli-setup",
        image: {
          instructions: [
            // Install gh CLI from official GitHub repository
            // Based on https://github.com/cli/cli/blob/trunk/docs/install_linux.md
            `RUN (type -p wget >/dev/null || (apt-get update && apt-get install -y wget)) \\
  && mkdir -p -m 755 /etc/apt/keyrings \\
  && wget -nv -O /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
  && apt-get update \\
  && apt-get install -y gh \\
  && gh --version \\
  && apt-get clean && rm -rf /var/lib/apt/lists/*`,
          ],
        },
      });
    },
  };
}

/**
 * Custom extension to install latest yt-dlp via pip
 * Note (Kevin, 2026-01-06): apt's yt-dlp version is often outdated, causing YouTube bot detection.
 * Installing via pip gets the latest version with current YouTube workarounds.
 * Note (Kevin, 2026-01-06): Must use image.instructions (not commands) because commands only
 * run in the build stage and don't persist to the final runtime image.
 * Note (Kevin, 2026-01-06): Self-contained - installs pip3 itself since instruction order
 * with aptGet extension is unpredictable.
 */
function ytDlpSetup(): BuildExtension {
  return {
    name: "yt-dlp-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "yt-dlp-setup",
        image: {
          // Install pip3 and yt-dlp in a single layer to ensure pip3 is available
          instructions: [
            'RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && pip3 install --break-system-packages yt-dlp && yt-dlp --version && apt-get clean && rm -rf /var/lib/apt/lists/*',
          ],
        },
      });
    },
  };
}

/**
 * Custom extension to set up OpenCode CLI for Trigger.dev tasks
 * Note (Kevin, 2026-01-06): The @opencode-ai/sdk spawns the `opencode` binary.
 * This extension ensures it's properly installed and in PATH.
 *
 * The opencode-linux-x64 package is installed via additionalPackages extension.
 * We add its bin directory to PATH so the binary can be found.
 */
function openCodeSetup(): BuildExtension {
  return {
    name: "opencode-setup",
    onBuildComplete: async (context) => {
      context.addLayer({
        id: "opencode-setup",
        commands: [
          // Verify the binary exists and is executable
          "echo '=== OpenCode Binary Setup ==='",
          `ls -la node_modules/${OPENCODE_LINUX_PACKAGE}/bin/${OPENCODE_BINARY_NAME}`,
          `chmod +x node_modules/${OPENCODE_LINUX_PACKAGE}/bin/${OPENCODE_BINARY_NAME}`,
          `node_modules/${OPENCODE_LINUX_PACKAGE}/bin/${OPENCODE_BINARY_NAME} --version`,
          "echo '=== OpenCode Setup Complete ==='",
        ],
        image: {
          // Add the opencode binary directory to PATH
          instructions: [
            `ENV PATH="${OPENCODE_BIN_DIR}:$PATH"`,
          ],
        },
      });
    },
  };
}

export default defineConfig({
  project: "proj_cdebdgjkxagvaxcymxjj",
  // Note (Kevin, 2026-01-08): Use node runtime for npm/pnpm compatibility
  // See: https://replohq.slack.com/archives/C03AACVP08Y/p1766094508472979
  runtime: "node",
  logLevel: "log",
  maxDuration: MAX_TASK_DURATION_SECONDS,
  // Note (Kevin, 2026-01-09): large-1x (8GB) required for pnpm install on large monorepos
  // medium-2x (4GB) was OOM'ing during dependency resolution
  machine: "large-1x",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      ffmpeg(),
      // Note (Kevin, 2026-01-09): Playwright for browser automation and visual testing
      // Used for taking screenshots of UI changes before/after code modifications
      playwright(),
      // Note (Kevin, 2026-01-07): git + openssh-client for SSH clone
      aptGet({ packages: ["git", "openssh-client"] }),

      // Note (Kevin, 2026-01-08): Install pnpm for package management in Trigger.dev container
      pnpmSetup(),
      // Note (Kevin, 2026-01-09): Configure global pnpm settings for memory optimization
      pnpmConfigSetup(),
      // Note (Kevin, 2026-01-08): Set Node memory limit to 4GB to prevent OOM during pnpm install
      nodeMemorySetup(),
      // Note (Kevin, 2026-01-08): Install TypeScript globally for tsc access
      typescriptSetup(),
      // Note (Kevin, 2026-01-07): Install GitHub CLI for interacting with PRs, issues, repos
      ghCliSetup(),
      // Install latest yt-dlp via pip (apt version gets blocked by YouTube)
      ytDlpSetup(),
      // Note (Kevin, 2026-01-06): Explicitly install opencode-linux-x64 binary package.
      // This is an optional dependency of opencode-ai that may not be installed automatically.
      // The additionalPackages extension ensures it's always present in production.
      additionalPackages({ packages: [OPENCODE_LINUX_PACKAGE, "pnpm"] }),
      // Set up OpenCode CLI binary (copies to /usr/local/bin for PATH access)
      openCodeSetup(),
      // Note (Kevin, 2026-01-06): Pre-bundle tool files to resolve @/ imports
      // This runs BEFORE additionalFiles to create bundled .js files
      openCodeToolsBundler(),
      // Include pre-bundled OpenCode runtime directory for deployment
      // Note (Kevin, 2026-01-06): Tools are bundled .js files with resolved imports
      // OpenCode auto-discovers tools from ${OPENCODE_CONFIG_DIR}/tool/
      additionalFiles({
        files: [
          "src/.opencode-runtime/**/*",
        ],
      }),
      // Sync environment variables from Doppler
      // Note (Kevin, 2026-01-05): Uses Doppler SDK with DOPPLER_ACCESS_TOKEN set in Trigger.dev dashboard
      // https://cloud.trigger.dev/orgs/replo-7289/projects/v3/proj_cdebdgjkxagvaxcymxjj/environment-variables
      syncEnvVars(async (ctx) => {
        if (!ctx.env.DOPPLER_ACCESS_TOKEN) {
          throw new Error("DOPPLER_ACCESS_TOKEN is not set in Trigger.dev environment variables");
        }

        // Note (Kevin, 2026-01-05): Map Trigger.dev env names to Doppler config names
        const dopplerConfigMap: Record<string, string> = {
          dev: "dev",
          staging: "stg",
          prod: "prod",
        };
        const dopplerConfig = dopplerConfigMap[ctx.environment] ?? ctx.environment;

        const doppler = new DopplerSDK({
          accessToken: ctx.env.DOPPLER_ACCESS_TOKEN,
        });

        const secretsResponse = await doppler.secrets.list(
          "replee",
          dopplerConfig,
        );

        const dopplerSecrets = z
          .record(z.string(), z.object({ computed: z.string() }))
          .parse(secretsResponse.secrets);

        const secrets = Object.entries(dopplerSecrets)
          // Note (Kevin, 2026-01-05): Filter out OTEL_ vars as they conflict with Trigger's collector
          .filter(([key]) => !key.startsWith("OTEL_"))
          // Note (Kevin, 2026-01-05): Filter out DOPPLER_ vars as they're auto-generated
          .filter(([key]) => !key.startsWith("DOPPLER_"))
          .map(([key, value]) => ({
            name: key,
            value: value.computed,
          }));

        // Note (Kevin, 2026-01-08): Include IS_TRIGGER so runtime can adjust paths
        // for additionalFiles which strips ".." from paths in the Trigger.dev container.
        // See: https://replohq.slack.com/archives/C08N6PJTK2Q/p1756405171439939
        secrets.push({ name: "IS_TRIGGER", value: "true" });

        return secrets;
      }),
      // Resolve @/ path aliases to ./src
      esbuildPlugin({
        name: "path-alias-resolver",
        setup(build) {
          build.onResolve({ filter: /^@\// }, (args) => {
            let importPath = args.path.replace(/^@\//, "");
            // Remove .js extension if present (TypeScript source files)
            importPath = importPath.replace(/\.js$/, ".ts");
            const resolved = resolve("./src", importPath);
            return { path: resolved };
          });
        },
      }),
    ],
    // Add opencode SDK and binaries to external to prevent bundling issues
    external: [
      "@opencode-ai/sdk",
      "opencode-ai",
      "opencode-darwin-arm64",
      "opencode-darwin-x64",
      "opencode-linux-arm64",
      "opencode-linux-x64",
      "opencode-win32-x64",
    ],
  },
});
