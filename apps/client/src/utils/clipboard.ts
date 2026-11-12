import { Color, useUIStore } from '@/stores/ui';

/** Copies `text`, then a success or failure toast naming `what` (#306). */
export async function copyText(text: string, what: string): Promise<void> {
    const ui = useUIStore();
    try {
        await navigator.clipboard.writeText(text);
        ui.queueMessage(Color.SUCCESS, `${what} copied`);
    } catch {
        ui.queueMessage(
            Color.ERROR,
            `Could not copy the ${what.charAt(0).toLowerCase()}${what.slice(1)}`,
        );
    }
}
