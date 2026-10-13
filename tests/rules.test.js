/* Gameplay rule tests. Runs inside the app page (see run_tests.py). */
(() => {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); }
  };
  const eq = (got, want, msg = '') => {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${msg} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

  const BASE = ['godfather', 'mafia', 'doctor', 'cop', 'villager', 'villager', 'villager', 'villager'];

  function setup(roles, settings = {}) {
    state = freshState();
    Object.assign(state.settings, settings);
    state.players = roles.map((role, i) => ({ seat: i + 1, name: `P${i + 1}`, role, alive: true, death: null }));
    state.screen = 'game';
    state.round = 1;
    state.vigBullets = state.settings.vigBullets;
    startNight();
  }
  const S = (role, n = 0) => state.players.filter(p => p.role === role)[n].seat;
  const isAlive = seat => P(seat).alive;
  const dead = () => state.players.filter(p => !p.alive).map(p => p.seat).sort((a, b) => a - b);
  const night = acts => { state.night.actions = acts; resolveNight(); };
  const lynch = seat => { actions.lynchSel(String(seat)); actions.lynch(); };
  const next = () => { if (!state.day.lynchDone) actions.noLynch(); actions.nextNight(); };
  const announce = () => state.day.announce.join(' | ');
  const def = key => stepDef(key);
  const nightLog = () => state.log[state.log.length - 2].lines.join(' | ');

  /* ----- Mafia kill ----- */
  test('Mafia kill kills the target', () => {
    setup(BASE);
    const v = S('villager');
    night({ kill: v });
    eq(dead(), [v]);
    ok(announce().includes('was killed during the night'));
    eq(state.winner, null);
  });

  test('Mafia "no action" kills nobody', () => {
    setup(BASE);
    night({ kill: 0 });
    eq(dead(), []);
    ok(announce().includes('nobody died'));
  });

  test('Night 1 kill disabled removes the kill picker', () => {
    setup(BASE, { night1Kill: false });
    eq(def('kill').pick, null);
    night({});
    next();
    eq(def('kill').pick, 'one', 'Night 2 kill should be allowed');
  });

  /* ----- Doctor ----- */
  test('Doctor saves the Mafia target', () => {
    setup(BASE);
    const v = S('villager');
    night({ kill: v, doctor: v });
    eq(dead(), []);
    ok(nightLog().includes('Doctor saved'));
  });

  test('Doctor cannot save the same player two nights in a row', () => {
    setup(BASE);
    const v = S('villager'), v2 = S('villager', 1);
    night({ doctor: v });
    next();
    eq(def('doctor').disabled(P(v)), 'Saved last night');
    eq(def('doctor').disabled(P(v2)), '');
  });

  test('Doctor can save the same player again after a different save', () => {
    setup(BASE);
    const v = S('villager'), v2 = S('villager', 1);
    night({ doctor: v }); next();
    night({ doctor: v2 }); next();
    eq(def('doctor').disabled(P(v)), '');
  });

  test('Doctor can save the same player again after skipping a night', () => {
    setup(BASE);
    const v = S('villager');
    night({ doctor: v }); next();
    night({ doctor: 0 }); next();
    eq(def('doctor').disabled(P(v)), '');
  });

  test('Doctor self-save follows the setting', () => {
    setup(BASE, { doctorSelf: false });
    eq(def('doctor').disabled(P(S('doctor'))), 'No self-save');
    setup(BASE, { doctorSelf: true });
    eq(def('doctor').disabled(P(S('doctor'))), '');
  });

  test('Doctor self-save survives a Mafia attack', () => {
    setup(BASE);
    const d = S('doctor');
    night({ kill: d, doctor: d });
    eq(dead(), []);
  });

  test('Role-blocked Doctor fails to save', () => {
    setup([...BASE, 'roleblocker']);
    const v = S('villager');
    night({ roleblock: S('doctor'), kill: v, doctor: v });
    eq(dead(), [v]);
    ok(nightLog().includes('save failed'));
  });

  /* ----- Bodyguard ----- */
  const BG = [...BASE, 'bodyguard'];

  test('Bodyguard dies in place of the protected player', () => {
    setup(BG);
    const v = S('villager'), bg = S('bodyguard');
    night({ kill: v, bodyguard: v });
    eq(dead(), [bg]);
    ok(isAlive(v));
  });

  test('Doctor saving the Bodyguard means nobody dies', () => {
    setup(BG);
    const v = S('villager'), bg = S('bodyguard');
    night({ kill: v, bodyguard: v, doctor: bg });
    eq(dead(), []);
  });

  test('Doctor save takes priority over Bodyguard', () => {
    setup(BG);
    const v = S('villager');
    night({ kill: v, bodyguard: v, doctor: v });
    eq(dead(), []);
  });

  test('Bodyguard cannot guard self or the same player twice in a row', () => {
    setup(BG);
    const v = S('villager'), bg = S('bodyguard');
    eq(def('bodyguard').disabled(P(bg)), 'Self');
    night({ bodyguard: v }); next();
    eq(def('bodyguard').disabled(P(v)), 'Guarded last night');
  });

  test('Role-blocked Bodyguard fails to protect', () => {
    setup([...BG, 'roleblocker']);
    const v = S('villager'), bg = S('bodyguard');
    night({ roleblock: bg, kill: v, bodyguard: v });
    eq(dead(), [v]);
  });

  test('Bodyguard also intercepts Vigilante and Serial Killer attacks', () => {
    setup([...BG, 'vigilante']);
    const v = S('villager'), bg = S('bodyguard');
    night({ vigilante: v, bodyguard: v });
    eq(dead(), [bg]);
    setup([...BG, 'serialKiller']);
    night({ serialKiller: S('villager'), bodyguard: S('villager') });
    eq(dead(), [S('bodyguard')]);
  });

  /* ----- Cop ----- */
  const copResult = (roles, targetRole, extra = {}) => {
    setup(roles);
    state.night.actions = { cop: S(targetRole), ...extra };
    return def('cop').result || '';
  };
  const ALL = ['godfather', 'mafia', 'roleblocker', 'blackmailer', 'doctor', 'cop', 'jester', 'serialKiller', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];

  test('Cop sees Mafia, Role Blocker and Blackmailer as MAFIA', () => {
    for (const r of ['mafia', 'roleblocker', 'blackmailer']) ok(copResult(ALL, r).includes('result bad'), r);
  });

  test('Cop sees Godfather, Jester, Serial Killer and Villager as not Mafia', () => {
    for (const r of ['godfather', 'jester', 'serialKiller', 'villager']) ok(copResult(ALL, r).includes('result good'), r);
  });

  test('Role-blocked Cop gets no answer', () => {
    const res = copResult(ALL, 'mafia', { roleblock: 0 });
    ok(res.includes('bad'));
    setup(ALL);
    state.night.actions = { roleblock: S('cop'), cop: S('mafia') };
    ok(def('cop').result.includes('no answer'));
  });

  test('Cop cannot investigate self', () => {
    setup(BASE);
    eq(def('cop').disabled(P(S('cop'))), 'Self');
  });

  /* ----- Vigilante ----- */
  const VIG = [...BASE, 'vigilante'];

  test('Vigilante shot kills and uses a bullet; then no bullets left', () => {
    setup(VIG);
    const v = S('villager');
    night({ vigilante: v });
    eq(dead(), [v]);
    eq(state.vigBullets, 0);
    next();
    eq(def('vigilante').pick, null);
    ok(def('vigilante').notes.join().includes('No bullets'));
  });

  test('Role-blocked Vigilante keeps the bullet', () => {
    setup([...VIG, 'roleblocker']);
    const v = S('villager');
    night({ roleblock: S('vigilante'), vigilante: v });
    eq(dead(), []);
    eq(state.vigBullets, 1);
  });

  test('Vigilante with 2 bullets can shoot twice', () => {
    setup(VIG, { vigBullets: 2 });
    night({ vigilante: S('villager') }); next();
    eq(def('vigilante').pick, 'one');
    night({ vigilante: S('villager', 1) });
    eq(state.vigBullets, 0);
    eq(dead().length, 2);
  });

  test('Vigilante cannot shoot self', () => {
    setup(VIG);
    eq(def('vigilante').disabled(P(S('vigilante'))), 'Self');
  });

  /* ----- Serial Killer ----- */
  const SK = [...BASE, 'serialKiller'];

  test('Serial Killer kills; Doctor can save; Role Blocker can stop', () => {
    setup(SK);
    night({ serialKiller: S('villager') });
    eq(dead(), [S('villager')]);
    setup(SK);
    night({ serialKiller: S('villager'), doctor: S('villager') });
    eq(dead(), []);
    setup([...SK, 'roleblocker']);
    night({ roleblock: S('serialKiller'), serialKiller: S('villager') });
    eq(dead(), []);
  });

  test('Mafia and Serial Killer on the same target = one death, one announcement', () => {
    setup(SK);
    const v = S('villager');
    night({ kill: v, serialKiller: v });
    eq(dead(), [v]);
    eq(state.day.announce.length, 1);
  });

  test('Mafia, Serial Killer and Vigilante on different targets = three deaths', () => {
    setup([...SK, 'vigilante', 'villager', 'villager']);
    night({ kill: S('villager'), serialKiller: S('villager', 1), vigilante: S('villager', 2) });
    eq(dead().length, 3);
  });

  test('Doctor saves one target but not the other', () => {
    setup(SK);
    const v1 = S('villager'), v2 = S('villager', 1);
    night({ kill: v1, serialKiller: v2, doctor: v1 });
    eq(dead(), [v2]);
  });

  /* ----- Cupid / lovers ----- */
  const CUP = [...BASE, 'cupid'];

  test('Cupid only acts on Night 1', () => {
    setup(CUP);
    ok(state.night.steps.includes('cupid'));
    night({}); next();
    ok(!state.night.steps.includes('cupid'));
  });

  test('Lover killed at night: partner dies of heartbreak', () => {
    setup(CUP);
    const a = S('villager'), b = S('villager', 1);
    night({ cupid: [a, b], kill: a });
    eq(dead(), [a, b].sort((x, y) => x - y));
    eq(P(b).death.cause, 'heartbreak');
    ok(announce().includes('broken heart'));
  });

  test('Lover executed: partner dies of heartbreak', () => {
    setup(CUP);
    const a = S('villager'), b = S('villager', 1);
    night({ cupid: [a, b] });
    lynch(a);
    ok(!isAlive(b));
  });

  test('"No lovers" leaves nobody linked', () => {
    setup(CUP);
    night({ cupid: 0, kill: S('villager') });
    eq(state.lovers, null);
    eq(dead().length, 1);
  });

  test('Lovers win when they are the last two alive', () => {
    setup(['mafia', 'villager', 'villager', 'villager', 'cupid']);
    const m = S('mafia'), v = S('villager');
    night({ cupid: [m, v], kill: S('villager', 1) });
    lynch(S('villager', 2));
    next();
    night({ kill: S('cupid') });
    eq(state.winner, 'lovers');
  });

  /* ----- Hunter ----- */
  const HUN = [...BASE, 'hunter'];

  test('Hunter killed at night takes their target', () => {
    setup(HUN);
    const h = S('hunter'), v = S('villager');
    night({ kill: h, hunter: v });
    eq(dead(), [h, v].sort((x, y) => x - y));
    eq(P(v).death.cause, 'hunter');
    ok(announce().includes('shot by the Hunter'));
  });

  test('Hunter executed the next day takes their target', () => {
    setup(HUN);
    const h = S('hunter'), v = S('villager');
    night({ hunter: v });
    lynch(h);
    ok(!isAlive(v));
    ok(announce().includes('shot by the Hunter'));
  });

  test('Hunter with "No action" takes nobody', () => {
    setup(HUN);
    night({ kill: S('hunter'), hunter: 0 });
    eq(dead(), [S('hunter')]);
  });

  test('Role-blocked Hunter takes nobody', () => {
    setup([...HUN, 'roleblocker']);
    const h = S('hunter');
    night({ roleblock: h, kill: h, hunter: S('villager') });
    eq(dead(), [h]);
  });

  test('Hunter target already killed that night = no extra death', () => {
    setup([...HUN, 'serialKiller']);
    const h = S('hunter'), v = S('villager');
    night({ kill: h, serialKiller: v, hunter: v });
    eq(dead(), [h, v].sort((x, y) => x - y));
  });

  test('Hunter dying of heartbreak still takes their target', () => {
    setup([...HUN, 'cupid']);
    const h = S('hunter'), lover = S('villager'), target = S('villager', 1);
    night({ cupid: [h, lover], kill: lover, hunter: target });
    eq(dead(), [h, lover, target].sort((x, y) => x - y));
  });

  test('Hunter shooting a lover kills the other lover too', () => {
    setup([...HUN, 'cupid']);
    const h = S('hunter'), a = S('villager'), b = S('villager', 1);
    night({ cupid: [a, b], kill: h, hunter: a });
    eq(dead(), [h, a, b].sort((x, y) => x - y));
  });

  test('Old Hunter target does not carry over a "No action" night', () => {
    setup(HUN);
    const h = S('hunter'), v = S('villager');
    night({ hunter: v }); next();
    night({ hunter: 0 });
    lynch(h);
    ok(isAlive(v));
  });

  test('Hunter cannot target self', () => {
    setup(HUN);
    eq(def('hunter').disabled(P(S('hunter'))), 'Self');
  });

  /* ----- Blackmailer / Role Blocker ----- */
  test('Blackmailed player is announced and flagged', () => {
    setup([...BASE, 'blackmailer']);
    const v = S('villager');
    night({ blackmail: v });
    eq(state.day.silenced, v);
    ok(announce().includes('blackmailed'));
  });

  test('Role-blocked Blackmailer silences nobody', () => {
    setup([...BASE, 'blackmailer', 'roleblocker']);
    night({ roleblock: S('blackmailer'), blackmail: S('villager') });
    eq(state.day.silenced, 0);
  });

  test('Blackmailed player who died that night is not announced as silenced', () => {
    setup([...BASE, 'blackmailer']);
    const v = S('villager');
    night({ blackmail: v, kill: v });
    ok(!announce().includes('blackmailed'));
  });

  test('Role Blocker and Blackmailer cannot target themselves', () => {
    setup([...BASE, 'blackmailer', 'roleblocker']);
    eq(def('roleblock').disabled(P(S('roleblocker'))), 'Self');
    eq(def('blackmail').disabled(P(S('blackmailer'))), 'Self');
  });

  test('Blocked player gets a warning on their step', () => {
    setup([...BASE, 'roleblocker']);
    state.night.actions = { roleblock: S('doctor') };
    ok(def('doctor').warn.join().includes('role-blocked'));
    eq(def('cop').warn.length, 0);
  });

  /* ----- Assistants ----- */
  const ASST = [...BASE, 'asstDoctor', 'asstCop', 'villager'];

  test('Assistants do nothing while the main role lives', () => {
    setup(ASST);
    eq(holder('doctor').role, 'doctor');
    eq(holder('cop').role, 'cop');
  });

  test('Assistant Doctor takes over when the Doctor dies, with a fresh restriction', () => {
    setup(ASST);
    const d = S('doctor'), v = S('villager');
    night({ kill: d, doctor: v });
    next();
    eq(holder('doctor').role, 'asstDoctor');
    ok(def('doctor').notes.join().includes('Assistant Doctor'));
    eq(def('doctor').disabled(P(v)), '');
    night({ kill: v, doctor: v });
    ok(isAlive(v));
  });

  test('Assistant Cop takes over when the Cop dies', () => {
    setup(ASST);
    night({ kill: S('cop') });
    next();
    eq(holder('cop').role, 'asstCop');
    state.night.actions = { cop: S('mafia') };
    ok(def('cop').result.includes('MAFIA'));
  });

  test('Dead role with no assistant: no picker, Next allowed', () => {
    setup(BASE);
    night({ kill: S('doctor') });
    next();
    const d = def('doctor');
    eq(d.holder, null);
    ok(d.notes.join().includes('dead'));
  });

  test('Night steps include only roles in the game, in order', () => {
    setup(['godfather', 'roleblocker', 'blackmailer', 'serialKiller', 'cupid', 'doctor', 'bodyguard', 'cop', 'vigilante', 'hunter', 'villager', 'villager', 'villager', 'villager', 'villager']);
    eq(state.night.steps, ['sleep', 'cupid', 'mafiaWake', 'roleblock', 'blackmail', 'kill', 'serialKiller', 'doctor', 'bodyguard', 'cop', 'vigilante', 'hunter', 'dawn']);
    setup(['mafia', 'villager', 'villager', 'villager']);
    eq(state.night.steps, ['sleep', 'mafiaWake', 'kill', 'dawn']);
  });

  /* ----- Win conditions ----- */
  test('Town wins when the last Mafia is executed', () => {
    setup(['mafia', 'doctor', 'villager', 'villager', 'villager']);
    night({});
    lynch(S('mafia'));
    eq(state.winner, 'town');
  });

  test('Mafia wins at parity after a night kill', () => {
    setup(['mafia', 'mafia', 'villager', 'villager', 'villager']);
    night({ kill: S('villager') });
    eq(state.winner, 'mafia');
  });

  test('Mafia wins at parity after an execution', () => {
    setup(['mafia', 'villager', 'villager', 'villager']);
    night({ kill: 0 });
    lynch(S('villager'));
    eq(state.winner, null);
    next();
    night({ kill: S('villager', 1) });
    eq(state.winner, 'mafia');
  });

  test('Vigilante killing the last Mafia gives Town the win', () => {
    setup(['mafia', 'vigilante', 'villager', 'villager', 'villager']);
    night({ vigilante: S('mafia') });
    eq(state.winner, 'town');
  });

  test('Town cannot win while the Serial Killer lives', () => {
    setup(['mafia', 'serialKiller', 'villager', 'villager', 'villager', 'villager']);
    night({});
    lynch(S('mafia'));
    eq(state.winner, null);
    next();
    night({});
    lynch(S('serialKiller'));
    eq(state.winner, 'town');
  });

  test('Mafia cannot win at parity while the Serial Killer lives', () => {
    setup(['mafia', 'serialKiller', 'villager', 'villager']);
    night({ kill: S('villager') });
    eq(state.winner, null);
  });

  test('Serial Killer wins when one of the last two', () => {
    setup(['mafia', 'serialKiller', 'villager', 'villager']);
    night({ kill: S('villager'), serialKiller: S('mafia') });
    eq(state.winner, 'serialKiller');
  });

  test('Jester executed wins; Jester killed at night does not', () => {
    setup([...BASE, 'jester']);
    night({});
    lynch(S('jester'));
    eq(state.winner, 'jester');
    setup([...BASE, 'jester']);
    night({ kill: S('jester') });
    eq(state.winner, null);
  });

  test('Jester win is not overwritten by a heartbreak death', () => {
    setup([...BASE, 'jester', 'cupid']);
    const j = S('jester'), m = S('mafia');
    night({ cupid: [j, m] });
    lynch(j);
    ok(!isAlive(m));
    eq(state.winner, 'jester');
  });

  test('No execution leaves everyone alive and logs it', () => {
    setup(BASE);
    night({});
    actions.noLynch();
    eq(dead(), []);
    ok(announce().includes('No one'));
  });

  /* ----- Narration and reveal ----- */
  test('Role reveal on death follows the setting', () => {
    setup(BASE, { revealOnDeath: true });
    night({ kill: S('cop') });
    ok(announce().includes('Cop'));
    setup(BASE, { revealOnDeath: false });
    night({ kill: S('cop') });
    ok(!announce().includes('They were'));
  });

  test('Death cause is not revealed publicly', () => {
    setup([...SK, 'vigilante']);
    night({ kill: S('villager'), serialKiller: S('villager', 1), vigilante: S('villager', 2) });
    ok(!/Mafia|Serial|Vigilante/.test(announce().replace(/They were the <b>[^<]*<\/b>/g, '')));
  });

  test('Moderator log lists every action and death', () => {
    setup([...BASE, 'roleblocker', 'bodyguard']);
    const v = S('villager');
    night({ roleblock: S('cop'), kill: v, doctor: S('villager', 1), bodyguard: v, cop: S('mafia') });
    const log = nightLog();
    for (const s of ['blocked', 'Mafia targeted', 'protected', 'guarded', 'no result', 'died protecting']) ok(log.includes(s), s);
  });

  test('Names with HTML characters are escaped', () => {
    setup(BASE);
    P(S('villager')).name = '<img src=x onerror=alert(1)>';
    night({ kill: S('villager') });
    ok(!announce().includes('<img'));
  });

  return results;
})();
