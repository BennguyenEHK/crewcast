import type { Skill } from '../catalog/skills.js';
import type { McpContent, McpTool } from './server.js';

export class CatalogTool implements McpTool {
  readonly name = 'catalog';
  readonly description = 'List the skills crewcast can choose from (name, description).';
  readonly inputSchema = { type: 'object', properties: {} };

  constructor(private readonly deps: { skills: Skill[] }) {}

  async call(_args: Record<string, unknown>): Promise<McpContent> {
    const list = this.deps.skills.map(s => ({ name: s.name, description: s.description }));
    return { content: [{ type: 'text', text: JSON.stringify(list) }] };
  }
}
