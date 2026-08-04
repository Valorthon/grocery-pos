<template>
    <v-sheet class="px-4 py-2 rounded-lg border" elevation="0">
        <v-row align="center">
            <v-col cols="12" md="7" lg="8" class="py-1">
                <v-text-field
                    v-model="searchQuery"
                    placeholder="Search for groceries (e.g., fresh milk)..."
                    prepend-inner-icon="mdi-magnify"
                    variant="outlined"
                    density="comfortable"
                    hide-details
                    clearable
                    @keyup.enter="applySearch"
                    @click:clear="applySearch"
                >
                    <template #append-inner>
                        <v-btn
                            color="primary"
                            variant="flat"
                            size="large"
                            elevation="0"
                            class="mr-n2"
                            @click="applySearch"
                        >
                            <v-icon>mdi-magnify</v-icon>
                        </v-btn>
                    </template>
                </v-text-field>
            </v-col>

            <v-col
                cols="12"
                md="5"
                lg="4"
                class="py-1 d-flex align-center justify-md-start"
            >
                <v-icon color="grey-darken-1" class="mr-2" size="small"
                    >mdi-sort-variant</v-icon
                >
                <span class="text-body-2 text-medium-emphasis mr-2 text-no-wrap"
                    >Sort by:</span
                >

                <v-chip-group
                    v-model="sortBy"
                    selected-class="bg-primary text-white border-primary"
                    mandatory
                    @update:model-value="applySearch"
                >
                    <v-chip value="relevance" variant="outlined" size="small">
                        Relevance
                    </v-chip>
                    <v-chip value="price_asc" variant="outlined" size="small">
                        Low to High
                    </v-chip>
                    <v-chip value="price_desc" variant="outlined" size="small">
                        High to Low
                    </v-chip>
                </v-chip-group>
            </v-col>
        </v-row>
    </v-sheet>
</template>

<script setup lang="ts">
import { ref } from 'vue';

// --- State ---
const searchQuery = ref('');
const sortBy = ref('relevance');

// --- Emits ---
const emit = defineEmits(['search']);

const applySearch = () => {
    emit('search', {
        query: searchQuery.value,
        sort: sortBy.value,
    });
};
</script>
