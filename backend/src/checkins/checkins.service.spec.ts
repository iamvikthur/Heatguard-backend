import { intakeFromTaps, RED_FLAGS, SYMPTOMS } from './checkins.service.js';

describe('intakeFromTaps', () => {
  it('reports the tapped symptoms in the fixed order', () => {
    const result = intakeFromTaps(['weakness', 'dizziness']);
    expect(result.reported).toEqual(['dizziness', 'weakness']);
    expect(result.redFlag).toBe(false);
    expect(Object.keys(result.symptoms)).toEqual(SYMPTOMS);
  });

  it('treats a tapped red flag as an emergency', () => {
    const result = intakeFromTaps(['headache', 'fainting']);
    expect(result.redFlag).toBe(true);
    expect(result.redFlags).toEqual(['fainting']);
  });

  it('accepts an empty check-in', () => {
    expect(intakeFromTaps([]).reported).toEqual([]);
  });

  it('rejects names that are not on the symptom list', () => {
    expect(() => intakeFromTaps(['sore foot'])).toThrow('Unknown symptom');
  });

  it('keeps every red flag on the symptom list', () => {
    expect(RED_FLAGS.every((name) => SYMPTOMS.includes(name))).toBe(true);
  });
});
