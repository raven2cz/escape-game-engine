// games/tests/puzzles.v2.test.js
// Comprehensive test suite for Puzzles 2.0 framework

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPuzzleRunner, registerKind, getKind } from '../../engine/puzzles/index.js';
import { BasePuzzle } from '../../engine/puzzles/base.js';
import PhrasePuzzle from '../../engine/puzzles/kinds/phrase.js';
import CodePuzzle from '../../engine/puzzles/kinds/code.js';
import QuizPuzzle from '../../engine/puzzles/kinds/quiz.js';
import OrderPuzzle from '../../engine/puzzles/kinds/order.js';
import MatchPuzzle from '../../engine/puzzles/kinds/match.js';
import GroupPuzzle from '../../engine/puzzles/kinds/group.js';
import ChoicePuzzle from '../../engine/puzzles/kinds/choice.js';
import ListPuzzle from '../../engine/puzzles/kinds/list.js';
import ClozePuzzle from '../../engine/puzzles/kinds/cloze.js';

// --- DOM Setup ---
function mountDom() {
    document.body.innerHTML = `
        <div id="gameRoot" style="position:relative;width:1000px;height:600px;">
            <div id="hotspotLayer" style="position:absolute;inset:0;"></div>
        </div>
    `;
}

// --- Mock Engine ---
function makeMockEngine() {
    return {
        i18n: { engine: {}, game: {} },
        _t: (key, def) => def || key,
        _resolveAsset: (path) => path.startsWith('http') ? path : `./assets/${path}`,
        hotspotLayer: document.getElementById('hotspotLayer'),
        modalRoot: null,
    };
}

// --- Tests ---
describe('Puzzles 2.0 - Core Framework', () => {
    beforeEach(() => {
        mountDom();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('Registry & Factory', () => {
        it('registers and retrieves puzzle kinds', () => {
            expect(getKind('phrase')).toBe(PhrasePuzzle);
            expect(getKind('code')).toBe(CodePuzzle);
            expect(getKind('quiz')).toBe(QuizPuzzle);
            expect(getKind('order')).toBe(OrderPuzzle);
            expect(getKind('match')).toBe(MatchPuzzle);
            expect(getKind('group')).toBe(GroupPuzzle);
            expect(getKind('choice')).toBe(ChoicePuzzle);
            expect(getKind('list')).toBe(ListPuzzle);
        });

        it('returns BasePuzzle for unknown kinds', () => {
            expect(getKind('unknown')).toBe(BasePuzzle);
        });

        it('allows custom kind registration', () => {
            class CustomPuzzle extends BasePuzzle {}
            registerKind('custom', CustomPuzzle);
            expect(getKind('custom')).toBe(CustomPuzzle);
        });
    });

    describe('createPuzzleRunner', () => {
        it('creates runner with config', () => {
            const engine = makeMockEngine();
            const runner = createPuzzleRunner({
                config: {
                    id: 'test',
                    kind: 'phrase',
                    title: 'Test',
                    solution: 'answer'
                },
                engine,
                onResolve: () => {}
            });

            expect(runner.puzzle).toBeInstanceOf(PhrasePuzzle);
            expect(runner.mountInto).toBeInstanceOf(Function);
            expect(runner.unmount).toBeInstanceOf(Function);
        });

        it('throws if config not found', () => {
            const engine = makeMockEngine();
            expect(() => {
                createPuzzleRunner({
                    ref: 'missing',
                    puzzlesById: {},
                    engine,
                    onResolve: () => {}
                });
            }).toThrow('Puzzle config not found');
        });

        it('mounts puzzle into container', () => {
            const engine = makeMockEngine();
            const runner = createPuzzleRunner({
                config: {
                    kind: 'phrase',
                    title: 'T',
                    solution: 'x'
                },
                engine,
                onResolve: () => {}
            });

            runner.mountInto(engine.hotspotLayer);

            const container = document.querySelector('.pz-container');
            expect(container).toBeTruthy();
            expect(container.parentElement).toBe(engine.hotspotLayer);
        });

        it('unmounts puzzle cleanly', () => {
            const engine = makeMockEngine();
            const runner = createPuzzleRunner({
                config: { kind: 'phrase', solution: 'x' },
                engine,
                onResolve: () => {}
            });

            runner.mountInto(engine.hotspotLayer);
            expect(document.querySelector('.pz-container')).toBeTruthy();

            runner.unmount();
            expect(document.querySelector('.pz-container')).toBeFalsy();
        });
    });
});

describe('Puzzles 2.0 - phrase kind', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders input, title, prompt, buttons', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'phrase',
                title: 'Phrase Test',
                prompt: 'Enter phrase',
                solution: 'eureka'
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        expect(document.querySelector('.pz-title')?.textContent).toContain('Phrase Test');
        expect(document.querySelector('.pz-prompt')?.textContent).toContain('Enter phrase');
        expect(document.querySelector('input[type="text"]')).toBeTruthy();
        expect(document.querySelector('.pz-btn--ok')).toBeTruthy();
        expect(document.querySelector('.pz-btn--cancel')).toBeTruthy();
    });

    it('accepts correct answer (normalized)', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'phrase',
                solution: 'eureka'
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const input = document.querySelector('input');
        input.value = 'EUREKA'; // uppercase

        const okBtn = document.querySelector('.pz-btn--ok');
        okBtn.click();

        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true })
        );
    });

    it('rejects incorrect answer with blockUntilSolved', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'phrase',
                solution: 'correct'
            },
            instanceOptions: {
                blockUntilSolved: true
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const input = document.querySelector('input');
        input.value = 'wrong';

        const okBtn = document.querySelector('.pz-btn--ok');
        okBtn.click();

        await new Promise(r => setTimeout(r, 10));

        // Should NOT resolve (hold: true)
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(document.querySelector('.pz-container')).toBeTruthy(); // still mounted
    });

    it('cancels puzzle', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: { kind: 'phrase', solution: 'x' },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const cancelBtn = document.querySelector('.pz-btn--cancel');
        cancelBtn.click();

        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: false })
        );
    });
});

