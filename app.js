'use strict';

const STORAGE_KEY = 'mafia-moderator-v1';
const root = document.getElementById('app');
const ui = { tab: 'phase', showRoles: false };
let undoStack = [];
let state = load() || freshState();

/* ---------- state & persistence ---------- */

function freshState(prev) {
  return {
    screen: 'setup',
    numPlayers: prev ? prev.numPlayers : 8,
    counts: prev ? prev.counts : { godfather: 1, mafia: 1, doctor: 1, cop: 1 },
    settings: prev ? prev.settings : { revealOnDeath: true, night1Kill: true, vigBullets: 1, blackmailerTeam: 'random' },
    players: [],
    assignIndex: 0,
    revealed: false,
    round: 1,
    phase: 'night',
    night: null,
    day: null,
    lovers: null,
    last: { doctor: null, bodyguard: null },
    vigBullets: 1,
    hunterTarget: null,
    log: [],
    winner: null,
  };
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- helpers ---------- */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = seat => state.players.find(p => p.seat === seat);
const nm = seat => `<b>${esc(P(seat).name)}</b>`;
const roleOf = p => ROLES[p.role];
const teamOf = p => p.team || roleOf(p).team;
const isMafia = p => teamOf(p) === 'mafia';
const blackmailerTeam = () => state.settings.blackmailerTeam || 'random';

function roleDesc(key, team) {
  const role = ROLES[key];
  let d = role.desc;
  if (role.flexTeam) {
    if (team === 'mafia') d += ' You are on the <b>Mafia</b> team: you also wake with the Mafia and help choose the kill.';
    else if (team === 'town') d += ' You are on the <b>Town</b> team: you win with the Town.';
    else d += ' Can be on the Mafia or the Town team (see Rules).';
  }
  return d;
}
const alivePlayers = () => state.players.filter(p => p.alive);
const inGame = r => state.players.some(p => p.role === r);
const firstAlive = r => state.players.find(p => p.role === r && p.alive) || null;
const roleTag = p => `${roleOf(p).icon} ${roleOf(p).name}${roleOf(p).flexTeam && p.team ? ` (${TEAM_LABEL[p.team]})` : ''}`;

function holder(role) {
  if (role === 'doctor') return firstAlive('doctor') || firstAlive('asstDoctor');
  if (role === 'cop') return firstAlive('cop') || firstAlive('asstCop');
  return firstAlive(role);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setupStats() {
  const c = state.counts;
  let special = 0, mafia = 0, neutral = 0;
  for (const [r, n] of Object.entries(c)) {
    special += n;
    const team = ROLES[r].flexTeam ? (blackmailerTeam() === 'mafia' ? 'mafia' : 'town') : ROLES[r].team;
    if (team === 'mafia') mafia += n;
    if (team === 'neutral') neutral += n;
  }
  const villagers = state.numPlayers - special;
  const town = state.numPlayers - mafia - neutral;
  const errors = [], warnings = [];
  if (villagers < 0) errors.push(`You picked ${special} roles for ${state.numPlayers} players.`);
  if (mafia === 0) errors.push('Add at least one Mafia-team role.');
  for (const [r, n] of Object.entries(c)) {
    if (n && ROLES[r].requires && !c[ROLES[r].requires]) {
      errors.push(`${ROLES[r].name} needs a ${ROLES[ROLES[r].requires].name} in the game.`);
    }
  }
  if (mafia && mafia >= town) errors.push('Mafia would already equal or outnumber the town.');
  const ideal = Math.max(1, Math.round(state.numPlayers / 4));
  if (!errors.length && mafia > ideal) warnings.push(`Mafia-heavy. About ${ideal} Mafia is typical for ${state.numPlayers} players.`);
  if (!errors.length && mafia < ideal) warnings.push(`Town-heavy. About ${ideal} Mafia is typical for ${state.numPlayers} players.`);
  if (c.blackmailer && blackmailerTeam() === 'random') warnings.push('The Blackmailer\'s team is picked at random — counted as Town above, but may join the Mafia.');
  return { villagers, mafia, neutral, town, errors, warnings };
}

function checkWinner() {
  const alive = alivePlayers();
  if (state.lovers && alive.length === 2 && alive.every(p => state.lovers.includes(p.seat))) return 'lovers';
  if (alive.some(p => p.role === 'serialKiller')) return alive.length <= 2 ? 'serialKiller' : null;
  const m = alive.filter(isMafia).length;
  if (m === 0) return 'town';
  if (m >= alive.length - m) return 'mafia';
  return null;
}

function currentLog() {
  return state.log[state.log.length - 1];
}

/* Kills a player and resolves chained deaths (lovers). Returns all deaths. */
function killPlayer(seat, cause) {
  const p = P(seat);
  if (!p || !p.alive) return [];
  p.alive = false;
  p.death = { round: state.round, phase: state.phase, cause };
  const out = [{ seat, cause }];
  const ht = state.hunterTarget;
  if (p.role === 'hunter' && ht && ht.by === seat && ht.target) {
    out.push(...killPlayer(ht.target, 'hunter'));
  }
  if (state.lovers && state.lovers.includes(seat)) {
    const other = state.lovers.find(s => s !== seat);
    if (P(other).alive) out.push(...killPlayer(other, 'heartbreak'));
  }
  return out;
}

function deathLine({ seat, cause }) {
  const p = P(seat);
  const text = {
    mafia: `${nm(seat)} was killed during the night.`,
    vigilante: `${nm(seat)} was killed during the night.`,
    serialKiller: `${nm(seat)} was killed during the night.`,
    bodyguard: `${nm(seat)} was killed during the night.`,
    heartbreak: `${nm(seat)} died of a broken heart.`,
    hunter: `${nm(seat)} was shot by the Hunter.`,
    lynch: `The town has executed ${nm(seat)}.`,
  }[cause] || `${nm(seat)} has died.`;
  return state.settings.revealOnDeath ? `${text} They were the <b>${roleTag(p)}</b>.` : text;
}

/* ---------- game flow ---------- */

function startAssign() {
  const roles = [];
  for (const r of ROLE_ORDER) for (let i = 0; i < (state.counts[r] || 0); i++) roles.push(r);
  while (roles.length < state.numPlayers) roles.push('villager');
  state.players = shuffle(roles).map((role, i) => ({ seat: i + 1, name: `Player ${i + 1}`, role, alive: true, death: null }));
  for (const p of state.players) {
    if (!ROLES[p.role].flexTeam) continue;
    const pick = blackmailerTeam();
    p.team = pick === 'random' ? shuffle(['mafia', 'town'])[0] : pick;
  }
  state.assignIndex = 0;
  state.revealed = false;
  state.screen = 'assign';
}

function startNight() {
  state.phase = 'night';
  state.day = null;
  state.night = { step: 0, steps: buildSteps(state.round), actions: {} };
  state.log.push({ title: `Night ${state.round}`, lines: [] });
}

function buildSteps(round) {
  const s = ['sleep'];
  if (round === 1 && inGame('cupid')) s.push('cupid');
  s.push('mafiaWake');
  if (inGame('roleblocker')) s.push('roleblock');
  s.push('kill');
  if (inGame('blackmailer')) s.push('blackmail');
  if (inGame('serialKiller')) s.push('serialKiller');
  if (inGame('doctor') || inGame('asstDoctor')) s.push('doctor');
  if (inGame('bodyguard')) s.push('bodyguard');
  if (inGame('cop') || inGame('asstCop')) s.push('cop');
  if (inGame('vigilante')) s.push('vigilante');
  if (inGame('hunter')) s.push('hunter');
  s.push('dawn');
  return s;
}

function stepDef(key) {
  const a = state.night.actions;
  const r = state.round;
  const blocked = a.roleblock || 0;
  const d = { key, pick: null, say: [], after: [], notes: [], warn: [], holder: undefined, disabled: () => '' };

  const withHolder = (h, roleName) => {
    d.holder = h;
    if (!h) {
      d.notes.push(`☠️ The ${roleName} is dead. Read the lines anyway and pause a few seconds so nobody can tell.`);
    } else if (h.seat === blocked && key !== 'roleblock') {
      d.warn.push(`${nm(h.seat)} is <b>role-blocked</b> tonight. Let them choose as usual — it will have no effect.`);
    }
  };

  switch (key) {
    case 'sleep':
      d.icon = '🌙'; d.title = `Night ${r} begins`;
      d.say = ['Everyone, close your eyes. Night falls on the town.'];
      break;

    case 'cupid': {
      d.icon = '💘'; d.title = 'Cupid'; d.pick = 'two';
      withHolder(holder('cupid'), 'Cupid');
      d.say = ['Cupid, open your eyes. Point at two players who will fall in love.'];
      d.after = ['Cupid, close your eyes.'];
      if (Array.isArray(a.cupid) && a.cupid.length === 2) {
        d.after.push(`<i>(Tap ${nm(a.cupid[0])} and ${nm(a.cupid[1])} on the shoulder.)</i> Lovers, open your eyes and look at each other. If one of you dies, so does the other. Lovers, close your eyes.`);
      }
      d.disabled = () => '';
      break;
    }

    case 'mafiaWake': {
      d.icon = '🔪'; d.title = 'Mafia wake up';
      const team = state.players.filter(isMafia);
      d.say = [r === 1
        ? 'Mafia, open your eyes. Look around — these are your teammates.'
        : 'Mafia, open your eyes.'];
      d.notes.push('Mafia team: ' + team.map(p => `${nm(p.seat)} (${roleTag(p)})${p.alive ? '' : ' ☠️'}`).join(', '));
      break;
    }

    case 'roleblock': {
      d.icon = '🚫'; d.title = 'Role Blocker'; d.pick = 'one';
      const h = holder('roleblocker');
      withHolder(h, 'Role Blocker');
      d.say = ['Role Blocker, point at the player whose ability you want to block tonight.'];
      d.disabled = p => (h && p.seat === h.seat ? 'Self' : '');
      break;
    }

    case 'blackmail': {
      d.icon = '🤐'; d.title = 'Blackmailer'; d.pick = 'one';
      const h = holder('blackmailer');
      withHolder(h, 'Blackmailer');
      if (h) d.notes.push(`Team: <b>${TEAM_LABEL[teamOf(h)]}</b>`);
      d.say = ['Blackmailer, open your eyes. Point at the player you want to silence tomorrow.'];
      d.after = ['Blackmailer, close your eyes.'];
      d.disabled = p => (h && p.seat === h.seat ? 'Self' : '');
      break;
    }

    case 'kill': {
      d.icon = '🗡️'; d.title = 'Mafia kill';
      d.holder = alivePlayers().find(isMafia) || null;
      if (r === 1 && !state.settings.night1Kill) {
        d.notes.push('No kill on Night 1 (game setting).');
        d.after = ['Mafia, close your eyes.'];
      } else {
        d.pick = 'one';
        d.say = ['Mafia, silently agree on a victim and point at them.'];
        d.after = ['Mafia, close your eyes.'];
        d.markMafia = true;
      }
      break;
    }

    case 'serialKiller': {
      d.icon = '🪓'; d.title = 'Serial Killer'; d.pick = 'one';
      const h = holder('serialKiller');
      withHolder(h, 'Serial Killer');
      d.say = ['Serial Killer, open your eyes. Point at the player you want to kill tonight.'];
      d.after = ['Serial Killer, close your eyes.'];
      d.disabled = p => (h && p.seat === h.seat ? 'Self' : '');
      break;
    }

    case 'doctor': {
      d.icon = '🩺'; d.title = 'Doctor'; d.pick = 'one';
      const h = holder('doctor');
      withHolder(h, 'Doctor');
      if (h && h.role === 'asstDoctor') {
        d.notes.push(`The Doctor is dead — the <b>Assistant Doctor</b> ${nm(h.seat)} now acts as Doctor. Tap them on the shoulder so they know to wake.`);
      }
      d.say = ['Doctor, open your eyes. Point at the player you want to save tonight.'];
      d.after = ['Doctor, close your eyes.'];
      d.disabled = p => {
        if (!h) return '';
        const l = state.last.doctor;
        if (l && l.by === h.seat && l.target === p.seat && l.round === r - 1) return 'Saved last night';
        return '';
      };
      break;
    }

    case 'bodyguard': {
      d.icon = '🛡️'; d.title = 'Bodyguard'; d.pick = 'one';
      const h = holder('bodyguard');
      withHolder(h, 'Bodyguard');
      d.say = ['Bodyguard, open your eyes. Point at the player you want to protect tonight.'];
      d.after = ['Bodyguard, close your eyes.'];
      d.disabled = p => {
        if (!h) return '';
        if (p.seat === h.seat) return 'Self';
        const l = state.last.bodyguard;
        if (l && l.by === h.seat && l.target === p.seat && l.round === r - 1) return 'Guarded last night';
        return '';
      };
      break;
    }

    case 'cop': {
      d.icon = '🕵️'; d.title = 'Cop'; d.pick = 'one';
      const h = holder('cop');
      withHolder(h, 'Cop');
      if (h && h.role === 'asstCop') {
        d.notes.push(`The Cop is dead — the <b>Assistant Cop</b> ${nm(h.seat)} now acts as Cop. Tap them on the shoulder so they know to wake.`);
      }
      d.say = ['Cop, open your eyes. Point at the player you want to investigate.'];
      d.after = ['Cop, close your eyes.'];
      d.disabled = p => (h && p.seat === h.seat ? 'Self' : '');
      if (h && a.cop) {
        const t = P(a.cop);
        if (h.seat === blocked) {
          d.result = `<div class="result neutral">Blocked — give <b>no answer</b> (shrug / no signal).</div>`;
        } else if (isMafia(t) && t.role !== 'godfather') {
          d.result = `<div class="result bad">👍 ${nm(t.seat)} is <b>MAFIA</b>. Give a thumbs up.</div>`;
        } else {
          d.result = `<div class="result good">👎 ${nm(t.seat)} is <b>NOT Mafia</b>. Give a thumbs down.</div>`;
        }
      }
      break;
    }

    case 'vigilante': {
      d.icon = '🔫'; d.title = 'Vigilante';
      const h = holder('vigilante');
      withHolder(h, 'Vigilante');
      d.say = [`Vigilante, open your eyes. Would you like to shoot someone tonight?`];
      d.after = ['Vigilante, close your eyes.'];
      if (h && state.vigBullets <= 0) {
        d.notes.push('No bullets left — shake your head at them and move on.');
      } else {
        d.pick = 'one';
        if (h) d.notes.push(`Bullets left: <b>${state.vigBullets}</b>`);
        d.disabled = p => (h && p.seat === h.seat ? 'Self' : '');
      }
      break;
    }

    case 'hunter': {
      d.icon = '🏹'; d.title = 'Hunter'; d.pick = 'one';
      const h = holder('hunter');
      withHolder(h, 'Hunter');
      d.say = ['Hunter, open your eyes. Point at the player you will take down with you if you die before tomorrow night.'];
      d.after = ['Hunter, close your eyes.'];
      d.disabled = p => (h && p.seat === h.seat ? 'Self' : '');
      break;
    }

    case 'dawn': {
      d.icon = '🌅'; d.title = 'Dawn';
      d.say = ['Everyone, open your eyes. The sun rises over the town…'];
      d.summary = true;
      break;
    }
  }
  return d;
}

function resolveNight() {
  const a = state.night.actions;
  const r = state.round;
  const blocked = a.roleblock || 0;
  const ev = currentLog().lines;
  const works = h => h && h.seat !== blocked;

  state.day = { announce: [], lynchSel: null, lynchDone: false, silenced: 0 };
  state.phase = 'day';

  if (Array.isArray(a.cupid) && a.cupid.length === 2) {
    state.lovers = a.cupid.slice();
    ev.push(`Cupid made ${nm(a.cupid[0])} and ${nm(a.cupid[1])} lovers.`);
  }
  if (blocked) ev.push(`Role Blocker blocked ${nm(blocked)} (${roleTag(P(blocked))}).`);

  const bm = holder('blackmailer');
  if (bm && a.blackmail) {
    if (works(bm)) { state.day.silenced = a.blackmail; ev.push(`Blackmailer silenced ${nm(a.blackmail)}.`); }
    else ev.push('Blackmailer was blocked — no one is silenced.');
  }

  const doc = holder('doctor');
  let save = 0;
  if (doc) {
    state.last.doctor = { by: doc.seat, target: a.doctor || 0, round: r };
    if (a.doctor) {
      if (works(doc)) { save = a.doctor; ev.push(`Doctor ${nm(doc.seat)} protected ${nm(a.doctor)}.`); }
      else ev.push(`Doctor ${nm(doc.seat)} was blocked — save failed.`);
    }
  }

  const bg = holder('bodyguard');
  let guard = 0;
  if (bg) {
    state.last.bodyguard = { by: bg.seat, target: a.bodyguard || 0, round: r };
    if (a.bodyguard) {
      if (works(bg)) { guard = a.bodyguard; ev.push(`Bodyguard ${nm(bg.seat)} guarded ${nm(a.bodyguard)}.`); }
      else ev.push(`Bodyguard ${nm(bg.seat)} was blocked — guard failed.`);
    }
  }

  const cop = holder('cop');
  if (cop && a.cop) {
    const t = P(a.cop);
    if (!works(cop)) ev.push(`Cop ${nm(cop.seat)} was blocked — no result.`);
    else ev.push(`Cop ${nm(cop.seat)} checked ${nm(t.seat)}: ${isMafia(t) && t.role !== 'godfather' ? 'MAFIA' : 'not Mafia'}.`);
  }

  const hunter = holder('hunter');
  if (hunter) {
    state.hunterTarget = { by: hunter.seat, target: works(hunter) ? a.hunter || 0 : 0, round: r };
    if (!works(hunter)) ev.push(`Hunter ${nm(hunter.seat)} was blocked — no revenge target until tomorrow night.`);
    else if (a.hunter) ev.push(`Hunter ${nm(hunter.seat)} aimed at ${nm(a.hunter)}.`);
  }

  const attacks = [];
  if (a.kill) { attacks.push({ target: a.kill, by: 'mafia' }); ev.push(`Mafia targeted ${nm(a.kill)}.`); }
  const sk = holder('serialKiller');
  if (sk && a.serialKiller) {
    if (works(sk)) {
      attacks.push({ target: a.serialKiller, by: 'serialKiller' });
      ev.push(`Serial Killer targeted ${nm(a.serialKiller)}.`);
    } else ev.push('Serial Killer was blocked — kill failed.');
  }
  const vig = holder('vigilante');
  if (vig && a.vigilante) {
    if (works(vig)) {
      state.vigBullets--;
      attacks.push({ target: a.vigilante, by: 'vigilante' });
      ev.push(`Vigilante shot at ${nm(a.vigilante)}.`);
    } else ev.push('Vigilante was blocked — shot failed (bullet not used).');
  }

  const toKill = [];
  for (const at of attacks) {
    const src = { mafia: 'Mafia', vigilante: 'Vigilante', serialKiller: 'Serial Killer' }[at.by];
    if (at.target === save) {
      ev.push(`→ Doctor saved ${nm(at.target)} from the ${src}.`);
      continue;
    }
    if (guard && at.target === guard) {
      if (bg.seat === save) {
        ev.push(`→ Bodyguard stepped in for ${nm(at.target)}, and the Doctor saved the Bodyguard.`);
      } else {
        ev.push(`→ Bodyguard ${nm(bg.seat)} died protecting ${nm(at.target)} from the ${src}.`);
        toKill.push({ seat: bg.seat, cause: 'bodyguard' });
      }
      continue;
    }
    toKill.push({ seat: at.target, cause: at.by });
  }

  const deaths = [];
  for (const k of toKill) deaths.push(...killPlayer(k.seat, k.cause));
  for (const dth of deaths) {
    const how = { heartbreak: 'died of heartbreak', hunter: 'was taken down by the Hunter' }[dth.cause] || 'died';
    ev.push(`→ ${nm(dth.seat)} (${roleTag(P(dth.seat))}) ${how}.`);
  }

  state.day.announce = deaths.length
    ? deaths.map(deathLine)
    : ['The sun rises. Miraculously, <b>nobody died</b> last night.'];
  if (state.day.silenced && P(state.day.silenced).alive) {
    state.day.announce.push(`${nm(state.day.silenced)} has been <b>blackmailed</b> — they may not speak or vote today.`);
  }
  if (!ev.length) ev.push('Quiet night — no actions.');

  state.night = null;
  state.log.push({ title: `Day ${r}`, lines: [] });
  state.winner = checkWinner();
}

function dayKill(seat, cause) {
  const deaths = killPlayer(seat, cause);
  for (const dth of deaths) {
    state.day.announce.push(deathLine(dth));
    currentLog().lines.push(deathLine(dth));
  }
  if (state.winner !== 'jester') state.winner = checkWinner();
}

/* ---------- actions ---------- */

const UI_ONLY = new Set(['tab', 'toggleRoles']);

const actions = {
  tab: t => { ui.tab = t; },
  toggleRoles: () => { ui.showRoles = !ui.showRoles; },

  undo: () => {
    const prev = undoStack.pop();
    if (prev) state = JSON.parse(prev);
  },

  newGame: () => {
    if (!confirm('End this game and start a new one? (Your role setup is kept.)')) return false;
    state = freshState(state);
    undoStack = [];
    ui.tab = 'phase';
  },

  players: delta => { state.numPlayers = Math.min(30, Math.max(4, state.numPlayers + Number(delta))); },

  count: arg => {
    const [role, delta] = arg.split(':');
    const n = (state.counts[role] || 0) + Number(delta);
    state.counts[role] = Math.min(ROLES[role].max, Math.max(0, n));
    if (!state.counts[role]) delete state.counts[role];
  },

  startAssign: () => {
    if (setupStats().errors.length) return false;
    startAssign();
  },

  backToSetup: () => { state.screen = 'setup'; },

  reveal: () => {
    const input = document.getElementById('nameInput');
    const p = state.players[state.assignIndex];
    p.name = (input && input.value.trim()) || `Player ${p.seat}`;
    state.revealed = true;
  },

  hideRole: () => {
    state.revealed = false;
    state.assignIndex++;
    if (state.assignIndex >= state.players.length) {
      state.screen = 'game';
      state.round = 1;
      state.vigBullets = state.settings.vigBullets;
      startNight();
    }
  },

  nightPick: seat => {
    seat = Number(seat);
    const n = state.night;
    const key = n.steps[n.step];
    const def = stepDef(key);
    if (def.pick === 'two') {
      let cur = Array.isArray(n.actions[key]) ? n.actions[key].slice() : [];
      if (cur.includes(seat)) cur = cur.filter(s => s !== seat);
      else if (cur.length < 2) cur.push(seat);
      n.actions[key] = cur;
    } else {
      n.actions[key] = n.actions[key] === seat ? undefined : seat;
    }
  },

  nightNone: () => {
    const n = state.night;
    n.actions[n.steps[n.step]] = 0;
  },

  nightBack: () => { if (state.night.step > 0) state.night.step--; },

  nightNext: () => {
    const n = state.night;
    if (n.step === n.steps.length - 1) resolveNight();
    else n.step++;
  },

  lynchSel: seat => { state.day.lynchSel = Number(seat) === state.day.lynchSel ? null : Number(seat); },

  lynch: () => {
    const d = state.day;
    const seat = d.lynchSel;
    if (!seat) return false;
    d.lynchDone = true;
    currentLog().lines.push(`Town voted to execute ${nm(seat)} (${roleTag(P(seat))}).`);
    if (P(seat).role === 'jester') state.winner = 'jester';
    dayKill(seat, 'lynch');
  },

  noLynch: () => {
    state.day.lynchDone = true;
    state.day.lynchSel = null;
    state.day.announce.push('The town could not agree. <b>No one</b> was executed today.');
    currentLog().lines.push('No execution.');
  },

  nextNight: () => {
    state.round++;
    startNight();
  },

  toggleAlive: seat => {
    const p = P(Number(seat));
    if (!confirm(`${p.alive ? 'Kill' : 'Revive'} ${p.name}? (Manual override — no lover/Hunter effects.)`)) return false;
    p.alive = !p.alive;
    p.death = p.alive ? null : { round: state.round, phase: state.phase, cause: 'override' };
    currentLog() && currentLog().lines.push(`Moderator ${p.alive ? 'revived' : 'killed'} ${nm(p.seat)}.`);
    state.winner = checkWinner();
  },
};

root.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const snapshot = JSON.stringify(state);
  const screenBefore = screenKey();
  const result = actions[act](el.dataset.arg);
  if (result !== false && !UI_ONLY.has(act) && act !== 'undo') {
    undoStack.push(snapshot);
    if (undoStack.length > 60) undoStack.shift();
  }
  save();
  render();
  if (screenKey() !== screenBefore) window.scrollTo({ top: 0 });
});

