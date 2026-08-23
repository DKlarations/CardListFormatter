export type FormatterPrimaryAction = {
  action: "process-list" | "cancel-processing";
  label: "Process List" | "Cancel";
  title: "Process list" | "Cancel processing";
  variant: "primary" | "danger";
};

export function formatterPrimaryAction(isProcessing: boolean): FormatterPrimaryAction {
  return isProcessing
    ? { action: "cancel-processing", label: "Cancel", title: "Cancel processing", variant: "danger" }
    : { action: "process-list", label: "Process List", title: "Process list", variant: "primary" };
}

type FormatterStatusMetricInput = {
  totalParsed: number;
  resolvedCount: number;
  printFallbacks: number;
};

export function formatterStatusMetrics({ totalParsed, resolvedCount, printFallbacks }: FormatterStatusMetricInput) {
  return [
    { key: "parsed", label: `${totalParsed} parsed`, interactive: false },
    { key: "resolved", label: `${resolvedCount} resolved`, interactive: false },
    ...(printFallbacks > 0 ? [{ key: "fallback", label: `${printFallbacks} fallback`, interactive: false }] : []),
  ];
}

export function shouldShowFormatterReprocess(needsReview: number, isProcessing: boolean) {
  return needsReview > 0 && !isProcessing;
}

export const FORMATTER_REPROCESS_ACTION = {
  ariaLabel: "Reprocess Needs Review",
  iconOnly: true,
  title: "Reprocess Needs Review",
} as const;
