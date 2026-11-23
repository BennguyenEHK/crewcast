export interface WorkUnit { id: string; description: string; files: string[]; depends: string[] }

// Parses crewcast's plan.md unit format (§7.14): each `## ` heading is one work unit; `files:`/`depends:` lines list its
// owned files and prerequisite units. The plan names no CLI/model/skill — the allocator derives those.
export function parsePlan(markdown: string): WorkUnit[] {
  const units: WorkUnit[] = [];
  const seen = new Set<string>();
  let current: WorkUnit | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(?!#)(.+)$/.exec(raw); // exactly ## (a ### line fails the (?!#) guard → treated as body)
    if (heading) {
      const id = heading[1].trim();
      if (seen.has(id)) throw new Error(`duplicate work unit: ${JSON.stringify(id)}`);
      seen.add(id);
      current = { id, description: id, files: [], depends: [] };
      units.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^(files|depends)\s*:\s*(.*)$/i.exec(raw.trim());
    if (field) {
      const items = field[2].split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none');
      if (field[1].toLowerCase() === 'files') current.files = items;
      else current.depends = items;
    }
  }
  return units;
}
