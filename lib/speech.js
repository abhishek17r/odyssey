// Speech to text with the phone's own recogniser (Web Speech API), where the browser has one. Safari and Chrome
// send the audio to Apple's / Google's speech service and hand back text; Odyssey only ever sees the text.
// Where there's no recogniser (or it fails), the mic simply isn't shown: the keyboard's own dictation still works.

import { el, toast } from './controls.js';

const Rec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canListen = () => !!Rec;

// A mic button that fills text as you speak. onText(text, final). → element | null
export function micButton(onText) {
  if (!Rec) return null;
  const b = el('button', { type: 'button', className: 'micBtn', ariaLabel: 'Speak', title: 'Speak' });
  b.innerHTML = '<svg width="16" height="20" viewBox="0 0 16 22" aria-hidden="true"><rect x="4" y="1" width="8" height="13" rx="4"/><path d="M1 10a7 7 0 0 0 14 0M8 17v4" fill="none" stroke-width="2" stroke-linecap="round"/></svg>';
  let rec = null;
  const stop = () => { try { rec?.stop(); } catch { /* fine */ } };
  b.onclick = () => {
    if (rec) { stop(); return; }
    try {
      rec = new Rec();
      rec.lang = navigator.language || 'en-IN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        const text = [...e.results].map((r) => r[0].transcript).join(' ').trim();
        onText(text, e.results[e.results.length - 1].isFinal);
      };
      rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast('The mic didn’t work here. Try the keyboard’s mic.', 'err'); };
      rec.onend = () => { rec = null; b.classList.remove('on'); };
      rec.start();
      b.classList.add('on');
    } catch { rec = null; b.classList.remove('on'); toast('The mic didn’t work here. Try the keyboard’s mic.', 'err'); }
  };
  return b;
}
