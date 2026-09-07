export type PullListTeamsCardInput = {
  jobId?: string;
  emailDisplay?: { sender?: string; subject?: string; receivedAt?: string; body?: string };
  formatterUrl?: string;
  checkEmailNowUrl?: string;
  statusUrls?: Partial<Record<"pull-list" | "pricing", string>>;
  printStatus?: { pullListPrintedAt?: string; pricingPrintedAt?: string };
};
export function storeTimestamp(value: string): string;
export function buildPullListTeamsCard(input?: PullListTeamsCardInput): Record<string, any>;
export function initialTeamsCardPayload(jobId: string, card: unknown): Record<string, any>;
