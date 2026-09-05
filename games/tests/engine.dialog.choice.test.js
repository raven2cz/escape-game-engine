// Two findings from the closing review, both in engine/dialogs.js.
//
// 1. A game that defines no heroes now has none (EI-015), and the neutral hero
//    the engine falls back to is called `hero` - the same id as the character
//    template that `characterId: "hero"` is meant to expand. _findCharacter()
//    looks the hero up by id first, so it found the template itself and returned
//    it raw: the nameplate showed the literal `{heroName}` and the portrait
//    pointed at `{heroBase}neutral.png`.
//
// 2. EI-021 releases the input lock when a dialog ends, which is what makes a
//    dialog opened from another one's ending usable. It also widened a window
//    that was already there: _applyChoice() checks the lock but never that the
//    step it was made for is still the current one. Two different choice buttons
//    tapped inside the 220 ms selection flash - the same button is disabled, a
//    different one is not - and the second one runs against a dialog that has
//    already ended.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness, waitFor } from './helpers/reload.js';

const SCENES = {
    meta: { id: 'choices', version: '1.0.0' },
    startScene: 'roomA',
    scenes: [
        { id: 'roomA', title: 'A', image: 'scenes/a.jpg', hotspots: [] },
        { id: 'roomB', title: 'B', image: 'scenes/b.jpg', hotspots: [] },
    ],
};

const DIALOGS = {
    meta: { id: 'choices' },
    characters: [
        {
            id: 'hero',
            name: '@character.hero.name@Hrdina',
            poses: { neutral: '{heroBase}neutral.png' },
        },
    ],
    dialogs: [
        {
            id: 'fork',
            typewriter: false,
            left: { characterId: 'hero', defaultPose: 'neutral' },
            sequence: [
                {
                    id: 's1',
                    speaker: 'left',
                    text: 'Kudy?',
                    choices: [
                        { label: 'Doleva', onChoose: { end: true, onEnd: { goTo: 'roomB' } } },
                        { label: 'Doprava', onChoose: { setFlags: 'chose_right' } },
                    ],
                },
                { id: 's2', speaker: 'left', text: 'Tak jo.' },
            ],
        },
    ],
};

const boot = () => createReloadHarness({ scenes: SCENES, dialogs: DIALOGS }).boot();

describe('dialogs, closing review', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('does not put the hero template on screen unexpanded', async () => {
        // The game defines no heroes, so there is nothing to expand it with.
        // Showing the template's own name is the honest answer; showing the
        // placeholder text is not.
        const game = await boot();

        game.openDialog('fork');
        await waitFor(() => game.dialogUI.active, { label: 'the dialog' });

        const name = document.querySelector('.dlg-nameplate').textContent;
        expect(name).toBe('Hrdina');
        expect(name).not.toContain('{');

        const portrait = document.querySelector('.dlg-char.left .dlg-char-img');
        expect(portrait.getAttribute('src')).not.toContain('{');
    });

    it('runs one choice, not two', async () => {
        const game = await boot();

        game.openDialog('fork');
        await waitFor(() => document.querySelectorAll('.dlg-choice').length === 2, { label: 'the choices' });

        const [left, right] = document.querySelectorAll('.dlg-choice');
        left.click();
        right.click();

        await waitFor(() => game.state.scene === 'roomB', { label: 'the left branch' });
        await new Promise(res => setTimeout(res, 300)); // past the selection flash

        expect(game.state.flags.chose_right).toBeUndefined();
    });
});
