/* Small formatting helpers and the one-character DOM getter. */

export const $ = id => document.getElementById(id);

export const rgb = c => "rgb(" + Math.floor(c[0]*255) + "," + Math.floor(c[1]*255) + "," + Math.floor(c[2]*255) + ")";
export const hex = c => "#" + [0,1,2].map(k => Math.floor(c[k]*255).toString(16).padStart(2,"0")).join("");
export const nm  = v => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1)).replace("-0.0","0.0");
export const lum = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
export const esc = s => String(s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
