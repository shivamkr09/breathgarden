// phrases.js — everything the voice guide can say. Fixed text only: nothing
// personal, no readings. scripts/generate-voice.mjs turns these into audio clips
// with ElevenLabs ahead of time; at runtime the app only plays local files.
'use strict';

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];

const PHRASES = {
  // Framing check
  check_start: 'Let’s make sure I can see you. Sit back, and let your shoulders show.',
  fix_face: 'I can’t see you yet. Face the camera when you’re ready.',
  fix_faces: 'This garden is for one. Make sure only you are in the frame.',
  fix_closer: 'Come a little closer.',
  fix_back: 'Lean back a little.',
  fix_center: 'Drift a little toward the centre.',
  fix_chest: 'Let your shoulders and upper chest show.',
  fix_dark: 'It’s a little dark. A soft light in front of you would help.',
  fix_bright: 'It’s a little bright. Try turning away from the window.',
  fix_still: 'Settle in, and stay still. No rush.',
  ready: 'Lovely. I can see you. The garden is opening.',

  // Session
  start: 'Let’s breathe together. I’ll start at your own pace.',
  in: 'Breathe in.',
  out: 'And out.',
  with_me: 'That’s it. You’re right with me.',
  easing: 'Let’s slow down, just a little.',
  eased_back: 'I’ll ease back, to match you.',
  holding: 'No rush. I’ll wait for you here.',
  talking: 'I’ll wait while you talk.',
  resume: 'Whenever you’re ready, follow the ring again.',
  lost: 'I’ve lost sight of you for a moment.',
  first_flower: 'Your first flower just bloomed.',
  five_flowers: 'Five flowers.',
  ten_flowers: 'Ten flowers. Your garden is filling up.',
  halfway: 'Halfway there.',
  one_minute: 'One minute left.',
  end: 'That’s the end of your session. Let your breathing return to normal.',
  goodbye: 'Take this calm with you.',
};
for (let n = 0; n <= 20; n++) PHRASES[`summary_${n}`] = n === 1 ? 'One flower grew today.' : `${NUMBER_WORDS[n]} flowers grew today.`;
PHRASES.summary_many = 'More than twenty flowers grew today.';

module.exports = { PHRASES };
