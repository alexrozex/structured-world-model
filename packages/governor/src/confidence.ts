const DRIFT_PENALTY = -0.10;
const POSTCONDITION_FAIL_PENALTY = -0.15;
const CORRECTION_BONUS = 0.05;

export class ConfidenceTracker {
  private value = 1.0;
  private readonly threshold: number;

  constructor(threshold: number = 0.7) {
    this.threshold = threshold;
  }

  get current(): number {
    return this.value;
  }

  get isLow(): boolean {
    return this.value < this.threshold;
  }

  onDrift(): number {
    this.value = Math.max(0, this.value + DRIFT_PENALTY);
    return this.value;
  }

  onPostconditionFail(): number {
    this.value = Math.max(0, this.value + POSTCONDITION_FAIL_PENALTY);
    return this.value;
  }

  onCorrectionApplied(): number {
    this.value = Math.min(1, this.value + CORRECTION_BONUS);
    return this.value;
  }
}
