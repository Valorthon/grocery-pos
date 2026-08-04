<template>
    <v-card variant="outlined" class="pa-4 rounded-lg">
        <div class="d-flex align-center justify-space-between mb-4">
            <span class="text-h6 font-weight-bold">Filters</span>
        </div>

        <div class="mb-4">
            <div class="text-subtitle-2 mb-2 font-weight-bold">Category</div>
            <v-select
                v-model="filters.category"
                :items="categories"
                label="Select Category"
                variant="outlined"
                density="compact"
                hide-details
                clearable
            />
        </div>

        <div class="mb-4">
            <div class="text-subtitle-2 mb-2 font-weight-bold">Shop</div>
            <v-select
                v-model="filters.shop"
                :items="shops"
                label="Select Shop"
                variant="outlined"
                density="compact"
                hide-details
                clearable
            />
        </div>

        <div class="mb-6">
            <div class="text-subtitle-2 mb-2 font-weight-bold">Price Range</div>
            <v-row>
                <v-col cols="6">
                    <v-text-field
                        v-model.number="filters.minPrice"
                        label="Min ($)"
                        type="number"
                        min="0"
                        variant="outlined"
                        density="compact"
                        hide-details
                    />
                </v-col>
                <v-col cols="6">
                    <v-text-field
                        v-model.number="filters.maxPrice"
                        label="Max ($)"
                        type="number"
                        min="0"
                        variant="outlined"
                        density="compact"
                        hide-details
                    />
                </v-col>
            </v-row>
        </div>

        <v-divider class="mb-4" />

        <v-btn
            color="primary"
            block
            elevation="0"
            class="mb-2"
            @click="applyFilters"
        >
            Apply Filters
        </v-btn>

        <v-btn variant="text" color="grey-darken-1" block @click="clearFilters">
            Clear All
        </v-btn>
    </v-card>
</template>

<script setup lang="ts">
import { reactive } from 'vue';

// --- Emits ---
// We emit 'apply' when the user clicks Apply, and 'clear' when they reset
const emit = defineEmits(['apply', 'clear']);

// --- State ---
// Using reactive() keeps all filter states bundled nicely in one object
const filters = reactive({
    category: null,
    shop: null,
    minPrice: null,
    maxPrice: null,
});

// --- Mock Options (You would fetch these from your backend) ---
const categories = [
    'Produce',
    'Dairy & Eggs',
    'Meat & Seafood',
    'Pantry',
    'Frozen Foods',
    'Beverages',
];

const shops = [
    'FreshMart Local',
    'GreenGrocer',
    'SuperValue Store',
    'Organic Oasis',
];

// --- Methods ---
const applyFilters = () => {
    // Send the current filter state to the parent component
    emit('apply', { ...filters });
};

const clearFilters = () => {
    // Reset all values back to null
    filters.category = null;
    filters.shop = null;
    filters.minPrice = null;
    filters.maxPrice = null;

    // Tell the parent component to clear the filters on its end too
    emit('clear');
};
</script>
