'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ValidationCode } = require('@smartspectra/node-sdk/renderer');
const { hintFor } = require('../src/signals');

test('framing codes map to the right checklist row with plain-language advice', () => {
  assert.equal(hintFor(ValidationCode.kOk).ok, true);
  assert.equal(hintFor(ValidationCode.kTooDark).group, 'light');
  assert.equal(hintFor(ValidationCode.kFaceTooFar).group, 'frame');
  assert.equal(hintFor(ValidationCode.kMultipleFacesFound).group, 'face');
  assert.equal(hintFor(ValidationCode.kExcessiveMotion).group, 'still');
  assert.match(hintFor(ValidationCode.kFaceTooFar).message, /closer/);
});
