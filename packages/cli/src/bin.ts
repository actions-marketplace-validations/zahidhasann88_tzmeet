#!/usr/bin/env node
import { runCLI } from './cli.js';

process.exitCode = runCLI();
