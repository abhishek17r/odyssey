// Add a habit: start from a playbook (Gym, Focus, Smoking, Scrolling, Diet) or your own habit, which gets the
// default playbook of its type (Build up, Cut down, Keep a rule). A few one-tap questions set it up; then its
// playbook page opens.

import { HABIT_PLAYBOOKS, TYPES, guessType, makeHabit, playbookIdOf } from './playbooks.js';
import { addHabit, load } from './storage.js';
import { el, openDrawer, toast } from './controls.js';
import { weekKeyOf, planOf } from './score.js';
import { athena } from './figures.js';

// setup questions per playbook: [key, question, kind, options | default, default]
const Q = {
  gym: [['target', 'How many sessions a week?', 'chips', [[2, '2'], [3, '3'], [4, '4'], [5, '5']], 3],
    ['tiny', 'What’s the smallest session that still counts?', 'chips', [['20 minutes counts', '20 minutes'], ['30 minutes counts', '30 minutes'], ['Just show up', 'Just show up']], '20 minutes counts']],
  focus: [['target', 'Deep-work hours a day?', 'chips', [[1, '1 h'], [2, '2 h'], [3, '3 h'], [4, '4 h']], 2],
    ['block', 'When do you focus best?', 'chips', [['Early morning', 'Early morning'], ['9–11 am', '9–11 am'], ['Afternoon', 'Afternoon'], ['Evening', 'Evening']], '9–11 am']],
  smoking: [['usual', 'On a usual day now, how many?', 'number', 10],
    ['pace', 'How fast to step down?', 'chips', [[1, '1 less every week'], [2, 'Every 2 weeks'], [0, 'Hold here for now']], 1],
    ['price', 'Price of one (₹)', 'number', 18]],
  scrolling: [['usual', 'A usual day now?', 'chips', [[60, 'About 1 h'], [120, 'About 2 h'], [180, '3 h or more']], 120],
    ['target', 'Daily limit to start with', 'chips', [[30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30']], 60]],
  diet: [['rule', 'Pick your first rule', 'chips', HABIT_PLAYBOOKS.diet.ladder.map((r) => [r, r]), 'Water before every meal', true],
    ['target', 'Days a week to keep it', 'chips', [[5, '5'], [6, '6'], [7, 'Every day']], 5]],
  build: [['target', 'How often?', 'chips', [[3, '3 a week'], [4, '4 a week'], [5, '5 a week'], [7, 'Every day']], 4],
    ['tiny', 'What’s the smallest version that counts?', 'chips', [['Two minutes counts', 'Two minutes'], ['Just start counts', 'Just start']], 'Two minutes counts', true],
    ['when', 'When will you do it?', 'chips', [['Morning', 'Morning'], ['After lunch', 'After lunch'], ['Evening', 'Evening'], ['Before bed', 'Before bed']], null]],
  cut: [['unit', 'Count it in', 'chips', [['times', 'Times a day'], ['min', 'Minutes a day']], 'times'],
    ['usual', 'On a usual day now?', 'number', 5],
    ['target', 'Limit to start with', 'number', 4]],
  rule: [['target', 'Days a week to keep it', 'chips', [[5, '5'], [6, '6'], [7, 'Every day']], 6]],
};
const WHY = { gym: 'Strong enough to …', focus: 'Ship the …', smoking: 'Run with … without coughing', scrolling: 'Read more, sleep better …', diet: 'Feel light and awake …' };

// onAdded(goal): after it's saved (open its page)
export async function openAddHabit({ today, onAdded = () => {} }) {
  const st = await load();
  const have = new Set((planOf(today, st)?.goals || []).map((g) => playbookIdOf(g)));
  const taken = (planOf(today, st)?.goals || []).map((g) => g.id);
  const body = el('div', { className: 'addHabit' });
  const d = openDrawer('Add a habit', body);

  const pickRow = (pbId) => {
    const pb = HABIT_PLAYBOOKS[pbId];
    const b = el('button', { type: 'button', className: 'cell' }, el('span', { className: 'cIcon', textContent: pb.icon }),
      el('span', { className: 'cMain' }, el('b', { textContent: pb.name }), el('small', { textContent: have.has(pbId) ? `${pb.line} · already one of yours` : pb.line })),
      el('span', { className: 'chev', textContent: '›' }));
    b.onclick = () => setup(pbId, {});
    return b;
  };
  function picker() {
    body.innerHTML = '';
    body.append(el('p', { className: 'small muted sheetNote', textContent: 'A playbook sets the target, how it’s counted and how Athena coaches it. You can change any of it later.' }));
    for (const [type, ids] of [['build', ['gym', 'focus']], ['cut', ['smoking', 'scrolling']], ['rule', ['diet']]]) {
      body.append(el('div', { className: 'groupHead', textContent: TYPES[type].label }));
      const g = el('div', { className: 'iosGroup' });
      ids.forEach((id) => g.append(pickRow(id)));
      body.append(g);
    }
    body.append(el('div', { className: 'groupHead', textContent: 'Something else' }));
    const own = el('button', { type: 'button', className: 'cell' }, el('span', { className: 'cIcon', textContent: '✎' }),
      el('span', { className: 'cMain' }, el('b', { textContent: 'Your own habit' }), el('small', { textContent: 'Name it, then pick Build up, Cut down or Keep a rule.' })), el('span', { className: 'chev', textContent: '›' }));
    own.onclick = () => ownHabit();
    body.append(el('div', { className: 'iosGroup' }, own));
  }

  // your own habit: a name, then its type (guessed from the name, yours to change)
  function ownHabit(name = '') {
    body.innerHTML = '';
    const back = el('button', { type: 'button', className: 'linkBtn backLink', textContent: '‹ Playbooks' });
    back.onclick = picker;
    const input = el('input', { type: 'text', className: 'iosInput ahName', maxLength: 40, placeholder: 'What’s the habit? e.g. Journal', value: name });
    const say = el('div', { className: 'ahSay' });
    const types = el('div', { className: 'ahTypes' });
    const go = el('button', { type: 'button', className: 'primary ahGo', textContent: 'Continue' });
    let chosen = null, userPicked = false;
    const draw = () => {
      const n = input.value.trim();
      const gu = guessType(n);
      if (!userPicked) chosen = gu.type;
      say.innerHTML = '';
      if (n) {
        const named = gu.playbook || null;
        const text = named ? `That sounds like ${HABIT_PLAYBOOKS[named].name}. Use its playbook, or set it up your way below.`
          : `Sounds like something to ${chosen === 'cut' ? 'cut down' : chosen === 'rule' ? 'keep as a rule' : 'build up'}. Pick how it should work:`;
        say.append(el('span', { className: 'ahAvatar', innerHTML: athena(28) }), el('p', { textContent: text }));
        if (named) {
          const use = el('button', { type: 'button', className: 'chip on', textContent: `Use the ${HABIT_PLAYBOOKS[named].name} playbook` });
          use.onclick = () => setup(named, {});
          say.querySelector('p').append(el('br'), use);
        }
      }
      types.innerHTML = '';
      for (const t of Object.values(TYPES)) {
        const on = t.id === chosen;
        const c = el('button', { type: 'button', className: `ahType ${on ? 'on' : ''}`, ariaPressed: String(on) },
          el('span', { className: 'ahTHead' }, el('span', { className: 'ahTIcon', textContent: t.icon }), el('b', { textContent: t.label })),
          el('span', { className: 'ahTWhat', textContent: t.what }),
          el('ul', {}, ...t.gets.map((x) => el('li', { textContent: x }))));
        c.onclick = () => { chosen = t.id; userPicked = true; draw(); };
        types.append(c);
      }
      types.hidden = !n;
      go.hidden = !n;
      go.textContent = `Continue with ${TYPES[chosen].label}`;
    };
    input.oninput = draw;
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) go.click(); };
    go.onclick = () => { if (input.value.trim()) setup(chosen, { name: input.value.trim() }); };
    body.append(back, input, say, types, go);
    draw();
    setTimeout(() => input.focus(), 60);
  }

  // the questions for a playbook, then Add
  function setup(pbId, a) {
    body.innerHTML = '';
    const pb = HABIT_PLAYBOOKS[pbId];
    const ans = { ...a };
    const back = el('button', { type: 'button', className: 'linkBtn backLink', textContent: a.name ? '‹ Back' : '‹ Playbooks' });
    back.onclick = () => (a.name ? ownHabit(a.name) : picker());
    const title = a.name || pb.name;
    body.append(back, el('div', { className: 'ahHead' }, el('span', { className: 'cIcon', textContent: a.name ? '⭐' : pb.icon }),
      el('div', {}, el('b', { textContent: title }), el('small', { textContent: `${TYPES[pb.type].label}${pb.line ? ` · ${pb.line}` : ''}` }))));
    for (const [key, q, kind, opts, def, free] of Q[pbId]) {
      const box = el('div', { className: 'ahQ' }, el('div', { className: 'lbl', textContent: q }));
      if (kind === 'number') {
        ans[key] = ans[key] ?? opts;
        const n = el('input', { type: 'number', inputMode: 'decimal', min: 0, className: 'iosInput ahNum', value: String(ans[key]) });
        n.oninput = () => { ans[key] = n.value === '' ? null : Number(n.value); };
        box.append(n);
      } else {
        ans[key] = ans[key] ?? def;
        const row = el('div', { className: 'chips' });
        const own = free ? el('input', { type: 'text', className: 'iosInput ahOwn', maxLength: 60, placeholder: 'Or type your own' }) : null;
        const paint = () => row.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', opts[i][0] === ans[key]));
        for (const [v, label] of opts) {
          const c = el('button', { type: 'button', className: 'chip', textContent: label });
          c.onclick = () => { ans[key] = ans[key] === v && def == null ? null : v; if (own) own.value = ''; paint(); };
          row.append(c);
        }
        if (own) own.oninput = () => { ans[key] = own.value.trim() || def; paint(); };
        paint();
        box.append(row);
        if (own) box.append(own);
      }
      body.append(box);
    }
    const why = el('input', { type: 'text', className: 'iosInput', maxLength: 90, placeholder: WHY[pbId] || 'In a few words' });
    body.append(el('div', { className: 'ahQ' }, el('div', { className: 'lbl', textContent: 'Why does this matter to you? (optional)' }), why,
      el('p', { className: 'small muted', textContent: 'Athena brings it up on the days that are hard.' })));
    const add = el('button', { type: 'button', className: 'primary ahGo', textContent: `Add ${title}` });
    add.onclick = async () => {
      add.disabled = true;
      const g = makeHabit(pbId, { ...ans, why: why.value }, today, taken);
      await addHabit(g, weekKeyOf(today));
      toast(`${g.name} added`);
      d.close();
      onAdded(g);
    };
    body.append(add);
  }

  picker();
  return d;
}
