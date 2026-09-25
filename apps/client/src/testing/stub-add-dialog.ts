/**
 * Test-only stand-in for the draft pages' add/edit dialogs, so page specs
 * can add and edit rows without driving product search. Mock a dialog with
 *
 *   vi.mock('@/components/User/Product/AddDialog.vue', async () =>
 *       (await import('@/testing/stub-add-dialog')).stubAddDialogModule());
 *
 * then set `nextDraft.value` and click "Stub submit": it emits `update`
 * when the page opened the dialog with a row to edit, else `add`.
 */
import { defineComponent, h, type PropType } from 'vue';

export const nextDraft: { value: Record<string, unknown> } = { value: {} };

export function stubAddDialogModule() {
    const StubAddDialog = defineComponent({
        props: {
            modelValue: { type: Boolean, required: true },
            item: {
                type: Object as PropType<Record<string, unknown>>,
                default: undefined,
            },
        },
        emits: ['update:modelValue', 'add', 'update'],
        setup(props, { emit }) {
            return () =>
                props.modelValue
                    ? h(
                          'button',
                          {
                              type: 'button',
                              onClick: () => {
                                  const editing =
                                      !!props.item &&
                                      Object.keys(props.item).length > 0;
                                  emit(editing ? 'update' : 'add', {
                                      ...nextDraft.value,
                                  });
                              },
                          },
                          'Stub submit',
                      )
                    : null;
        },
    });
    return { default: StubAddDialog };
}
