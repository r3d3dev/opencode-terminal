/**
 * OpenCode plugin shipped with the "OpenCode v2 Terminal" VS Code extension.
 *
 * The CLI can only ask for attention through the terminal it runs in (sounds plus
 * OSC notifications), and the integrated terminal in VS Code does not surface
 * those, so nothing reaches the user when the window is in the background.
 *
 * The extension therefore points `OPENCODE_CONFIG_DIR` at a directory it owns,
 * this file sits in that directory's `plugins/` folder, and every event worth
 * interrupting for is appended to the log named by `OPENCODE_ATTENTION_FILE`.
 * The extension watches that file and turns each line into a VS Code
 * notification. Set `OPENCODE_ATTENTION_DEBUG` to also log plugin activation.
 *
 * Nothing here touches the user's own configuration: the directory lives under
 * the extension's global storage and is only passed to the terminals it opens.
 */

/** Events the extension knows how to surface. Kept in sync with extension.js. */
const EVENTS = ["session.idle", "session.error", "permission.asked"];

export const OpenCodeTerminalAttention = async () => {
  const env = typeof process === "undefined" ? undefined : process.env;
  const log = env ? env.OPENCODE_ATTENTION_FILE : undefined;
  // Without the log path there is nothing to report to; stay out of the way.
  if (!log) return {};

  const { appendFileSync } = await import("node:fs");
  const write = (type) => {
    try {
      appendFileSync(log, JSON.stringify({ type, at: Date.now() }) + "\n");
    } catch {
      // A missed notification is never worth breaking a session over.
    }
  };

  if (env.OPENCODE_ATTENTION_DEBUG) write("plugin.loaded");

  return {
    event: async ({ event }) => {
      if (event && EVENTS.includes(event.type)) write(event.type);
    },
  };
};
