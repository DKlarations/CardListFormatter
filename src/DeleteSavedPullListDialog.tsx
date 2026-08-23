import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { SavedJobSummary } from "./pull-list-job";
import { savedPullListDeleteDialogDetails } from "./saved-pull-list-picker";

type DeleteSavedPullListDialogProps = {
  job: SavedJobSummary;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute("hidden"));
}

export default function DeleteSavedPullListDialog({
  job,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteSavedPullListDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const details = savedPullListDeleteDialogDetails(job);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDeleting, onCancel]);

  return createPortal(
    <div
      className="saved-pull-list-delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="saved-pull-list-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>{details.title}</h2>
        <div className="saved-pull-list-delete-identity">
          <strong>{details.customerName}</strong>
          <span>{details.updatedAt}</span>
        </div>
        <p id={descriptionId}>{details.warning}</p>
        <div className="saved-pull-list-delete-actions">
          <button ref={cancelButtonRef} className="icon-button" type="button" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </button>
          <button className="icon-button danger" type="button" onClick={() => void onConfirm()} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
