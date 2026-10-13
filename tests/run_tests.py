"""Runs all gameplay tests in a headless browser.

Usage (from the repo root):
    PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright python3 tests/run_tests.py [fuzz_games]
"""
import os
import random
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(ROOT, 'index.html')
FUZZ_GAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 150

results = []
page_errors = []


def record(name, ok, err=''):
    results.append((name, ok, err))


def ui_test(name):
    def wrap(fn):
        def run(pg):
            try:
                fresh(pg)
                fn(pg)
                record(f'[UI] {name}', True)
            except Exception as e:  # noqa: BLE001
                record(f'[UI] {name}', False, str(e).splitlines()[0])
        run.__name__ = fn.__name__
        UI_TESTS.append(run)
        return run
    return wrap


UI_TESTS = []


def fresh(pg):
    pg.goto(URL)
    pg.evaluate('localStorage.clear()')
    pg.reload()


def set_setup(pg, num, counts):
    pg.evaluate('([n, c]) => { state = freshState(); state.numPlayers = n; state.counts = c; save(); render(); }', [num, counts])


def assign_all(pg, names=None):
    total = pg.evaluate('state.players.length')
    for i in range(total):
        pg.fill('#nameInput', names[i] if names else f'P{i + 1}')
        pg.click('[data-act=reveal]')
        pg.click('[data-act=hideRole]')


def go_to_step(pg, key):
    for _ in range(20):
        if pg.evaluate('state.night.steps[state.night.step]') == key:
            return
        btns = pg.locator('.pbtn:not([disabled])')
        if pg.locator('[data-act=nightNext]').is_disabled():
            pg.click('[data-act=nightNone]')
        pg.click('[data-act=nightNext]')
    raise AssertionError(f'step {key} not reached')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ---------------- UI flow tests ----------------

@ui_test('Too many roles blocks start')
def _(pg):
    set_setup(pg, 4, {'godfather': 1, 'doctor': 1, 'cop': 1, 'jester': 1, 'hunter': 1})
    check('roles for 4 players' in pg.inner_text('#app'), 'missing error text')
    check(pg.locator('[data-act=startAssign]').is_disabled(), 'start should be disabled')


@ui_test('No Mafia blocks start')
def _(pg):
    set_setup(pg, 6, {'doctor': 1})
    check('at least one Mafia' in pg.inner_text('#app'), 'missing error')
    check(pg.locator('[data-act=startAssign]').is_disabled(), 'start should be disabled')


@ui_test('Assistant without main role blocks start')
def _(pg):
    set_setup(pg, 8, {'mafia': 1, 'asstDoctor': 1, 'asstCop': 1})
    txt = pg.inner_text('#app')
    check('Assistant Doctor needs a Doctor' in txt and 'Assistant Cop needs a Cop' in txt, 'missing errors')
    check(pg.locator('[data-act=startAssign]').is_disabled(), 'start should be disabled')


@ui_test('Mafia majority blocks start')
def _(pg):
    set_setup(pg, 4, {'mafia': 2})
    check('outnumber' in pg.inner_text('#app'), 'missing error')


@ui_test('Player count clamps to 4..30')
def _(pg):
    for _ in range(10):
        pg.click('[data-act=players][data-arg="-1"]')
    check(pg.evaluate('state.numPlayers') == 4, 'min not 4')
    for _ in range(30):
        pg.click('[data-act=players][data-arg="1"]')
    check(pg.evaluate('state.numPlayers') == 30, 'max not 30')


@ui_test('Unique roles capped at 1, Mafia can be multiple')
def _(pg):
    check(pg.locator('[data-act=count][data-arg="godfather:1"]').is_disabled(), 'godfather + should be disabled at 1')
    pg.click('[data-act=count][data-arg="mafia:1"]')
    pg.click('[data-act=count][data-arg="mafia:1"]')
    check(pg.evaluate('state.counts.mafia') == 3, 'mafia should allow 3')


