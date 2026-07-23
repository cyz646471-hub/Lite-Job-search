#!/usr/bin/env node

import { main } from '../src/cli/main.mjs';

main().catch((error) => {
  const message = String(error?.message || error)
    .replace(/(?:authorization|bearer|api[_-]?key|token)\s*[:=]?\s*[^\s,;]+/gi, '[REDACTED]');
  process.stderr.write(`${JSON.stringify({ status: 'error', error: message })}\n`);
  process.exitCode = 1;
});

