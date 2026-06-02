'use client';

// Keep the user's scroll position across page refreshes (and back/forward).
//
// Why this isn't trivial: the dashboard's cards render as short
// `animate-pulse` placeholders at first paint, then expand as their data
// lands a moment later. By the time the page is tall enough to hold the
// previous scrollY, the browser has already given up on auto-restore.
//
// Strategy:
//   1. Disable the browser's auto-restore so it doesn't fight us.
//   2. Read the saved scrollY for this pathname from sessionStorage.
//   3. Re-attempt the scroll every time the document grows (ResizeObserver)
//      until we've reached the target OR the user manually scrolls OR
//      ~5 s elapses. Save-handlers pause during this window so partial
//      restores don't overwrite the target with a smaller value.
//   4. Once restoration finishes (or user takes over), save scrollY on
//      every scroll, debounced — but skip events that look like our own
//      programmatic scrolls.
//   5. Always flush on beforeunload so a refresh captures the latest
//      position even if the debounce timer hasn't fired yet.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = (path: string) => `mango-scroll:${path}`;
const RESTORE_WINDOW_MS = 5000;
const SAVE_DEBOUNCE_MS = 200;
// Tolerance for "did we land where we wanted" + "is this scroll ours" — in px.
const SCROLL_EPSILON = 4;

export default function ScrollRestorer() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = STORAGE_KEY(pathname || '/');

    // Hand off restoration from the browser to us. Letting both run races.
    if ('scrollRestoration' in window.history) {
      try { window.history.scrollRestoration = 'manual'; } catch {}
    }

    // If the URL points at an in-page anchor, let that win.
    if (window.location.hash) return;

    const target = parseInt(sessionStorage.getItem(storageKey) || '0', 10);

    // Mutable state shared by the restore loop, save handler, and cleanup.
    const state = {
      restoring: target > 0,
      userScrolled: false,
      lastProgrammaticY: -1,
    };

    function attemptRestore() {
      if (!state.restoring || state.userScrolled) return;
      const docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      const maxScroll = Math.max(0, docHeight - window.innerHeight);
      const newTarget = Math.min(target, maxScroll);
      // If the current scroll is already very close to the target, we're
      // done. Otherwise jump there now.
      if (Math.abs(window.scrollY - newTarget) > SCROLL_EPSILON && newTarget > 0) {
        state.lastProgrammaticY = newTarget;
        window.scrollTo({ top: newTarget, behavior: 'instant' as ScrollBehavior });
      }
      // If we landed on the target, we can stop trying. The ResizeObserver
      // will still re-trigger restore if the page grows further AND the
      // user hasn't scrolled — but if maxScroll already >= target and
      // we're there, the restore loop is functionally done.
      if (window.scrollY >= target - SCROLL_EPSILON) {
        // Don't disable restoring yet — give a small grace period in case
        // more content is still about to load below us. The stopTimer
        // handles the final shutdown.
      }
    }

    // Re-attempt every time the document height changes — that's the real
    // signal that triggers restore success, not a wall-clock timer.
    const ro = new ResizeObserver(() => attemptRestore());
    ro.observe(document.documentElement);
    ro.observe(document.body);
    // Initial pass.
    requestAnimationFrame(attemptRestore);

    // Hard shutoff after RESTORE_WINDOW_MS — at some point we have to let
    // the save handler take over even if the page hasn't reached the
    // target (page might just be shorter than it was before, e.g. data
    // changed). Without this, scroll saves never resume.
    const stopTimer = window.setTimeout(() => {
      state.restoring = false;
      ro.disconnect();
    }, RESTORE_WINDOW_MS);

    // ---- scroll listeners ----

    // Classify each scroll event: is this our restore, or is it the user?
    // If the new scrollY is within SCROLL_EPSILON of our last programmatic
    // jump, treat it as ours and ignore. Anything else marks the user as
    // having taken over, which also halts restoration immediately.
    let saveTimer: number | null = null;
    const onScroll = () => {
      const looksProgrammatic =
        state.lastProgrammaticY >= 0 &&
        Math.abs(window.scrollY - state.lastProgrammaticY) <= SCROLL_EPSILON;
      if (!looksProgrammatic) {
        state.userScrolled = true;
        state.restoring = false;
      }
      // Don't persist anything while we're still trying to restore — partial
      // restore positions would overwrite the real target.
      if (state.restoring) return;
      if (saveTimer != null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try { sessionStorage.setItem(storageKey, String(window.scrollY)); } catch {}
      }, SAVE_DEBOUNCE_MS);
    };

    // Flush on unload so a refresh captures the latest position even if
    // the debounce timer hasn't fired yet.
    const onBeforeUnload = () => {
      if (state.restoring) return;
      try { sessionStorage.setItem(storageKey, String(window.scrollY)); } catch {}
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      ro.disconnect();
      window.clearTimeout(stopTimer);
      if (saveTimer != null) window.clearTimeout(saveTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [pathname]);

  return null;
}