@ui_test('Settings toggles persist')
def _(pg):
    pg.uncheck('[data-setting=revealOnDeath]')
    pg.select_option('[data-setting=vigBullets]', '3')
    pg.reload()
    check(pg.evaluate('state.settings.revealOnDeath') is False, 'reveal not saved')
    check(pg.evaluate('state.settings.vigBullets') == 3, 'bullets not saved')


@ui_test('Role handout: blank name defaults, Enter reveals, roles match setup')
def _(pg):
    set_setup(pg, 10, {'godfather': 1, 'mafia': 1, 'doctor': 1, 'cop': 1, 'jester': 1})
    pg.click('[data-act=startAssign]')
    pg.fill('#nameInput', '')
    pg.click('[data-act=reveal]')
    check(pg.evaluate('state.players[0].name') == 'Player 1', 'blank name not defaulted')
    pg.click('[data-act=hideRole]')
    pg.fill('#nameInput', 'Zed')
    pg.press('#nameInput', 'Enter')
    check(pg.locator('.role-card').count() == 1, 'Enter did not reveal')
    pg.click('[data-act=hideRole]')
    roles = sorted(pg.evaluate('state.players.map(p => p.role)'))
    check(roles == sorted(['godfather', 'mafia', 'doctor', 'cop', 'jester'] + ['villager'] * 5), f'roles {roles}')


@ui_test('Role card hides before passing on')
def _(pg):
    pg.click('[data-act=startAssign]')
    pg.fill('#nameInput', 'A')
    pg.click('[data-act=reveal]')
    pg.click('[data-act=hideRole]')
    check(pg.locator('.role-card').count() == 0, 'role still visible')
    check('Seat 2' in pg.inner_text('#app'), 'not on seat 2')


@ui_test('Night: Next disabled until a choice; No action enables it')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'kill')
    check(pg.locator('[data-act=nightNext]').is_disabled(), 'Next should be disabled')
    pg.click('[data-act=nightNone]')
    check(not pg.locator('[data-act=nightNext]').is_disabled(), 'Next should be enabled')


@ui_test('Night: Back keeps earlier selections')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'kill')
    pg.locator('.pbtn').nth(2).click()
    pg.click('[data-act=nightNext]')
    pg.click('[data-act=nightBack]')
    check(pg.locator('.pbtn.sel').count() == 1, 'selection lost')


@ui_test('Night: reload mid-night resumes same step and picks')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'kill')
    pg.locator('.pbtn').nth(1).click()
    before = pg.evaluate('JSON.stringify(state.night)')
    pg.reload()
    check(pg.evaluate('JSON.stringify(state.night)') == before, 'night state changed after reload')
    check(pg.locator('.pbtn.sel').count() == 1, 'selection not shown after reload')


@ui_test('Night: kill picker marks Mafia members')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'kill')
    check(pg.locator('.pbtn', has_text='🔪 Mafia').count() == 2, 'mafia not marked')


@ui_test('Night: Cop result appears on screen')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'cop')
    pg.locator('.pbtn:not([disabled])').first.click()
    check(pg.locator('.result').count() == 1, 'no cop result')


@ui_test('Day: Undo reverses an execution')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'dawn')
    pg.click('[data-act=nightNext]')
    alive = pg.evaluate('alivePlayers().length')
    pg.locator('.pbtn').first.click()
    pg.click('[data-act=lynch]')
    check(pg.evaluate('alivePlayers().length') == alive - 1, 'lynch failed')
    pg.click('[data-act=undo]')
    check(pg.evaluate('alivePlayers().length') == alive, 'undo did not restore')


@ui_test('Day: moderator-only panel and blackmail warning')
def _(pg):
    set_setup(pg, 8, {'mafia': 1, 'blackmailer': 1, 'doctor': 1})
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    go_to_step(pg, 'blackmail')
    target = pg.evaluate("state.players.find(p => p.role === 'villager').seat")
    pg.click(f'.pbtn[data-arg="{target}"]')
    go_to_step(pg, 'dawn')
    pg.click('[data-act=nightNext]')
    check(pg.locator('details.secret').count() == 1, 'no moderator panel')
    check('cannot speak or vote' in pg.inner_text('#app'), 'no blackmail warning')


