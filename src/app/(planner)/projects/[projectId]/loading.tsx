import { LoaderCircle } from "lucide-react";

/**
 * A plan's id is not known until somebody asks for it, so its pages are rendered
 * on request rather than at build time. This is what lets the click land at once
 * and be prefetched, instead of the page appearing to hang on the way there.
 */
export default function Loading() {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-faint">
      <LoaderCircle size={15} className="animate-spin" />
      Opening…
    </div>
  );
}
