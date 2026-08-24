import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./Icons";

/**
 * A dialog wrapper over the native <dialog> element, which brings the backdrop,
 * focus trapping and Escape-to-close with it rather than reimplementing them.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape fires the dialog's own close event; keep React state in step with it.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handle = () => onClose();
    dialog.addEventListener("close", handle);
    return () => dialog.removeEventListener("close", handle);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " wide" : ""}`}
      aria-label={title}
      onClick={(e) => {
        // Clicking the backdrop lands on the dialog itself, not its contents.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h3>{title}</h3>
        <button className="btn-ghost" type="button" onClick={onClose}>
          <CloseIcon />
          Close
        </button>
      </div>
      <div className="modal-body">{open ? children : null}</div>
    </dialog>
  );
}
