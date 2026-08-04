<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon icon="mdi-tune" color="amber-darken-2" class="me-2" />
            <span class="text-subtitle-1 font-weight-bold"
                >Adjustment History</span
            >
            <v-spacer />
            <div class="d-flex ga-2">
                <v-btn
                    color="amber-darken-2"
                    variant="flat"
                    prepend-icon="mdi-pencil"
                    size="small"
                    :to="{ name: 'Adjustments/Add' }"
                >
                    Adjust
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="bg-grey-lighten-5 pt-4">
            <v-row align="center">
                <v-col cols="12" md="3">
                    <v-select
                        v-model="searchAdjustedBy"
                        :items="userOptions"
                        label="Adjusted By"
                        prepend-inner-icon="mdi-account"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        color="amber-darken-2"
                        clearable
                        hide-details
                        @update:model-value="resetSearch"
                    />
                </v-col>

                <v-col cols="12" md="3">
                    <v-menu v-model="dateMenu" :close-on-content-click="false">
                        <template #activator="{ props }">
                            <v-text-field
                                v-bind="props"
                                :model-value="dateRangeText"
                                label="Date Range"
                                prepend-inner-icon="mdi-calendar"
                                variant="outlined"
                                density="compact"
                                bg-color="white"
                                readonly
                                hide-details
                                color="amber-darken-2"
                                clearable
                                @click:clear="
                                    () => {
                                        searchDateRange = [];
                                        resetSearch();
                                    }
                                "
                            />
                        </template>
                        <v-date-picker
                            v-model="searchDateRange"
                            multiple="range"
                            color="amber-darken-2"
                            hide-header
                            :max="new Date()"
                            @update:model-value="resetSearch"
                        />
                    </v-menu>
                </v-col>
                <v-spacer />
                <v-col cols="12" md="2">
                    <v-btn
                        color="grey-darken-2"
                        variant="tonal"
                        prepend-icon="mdi-filter-remove-outline"
                        block
                        @click="resetFilters"
                    >
                        Clear Filters
                    </v-btn>
                </v-col>
            </v-row>
        </v-card-text>

        <v-divider />

        <v-data-table-server
            v-model:items-per-page="limit"
            v-model:page="page"
            :headers="headers"
            :items="serverItems"
            :items-length="totalItems"
            :loading="loading"
            hover
            @update:options="fetchAdjust"
            @click:row="showDetails"
        >
            <template #loading>
                <v-skeleton-loader type="table-row@5" />
            </template>
        </v-data-table-server>

        <v-dialog v-model="isDialogOpen">
            <AdjustDetails :item="selectedItem" @close="isDialogOpen = false" />
        </v-dialog>
    </v-card>
</template>

<script setup lang="ts">
import api from '@/axios';
import AdjustDetails from '@/components/User/Adjustments/DetailsDialog.vue';
import { computed, onMounted, ref } from 'vue';

// Table
const loading = ref(true);
const limit = ref(5);
const totalItems = ref(0);
const page = ref(1);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverItems = ref<any[]>([]);

const headers = ref([
    {
        title: 'Description',
        key: 'description',
        align: 'start' as const,
        sortable: false,
    },
    {
        title: 'Adjusted By',
        key: 'adjustedBy',
        align: 'start' as const,
        sortable: false,
    },
    { title: 'Date', key: 'date', align: 'start' as const, sortable: false },
]);

// Components
const searchAdjustedBy = ref<string | null>(null);
const searchDateRange = ref<Date[] | null>([]);
const dateMenu = ref(false);
const userOptions = ref<Array<{ title: string; value: string }>>([]);

const fetchUserOptions = async () => {
    const result = await api.get('/adjustments/users');

    userOptions.value = result.data.map(
        ({ _id, name }: { _id: string; name: string }) => ({
            title: name,
            value: _id,
        }),
    );
};

onMounted(() => {
    fetchUserOptions();
});

const dateRangeText = computed(() => {
    if (!searchDateRange.value || searchDateRange.value.length === 0) return '';

    const formatDate = (date: Date | string) =>
        new Date(date).toLocaleDateString('en-PH');

    if (searchDateRange.value.length === 1) {
        return formatDate(searchDateRange.value[0]);
    }

    const start = formatDate(searchDateRange.value[0]);
    const end = formatDate(
        searchDateRange.value[searchDateRange.value.length - 1],
    );
    return `${start} - ${end}`;
});

const resetSearch = () => {
    page.value = 1;
    fetchAdjust();
};

const resetFilters = () => {
    searchAdjustedBy.value = null;
    searchDateRange.value = null;
    resetSearch();
};

async function fetchAdjust() {
    loading.value = true;
    const formattedDates =
        searchDateRange.value && searchDateRange.value.length
            ? searchDateRange.value.map((date) => new Date(date).toISOString())
            : undefined;

    const result = await api.get(`/adjustments`, {
        params: {
            page: page.value,
            limit: limit.value,
            adjustedBy: searchAdjustedBy.value,
            dateRange: formattedDates,
        },
        paramsSerializer: { indexes: null },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverItems.value = result.data.data.map((adjust: any) => {
        return {
            id: adjust._id,
            description: adjust.description,
            adjustedBy: adjust.adjustedBy.name,
            date: new Date(adjust.createdAt).toLocaleString('en-PH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            }),
        };
    });

    totalItems.value = result.data.totalItems;
    loading.value = false;
}

// Dialogue Box
const isDialogOpen = ref(false);
const selectedItem = ref();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showDetails(_event: Event, { item }: { item: any }) {
    selectedItem.value = item;
    isDialogOpen.value = true;
}
</script>
