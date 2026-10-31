"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  createDraftStorage,
  leavesReviewPage,
} from "@/lib/reports/draft-navigation";

export type DraftGuard = {
  dirtyCount: number;
  busy: boolean;
  storageWarning: string;
  save: () => Promise<boolean>;
  discard: () => void;
};
type Navigation = { href: string; replace?: boolean; scroll?: boolean };
type Context = {
  storage: ReturnType<typeof createDraftStorage>;
  register: (guard: DraftGuard) => () => void;
  block: (navigation: Navigation) => boolean;
};
const DraftNavigationContext = createContext<Context | null>(null);
export function useDraftNavigation() {
  const value = useContext(DraftNavigationContext);
  if (!value) throw new Error("Draft navigation provider is missing.");
  return value;
}

export function DraftNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const guard = useRef<DraftGuard | null>(null);
  const [pending, setPending] = useState<
    (Navigation & { fromPathname: string }) | null
  >(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({ busy: false, storageWarning: "" });
  const dialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const [context] = useState<Context>(() => ({
    storage: createDraftStorage(() => window.sessionStorage),
    register(value) {
      guard.current = value;
      setSummary((previous) =>
        previous.busy === value.busy &&
        previous.storageWarning === value.storageWarning
          ? previous
          : { busy: value.busy, storageWarning: value.storageWarning },
      );
      return () => {
        if (guard.current === value) guard.current = null;
      };
    },
    block(navigation) {
      if (
        !guard.current?.dirtyCount ||
        !leavesReviewPage(navigation.href, window.location.href)
      )
        return false;
      setError("");
      setPending({ ...navigation, fromPathname: window.location.pathname });
      return true;
    },
  }));
  // Back/Forward can change the report while its leave dialog is open.
  if (pending && pending.fromPathname !== pathname) {
    setPending(null);
  }
  useEffect(() => {
    if (pending) {
      if (!dialog.current?.open) dialog.current?.showModal();
      if (!saving) stayButton.current?.focus();
    } else dialog.current?.close();
  }, [pending, saving]);
  useEffect(() => {
    // Protect fallback drafts even after Back/Forward has left their report.
    const warn = (event: BeforeUnloadEvent) => {
      if (!context.storage.hasVolatileDrafts()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [context]);

  function leave(destination: Navigation) {
    setPending(null);
    const options = { scroll: destination.scroll };
    if (destination.replace) router.replace(destination.href, options);
    else router.push(destination.href, options);
  }
  async function saveAndLeave() {
    if (!pending || !guard.current || savingRef.current) return;
    const current = guard.current,
      destination = pending;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (await current.save()) leave(destination);
      else
        setError(
          "Saving was not completed. Stay on this report to review the save error or conflict. Your remaining drafts are kept.",
        );
    } catch {
      setError(
        "Saving failed. Your drafts are kept. Stay on this report and retry.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <DraftNavigationContext.Provider value={context}>
      {children}
      <dialog
        ref={dialog}
        className="draft-navigation-dialog"
        aria-labelledby="draft-navigation-title"
        aria-describedby="draft-navigation-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!savingRef.current) setPending(null);
        }}
      >
        <h2 id="draft-navigation-title">Save your review before leaving?</h2>
        <p id="draft-navigation-description">
          You have unsaved review drafts. Save them, stay to keep editing, or
          discard the remaining drafts and leave.
        </p>
        {summary.storageWarning && (
          <p className="form-error">
            Browser draft recovery is unavailable. Save before refreshing or
            closing this tab.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="draft-navigation-actions">
          <Button
            ref={stayButton}
            variant="outline"
            disabled={saving}
            onClick={() => setPending(null)}
          >
            Stay
          </Button>
          <Button
            variant="ghost"
            disabled={saving || summary.busy}
            onClick={() => {
              if (!pending || savingRef.current || guard.current?.busy) return;
              guard.current?.discard();
              leave(pending);
            }}
          >
            Discard and leave
          </Button>
          <Button disabled={saving || summary.busy} onClick={saveAndLeave}>
            {saving ? "Saving…" : "Save and leave"}
          </Button>
        </div>
      </dialog>
    </DraftNavigationContext.Provider>
  );
}

/** Next's onNavigate preserves modified clicks, downloads and new-tab behavior. */
export function DraftProtectedLink({
  href,
  onNavigate,
  replace,
  scroll,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { block } = useDraftNavigation();
  return (
    <Link
      {...props}
      href={href}
      replace={replace}
      scroll={scroll}
      onNavigate={(event) => {
        let cancelled = false;
        onNavigate?.({
          preventDefault() {
            cancelled = true;
            event.preventDefault();
          },
        });
        if (!cancelled && block({ href, replace, scroll }))
          event.preventDefault();
      }}
    />
  );
}
