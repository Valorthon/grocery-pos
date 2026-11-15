<template>
    <BaseModal
        :model-value="clientOutdated"
        title="Grocery POS was updated"
        max-width="24rem"
        :closable="false"
        data-testid="client-outdated"
    >
        <p class="text-sm text-muted">Reload to continue.</p>
        <template #footer>
            <BaseButton
                data-autofocus
                variant="primary"
                data-testid="client-outdated-reload"
                @click="reloader.reload()"
                >Reload</BaseButton
            >
        </template>
    </BaseModal>
</template>

<script setup lang="ts">
import BaseModal from './ui/BaseModal.vue';
import BaseButton from './ui/BaseButton.vue';
import { clientOutdated, reloader } from '@/utils/client-outdated';

/**
 * Owner decision 2026-11-15 (#364): a tab still running the previous
 * release after an upgrade gets this dialog, with only Reload. The
 * basket and queued offline cash sales are kept across the reload.
 */
</script>
