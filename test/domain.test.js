'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreSummary } = require('../domain');

test('scoreSummary calculates total, percentage, and category from indicator scores', () => {
  assert.deepEqual(scoreSummary({
    fluency: 4,
    flexibility: 3,
    originality: 4,
    elaboration: 2,
  }), {
    fluency: 4,
    flexibility: 3,
    originality: 4,
    elaboration: 2,
    total: 13,
    finalScore: 81.25,
    category: 'Sangat Kreatif',
  });
});

test('scoreSummary applies every interpretation threshold', () => {
  assert.equal(scoreSummary({ fluency: 4, flexibility: 4, originality: 4, elaboration: 4 }).category, 'Sangat Kreatif');
  assert.equal(scoreSummary({ fluency: 3, flexibility: 3, originality: 3, elaboration: 1 }).category, 'Kreatif');
  assert.equal(scoreSummary({ fluency: 2, flexibility: 2, originality: 1, elaboration: 2 }).category, 'Cukup Kreatif');
  assert.equal(scoreSummary({ fluency: 1, flexibility: 1, originality: 1, elaboration: 1 }).category, 'Kurang Kreatif');
  assert.equal(scoreSummary({ fluency: 0, flexibility: 0, originality: 0, elaboration: 0 }).category, 'Sangat Kurang Kreatif');
});

test('scoreSummary rejects scores outside the rubric', () => {
  assert.throws(() => scoreSummary({ fluency: 5, flexibility: 0, originality: 0, elaboration: 0 }), /0–4/);
  assert.throws(() => scoreSummary({ fluency: 1.5, flexibility: 0, originality: 0, elaboration: 0 }), /bilangan bulat/);
  assert.throws(() => scoreSummary({ fluency: null, flexibility: 0, originality: 0, elaboration: 0 }), /bilangan bulat/);
  assert.throws(() => scoreSummary({ fluency: '4', flexibility: 0, originality: 0, elaboration: 0 }), /bilangan bulat/);
});
