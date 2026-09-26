// engine/dashboard/avatars.js
//
// The avatars a player can pick before a game. Part of the dashboard contract:
// a report carries only the `id`, the join screen and the board both draw from
// this list, and an id not in it is reported as no avatar at all.
//
// Pictures shipped with the engine (engine/avatars/), so they look the same on
// every tablet, unlike system emoji. Two sets, chosen by the owner 2026-09-26:
//   - animals: Microsoft Fluent Emoji 3D, MIT licence
//   - kids: DiceBear "Big Smile" by Ashley Seo, CC BY 4.0 (attribution required,
//     shown on the join screen and in engine/avatars/CREDITS.md)
// Adding an avatar is fine; removing or re-meaning an id is a contract change.

const ANIMALS = [
    ['fox', 'Liška'], ['panda', 'Panda'], ['frog', 'Žabka'], ['octopus', 'Chobotnice'],
    ['unicorn', 'Jednorožec'], ['turtle', 'Želva'], ['lion', 'Lev'], ['penguin', 'Tučňák'],
    ['owl', 'Sova'], ['cat', 'Kočka'], ['dog', 'Pejsek'], ['rabbit', 'Zajíček'],
    ['koala', 'Koala'], ['tiger', 'Tygr'], ['dolphin', 'Delfín'], ['dinosaur', 'Dinosaurus'],
];

export const AVATARS = Object.freeze([
    ...ANIMALS.map(([id, label]) => ({id, label, kind: 'animal', file: `${id}.webp`})),
    ...Array.from({length: 16}, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return {id: `kid-${n}`, label: `Postavička ${i + 1}`, kind: 'kid', file: `kid-${n}.svg`};
    }),
].map(Object.freeze));

/** Who made the pictures, for the join screen and the credits file. */
export const AVATAR_CREDITS = 'Obrázky: Microsoft Fluent Emoji (MIT), postavičky Big Smile od Ashley Seo (CC BY 4.0)';

const BY_ID = new Map(AVATARS.map(a => [a.id, a]));

/** The avatar for an id, or null for anything not in the list. */
export function avatarById(id) {
    return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** Where an avatar's picture is, relative to wherever the engine is served from. */
export function avatarSrc(avatar) {
    return new URL(`../avatars/${avatar.file}`, import.meta.url).href;
}
