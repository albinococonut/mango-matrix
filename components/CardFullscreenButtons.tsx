'use client';

// Adds a "present on TV" full-screen toggle to dashboard sections without
// touching each section component. Mounted once by ExecShell. A MutationObserver
// catches sections that render asynchronously (most cards fetch their own data).
//
// SCOPE: only the Employee View (/employee) gets these buttons. The analytical
// exec pages (Diagnostic, Weekly Review, To Do) intentionally don't — per-card
// fullscreen is a "present this on the TV" affordance, which only makes sense
// for the employee-facing cards. On any other route the effect is a no-op.
//
// Lightweight: no deps, native Fullscreen API, idempotent (one button per
// section, guarded by a data attribute).

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function CardFullscreenButtons() {
  const pathname = usePathname();
  useEffect(() => {
    // Employee View only. Bail (and skip wiring observers) anywhere else.
    if (!pathname?.startsWith('/employee')) return;
    const SELECTOR = '.card, [data-fs-section]';

    function decorate(el: HTMLElement) {
      if (el.dataset.fsDecorated) return;
      // A plain .card nested inside a [data-fs-section] (e.g. the KPI boxes
      // inside the Primary/Secondary matrix) should NOT get its own button —
      // the whole section is one expandable unit.
      if (!el.hasAttribute('data-fs-section') && el.parentElement?.closest('[data-fs-section]')) {
        el.dataset.fsDecorated = '1';
        return;
      }
      el.dataset.fsDecorated = '1';
      const cs = getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';

      // Sections that clip (the hero uses overflow:hidden) must keep the button
      // INSIDE; their top-right is empty so it covers nothing. Plain cards don't
      // clip, so float the button as a corner badge OUTSIDE the content box —
      // it never overlaps a title or header control and has room to breathe.
      const clips = cs.overflow === 'hidden' || el.hasAttribute('data-fs-section');
      const pos = clips
        ? { top: '12px', right: '12px' }
        : { top: '-14px', right: '-14px' };

      const btn = document.createElement('button');
      btn.className = 'gm-fs-btn';
      btn.type = 'button';
      btn.title = 'Show full screen';
      btn.setAttribute('aria-label', 'Show this section full screen');
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
      Object.assign(btn.style, {
        position: 'absolute', top: pos.top, right: pos.right, zIndex: '30',
        width: '30px', height: '30px', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        borderRadius: '9999px', border: '1px solid rgba(15,20,25,0.12)',
        background: '#ffffff', color: '#6B7280',
        cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,20,25,0.12)',
      } as CSSStyleDeclaration);
      btn.onmouseenter = () => { btn.style.color = '#ff7a00'; btn.style.borderColor = '#ff7a0055'; };
      btn.onmouseleave = () => { btn.style.color = '#6B7280'; btn.style.borderColor = 'rgba(15,20,25,0.12)'; };
      btn.onclick = (e) => {
        e.stopPropagation();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else el.requestFullscreen().catch(() => {});
      };
      el.appendChild(btn);
    }

    function scan() {
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach(decorate);
    }

    // One big red X in the corner of whatever is full-screen — one click out.
    let closeX: HTMLButtonElement | null = null;
    function onFsChange() {
      const fs = document.fullscreenElement as HTMLElement | null;
      if (closeX) { closeX.remove(); closeX = null; }
      if (!fs) return;
      closeX = document.createElement('button');
      closeX.type = 'button';
      closeX.setAttribute('aria-label', 'Exit full screen');
      closeX.title = 'Exit full screen (Esc)';
      closeX.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      Object.assign(closeX.style, {
        position: 'fixed', top: '18px', right: '22px', zIndex: '2147483647',
        width: '44px', height: '44px', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', borderRadius: '9999px',
        border: 'none', background: '#e0162b', color: '#fff', cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(224,22,43,0.5)',
      } as CSSStyleDeclaration);
      closeX.onmouseenter = () => { if (closeX) closeX.style.background = '#ff2740'; };
      closeX.onmouseleave = () => { if (closeX) closeX.style.background = '#e0162b'; };
      closeX.onclick = () => document.exitFullscreen().catch(() => {});
      fs.appendChild(closeX);
    }

    scan();
    const obs = new MutationObserver(() => scan());
    obs.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('fullscreenchange', onFsChange);
    return () => { obs.disconnect(); document.removeEventListener('fullscreenchange', onFsChange); if (closeX) closeX.remove(); };
  }, [pathname]);

  return null;
}
