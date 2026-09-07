import type { PullListJobPrintTarget } from "./pull-list-job";
import type { ClientPrintStatusResult } from "./pull-list-job-client";

export type PrintStatusWorkspace = { jobId: string; generation: number };

type PrintStatusSynchronizerOptions = {
  currentWorkspace: () => PrintStatusWorkspace;
  updateLocalStatus: (target: PullListJobPrintTarget, printedAt: string) => void;
  onWarning: (target: PullListJobPrintTarget, warning: string) => void;
  persistStatus: (id: string, target: PullListJobPrintTarget, printedAt: string) => Promise<ClientPrintStatusResult>;
};

/** Keeps print responses scoped to their workspace and latest action for each target. */
export class PullListPrintStatusSynchronizer {
  private revision = 0;
  private latestRequests: Partial<Record<PullListJobPrintTarget, number>> = {};

  constructor(private readonly options: PrintStatusSynchronizerOptions) {}

  async record(workspace: PrintStatusWorkspace, target: PullListJobPrintTarget, printedAt: string): Promise<void> {
    const isCurrentWorkspace = () => {
      const current = this.options.currentWorkspace();
      return current.jobId === workspace.jobId && current.generation === workspace.generation;
    };
    if (isCurrentWorkspace()) this.options.updateLocalStatus(target, printedAt);
    if (!workspace.jobId) return;

    const revision = ++this.revision;
    if (isCurrentWorkspace()) this.latestRequests[target] = revision;
    const canShowResult = () => isCurrentWorkspace() && this.latestRequests[target] === revision;
    if (canShowResult()) this.options.onWarning(target, "");
    const label = target === "pull-list" ? "Pull List" : "Pricing";
    try {
      const { teamsSync } = await this.options.persistStatus(workspace.jobId, target, printedAt);
      if (!canShowResult()) return;
      const synced = teamsSync.status === "updated"
        || (teamsSync.status === "skipped" && teamsSync.reason === "not-email-job");
      this.options.onWarning(target, synced ? ""
        : `${label} Printed was saved, but the original Teams card could not be updated.`);
    } catch {
      if (canShowResult()) {
        this.options.onWarning(target, `${label} print status could not be saved. Your local work is still here.`);
      }
    }
  }
}
