#!/usr/bin/env node
import { runCLI } from './cli.js';

// Do not process.exit(): allow stdout/stderr to flush, including piped JSON.
process.exitCode = runCLI();
