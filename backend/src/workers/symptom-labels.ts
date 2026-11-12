import { SYMPTOMS } from '../checkins/checkins.service.js';

/**
 * What a worker taps instead of typing. English is the source text; the Arabic
 * and Hindi labels were machine-drafted and MUST be reviewed by native
 * speakers before a pilot. Other languages fall back to English.
 */
const LABELS: Record<'en' | 'ar' | 'hi', Record<string, string>> = {
  en: {
    dizziness: 'Dizzy',
    headache: 'Headache',
    nausea: 'Feel sick',
    cramps: 'Cramps',
    heavy_sweating: 'Sweating a lot',
    stopped_sweating: 'Stopped sweating',
    confusion: 'Confused',
    fainting: 'Fainted',
    vomiting: 'Vomited',
    very_thirsty: 'Very thirsty',
    weakness: 'Weak',
  },
  ar: {
    dizziness: 'دوخة',
    headache: 'صداع',
    nausea: 'غثيان',
    cramps: 'تشنجات',
    heavy_sweating: 'تعرق شديد',
    stopped_sweating: 'توقف العرق',
    confusion: 'تشوش',
    fainting: 'إغماء',
    vomiting: 'تقيؤ',
    very_thirsty: 'عطش شديد',
    weakness: 'ضعف',
  },
  hi: {
    dizziness: 'चक्कर',
    headache: 'सिर दर्द',
    nausea: 'जी मिचलाना',
    cramps: 'ऐंठन',
    heavy_sweating: 'बहुत पसीना',
    stopped_sweating: 'पसीना बंद',
    confusion: 'उलझन',
    fainting: 'बेहोशी',
    vomiting: 'उल्टी',
    very_thirsty: 'बहुत प्यास',
    weakness: 'कमजोरी',
  },
};

export function symptomOptions(language: string): { name: string; label: string }[] {
  const texts = LABELS[language === 'ar' || language === 'hi' ? language : 'en'];
  return SYMPTOMS.map((name) => ({ name, label: texts[name] }));
}

/** The script direction a worker's page should use. */
export function textDirection(language: string): 'ltr' | 'rtl' {
  return language === 'ar' || language === 'ur' ? 'rtl' : 'ltr';
}
