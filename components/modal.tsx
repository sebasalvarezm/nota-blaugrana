"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ labelId, onClose, children, className = "" }: { labelId: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`nb-dialog ${className}`} aria-labelledby={labelId}
    onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-content">{children}</div>
  </dialog>;
}
