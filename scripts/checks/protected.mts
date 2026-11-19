// Shared routing/agent policy. Keep this inventory independent of third-party packages.
export function protectedPolicyFile(file: string): boolean {
  return (
    /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(file) ||
    /^(?:\.codex\/|\.claude\/|\.githooks\/|\.github\/|scripts\/(?:checks|agent)\/)/.test(file) ||
    /^(?:package\.json|pnpm-(?:lock|workspace)\.yaml|tsconfig[^/]*\.json|vite\.config\.ts)$/.test(file) ||
    /^(?:apps|packages)\/[^/]+\/(?:package\.json|tsconfig[^/]*\.json|vite\.config\.[\w]+|Cargo\.(?:toml|lock))$/.test(file) ||
    /^docs\/(?:coding-standards|dependencies|enforcement|agent-hooks)\.md$/.test(file)
  )
}