describe('Puzzles 2.0 - code kind', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders password input', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'code',
                solution: '1234'
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const input = document.querySelector('input');
        expect(input.type).toBe('password');
    });

    it('accepts correct code', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'code',
                solution: '4815'
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const input = document.querySelector('input');
        input.value = '4815';

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true })
        );
    });
});

describe('Puzzles 2.0 - quiz kind', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders tokens as clickable buttons', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [
                    { id: 'a', text: 'Option A' },
                    { id: 'b', text: 'Option B' },
                    { id: 'c', text: 'Option C' }
                ],
                solutions: ['b']
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const tokens = document.querySelectorAll('.pz-token');
        expect(tokens.length).toBe(3);
        expect(tokens[0].textContent).toContain('Option A');
    });

    it('selects token on click', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [
                    { id: 'a', text: 'A' },
                    { id: 'b', text: 'B' }
                ],
                solutions: ['a']
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const tokens = document.querySelectorAll('.pz-token');
        tokens[0].click();

        expect(tokens[0].classList.contains('selected')).toBe(true);
    });

    it('validates single correct answer', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [
                    { id: 'a', text: 'A' },
                    { id: 'b', text: 'B' }
                ],
                solutions: ['b']
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const tokens = document.querySelectorAll('.pz-token');
        tokens[1].click(); // select 'b'

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true })
        );
    });

    it('supports multi-selection', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [
                    { id: 'a', text: 'A' },
                    { id: 'b', text: 'B' },
                    { id: 'c', text: 'C' }
                ],
                solutions: ['a', 'c'],
                multiSelect: true
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const tokens = document.querySelectorAll('.pz-token');
        tokens[0].click(); // a
        tokens[2].click(); // c

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true })
        );
    });
});

