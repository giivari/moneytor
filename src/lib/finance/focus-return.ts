/**
 * Focus hand-over between the inspector and the dialogs launched from it. The inspector closes itself before the dialog opens, so the
 * element that held focus (an inspector button) is gone when the dialog closes; the browser would then drop focus on <body>.
 * The inspector leaves its row trigger here, and the dialog that opens right after claims it.
 */
const WINDOW_MS = 1500;
let pending: { element: HTMLElement; at: number } | null = null;

export function offerFocusReturn(element: HTMLElement | null) {
  pending = element ? { element, at: Date.now() } : null;
}

/** Takes the offered element when it is recent and still in the document. */
export function claimFocusReturn(): HTMLElement | null {
  const offer = pending;
  pending = null;
  return offer && Date.now() - offer.at <= WINDOW_MS && offer.element.isConnected ? offer.element : null;
}
