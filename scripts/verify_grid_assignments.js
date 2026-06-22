const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const assignmentDir = path.join(root, 'game', 'grid-assignments');
const schemaPath = path.join(assignmentDir, '_schema.json');

const REQUIRED_FIELDS = [
  'type',
  'objective_type',
  'capability',
  'planner',
  'description',
  'prompt_template',
  'gold_reward',
  'output_schema'
];

function assertPlainObject(value, label) {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    label + ' must be a non-empty object'
  );
  assert(Object.keys(value).length > 0, label + ' must be a non-empty object');
}

function assertNonEmptyString(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0, label + ' must be a non-empty string');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    err.message = path.relative(root, filePath) + ' must parse as JSON: ' + err.message;
    throw err;
  }
}

assert(fs.existsSync(assignmentDir), 'game/grid-assignments must exist');

const schema = readJson(schemaPath);
assertPlainObject(schema, '_schema.json');
assert(Array.isArray(schema.required), '_schema.json must list required fields');

for (const field of REQUIRED_FIELDS) {
  assert(schema.required.includes(field), '_schema.json required fields must include ' + field);
}

const specFiles = fs.readdirSync(assignmentDir)
  .filter((name) => name.endsWith('.json') && name !== '_schema.json')
  .sort();

for (const fileName of specFiles) {
  const specPath = path.join(assignmentDir, fileName);
  const spec = readJson(specPath);
  const label = path.join('game', 'grid-assignments', fileName);

  assertPlainObject(spec, label);

  for (const field of REQUIRED_FIELDS) {
    assert(Object.prototype.hasOwnProperty.call(spec, field), label + ' missing required field: ' + field);
  }

  assertNonEmptyString(spec.type, label + ' type');
  assert.strictEqual(spec.objective_type, 'inference', label + ' objective_type must be inference');
  assertNonEmptyString(spec.capability, label + ' capability');
  assertNonEmptyString(spec.planner, label + ' planner');
  assertNonEmptyString(spec.description, label + ' description');
  assertNonEmptyString(spec.prompt_template, label + ' prompt_template');
  assert(
    spec.prompt_template.trim().length >= 120,
    label + ' prompt_template must be at least 120 characters'
  );
  assert(
    typeof spec.gold_reward === 'number' && Number.isFinite(spec.gold_reward) && spec.gold_reward > 0,
    label + ' gold_reward must be a positive number'
  );
  assertPlainObject(spec.output_schema, label + ' output_schema');
}

console.log('grid assignment verification passed (' + specFiles.length + ' spec file(s))');
