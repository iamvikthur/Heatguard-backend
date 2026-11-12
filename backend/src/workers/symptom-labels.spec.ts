import { SYMPTOMS } from '../checkins/checkins.service.js';
import { symptomOptions, textDirection } from './symptom-labels.js';

describe('symptomOptions', () => {
  it('covers every symptom in each language it claims to support', () => {
    for (const language of ['en', 'ar', 'hi']) {
      const options = symptomOptions(language);
      expect(options.map((o) => o.name)).toEqual(SYMPTOMS);
      expect(options.every((o) => o.label.length > 0)).toBe(true);
    }
  });

  it('falls back to English for a language without labels', () => {
    expect(symptomOptions('ml')).toEqual(symptomOptions('en'));
  });

  it('translates rather than echoing the field name', () => {
    const hindi = Object.fromEntries(symptomOptions('hi').map((o) => [o.name, o.label]));
    expect(hindi.dizziness).not.toBe('Dizzy');
  });
});

describe('textDirection', () => {
  it('is right to left for Arabic and Urdu only', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('ur')).toBe('rtl');
    expect(textDirection('hi')).toBe('ltr');
    expect(textDirection('en')).toBe('ltr');
  });
});