@ui_test('Players tab: manual kill and revive')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    pg.click('[data-act=tab][data-arg=players]')
    pg.locator('[data-act=toggleAlive]').first.click()
    check(not pg.evaluate('state.players[0].alive'), 'not killed')
    pg.locator('[data-act=toggleAlive]').first.click()
    check(pg.evaluate('state.players[0].alive'), 'not revived')


@ui_test('Roles hidden on Players tab until eye toggled')
def _(pg):
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    pg.click('[data-act=tab][data-arg=players]')
    check('••••' in pg.inner_text('#app'), 'roles visible by default')
    pg.click('[data-act=toggleRoles]')
    check('••••' not in pg.inner_text('#app'), 'roles not shown after toggle')


@ui_test('New game keeps the role setup')
def _(pg):
    set_setup(pg, 9, {'godfather': 1, 'mafia': 1, 'hunter': 1})
    pg.click('[data-act=startAssign]')
    assign_all(pg)
    pg.click('[data-act=newGame]')
    check(pg.evaluate('state.screen') == 'setup', 'not back on setup')
    check(pg.evaluate('state.numPlayers') == 9 and pg.evaluate('state.counts.hunter') == 1, 'setup lost')


# ---------------- random full games ----------------

SPECIALS = ['doctor', 'asstDoctor', 'cop', 'asstCop', 'bodyguard', 'vigilante', 'hunter', 'cupid', 'jester', 'serialKiller']
MAFIA_EXTRAS = ['godfather', 'roleblocker', 'blackmailer']

INVARIANTS = r"""() => {
  const alive = alivePlayers();
  const errs = [];
  for (const p of state.players) {
    if (!p.alive && !p.death) errs.push(`dead player ${p.seat} without death info`);
    if (p.alive && p.death) errs.push(`alive player ${p.seat} with death info`);
  }
  const m = alive.filter(isMafia).length;
  const sk = alive.some(p => p.role === 'serialKiller');
  const w = state.winner;
  if (w === null && checkWinner() !== null) errs.push(`winner missed: ${checkWinner()}`);
  if (w === 'town' && (m > 0 || sk)) errs.push('town won with killers alive');
  if (w === 'mafia' && (sk || m < alive.length - m)) errs.push('mafia won without parity');
  if (w === 'serialKiller' && (!sk || alive.length > 2)) errs.push('bad SK win');
  if (w === 'lovers' && !(alive.length === 2 && alive.every(p => state.lovers.includes(p.seat)))) errs.push('bad lovers win');
  if (w === 'jester' && !state.players.some(p => p.role === 'jester' && p.death && p.death.cause === 'lynch')) errs.push('bad jester win');
  if (state.lovers) {
    const [a, b] = state.lovers.map(P);
    if (a.alive !== b.alive && !(a.death && a.death.cause === 'override') && !(b.death && b.death.cause === 'override')) errs.push('lovers split');
  }
  if (state.vigBullets < 0) errs.push('negative bullets');
  return errs.join('; ');
}"""


def random_setup(rng):
    for _ in range(100):
        n = rng.randint(5, 16)
        counts = {}
        mafia_total = max(1, round(n / 4) + rng.choice([-1, 0, 0, 1]))
        extras = rng.sample(MAFIA_EXTRAS, k=min(len(MAFIA_EXTRAS), rng.randint(0, mafia_total)))
        for r in extras:
            counts[r] = 1
        if mafia_total - len(extras) > 0:
            counts['mafia'] = mafia_total - len(extras)
        for r in rng.sample(SPECIALS, k=rng.randint(0, min(len(SPECIALS), n - mafia_total - 1))):
            counts[r] = 1
        settings = {
            'revealOnDeath': rng.random() < 0.7,
            'night1Kill': rng.random() < 0.8,
            'doctorSelf': rng.random() < 0.5,
            'vigBullets': rng.randint(1, 3),
        }
        yield n, counts, settings


