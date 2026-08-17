#!/usr/bin/env node
const version = '0.1.0';
const command = process.argv[2] ?? 'help';
if (command === 'version' || command === '--version' || command === '-v')
  console.log(version);
else if (command === 'help' || command === '--help' || command === '-h')
  console.log(
    `CIRelay ${version}\n\nUsage: cirelay <help|version>\n\nCI feedback infrastructure for AI coding agents.`,
  );
else {
  console.error(`Unknown command: ${command}\nRun 'cirelay help' for usage.`);
  process.exitCode = 1;
}
