import type { Level } from '../ai/ai.client.js';

/**
 * Worker messages. English is the source text. The Arabic and Hindi texts were
 * machine-drafted and MUST be reviewed by a native speaker before any pilot.
 * Other languages fall back to English.
 */
type Lang = 'en' | 'ar' | 'hi';

interface Texts {
  levels: Record<Level, string>;
  eased: string;
  yellow: string;
  workRest: (level: string, work: number, rest: number) => string;
  stop: string;
  emergency: string;
  checkinReceived: string;
}

const TEXTS: Record<Lang, Texts> = {
  en: {
    levels: { GREEN: 'GREEN', YELLOW: 'YELLOW', ORANGE: 'ORANGE', RED: 'RED' },
    eased: 'HeatGuard: Heat has eased. Normal work. Keep drinking water.',
    yellow: 'HeatGuard: Heat is rising. Drink water often and take your breaks in the rest area.',
    workRest: (level, work, rest) =>
      `HeatGuard ${level}: Each hour, work ${work} min, then rest ${rest} min in the rest area. Drink water. Tell your supervisor if you feel unwell.`,
    stop: 'HeatGuard RED: Stop work now and go to the rest area. Drink water. Tell your supervisor if you feel unwell.',
    emergency: 'HeatGuard EMERGENCY: Stop work now. Go to a cool place and sit down. Your supervisor is coming to you.',
    checkinReceived: 'HeatGuard: Thank you for telling us. Go to the rest area now, sit down and drink water. Your supervisor will check on you.',
  },
  ar: {
    levels: { GREEN: 'أخضر', YELLOW: 'أصفر', ORANGE: 'برتقالي', RED: 'أحمر' },
    eased: 'هيت غارد: انخفضت الحرارة. العمل طبيعي. استمر في شرب الماء.',
    yellow: 'هيت غارد: الحرارة ترتفع. اشرب الماء كثيراً وخذ استراحاتك في منطقة الاستراحة.',
    workRest: (level, work, rest) =>
      `هيت غارد (${level}): في كل ساعة، اعمل ${work} دقيقة ثم استرح ${rest} دقيقة في منطقة الاستراحة. اشرب الماء. أخبر مشرفك إذا شعرت بتعب.`,
    stop: 'هيت غارد (أحمر): توقف عن العمل الآن واذهب إلى منطقة الاستراحة. اشرب الماء. أخبر مشرفك إذا شعرت بتعب.',
    emergency: 'هيت غارد - طوارئ: توقف عن العمل الآن. اذهب إلى مكان بارد واجلس. مشرفك قادم إليك.',
    checkinReceived: 'هيت غارد: شكراً لإبلاغنا. اذهب إلى منطقة الاستراحة الآن، اجلس واشرب الماء. سيأتي مشرفك للاطمئنان عليك.',
  },
  hi: {
    levels: { GREEN: 'हरा', YELLOW: 'पीला', ORANGE: 'नारंगी', RED: 'लाल' },
    eased: 'HeatGuard: गर्मी कम हुई है। सामान्य काम करें। पानी पीते रहें।',
    yellow: 'HeatGuard: गर्मी बढ़ रही है। बार-बार पानी पिएं और आराम क्षेत्र में ब्रेक लें।',
    workRest: (level, work, rest) =>
      `HeatGuard (${level}): हर घंटे ${work} मिनट काम करें, फिर ${rest} मिनट आराम क्षेत्र में आराम करें। पानी पिएं। तबीयत ठीक न लगे तो सुपरवाइज़र को बताएं।`,
    stop: 'HeatGuard (लाल): अभी काम रोकें और आराम क्षेत्र में जाएं। पानी पिएं। तबीयत ठीक न लगे तो सुपरवाइज़र को बताएं।',
    emergency: 'HeatGuard आपातकाल: अभी काम रोकें। ठंडी जगह पर जाकर बैठ जाएं। आपका सुपरवाइज़र आपके पास आ रहा है।',
    checkinReceived: 'HeatGuard: बताने के लिए धन्यवाद। अभी आराम क्षेत्र में जाएं, बैठें और पानी पिएं। आपका सुपरवाइज़र आपको देखने आएगा।',
  },
};

/** The language a message is actually written in for a worker's preferred language. */
export function messageLanguage(preferred: string): Lang {
  return preferred === 'ar' || preferred === 'hi' ? preferred : 'en';
}

export function workerMessage(preferred: string, level: Level, workMin: number, restMin: number): string {
  const t = TEXTS[messageLanguage(preferred)];
  if (level === 'GREEN') return t.eased;
  if (level === 'YELLOW') return t.yellow;
  if (workMin === 0) return t.stop;
  return t.workRest(t.levels[level], workMin, restMin);
}

export function workerEmergencyMessage(preferred: string): string {
  return TEXTS[messageLanguage(preferred)].emergency;
}

export function supervisorCrewMessage(
  crewName: string,
  level: Level,
  workMin: number,
  restMin: number,
  stricterWorkers: number,
  reason: string,
): string {
  const schedule = workMin === 0 ? 'Stop work; crew to the rest area.' : `Work ${workMin} / rest ${restMin} min per hour.`;
  const lead = reason === 'EASED' ? 'eased to' : reason === 'REMINDER' ? 'still' : reason === 'SCHEDULE' ? 'new schedule, still' : 'now';
  const stricter =
    stricterWorkers > 0 ? ` ${stricterWorkers} worker${stricterWorkers === 1 ? '' : 's'} on a stricter schedule.` : '';
  return `${crewName}: ${lead} ${level}. ${schedule}${stricter}`;
}

/** UAE ambulance number. */
export const EMERGENCY_NUMBER = '998';

export function supervisorEmergencyMessage(pseudonym: string, crewName: string, symptoms: string[]): string {
  const list = symptoms.length > 0 ? symptoms.join(', ') : 'red-flag symptoms';
  return `EMERGENCY: ${pseudonym} (${crewName}) reports ${list}. Go to them now, move them to a cool place, cool them with water, and call ${EMERGENCY_NUMBER}. Do not leave them alone.`;
}

export function workerCheckinMessage(preferred: string): string {
  return TEXTS[messageLanguage(preferred)].checkinReceived;
}

/** Supervisors are told to check on the worker, not which symptoms were reported. */
export function supervisorCheckMessage(pseudonym: string, crewName: string, urgent: boolean, schedule?: { workMin: number; restMin: number }): string {
  if (urgent) {
    return `URGENT CHECK: ${pseudonym} (${crewName}) may have a serious symptom. Go and check on them now.`;
  }
  const change = schedule ? ` They are now on work ${schedule.workMin} / rest ${schedule.restMin} min per hour.` : '';
  return `${pseudonym} (${crewName}) reported feeling unwell.${change} Check on them.`;
}
