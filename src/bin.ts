#!/usr/bin/env node
import { Cli } from './cli.js';

process.exitCode = await new Cli(console.log).run(process.argv.slice(2));
