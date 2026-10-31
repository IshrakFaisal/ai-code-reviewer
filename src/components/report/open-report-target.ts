/** Call after revealing any filtered finding so native fragment navigation can find it. */
export function openReportTarget(href: string) {
  if (!href.startsWith("#")) return;
  let id: string;
  try {
    id = decodeURIComponent(href.slice(1));
  } catch {
    return;
  }
  const target = document.getElementById(id);
  if (!target) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.querySelectorAll("details").forEach((details) => {
    details.open = true;
  });
  // Move keyboard focus along with the link without adding a tab stop.
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
