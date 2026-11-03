<template>
    <BaseModal
        v-model="open"
        title="Parked tickets"
        subtitle="Saved in this browser for your account. Stock is not reserved."
        scrollable
        :closable="!busy"
    >
        <p v-if="!cart.parked.length" class="text-sm text-slate-600">
            No parked tickets.
        </p>
        <p v-if="cart.items.length" class="mb-3 text-sm text-amber-800">
            Park or clear the current ticket before resuming another.
        </p>
        <p v-if="error" role="alert" class="mb-3 text-sm text-red-700">
            {{ error }}
        </p>
        <ul class="space-y-3">
            <li
                v-for="ticket in cart.parked"
                :key="ticket.id"
                class="rounded-xl border border-slate-200 p-3"
            >
                <h3 class="font-bold text-sm break-words">
                    {{ ticket.label || 'Unnamed ticket' }}
                </h3>
                <p class="text-xs text-slate-600">
                    {{ new Date(ticket.parkedAt).toLocaleString() }} ·
                    {{ ticket.items.length }} lines ·
                    {{
                        ticket.items.reduce(
                            (n, item) =>
                                n +
                                (item.unit && item.unit !== UnitOfMeasure.PIECE
                                    ? 1
                                    : item.quantity),
                            0,
                        )
                    }}
                    items
                </p>
                <p class="text-xs text-slate-600">
                    Prices refresh on resume. Discounts need fresh admin
                    approval at checkout.
                </p>
                <div class="flex gap-2 mt-3">
                    <BaseButton
                        class="min-h-11"
                        :disabled="
                            busy ||
                            cart.locked ||
                            !!cart.items.length ||
                            !shift.activeShift
                        "
                        @click="resume(ticket)"
                        >Resume</BaseButton
                    >
                    <BaseButton
                        class="min-h-11"
                        variant="outline"
                        :disabled="busy || cart.locked"
                        @click="discard(ticket)"
                        >Discard</BaseButton
                    >
                </div>
            </li>
        </ul>
        <p v-if="!shift.activeShift" class="mt-3 text-sm text-amber-800">
            Open a shift to resume a ticket.
        </p>
    </BaseModal>
    <ConfirmDialog :request="request" @answer="answer" />
</template>

<script setup lang="ts">
import { isAxiosError } from 'axios';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
    unitOf,
    UnitOfMeasure,
    type ProductView,
} from '@grocery-pos/contracts';
import api from '@/axios';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useCartStore, type ParkedTicket } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import { Color, useUIStore } from '@/stores/ui';
import { apiErrorText } from '@/utils/api-error';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; resumed: [] }>();
const cart = useCartStore();
const shift = useShiftStore();
const ui = useUIStore();
const busy = ref(false);
const error = ref('');
let disposed = false;
onBeforeUnmount(() => {
    disposed = true;
});
const open = computed({
    get: () => props.modelValue,
    set: (value) => {
        if (!busy.value) emit('update:modelValue', value);
    },
});
const { request, confirm, answer } = useConfirm();
watch(
    () => props.modelValue,
    () => {
        error.value = '';
    },
);

async function resume(ticket: ParkedTicket) {
    if (busy.value || cart.locked || !shift.activeShift || cart.items.length)
        return;
    busy.value = true;
    error.value = '';
    const owner = cart.owner;
    const currentShift = shift.activeShift._id;
    const expected = JSON.stringify(ticket);
    try {
        const refreshed = await Promise.all(
            ticket.items.map(async (item) => {
                const { data: product } = await api.get<ProductView>(
                    `/products/${encodeURIComponent(item.EAN)}`,
                );
                if (
                    product._id !== item.product ||
                    unitOf(product.unit) !== unitOf(item.unit)
                )
                    throw new Error(
                        `${item.name} is no longer available. The parked ticket is kept.`,
                    );
                return {
                    ...item,
                    EAN: product.EAN,
                    name: product.name,
                    unitPrice: product.price,
                };
            }),
        );
        if (
            disposed ||
            owner !== cart.owner ||
            currentShift !== shift.activeShift?._id
        )
            return;
        cart.resumeParked(ticket.id, refreshed, expected);
        ui.queueMessage(
            Color.INFO,
            'Ticket resumed with current prices. Stock is checked at checkout.',
        );
        emit('update:modelValue', false);
        emit('resumed');
    } catch (err) {
        if (!disposed)
            error.value =
                err instanceof Error && !isAxiosError(err)
                    ? err.message
                    : apiErrorText(
                          err,
                          'Could not refresh all products. The parked ticket is kept.',
                      );
    } finally {
        busy.value = false;
    }
}

async function discard(ticket: ParkedTicket) {
    if (busy.value || cart.locked) return;
    const owner = cart.owner;
    const ok = await confirm({
        title: 'Discard parked ticket',
        message: `Discard ${ticket.label || 'this ticket'} (${ticket.items.length} lines)?`,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep Ticket',
        danger: true,
    });
    if (!ok || owner !== cart.owner) return;
    try {
        cart.discardParked(ticket.id);
    } catch (err) {
        error.value =
            err instanceof Error && !isAxiosError(err)
                ? err.message
                : apiErrorText(err, 'Could not discard this ticket.');
    }
}
</script>
