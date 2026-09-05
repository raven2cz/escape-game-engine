// EI-015: the engine must not be named after one particular game.
//
// The hero fallback was hardcoded to `adam` with `assets/npc/adam/`, which are
// leeuwenhoek's. Every other game - all five of them, none of which defines a
// `heroes` block - therefore stored a phantom hero called Adam whose portraits
// point into another game's asset directory. Mostly it is confusion rather than
// breakage, but it gets worse the moment the games move to their own repository
// and the engine is supposed to stand on its own.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReloadHarness } from './helpers/reload.js';

const withoutHeroes = {
    meta: { id: 'no-heroes', version: '1.0.0' },
    startScene: 'room',
    scenes: [{ id: 'room', title: 'Room', image: 'scenes/room.jpg', hotspots: [] }],
};

const withHeroes = {
    meta: { id: 'with-heroes', version: '1.0.0' },
    startScene: 'room',
    heroes: {
        eva: { id: 'eva', gender: 'f', name: 'Eva', assetsBase: 'assets/npc/eva/' },
        adam: { id: 'adam', gender: 'm', name: 'Adam', assetsBase: 'assets/npc/adam/' },
    },
    defaultHero: 'eva',
    scenes: [{ id: 'room', title: 'Room', image: 'scenes/room.jpg', hotspots: [] }],
};

describe('EI-015: the hero a game did not ask for', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('does not invent one for a game with no heroes', async () => {
        const game = await createReloadHarness({ scenes: withoutHeroes }).boot();

        expect(game.state.hero).toBeNull();
    });

    it('does not point that game at another game\'s portraits', async () => {
        const game = await createReloadHarness({ scenes: withoutHeroes }).boot();

        expect(game.getHero().assetsBase).toBe('');
        expect(JSON.stringify(game.state)).not.toContain('npc/adam');
    });

    it('still uses the hero a game does define', async () => {
        const game = await createReloadHarness({ scenes: withHeroes }).boot();

        expect(game.state.hero.id).toBe('eva');
        expect(game.getHero().assetsBase).toBe('assets/npc/eva/');

        game.setHero('adam');
        expect(game.getHero().assetsBase).toBe('assets/npc/adam/');
    });

    it('does not fall back to another game\'s hero for an id it does not know', async () => {
        // ?hero=nobody used to hand back Adam and leeuwenhoek's asset path.
        const game = await createReloadHarness({ scenes: withHeroes }).boot();

        game.setHero('nobody');

        expect(game.getHero().id).toBe('nobody');
        expect(game.getHero().assetsBase).toBe('');
    });
});
