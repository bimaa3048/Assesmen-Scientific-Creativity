'use strict';

const INDICATORS = ['fluency', 'flexibility', 'originality', 'elaboration'];

function scoreSummary(scores) {
  const normalized = {};
  for (const indicator of INDICATORS) {
    const score = scores[indicator];
    if (!Number.isInteger(score) || score < 0 || score > 4) {
      throw new Error(`Skor ${indicator} harus berupa bilangan bulat 0–4.`);
    }
    normalized[indicator] = score;
  }

  const total = INDICATORS.reduce((sum, indicator) => sum + normalized[indicator], 0);
  const finalScore = Number(((total / 16) * 100).toFixed(2));
  let category;
  if (finalScore >= 81) category = 'Sangat Kreatif';
  else if (finalScore >= 61) category = 'Kreatif';
  else if (finalScore >= 41) category = 'Cukup Kreatif';
  else if (finalScore >= 21) category = 'Kurang Kreatif';
  else category = 'Sangat Kurang Kreatif';

  return { ...normalized, total, finalScore, category };
}

module.exports = { INDICATORS, scoreSummary };