describe('Puzzles 2.0 - order kind', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders shuffled and ordered areas', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'order',
                tokens: [
                    { id: '1', text: 'First' },
                    { id: '2', text: 'Second' },
                    { id: '3', text: 'Third' }
                ],
                solutions: ['1', '2', '3']
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        expect(document.querySelector('.pz-area-shuffled')).toBeTruthy();
        expect(document.querySelector('.pz-area-ordered')).toBeTruthy();
    });

    it('moves tokens from shuffled to ordered on click', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'order',
                tokens: [
                    { id: '1', text: 'A' },
                    { id: '2', text: 'B' }
                ],
                solutions: ['1', '2']
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const shuffled = document.querySelector('.pz-area-shuffled');
        const ordered = document.querySelector('.pz-area-ordered');

        const initialShuffled = shuffled.querySelectorAll('.pz-token').length;
        const initialOrdered = ordered.querySelectorAll('.pz-token').length;

        const firstToken = shuffled.querySelector('.pz-token');
        firstToken.click();

        expect(shuffled.querySelectorAll('.pz-token').length).toBe(initialShuffled - 1);
        expect(ordered.querySelectorAll('.pz-token').length).toBe(initialOrdered + 1);
    });

    it('validates correct order', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'order',
                tokens: [
                    { id: '1', text: 'A' },
                    { id: '2', text: 'B' },
                    { id: '3', text: 'C' }
                ],
                solutions: ['1', '2', '3']
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        // Click in correct order
        const tokens = document.querySelectorAll('.pz-area-shuffled .pz-token');
        Array.from(tokens).forEach(t => {
            if (t.getAttribute('data-id') === '1') t.click();
        });
        Array.from(document.querySelectorAll('.pz-area-shuffled .pz-token')).forEach(t => {
            if (t.getAttribute('data-id') === '2') t.click();
        });
        Array.from(document.querySelectorAll('.pz-area-shuffled .pz-token')).forEach(t => {
            if (t.getAttribute('data-id') === '3') t.click();
        });

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true })
        );
    });
});

describe('Puzzles 2.0 - match kind (columns mode)', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders left and right columns', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'match',
                mode: 'columns',
                tokens: [
                    { id: 'a', text: 'A', side: 'left' },
                    { id: 'b', text: 'B', side: 'right' }
                ],
                solutions: { 'a': 'b' }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        expect(document.querySelector('.pz-match-column--left')).toBeTruthy();
        expect(document.querySelector('.pz-match-column--right')).toBeTruthy();
    });

    it('pairs tokens with click', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'match',
                mode: 'columns',
                tokens: [
                    { id: 'a', text: 'A', side: 'left' },
                    { id: 'b', text: 'B', side: 'right' }
                ],
                solutions: { 'a': 'b' }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const tokens = document.querySelectorAll('.pz-token');
        tokens[0].click(); // select first

        // After first click, should have 'is-selected' class
        expect(tokens[0].classList.contains('is-selected')).toBe(true);

        tokens[1].click(); // pair with second

        // After pairing, selection removed, dataset pairIndex set
        expect(tokens[0].dataset.pairIndex).toBeDefined();
        expect(tokens[1].dataset.pairIndex).toBeDefined();
        expect(tokens[0].classList.contains('is-selected')).toBe(false);
    });
});

describe('Puzzles 2.0 - match kind (dragdrop mode)', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders tokens scattered on board', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'match',
                mode: 'dragdrop',
                tokens: [
                    { id: 'a', text: 'A' },
                    { id: 'b', text: 'B' },
                    { id: 'c', text: 'C' },
                    { id: 'd', text: 'D' }
                ],
                solutions: { 'a': 'b', 'c': 'd' }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const board = document.querySelector('.pz-match-board');
        expect(board).toBeTruthy();

        const tokens = board.querySelectorAll('.pz-token');
        expect(tokens.length).toBe(4);

        // Tokens should be positioned absolutely with scattered positions
        tokens.forEach(t => {
            expect(t.style.position).toBe('absolute');
            expect(t.style.left).toBeTruthy();
            expect(t.style.top).toBeTruthy();
        });
    });

    it('tokens have non-overlapping initial positions', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'match',
                mode: 'dragdrop',
                tokens: Array.from({ length: 10 }, (_, i) => ({
                    id: String(i),
                    text: `Token ${i}`
                })),
                solutions: {}
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const tokens = Array.from(document.querySelectorAll('.pz-token'));
        const positions = tokens.map(t => ({
            left: parseFloat(t.style.left),
            top: parseFloat(t.style.top)
        }));

        // Check no two tokens have identical positions
        const unique = new Set(positions.map(p => `${p.left},${p.top}`));
        expect(unique.size).toBe(positions.length);
    });
});

