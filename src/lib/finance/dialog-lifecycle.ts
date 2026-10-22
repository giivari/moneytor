/** Conditionally mounted dialogs close when removed from the DOM.
 * Do not call close during effect cleanup: Strict Mode replays effects and
 * the queued native close event would otherwise dismiss the newly opened form.
 */
export function connectFinanceDialog(node: HTMLDialogElement, onClose: () => void) {
  const handleClose = () => { if (!node.open) onClose(); };
  node.addEventListener("close", handleClose);
  if (!node.open) node.showModal();
  return () => node.removeEventListener("close", handleClose);
}
