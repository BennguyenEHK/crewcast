export interface WorkUnit { id: string; description: string; files: string[]; depends: string[] }

// Parses crewcast's plan.md unit format (§7.14): each `## ` heading is one work unit; `files:`/`depends:` lines list its
// owned files and prerequisite units. The plan names no CLI/model/skill — the allocator derives those.
export function parsePlan(markdown: string): WorkUnit[] {
  const units: WorkUnit[] = [];
  const seen = new Set<string>();
  let current: WorkUnit | null = null;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
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
      // A list may wrap: lines are joined while the value ends with ',' or the next line is an indented continuation.
      let value = field[2];
      while (value.trimEnd().endsWith(',') || /^\s+\S/.test(lines[i + 1] ?? '') && !/^##\s|^\s*(files|depends)\s*:/i.test(lines[i + 1]!.trim())) {
        const next = lines[++i];
        if (next === undefined || !next.trim()) break;
        value += ` ${next.trim()}`;
      }
      const items = value.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none');
      if (field[1].toLowerCase() === 'files') current.files = items;
      else current.depends = items;
    }
  }
  return units;
}