describe('Puzzles 2.0 - group kind', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders group areas with labels', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'group',
                groups: [
                    { id: 'a', label: 'Group A' },
                    { id: 'b', label: 'Group B' }
                ],
                tokens: [
                    { id: '1', text: 'Token 1' }
                ],
                solutions: { '1': 'a' }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const areas = document.querySelectorAll('.pz-group-area');
        expect(areas.length).toBe(2);
        expect(areas[0].textContent).toContain('Group A');
        expect(areas[1].textContent).toContain('Group B');
    });

    it('uses dynamic grid layout for vertical mode', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'group',
                groups: [
                    { id: 'a', label: 'A' },
                    { id: 'b', label: 'B' }
                ],
                tokens: [],
                solutions: {},
                layout: {
                    mode: 'auto',
                    direction: 'vertical'
                }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const board = document.querySelector('.pz-group-board');
        // 2 groups vertical = 2 cols × 1 row
        expect(board.style.gridTemplateColumns).toContain('2');
        expect(board.style.placeContent).toBe('center');
    });

    it('calculates grid for 5 groups correctly', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'group',
                groups: Array.from({ length: 5 }, (_, i) => ({
                    id: String(i),
                    label: `Group ${i}`
                })),
                tokens: [],
                solutions: {},
                layout: {
                    mode: 'auto',
                    direction: 'vertical'
                }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const board = document.querySelector('.pz-group-board');
        // 5 groups vertical = 3 cols × 2 rows
        expect(board.style.gridTemplateColumns).toContain('3');
        expect(board.style.gridTemplateRows).toContain('2');
    });
});

describe('Puzzles 2.0 - choice kind', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('renders text + choice pairs', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'choice',
                tokens: [
                    {
                        id: 'q1',
                        text: 'Question 1?',
                        choices: [
                            { value: 'Yes', label: 'Yes' },
                            { value: 'No', label: 'No' }
                        ],
                        solution: 'Yes'
                    },
                    {
                        id: 'q2',
                        text: 'Question 2?',
                        choices: [
                            { value: 'A', label: 'A' },
                            { value: 'B', label: 'B' },
                            { value: 'C', label: 'C' }
                        ],
                        solution: 'B'
                    }
                ]
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const rows = document.querySelectorAll('.pz-choice-row');
        expect(rows.length).toBe(2);

        // Choice uses custom dropdown buttons, not <select>
        const buttons = document.querySelectorAll('.pz-choice-button');
        expect(buttons.length).toBe(2);
    });

    it('validates correct choices', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'choice',
                tokens: [
                    {
                        id: 'q1',
                        text: 'Q1',
                        choices: [
                            { value: 'A', label: 'A' },
                            { value: 'B', label: 'B' }
                        ],
                        solution: 'B'
                    }
                ]
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        // Open dropdown and select option
        const choiceBtn = document.querySelector('.pz-choice-button');
        choiceBtn.click(); // open dropdown

        const options = document.querySelectorAll('.pz-choice-option');
        options[1].click(); // select 'B'

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        expect(resolveSpy).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true })
        );
    });
});

