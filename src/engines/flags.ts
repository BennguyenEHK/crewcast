import type { Engine } from './catalog.js';
import type { RiskArea, Size } from '../decide/record.js';

export interface ResolveSignals { writes_files: boolean | null; risk_area: RiskArea | null; size: Size | null }
export interface Resolved { model: string; effort: string | null; args: string[] }

// The flags-by-rules definition (§7.6/§7.3): decision signals → the model, effort and args to launch a worker with.
// It draws only from the engine's own recipe fields, so it can never emit a permission-off flag.
export function resolveFlags(engine: Engine, signals: ResolveSignals): Resolved {
  if (engine.autoMode) return { model: 'default', effort: null, args: [...engine.safeFlags] };

  const risky = signals.risk_area !== null && signals.risk_area !== 'none';
  const model = risky && engine.strongModel ? engine.strongModel : (engine.models[0] ?? 'default');
  const effort = (risky || signals.size === 'many_files') ? engine.highEffort : null;

  const args = [...engine.safeFlags];
  args.push(...(signals.writes_files === true ? engine.writeFlags : engine.readFlags));
  if (engine.modelFlag && model !== 'default') args.push(engine.modelFlag, model);
  if (effort && engine.effortArgs.length) args.push(...engine.effortArgs.map(a => a.replace('{effort}', effort)));

  return { model, effort, args };
}
