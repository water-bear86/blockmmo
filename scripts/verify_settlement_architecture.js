const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const NATIVE_WSOL_MINT = 'So11111111111111111111111111111111111111112';

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function sectionAfter(markdown, heading) {
  const index = markdown.indexOf(heading);
  assert(index !== -1, 'missing section heading: ' + heading);
  return markdown.slice(index);
}

function assertMatches(text, regex, message) {
  assert(regex.test(text), message);
}

const prd = readProjectFile('docs/design/PRD.md');
const contractsReadme = readProjectFile('contracts/README.md');
const settlementProgram = readProjectFile('contracts/programs/runechain-settlement/src/lib.rs');

assertMatches(prd, /\*\*Q-F6a \[(DECIDED|CLOSED)\]\*\*/i, 'PRD must close Q-F6a');
assertMatches(
  prd,
  /Q-F6a \[(?:DECIDED|CLOSED)\][\s\S]{0,900}custom \*\*Anchor program\*\*/i,
  'Q-F6a must choose the custom Anchor program',
);
assertMatches(
  prd,
  /Q-F6a \[(?:DECIDED|CLOSED)\][\s\S]{0,900}not[\s\S]{0,120}client-built\s+multi-instruction\s+transaction/i,
  'Q-F6a must explicitly reject a client-built multi-instruction settlement transaction',
);
assertMatches(
  prd,
  /Q-F6a \[(?:DECIDED|CLOSED)\][\s\S]{0,900}(server-authority|server-authoritative|server-constructed|server-validated)/i,
  'Q-F6a must preserve the U7/server-authority reason for the Anchor decision',
);
assertMatches(
  prd,
  /Q-F6a \[(?:DECIDED|CLOSED)\][\s\S]{0,900}(one instruction|single instruction|atomic)/i,
  'Q-F6a must preserve the atomic one-instruction settlement reason',
);

assertMatches(prd, /\*\*Q-F6b \[(DECIDED|CLOSED)\]\*\*/i, 'PRD must close Q-F6b');
assert(
  prd.includes(NATIVE_WSOL_MINT),
  'Q-F6b must pin the SPL Token Program native wSOL mint: ' + NATIVE_WSOL_MINT,
);
assertMatches(
  prd,
  /Q-F6b \[(?:DECIDED|CLOSED)\][\s\S]{0,700}(SPL Token Program|native wSOL|wrapped SOL)/i,
  'Q-F6b must describe the selected native wSOL/SPL Token settlement mint',
);

assertMatches(prd, /\| Q-F6a \| CLOSED:/, 'Open Questions Register must mark Q-F6a closed');
assertMatches(prd, /\| Q-F6b \| CLOSED:/, 'Open Questions Register must mark Q-F6b closed');
assert(
  !/\| Q-F6a \| Settlement: custom Anchor program vs\. client-built multi-instruction tx \| Architecture \|/.test(prd),
  'Open Questions Register must not keep the old Q-F6a open-question row',
);
assert(
  !/\| Q-F6b \| Which wrapped-SOL mint to settle in \| Architecture \|/.test(prd),
  'Open Questions Register must not keep the old Q-F6b open-question row',
);

assertMatches(
  contractsReadme,
  /Q-F6a[\s\S]{0,900}custom Anchor program/i,
  'contracts README must record the Q-F6a Anchor decision',
);
assertMatches(
  contractsReadme,
  /Q-F6b[\s\S]{0,900}So11111111111111111111111111111111111111112/i,
  'contracts README must record the Q-F6b native wSOL mint',
);
assert(
  contractsReadme.includes(NATIVE_WSOL_MINT),
  'contracts README must include the native wSOL mint',
);

const contractsOpenQuestions = sectionAfter(contractsReadme, '## Open questions');
assert(!/\bQ-F6a\b/.test(contractsOpenQuestions), 'contracts README must not list Q-F6a as open');
assert(!/\bQ-F6b\b/.test(contractsOpenQuestions), 'contracts README must not list Q-F6b as open');
assert(
  !/mint-agnostic[\s\S]{0,160}pick at deploy/i.test(contractsReadme),
  'contracts README must not leave the settlement mint as an arbitrary deploy-time pick',
);

assert(
  !/whichever mint is settled in,[\s\S]{0,40}Q-F6b/i.test(settlementProgram),
  'settlement program comments must not leave Q-F6b open',
);
assertMatches(
  prd + contractsReadme,
  /(legal\/compliance sign-off|legal-gated|paused)/i,
  'settlement architecture docs must keep the legal/compliance go-live gate visible',
);

console.log('settlement architecture decision verification passed.');