function screenKey() {
  const s = state;
  return [ui.tab, s.screen, s.assignIndex, s.revealed, s.phase, s.round, s.night && s.night.step, s.day && s.day.lynchDone, s.winner].join('|');
}

root.addEventListener('change', e => {
  const el = e.target;
  if (!el.dataset.setting) return;
  const key = el.dataset.setting;
  state.settings[key] = el.type === 'checkbox' ? el.checked : el.dataset.kind === 'text' ? el.value : Number(el.value);
  save();
  render();
});

root.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'nameInput') {
    root.querySelector('[data-act="reveal"]').click();
  }
});

/* ---------- views ---------- */

function render() {
  const y = window.scrollY;
  if (state.screen === 'setup') root.innerHTML = viewSetup();
  else if (state.screen === 'assign') root.innerHTML = viewAssign();
  else root.innerHTML = viewGame();
  window.scrollTo(0, y);
  const input = document.getElementById('nameInput');
  if (input) input.focus();
}

function teamBadge(team) {
  return `<span class="badge ${team}">${TEAM_LABEL[team]}</span>`;
}

function viewSetup() {
  const s = setupStats();
  const rows = ROLE_ORDER.map(r => {
    const role = ROLES[r];
    const n = state.counts[r] || 0;
    const flex = role.flexTeam ? blackmailerTeam() : null;
    const badges = flex === 'random' ? `${teamBadge('mafia')} ${teamBadge('town')}` : teamBadge(flex || role.team);
    return `
      <div class="role-row">
        <div class="role-info">
          <div class="role-name">${role.icon} ${role.name} ${badges}</div>
          <div class="role-desc">${roleDesc(r)}</div>
        </div>
        <div class="stepper">
          <button data-act="count" data-arg="${r}:-1" ${n ? '' : 'disabled'}>−</button>
          <span>${n}</span>
          <button data-act="count" data-arg="${r}:1" ${n >= role.max ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
  }).join('');

  const st = state.settings;
  return `
    <header class="top"><h1>🎭 Mafia Moderator</h1></header>
    <section class="card">
      <h2>Players</h2>
      <div class="role-row">
        <div class="role-info"><div class="role-name">Number of players</div></div>
        <div class="stepper big">
          <button data-act="players" data-arg="-1">−</button>
          <span>${state.numPlayers}</span>
          <button data-act="players" data-arg="1">+</button>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Roles</h2>
      ${rows}
      <div class="role-row">
        <div class="role-info">
          <div class="role-name">${ROLES.villager.icon} Villager ${teamBadge('town')}</div>
          <div class="role-desc">Fills the remaining seats automatically.</div>
        </div>
        <div class="stepper"><span>${Math.max(0, s.villagers)}</span></div>
      </div>
      <div class="totals">
        <span class="badge mafia">Mafia ${s.mafia}</span>
        <span class="badge town">Town ${Math.max(0, s.town)}</span>
        <span class="badge neutral">Neutral ${s.neutral}</span>
      </div>
      ${s.errors.map(e => `<div class="alert error">${e}</div>`).join('')}
      ${s.warnings.map(w => `<div class="alert warn">${w}</div>`).join('')}
    </section>

    <section class="card">
      <h2>Rules</h2>
      <label class="toggle"><input type="checkbox" data-setting="revealOnDeath" ${st.revealOnDeath ? 'checked' : ''}> Reveal role when a player dies</label>
      <label class="toggle"><input type="checkbox" data-setting="night1Kill" ${st.night1Kill ? 'checked' : ''}> Mafia may kill on Night 1</label>
      <label class="toggle">Blackmailer team
        <select data-setting="blackmailerTeam" data-kind="text">${[['random', 'Random'], ['mafia', 'Mafia'], ['town', 'Town']].map(([v, l]) => `<option value="${v}" ${blackmailerTeam() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <label class="toggle">Vigilante bullets
        <select data-setting="vigBullets">${[1, 2, 3].map(n => `<option ${st.vigBullets === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>
    </section>

    <button class="primary block" data-act="startAssign" ${s.errors.length ? 'disabled' : ''}>🎲 Shuffle &amp; hand out roles</button>
  `;
}

function viewAssign() {
  const i = state.assignIndex;
  const p = state.players[i];
  const total = state.players.length;
  const progress = `<div class="progress"><div style="width:${(i / total) * 100}%"></div></div>`;

  if (!state.revealed) {
    return `
      <header class="top"><h1>🎭 Hand out roles</h1></header>
      ${progress}
      <section class="card center">
        <div class="seat-big">Seat ${p.seat}</div>
        <p class="muted">of ${total}</p>
        <p>Hand the phone to the player in <b>seat ${p.seat}</b>.</p>
        <input id="nameInput" class="name-input" placeholder="Enter your name" maxlength="20" autocomplete="off" value="">
        <button class="primary block" data-act="reveal">👁 Reveal my role</button>
      </section>
      ${i === 0 ? `<button class="ghost block" data-act="backToSetup">← Back to setup</button>` : ''}
    `;
  }

  const role = roleOf(p);
  const last = i === total - 1;
  return `
    <header class="top"><h1>🎭 ${esc(p.name)}</h1></header>
    ${progress}
    <section class="card center role-card ${teamOf(p)}">
      <div class="role-icon">${role.icon}</div>
      <div class="role-title">${role.name}</div>
      ${teamBadge(teamOf(p))}
      <p class="role-desc big">${roleDesc(p.role, p.team)}</p>
    </section>
    <button class="primary block" data-act="hideRole">${last ? '✅ Done — hand back to the moderator' : '🙈 Hide &amp; pass to next seat'}</button>
  `;
}

function viewGame() {
  const gameOver = !!state.winner;
  const phaseLabel = gameOver ? 'Game over' : state.phase === 'night' ? `🌙 Night ${state.round}` : `☀️ Day ${state.round}`;
  const tabs = [['phase', state.phase === 'night' ? 'Night' : 'Day'], ['players', 'Players'], ['log', 'Log']];
  let body = '';
  if (ui.tab === 'players') body = viewPlayers();
  else if (ui.tab === 'log') body = viewLog();
  else if (gameOver) body = viewWinner();
  else body = state.phase === 'night' ? viewNight() : viewDay();

  return `
    <header class="top game ${state.phase}">
      <h1>${phaseLabel}</h1>
      <div class="tools">
        <button class="icon" data-act="undo" ${undoStack.length ? '' : 'disabled'} title="Undo">↶</button>
        <button class="icon ${ui.showRoles ? 'on' : ''}" data-act="toggleRoles" title="Show roles in pickers">👁</button>
        <button class="icon" data-act="newGame" title="New game">⟲</button>
      </div>
    </header>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${ui.tab === k ? 'active' : ''}" data-act="tab" data-arg="${k}">${l}</button>`).join('')}</nav>
    ${body}
  `;
}

function picker({ act, selected = [], disabled = () => '', markMafia = false }) {
  return `<div class="grid">${alivePlayers().map(p => {
    const reason = disabled(p);
    const sel = selected.includes(p.seat);
    const tags = [];
    if (ui.showRoles) tags.push(roleTag(p));
    else if (markMafia && isMafia(p)) tags.push('🔪 Mafia');
    if (state.lovers && state.lovers.includes(p.seat) && ui.showRoles) tags.push('💘');
    return `
      <button class="pbtn ${sel ? 'sel' : ''}" data-act="${act}" data-arg="${p.seat}" ${reason ? 'disabled' : ''}>
        <span class="seat">${p.seat}</span>
        <span class="pname">${esc(p.name)}</span>
        ${tags.length ? `<span class="tag">${tags.join(' ')}</span>` : ''}
        ${reason ? `<span class="reason">${reason}</span>` : ''}
      </button>`;
  }).join('')}</div>`;
}

function sayBlock(lines, cls = '') {
  if (!lines.length) return '';
  return `<div class="say ${cls}">${lines.map(l => `<p>📢 “${l}”</p>`).join('')}</div>`;
}

function viewNight() {
  const n = state.night;
  const key = n.steps[n.step];
  const d = stepDef(key);
  const val = n.actions[key];
  const active = d.pick && d.holder;
  const chosen = d.pick === 'two'
    ? (val === 0 || (Array.isArray(val) && val.length === 2))
    : val !== undefined;
  const canNext = !active || chosen;
  const selected = Array.isArray(val) ? val : val ? [val] : [];

  const dots = n.steps.map((s, i) => `<span class="dot ${i < n.step ? 'done' : ''} ${i === n.step ? 'cur' : ''}"></span>`).join('');

  let holderLine = '';
  if (d.holder && key !== 'kill') holderLine = `<div class="holder">Wakes: ${nm(d.holder.seat)} (seat ${d.holder.seat})</div>`;

  let summary = '';
  if (d.summary) {
    const labels = { cupid: 'Cupid', roleblock: 'Block', blackmail: 'Blackmail', kill: 'Mafia kill', serialKiller: 'Serial Killer', doctor: 'Doctor save', bodyguard: 'Bodyguard', cop: 'Cop check', vigilante: 'Vigilante shot', hunter: 'Hunter target' };
    const rows = n.steps.filter(s => labels[s]).map(s => {
      const v = n.actions[s];
      const txt = Array.isArray(v) ? v.map(nm).join(' &amp; ') : v ? nm(v) : '<span class="muted">—</span>';
      return `<li><span>${labels[s]}</span><span>${txt}</span></li>`;
    }).join('');
    summary = `<ul class="summary">${rows}</ul><p class="muted small">Go back to change anything. Results are calculated when the day starts.</p>`;
  }

  return `
    <div class="dots">${dots}</div>
    <section class="card step">
      <div class="step-title"><span class="step-icon">${d.icon}</span>${d.title}</div>
      ${sayBlock(d.say)}
      ${holderLine}
      ${d.notes.map(x => `<div class="alert info">${x}</div>`).join('')}
      ${d.warn.map(x => `<div class="alert warn">${x}</div>`).join('')}
      ${active ? picker({ act: 'nightPick', selected, disabled: d.disabled, markMafia: d.markMafia }) : ''}
      ${active ? `<button class="ghost block ${val === 0 ? 'sel' : ''}" data-act="nightNone">${d.pick === 'two' ? 'No lovers' : 'No action'}</button>` : ''}
      ${d.result || ''}
      ${summary}
      ${sayBlock(d.after, 'after')}
    </section>
    <div class="nav">
      <button class="ghost" data-act="nightBack" ${n.step === 0 ? 'disabled' : ''}>← Back</button>
      <button class="primary" data-act="nightNext" ${canNext ? '' : 'disabled'}>${key === 'dawn' ? '☀️ Start day' : 'Next →'}</button>
    </div>
  `;
}

function viewDay() {
  const d = state.day;
  const secrets = (state.log[state.log.length - 2] || { lines: [] }).lines;

  let action = '';
  if (!d.lynchDone) {
    const silenced = d.silenced && P(d.silenced).alive ? `<div class="alert warn">🤐 ${nm(d.silenced)} cannot speak or vote today.</div>` : '';
    action = `
      <section class="card">
        <h2>🗳️ Discussion &amp; vote</h2>
        ${sayBlock(['Discuss who you suspect. When ready, nominate and vote.'])}
        ${silenced}
        <p class="muted small">Tap the player the town voted to execute.</p>
        ${picker({ act: 'lynchSel', selected: d.lynchSel ? [d.lynchSel] : [] })}
        <div class="nav">
          <button class="ghost" data-act="noLynch">No execution</button>
          <button class="primary danger" data-act="lynch" ${d.lynchSel ? '' : 'disabled'}>Execute${d.lynchSel ? ` ${esc(P(d.lynchSel).name)}` : ''}</button>
        </div>
      </section>`;
  } else {
    action = `<button class="primary block" data-act="nextNight">🌙 Begin Night ${state.round + 1}</button>`;
  }

  return `
    <section class="card narrate">
      <h2>📢 Read aloud</h2>
      ${d.announce.map(l => `<p>${l}</p>`).join('')}
    </section>
    <details class="card secret">
      <summary>🔒 What really happened last night (moderator only)</summary>
      <ul>${secrets.map(l => `<li>${l}</li>`).join('')}</ul>
    </details>
    ${action}
  `;
}

function viewWinner() {
  const text = {
    town: '🏘️ The Town wins!',
    mafia: '🔪 The Mafia wins!',
    jester: '🃏 The Jester wins!',
    lovers: '💘 The Lovers win!',
    serialKiller: '🪓 The Serial Killer wins!',
  }[state.winner];
  const announce = state.day ? `<section class="card narrate"><h2>📢 Read aloud</h2>${state.day.announce.map(l => `<p>${l}</p>`).join('')}</section>` : '';
  return `
    ${announce}
    <section class="card center winner ${state.winner}">
      <div class="role-title">${text}</div>
    </section>
    <section class="card">
      <h2>Final roles</h2>
      ${state.players.map(p => `
        <div class="prow ${p.alive ? '' : 'dead'}">
          <span class="seat">${p.seat}</span>
          <span class="pname">${esc(p.name)}</span>
          <span class="prole">${roleTag(p)}</span>
        </div>`).join('')}
    </section>
    <button class="primary block" data-act="newGame">🎲 New game</button>
  `;
}

function viewPlayers() {
  const silenced = state.phase === 'day' && state.day ? state.day.silenced : 0;
  return `
    <section class="card">
      <h2>Players <span class="muted small">${alivePlayers().length} alive</span></h2>
      ${state.players.map(p => {
        const badges = [];
        if (state.lovers && state.lovers.includes(p.seat)) badges.push('💘');
        if (silenced === p.seat && p.alive) badges.push('🤐');
        const death = p.death ? `<span class="muted small">☠️ ${p.death.phase} ${p.death.round} (${p.death.cause})</span>` : '';
        return `
          <div class="prow ${p.alive ? '' : 'dead'}">
            <span class="seat">${p.seat}</span>
            <span class="pname">${esc(p.name)} ${badges.join('')}<br>${death}</span>
            <span class="prole">${ui.showRoles ? roleTag(p) : '••••'}</span>
            <button class="icon small" data-act="toggleAlive" data-arg="${p.seat}" title="${p.alive ? 'Kill' : 'Revive'}">${p.alive ? '☠️' : '❤️'}</button>
          </div>`;
      }).join('')}
      <p class="muted small">Tap 👁 at the top to show roles. ☠️ / ❤️ are manual overrides.</p>
    </section>
    ${state.settings.vigBullets && inGame('vigilante') ? `<section class="card"><p>🔫 Vigilante bullets left: <b>${state.vigBullets}</b></p></section>` : ''}
  `;
}

function viewLog() {
  const entries = state.log.slice().reverse().filter(e => e.lines.length);
  if (!entries.length) return `<section class="card"><p class="muted">Nothing yet.</p></section>`;
  return entries.map(e => `
    <section class="card">
      <h2>${e.title}</h2>
      <ul class="log">${e.lines.map(l => `<li>${l}</li>`).join('')}</ul>
    </section>`).join('');
}

render();
