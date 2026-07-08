/*
  Verve Advisory wordmark — used as the letterhead on printable documents
  (invoices, statements). It's a crisp, scalable recreation drawn with the app
  font (no image file needed), sized by the container's font-size via `em`.

  Scale it by setting a text size on the element, e.g.:
    <VerveLogo className="text-[26px]" />   → "verve" ≈ 62px tall

  If the team later drops the official SVG/PNG into /public, swap the two
  <span> lines for an <img> — every usage updates at once.
*/
export function VerveLogo({
  className = "",
  subtitle = true,
}: {
  className?: string;
  subtitle?: boolean;
}) {
  return (
    <span className={`inline-block leading-none ${className}`} aria-label="Verve Advisory">
      <span
        className="block font-black tracking-[-0.045em] text-[#2b4c9c]"
        style={{ fontSize: "2.4em" }}
      >
        verve
      </span>
      {subtitle && (
        <span
          className="block text-right font-bold tracking-[0.03em] text-slate-800 dark:text-slate-200"
          style={{ fontSize: "0.95em", marginTop: "-0.12em" }}
        >
          Advisory
        </span>
      )}
    </span>
  );
}
