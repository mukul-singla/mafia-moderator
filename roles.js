'use strict';

const ROLES = {
  godfather: {
    name: 'Godfather', team: 'mafia', icon: '🎩', max: 1,
    desc: 'Leader of the Mafia. Each night you and the Mafia choose someone to kill. You appear INNOCENT to the Cop.',
  },
  mafia: {
    name: 'Mafia', team: 'mafia', icon: '🔪', max: 10,
    desc: 'Each night, wake with the Mafia and agree on someone to kill. Win when the Mafia equal or outnumber everyone else.',
  },
  roleblocker: {
    name: 'Role Blocker', team: 'mafia', icon: '🚫', max: 1,
    desc: 'Mafia. Each night, choose a player — their night ability fails tonight. You also help choose the Mafia kill.',
  },
  blackmailer: {
    name: 'Blackmailer', team: 'mafia', icon: '🤐', max: 1,
    desc: 'Mafia. Each night, choose a player — they cannot speak or vote the next day. You also help choose the Mafia kill.',
  },
  doctor: {
    name: 'Doctor', team: 'town', icon: '🩺', max: 1,
    desc: 'Each night, choose a player to save from death. You cannot save the same player two nights in a row.',
  },
  asstDoctor: {
    name: 'Assistant Doctor', team: 'town', icon: '💉', max: 1, requires: 'doctor',
    desc: 'You have no power while the Doctor lives. If the Doctor dies, you become the new Doctor.',
  },
  cop: {
    name: 'Cop', team: 'town', icon: '🕵️', max: 1,
    desc: 'Each night, investigate a player to learn whether they are Mafia. The Godfather appears innocent.',
  },
  asstCop: {
    name: 'Assistant Cop', team: 'town', icon: '🔎', max: 1, requires: 'cop',
    desc: 'You have no power while the Cop lives. If the Cop dies, you become the new Cop.',
  },
  bodyguard: {
    name: 'Bodyguard', team: 'town', icon: '🛡️', max: 1,
    desc: 'Each night, protect another player. If they are attacked, you die in their place. You cannot protect the same player two nights in a row.',
  },
  vigilante: {
    name: 'Vigilante', team: 'town', icon: '🔫', max: 1,
    desc: 'You have a limited number of bullets. At night you may choose to shoot a player.',
  },
  hunter: {
    name: 'Hunter', team: 'town', icon: '🏹', max: 1,
    desc: 'Each night, choose a player. If you die — by any means — before your next choice, that player dies with you.',
  },
  cupid: {
    name: 'Cupid', team: 'town', icon: '💘', max: 1,
    desc: 'On the first night, choose two players to fall in love. If one lover dies, the other dies of heartbreak. If the lovers are the last two alive, they win together.',
  },
  jester: {
    name: 'Jester', team: 'neutral', icon: '🃏', max: 1,
    desc: 'You win — alone — if the town votes to execute you during the day. Act suspicious!',
  },
  serialKiller: {
    name: 'Serial Killer', team: 'neutral', icon: '🪓', max: 1,
    desc: 'You work alone. Each night, choose one player to kill. You win if you are one of the last two players alive. The Cop sees you as not Mafia.',
  },
  villager: {
    name: 'Villager', team: 'town', icon: '🧑‍🌾', max: 99,
    desc: 'No special ability. Use discussion and your vote to find and execute the Mafia.',
  },
};

const ROLE_ORDER = [
  'godfather', 'mafia', 'roleblocker', 'blackmailer',
  'doctor', 'asstDoctor', 'cop', 'asstCop', 'bodyguard', 'vigilante', 'hunter', 'cupid',
  'jester', 'serialKiller',
];

const TEAM_LABEL = { mafia: 'Mafia', town: 'Town', neutral: 'Neutral' };
