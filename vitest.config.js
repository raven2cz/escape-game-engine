import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['games/tests/**/*.test.js'],
        globals: true,
        setupFiles: ['games/tests/setup.localstorage.js'],
    },
});
