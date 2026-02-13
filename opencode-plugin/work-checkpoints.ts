/**
 * work-checkpoints plugin for OpenCode
 *
 * Automatically saves workspace snapshots to a shadow Git repository
 * on each user message. Provides tools to list and restore checkpoints.
 *
 * Shadow repos are stored at ~/.work-checkpoints/<repo_id>/
 * where repo_id = SHA256(remote URL or workspace path)[0:12]
 *
 * Compatible with the Claude Code work-checkpoints plugin and VSCode extension.
 *
 * Installation:
 *   Copy this file to ~/.config/opencode/plugin/work-checkpoints.ts (global)
 *   or .opencode/plugin/work-checkpoints.ts (project-local)
 *
 * @see https://github.com/kururu6966/work-checkpoints
 * @see https://opencode.ai/docs/plugins/
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const WorkCheckpointsPlugin: Plugin = async ({ $, worktree }) => {
  const getShadowRepo = async () => {
    let gitRoot: string
    try {
      gitRoot = (
        await $`git -C ${worktree} rev-parse --show-toplevel`.quiet()
      ).stdout
        .toString()
        .trim()
    } catch {
      return null
    }
    if (!gitRoot) return null

    let source: string
    try {
      source = (
        await $`git -C ${gitRoot} remote get-url origin`.quiet()
      ).stdout
        .toString()
        .trim()
    } catch {
      source = gitRoot
    }

    const hash = new Bun.CryptoHasher("sha256")
      .update(source)
      .digest("hex")
      .substring(0, 12)
    return {
      shadowRepo: `${process.env.HOME}/.work-checkpoints/${hash}`,
      gitRoot,
    }
  }

  const initShadowRepo = async (shadowRepo: string, gitRoot: string) => {
    try {
      await $`test -d ${shadowRepo}/.git`.quiet()
    } catch {
      await $`mkdir -p ${shadowRepo}`
      await $`git -C ${shadowRepo} init`.quiet()
      await $`git -C ${shadowRepo} config user.email "work-checkpoints@local"`.quiet()
      await $`git -C ${shadowRepo} config user.name "Work Checkpoints"`.quiet()
      await $`git -C ${shadowRepo} config core.quotepath false`.quiet()
      await $`git -C ${shadowRepo} config i18n.commitencoding utf-8`.quiet()
      await $`git -C ${shadowRepo} config i18n.logoutputencoding utf-8`.quiet()
    }
    await $`git -C ${shadowRepo} config core.worktree ${gitRoot}`.quiet()
  }

  // Wait for git lock file to be released (max 3 seconds)
  const waitForGitLock = async (shadowRepo: string) => {
    const lockFile = `${shadowRepo}/.git/index.lock`
    for (let i = 0; i < 6; i++) {
      try {
        await $`test -f ${lockFile}`.quiet()
        await Bun.sleep(500)
      } catch {
        return true // lock file doesn't exist
      }
    }
    return false
  }

  // git add with retry (up to 3 times)
  const safeGitAdd = async (shadowRepo: string) => {
    for (let i = 0; i < 3; i++) {
      if (!(await waitForGitLock(shadowRepo))) return false
      try {
        await $`git -C ${shadowRepo} add -A`.quiet()
        return true
      } catch {
        await Bun.sleep(300)
      }
    }
    return false
  }

  // git commit with retry (up to 3 times)
  const safeGitCommit = async (shadowRepo: string, message: string) => {
    for (let i = 0; i < 3; i++) {
      if (!(await waitForGitLock(shadowRepo))) return false
      try {
        // Check if there are staged changes
        await $`git -C ${shadowRepo} diff --cached --quiet`.quiet()
        return true // no changes to commit
      } catch {
        // There are staged changes, try to commit
        try {
          await $`git -C ${shadowRepo} commit -m ${message}`.quiet()
          return true
        } catch {
          await Bun.sleep(300)
        }
      }
    }
    return false
  }

  return {
    // Auto-save on user message
    "chat.message": async (input, output) => {
      try {
        const info = await getShadowRepo()
        if (!info) return
        const { shadowRepo, gitRoot } = info
        await initShadowRepo(shadowRepo, gitRoot)

        const branch =
          (
            await $`git -C ${gitRoot} rev-parse --abbrev-ref HEAD`.quiet()
          ).stdout
            .toString()
            .trim() || "unknown"
        const timestamp = new Date().toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        })
        const promptText =
          output.message?.parts?.[0]?.text?.substring(0, 500) || ""
        const title = `[OpenCode] ${branch} @ ${timestamp}`
        const message = promptText ? `${title}\n\n${promptText}` : title

        if (await safeGitAdd(shadowRepo)) {
          await safeGitCommit(shadowRepo, message)
        }
      } catch {
        // Never break the session due to checkpoint failure
      }
    },

    tool: {
      list_checkpoints: tool({
        description:
          "List all work checkpoints (snapshots saved on each user message)",
        args: {},
        async execute(_args, _context) {
          const info = await getShadowRepo()
          if (!info) return "Error: Not a Git repository"

          const { shadowRepo } = info
          try {
            await $`test -d ${shadowRepo}/.git`.quiet()
          } catch {
            return "No checkpoints found."
          }

          // Read deleted IDs
          let deletedIds: Set<string> = new Set()
          try {
            const deleted = (
              await $`cat ${shadowRepo}/.deleted`.quiet()
            ).stdout
              .toString()
              .trim()
            if (deleted) {
              for (const id of deleted.split("\n")) {
                deletedIds.add(id.trim())
              }
            }
          } catch {
            // No .deleted file
          }

          // Read renamed mappings
          const renamedMap = new Map<string, string>()
          try {
            const renamed = (
              await $`cat ${shadowRepo}/.renamed`.quiet()
            ).stdout
              .toString()
              .trim()
            if (renamed) {
              for (const line of renamed.split("\n")) {
                const [id, ...nameParts] = line.split("\t")
                if (id && nameParts.length > 0) {
                  renamedMap.set(id.trim(), nameParts.join("\t").trim())
                }
              }
            }
          } catch {
            // No .renamed file
          }

          // Get log
          let logOutput: string
          try {
            logOutput = (
              await $`git -C ${shadowRepo} log --oneline --all --format=%h\ %s`.quiet()
            ).stdout
              .toString()
              .trim()
          } catch {
            return "No checkpoints found."
          }

          if (!logOutput) return "No checkpoints found."

          const lines: string[] = []
          let count = 0

          for (const line of logOutput.split("\n")) {
            const spaceIdx = line.indexOf(" ")
            if (spaceIdx === -1) continue
            const id = line.substring(0, spaceIdx)
            const message = line.substring(spaceIdx + 1)

            if (deletedIds.has(id)) continue

            count++
            const displayName = renamedMap.get(id) || message

            // Get date
            let date = ""
            try {
              date = (
                await $`git -C ${shadowRepo} log -1 --format=%ci ${id}`.quiet()
              ).stdout
                .toString()
                .trim()
                .split(" ")
                .slice(0, 2)
                .join(" ")
            } catch {
              // ignore
            }

            lines.push(`${count}) ${id} - ${displayName} (${date})`)
          }

          if (count === 0) return "No checkpoints found."

          return `=== Checkpoints ===\n\n${lines.join("\n")}\n\nTotal: ${count} checkpoint(s)`
        },
      }),

      restore_checkpoint: tool({
        description: "Restore workspace files to a specific checkpoint",
        args: {
          checkpoint_id: tool.schema
            .string()
            .describe(
              "Checkpoint commit ID (short hash from list_checkpoints)"
            ),
        },
        async execute(args, context) {
          const info = await getShadowRepo()
          if (!info) return "Error: Not a Git repository"

          const { shadowRepo } = info
          try {
            await $`test -d ${shadowRepo}/.git`.quiet()
          } catch {
            return "Error: No checkpoints repository found"
          }

          const checkpointId = args.checkpoint_id

          // Verify checkpoint exists
          try {
            await $`git -C ${shadowRepo} rev-parse --verify ${checkpointId}`.quiet()
          } catch {
            return `Error: Checkpoint '${checkpointId}' not found`
          }

          // Get checkpoint info
          let commitMsg = ""
          let commitDate = ""
          try {
            commitMsg = (
              await $`git -C ${shadowRepo} log -1 --format=%s ${checkpointId}`.quiet()
            ).stdout
              .toString()
              .trim()
            commitDate = (
              await $`git -C ${shadowRepo} log -1 --format=%ci ${checkpointId}`.quiet()
            ).stdout
              .toString()
              .trim()
          } catch {
            // ignore
          }

          // Ask for permission before restoring
          await context.ask({
            permission: `Restore checkpoint ${checkpointId}?\n  Message: ${commitMsg}\n  Date: ${commitDate}\n\nThis will overwrite current workspace files.`,
            patterns: ["*"],
            always: [],
            metadata: {
              checkpoint_id: checkpointId,
              message: commitMsg,
              date: commitDate,
            },
          })

          // Restore files
          try {
            await $`git -C ${shadowRepo} checkout ${checkpointId} -- .`.quiet()
          } catch (error) {
            return `Error: Failed to restore checkpoint - ${String(error)}`
          }

          return `Successfully restored checkpoint: ${checkpointId}\n  Message: ${commitMsg}\n  Date: ${commitDate}`
        },
      }),
    },
  }
}
