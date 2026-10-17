import type { DetectorDevice } from './protocol';

/** Logistic fit of P(AI | score) for one language and model build, from scripts/detector-calibrate.mjs. */
export interface LangCalibration {
  /** P(AI) = 1 / (1 + exp(slope * (score - midpoint))). */
  slope: number;
  midpoint: number;
  /** Area under the ROC curve on the held-out half. */
  auc: number;
  /** Scores below this are called "likely AI": chosen so few fit-half human texts fall under it. */
  aiBelow: number;
  /** Scores above this are called "likely human": chosen so few fit-half AI texts rise over it. */
  humanAbove: number;
  /** Share of held-out human texts called "likely AI". */
  falsePositiveRate: number;
  /** Share of held-out human texts called "likely human". */
  humanCleared?: number;
  /** Share of held-out AI texts called "likely AI". */
  truePositiveRate: number;
  humanTexts: number;
  aiTexts: number;
}

export interface Calibration {
  created: string;
  /** Spread of a document's score from token-level noise: sd ≈ noise / sqrt(tokens). */
  noise: number;
  builds: Partial<Record<DetectorDevice, Record<string, LangCalibration>>>;
}

export type Verdict = 'likely-human' | 'unclear' | 'likely-ai';
export type Confidence = 'high' | 'medium' | 'low';

export interface Presentation {
  verdict: Verdict;
  /** AI-likelihood range in whole percent. */
  low: number;
  high: number;
  confidence: Confidence;
  /** Plain-language reasons the confidence isn't high. */
  caveats: string[];
  /** Sentence IDs that read most machine-like, at most three. */
  drivers: string[];
}

/** Above this held-out false-positive rate, a language never gets a "likely AI" verdict. */
const MAX_FALSE_POSITIVES = 0.05;
const MIN_TOKENS = 80;
const SHORT_TOKENS = 200;

const prob = (c: LangCalibration, score: number) => 1 / (1 + Math.exp(c.slope * (score - c.midpoint)));

/** Falls back to English parameters for uncalibrated languages, and says so. */
export function present(
  input: { score: number; tokens: number; lang: string; device: DetectorDevice; sentences: Array<{ id: string; score: number | undefined }> },
  calibration: Calibration,
  langName: string,
): Presentation | null {
  const build = calibration.builds[input.device] ?? calibration.builds.wasm;
  if (!build) return null;
  const own = build[input.lang];
  const cal = own ?? build.eng;
  if (!cal) return null;

  const sd = calibration.noise / Math.sqrt(Math.max(1, input.tokens));
  const a = prob(cal, input.score + 1.5 * sd);
  const b = prob(cal, input.score - 1.5 * sd);
  let low = Math.round(Math.min(a, b) * 100);
  let high = Math.max(low + 1, Math.round(Math.max(a, b) * 100));

  const caveats: string[] = [];
  let confidence: Confidence = 'high';
  const lower = (to: Confidence) => {
    if (to === 'low' || (to === 'medium' && confidence === 'high')) confidence = to;
  };
  if (!own) {
    lower('low');
    caveats.push(`The checker hasn't been tested on ${langName} yet.`);
  } else if (cal.auc < 0.85) {
    lower('low');
    caveats.push(`It is unreliable on ${langName} in our tests.`);
  } else if (cal.auc < 0.95) {
    lower('medium');
  }
  if (input.tokens < MIN_TOKENS) {
    lower('low');
    caveats.push('The text is too short to judge well.');
  } else if (input.tokens < SHORT_TOKENS) {
    lower('medium');
    caveats.push('Longer texts give steadier results.');
  }

  // The verdict uses the false-positive-controlled cutoffs, not the curve, and
  // short texts must clear them by their own noise margin.
  const margin = 1.5 * sd;
  const canAccuse = !!own && cal.falsePositiveRate <= MAX_FALSE_POSITIVES;
  if (own && !canAccuse) caveats.push(`In our tests it wrongly flagged too much human writing in ${langName} to call anything AI.`);
  const verdict: Verdict =
    canAccuse && input.score + margin < cal.aiBelow
      ? 'likely-ai'
      : input.score - margin > cal.humanAbove
        ? 'likely-human'
        : 'unclear';
  // Keep the range from contradicting the verdict near a cutoff.
  if (verdict === 'likely-ai') {
    low = Math.max(low, 50);
    high = Math.max(high, low + 1);
  } else if (verdict === 'likely-human') {
    high = Math.min(high, 50);
    low = Math.min(low, high - 1);
  }

  const drivers = input.sentences
    .filter((s): s is { id: string; score: number } => s.score !== undefined)
    .sort((x, y) => x.score - y.score)
    .slice(0, 3)
    .map((s) => s.id);

  return { verdict, low, high, confidence, caveats, drivers };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  'likely-human': 'Likely human-written',
  unclear: 'Unclear',
  'likely-ai': 'Likely AI-generated',
};

export const CAVEAT =
  'Detectors, this one included, sometimes flag real human writing, especially from non-native speakers and formulaic genres. Treat this as a signal, never as proof.';
