"use client";

import { useEffect } from "react";
import { usePrefs } from "@/lib/store";

/**
 * Applies theme/accent/contrast tokens to <html> based on persisted prefs.
 * Pairs with the inline no-flash script in layout.tsx.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = usePrefs((s) => s.theme);
  const accent = usePrefs((s) => s.accent);
  const contrast = usePrefs((s) => s.contrast);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.contrast = contrast;
  }, [theme, accent, contrast]);

  return <>{children}</>;
}

/** Inline script string — runs before paint to avoid theme flash. */
export const themeNoFlashScript = `
(function(){try{
  var s = localStorage.getItem('live-tv-prefs');
  var t='dark', a='cyan', c='normal';
  if(s){var p=JSON.parse(s).state||{}; t=p.theme||t; a=p.accent||a; c=p.contrast||c;}
  var r=document.documentElement;
  r.dataset.theme=t; r.dataset.accent=a; r.dataset.contrast=c;
}catch(e){}})();
`;
