import { claimFocusReturn } from "./focus-return.ts";

/** Conditionally mounted dialogs close when removed from the DOM.
 * Do not call close during effect cleanup: Strict Mode replays effects and
 * the queued native close event would otherwise dismiss the newly opened form.
 */
export function connectFinanceDialog(node: HTMLDialogElement, onClose: () => void) {
  const opener = typeof document === "undefined" ? null : document.activeElement as HTMLElement | null;
  const returnTo = claimFocusReturn();
  const handleClose = () => {
    if (node.open) return;
    // The opener (an inspector button) may be gone by now; hand focus back to the row that opened the inspector instead of <body>.
    if (returnTo && !opener?.isConnected) {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => returnTo.focus());
      else returnTo.focus();
    }
    onClose();
  };
  node.addEventListener("close", handleClose);
  if (!node.open) node.showModal();
  return () => node.removeEventListener("close", handleClose);
}
