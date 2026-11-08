import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// NotFound renders inside the layouts through their default slot (#193);
// its spec uses stubs, so pin the real slot inside each layout's <main>.
describe.each(['UserLayout.vue', 'SellerLayout.vue'])('%s slot', (file) => {
    it('keeps the default slot (around the router view) inside <main>', () => {
        const src = readFileSync(new URL(file, import.meta.url), 'utf8');
        const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(src)?.[1] ?? '';
        expect(main).toMatch(/<slot>\s*<router-view \/>\s*<\/slot>/);
    });
});
