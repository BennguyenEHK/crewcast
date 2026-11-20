#!/usr/bin/env node
import { Cli } from './cli.js';

try {
  process.exitCode = await new Cli(console.log).run(process.argv.slice(2));
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