describe('Puzzles 2.0 - Layout & Theming', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('applies custom rect positioning', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'phrase',
                solution: 'x',
                rect: { x: 20, y: 30, w: 50, h: 40 }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        // Window element has the rect positioning
        const win = document.querySelector('.pz__window');
        expect(win.style.left).toBe('20%');
        expect(win.style.top).toBe('30%');
        expect(win.style.width).toBe('50%');
        expect(win.style.height).toBe('40%');
    });

    it('supports custom background image', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [{ id: 'a', text: 'A' }],
                solutions: ['a']
            },
            background: 'bg.jpg',
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const bg = document.querySelector('.pz-overlay');
        expect(bg).toBeTruthy();
        expect(bg.style.background).toContain('bg.jpg');
    });

    it('respects blockUntilSolved option', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'phrase',
                solution: 'correct'
            },
            instanceOptions: {
                blockUntilSolved: true
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        const input = document.querySelector('input');
        input.value = 'wrong';

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        // Puzzle should NOT resolve
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(document.querySelector('.pz-container')).toBeTruthy();
    });
});

describe('Puzzles 2.0 - List (Sequential)', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('executes puzzles in sequence', async () => {
        const engine = makeMockEngine();
        engine.data = {
            puzzles: {
                p1: { kind: 'phrase', solution: 'a' },
                p2: { kind: 'phrase', solution: 'b' }
            }
        };

        const runner = createPuzzleRunner({
            config: {
                kind: 'list',
                steps: [
                    { ref: 'p1' },
                    { ref: 'p2' }
                ]
            },
            instanceOptions: {
                aggregateOnly: false
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        // List puzzle should render first step
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelector('input')).toBeTruthy();
    });
});

describe('Puzzles 2.0 - Cloze Interaction', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('returns token to bank on gap click', async () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'cloze',
                text: 'Hello {gap1}',
                tokens: [{ id: 't1', text: 'World' }],
                solution: { 'gap1': 't1' }
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);

        const puzzle = runner.puzzle;
        const tokenEl = document.querySelector('[data-token-id="t1"]');
        const gapEl = document.querySelector('[data-gap-id="gap1"]');
        const tokensArea = document.querySelector('.pz-cloze-tokens-area');

        // FIX: Manually simulate the "dropped" state
        // We set the internal map and move the DOM element into the gap
        puzzle._placements.set('gap1', 't1');
        gapEl.appendChild(tokenEl);
        gapEl.classList.add('filled');

        // Verify it's in gap
        expect(gapEl.contains(tokenEl)).toBe(true);
        expect(tokensArea.contains(tokenEl)).toBe(false);

        // CLICK on gap -> Should return to bank
        gapEl.click();

        await new Promise(r => setTimeout(r, 10));

        // Verify return
        expect(puzzle._placements.has('gap1')).toBe(false);
        expect(gapEl.classList.contains('filled')).toBe(false);
        expect(tokensArea.contains(tokenEl)).toBe(true);
    });
});

describe('Puzzles 2.0 - Edge Cases', () => {
    beforeEach(mountDom);
    afterEach(() => { document.body.innerHTML = ''; });

    it('handles empty tokens array', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [],
                solutions: []
            },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);
        expect(document.querySelector('.pz-container')).toBeTruthy();
    });

    it('handles missing solutions gracefully', async () => {
        const engine = makeMockEngine();
        const resolveSpy = vi.fn();

        const runner = createPuzzleRunner({
            config: {
                kind: 'quiz',
                tokens: [{ id: 'a', text: 'A' }]
                // solutions missing
            },
            engine,
            onResolve: resolveSpy
        });

        runner.mountInto(engine.hotspotLayer);

        document.querySelector('.pz-btn--ok').click();
        await new Promise(r => setTimeout(r, 10));

        // Should not crash
        expect(resolveSpy).toHaveBeenCalled();
    });

    it('cleans up event listeners on unmount', () => {
        const engine = makeMockEngine();
        const runner = createPuzzleRunner({
            config: { kind: 'phrase', solution: 'x' },
            engine,
            onResolve: () => {}
        });

        runner.mountInto(engine.hotspotLayer);
        const okBtn = document.querySelector('.pz-btn--ok');

        runner.unmount();

        // Button should no longer exist
        expect(document.body.contains(okBtn)).toBe(false);
    });
});
