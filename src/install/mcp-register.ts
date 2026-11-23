// How to register / remove crewcast's MCP server in each CLI (vendor facts, confirmed 2026-11-22 against the installed CLIs' `mcp add --help`).
// A worker needs crewcast registered so it has the post_message tool to report back (§7.7). Returns null for a CLI with no confirmed MCP support.
export function mcpAddArgs(engineId: string): string[] | null {
  switch (engineId) {
    case 'claude': return ['mcp', 'add', '--scope', 'user', 'crewcast', '--', 'crewcast', 'mcp'];
    case 'agy': return ['mcp', 'add', 'crewcast', 'crewcast', 'mcp']; // agy: flags before <name>; command then args, no -- needed
    case 'codex':
    case 'copilot': return ['mcp', 'add', 'crewcast', '--', 'crewcast', 'mcp']; // both require -- before the stdio command
    default: return null; // e.g. kiro — MCP-add syntax not yet confirmed
  }
}

export const mcpRemoveArgs = ['mcp', 'remove', 'crewcast'];