def play_random_game(pg, rng, game_no):
    for n, counts, settings in random_setup(rng):
        pg.evaluate('([n, c, s]) => { state = freshState(); state.numPlayers = n; state.counts = c; state.settings = s; save(); render(); }', [n, counts, settings])
        if not pg.evaluate('setupStats().errors.length'):
            break
    pg.click('[data-act=startAssign]')
    names = [rng.choice(['', 'Ana', 'Bob <b>', 'Çelik', 'O\'Neil', '"Q"', 'Lee & Co', 'x' * 20]) for _ in range(n)]
    assign_all(pg, names)
    if rng.random() < 0.5:
        pg.click('[data-act=toggleRoles]')

    for rnd in range(40):
        # night
        while pg.locator('[data-act=nightNext]').count():
            if rng.random() < 0.05:
                pg.reload()
            if rng.random() < 0.08 and not pg.locator('[data-act=nightBack]').is_disabled():
                pg.click('[data-act=nightBack]')
                continue
            title = pg.locator('.step-title').inner_text()
            btns = pg.locator('.pbtn:not([disabled])')
            k = btns.count()
            if k:
                if rng.random() < 0.15:
                    pg.click('[data-act=nightNone]')
                elif 'Cupid' in title and k >= 2:
                    a, b = rng.sample(range(k), 2)
                    btns.nth(a).click()
                    btns.nth(b).click()
                else:
                    btns.nth(rng.randrange(k)).click()
            next_btn = pg.locator('[data-act=nightNext]')
            if next_btn.is_disabled():
                pg.click('[data-act=nightNone]')
            next_btn.click()

        err = pg.evaluate(INVARIANTS)
        if err:
            raise AssertionError(f'after night {rnd + 1}: {err}')
        if pg.locator('.winner').count():
            return pg.evaluate('state.winner'), rnd + 1

        # day
        if rng.random() < 0.15:
            pg.click('[data-act=noLynch]')
        else:
            pg.locator('.pbtn').nth(rng.randrange(pg.locator('.pbtn').count())).click()
            pg.click('[data-act=lynch]')
            if rng.random() < 0.1:
                pg.click('[data-act=undo]')
                check(pg.evaluate('!state.day.lynchDone'), 'undo did not reopen the vote')
                if pg.locator('[data-act=lynch]').is_disabled():
                    pg.locator('.pbtn').first.click()
                pg.click('[data-act=lynch]')
        err = pg.evaluate(INVARIANTS)
        if err:
            raise AssertionError(f'after day {rnd + 1}: {err}')
        if pg.locator('.winner').count():
            return pg.evaluate('state.winner'), rnd + 1
        if rng.random() < 0.3:
            pg.click('[data-act=tab][data-arg=log]')
            pg.click('[data-act=tab][data-arg=players]')
            pg.click('[data-act=tab][data-arg=phase]')
        pg.click('[data-act=nextNight]')
    raise AssertionError('game did not finish in 40 rounds')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport={'width': 400, 'height': 860})
        pg.set_default_timeout(5000)
        pg.on('pageerror', lambda e: page_errors.append(str(e)))
        pg.on('dialog', lambda d: d.accept())

        fresh(pg)
        with open(os.path.join(ROOT, 'tests', 'rules.test.js')) as f:
            for r in pg.evaluate(f.read()):
                record(f'[Rules] {r["name"]}', r['ok'], r.get('err', ''))

        for t in UI_TESTS:
            t(pg)

        winners = {}
        rng = random.Random(20261013)
        fuzz_fail = 0
        for g in range(FUZZ_GAMES):
            fresh(pg)
            try:
                w, rounds = play_random_game(pg, rng, g)
                winners[w] = winners.get(w, 0) + 1
            except Exception as e:  # noqa: BLE001
                fuzz_fail += 1
                record(f'[Random game #{g + 1}]', False, str(e).splitlines()[0])
        record(f'[Random] {FUZZ_GAMES} full games finished, winners: {winners}', fuzz_fail == 0)
        browser.close()

    record('No JavaScript errors in the page', not page_errors, '; '.join(page_errors[:3]))

    failed = [r for r in results if not r[1]]
    for name, ok, err in results:
        print(('PASS ' if ok else 'FAIL ') + name + (f'  ->  {err}' if err else ''))
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
