#!/usr/bin/env node
// Compiles every .sol file in src/ against real solc + real @openzeppelin/contracts
// (not stubs). This is the strongest verification available in a sandbox that
// cannot reach the Foundry installer (see README.md) -- it catches real type
// errors, real import-resolution errors, and real Solidity compiler warnings,
// the same tier of check `terraform fmt` was for the AWS stack before it could
// be `apply`'d. It does not run these contracts against an EVM -- no unit test
// has actually executed any function in this package.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

const SRC_DIR = path.join(__dirname, '..', 'src');
const NODE_MODULES = path.join(__dirname, '..', '..', '..', 'node_modules');

function findImports(importPath) {
  const candidates = [
    path.join(SRC_DIR, importPath),
    path.join(NODE_MODULES, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, 'utf8') };
    }
  }
  return { error: `File not found: ${importPath}` };
}

const sources = {};
for (const file of fs.readdirSync(SRC_DIR)) {
  if (file.endsWith('.sol')) {
    sources[file] = { content: fs.readFileSync(path.join(SRC_DIR, file), 'utf8') };
  }
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hadError = false;
for (const err of output.errors ?? []) {
  const stream = err.severity === 'error' ? console.error : console.warn;
  stream(err.formattedMessage);
  if (err.severity === 'error') hadError = true;
}

if (hadError) {
  console.error('\nCompilation FAILED.');
  process.exit(1);
}

let contractCount = 0;
for (const file of Object.keys(output.contracts ?? {})) {
  for (const name of Object.keys(output.contracts[file])) {
    contractCount++;
  }
}

console.log(`\nCompilation succeeded: ${contractCount} contract(s)/librar(y/ies) across ${Object.keys(sources).length} file(s).`);
console.log('Reminder: compiled only -- not run against any EVM. See README.md.');
