<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon
                icon="mdi-package-variant-closed"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold">Restock Draft</span>
            <v-spacer />
            <div class="d-flex ga-2">
                <v-btn
                    color="amber-darken-2"
                    variant="flat"
                    prepend-icon="mdi-plus"
                    size="small"
                    @click="openAddDialog"
                >
                    Add Product
                </v-btn>

                <v-btn
                    color="green-darken-2"
                    variant="flat"
                    prepend-icon="mdi-content-save"
                    size="small"
                    @click="isSaveDialogOpen = true"
                >
                    Save
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="bg-grey-lighten-5 pt-4">
            <v-row align="center">
                <v-col cols="12" md="6">
                    <v-text-field
                        v-model="search"
                        label="Search restocked products..."
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        bg-color="white"
                        hide-details
                        color="amber-darken-2"
                        clearable
                    />
                </v-col>
                <v-spacer />

                <v-col cols="12" md="2">
                    <v-btn
                        color="grey-darken-2"
                        variant="tonal"
                        prepend-icon="mdi-delete-sweep-outline"
                        block
                        @click="items = []"
                    >
                        Clear Drafts
                    </v-btn>
                </v-col>
            </v-row>
        </v-card-text>

        <v-divider />

        <v-data-table
            v-model:items-per-page="limit"
            :headers="headers"
            :items="items"
            :search="search"
            hover
        >
            <template #no-data>
                <div class="pa-4 text-grey-darken-1">
                    No new products added yet. Click "Add Product" to start.
                </div>
            </template>

            <template #[`item.EAN`]="{ item }">
                <span
                    v-if="item.autoGenerateEAN"
                    class="text-grey-darken-1 font-italic"
                >
                    [Auto-Generated]
                </span>
                <span v-else>{{ item.EAN }}</span>
            </template>

            <template #[`item.actions`]="{ item }">
                <div class="d-flex justify-end ga-1">
                    <v-btn
                        icon="mdi-pencil"
                        variant="text"
                        color="blue-darken-2"
                        size="small"
                        density="comfortable"
                        @click="editDraft(item)"
                    />
                    <v-btn
                        icon="mdi-delete"
                        variant="text"
                        color="red-darken-2"
                        size="small"
                        density="comfortable"
                        @click="deleteDraft(item)"
                    />
                </div>
            </template>
        </v-data-table>
    </v-card>

    <v-dialog v-model="isAddDialogOpen" max-width="500" destroy-on-close>
        <add-dialog
            v-bind="editItem"
            :item="editItem"
            @close="isAddDialogOpen = false"
            @add="handleNewItem"
            @update="handleUpdateItem"
        />
    </v-dialog>
    <v-dialog v-model="isSaveDialogOpen" max-width="500" destroy-on-close>
        <save-dialog @close="isSaveDialogOpen = false" @save="saveToDB" />
    </v-dialog>
</template>

<script setup lang="ts">
import api from '@/axios';
import AddDialog from '@/components/User/Restock/AddDialog.vue';
import { AddForm, SaveForm } from '@/components/User/Restock/dto';
import SaveDialog from '@/components/User/Restock/SaveDialog.vue';
import { Color, useUIStore } from '@/stores/ui';
import { RestockDto } from '@grocery-pos/shared';
import { isAxiosError } from 'axios';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const isAddDialogOpen = ref(false);
const isSaveDialogOpen = ref(false);

const limit = ref(5);
const search = ref('');
const items = ref<AddForm[]>([]);

const editItem = ref<AddForm>();
const editIndex = ref(-1);

const headers = ref([
    { title: 'Name', key: 'name', align: 'start' as const, sortable: true },
    {
        title: 'Quantity',
        key: 'quantity',
        align: 'start' as const,
        sortable: true,
    },
    {
        title: 'Unit Cost',
        key: 'unitCost',
        align: 'start' as const,
        sortable: true,
    },
    {
        title: 'Total Cost',
        key: 'totalCost',
        align: 'start' as const,
        sortable: true,
    },
    {
        title: 'Actions',
        key: 'actions',
        align: 'end' as const,
        sortable: false,
    },
]);

const uiStore = useUIStore();
const router = useRouter();

const saveToDB = async (saveForm: SaveForm) => {
    console.log({ items });
    try {
        const restockDetails = items.value.map((item: AddForm) => {
            const result: RestockDto['restockDetails'][number] = {
                quantity: item.quantity,
                unitCost: item.unitCost,
            };

            if (item.isNewProduct) {
                result.newProduct = {
                    EAN: item.EAN,
                    name: item.name,
                    price: item.price ?? 0,
                };
            } else {
                result.product = item.product;
            }

            return result;
        });

        const payload: RestockDto = {
            restockDetails,
            description: saveForm?.description ?? '',
        };

        console.log({ restockDetails });
        await api.post('/restocks', payload);

        isSaveDialogOpen.value = false;
        router.push({
            name: 'Restocks',
        });
        uiStore.queueMessage(Color.SUCCESS, 'Adjustments saved.');
    } catch (error) {
        if (isAxiosError(error))
            uiStore.queueMessage(
                Color.ERROR,
                error?.response?.data?.message ?? 'Error saving. Try again.',
            );
    }
};

const openAddDialog = () => {
    editItem.value = undefined;
    editIndex.value = -1;
    isAddDialogOpen.value = true;
};

const handleNewItem = (newItem: AddForm) => {
    const totalCost = newItem.quantity * newItem.unitCost;
    items.value.push({ ...newItem, totalCost });
    isAddDialogOpen.value = false;
};

const editDraft = (item: AddForm) => {
    editIndex.value = items.value.indexOf(item); // Track WHICH item we are editing

    const totalCost = item.quantity * item.unitCost;
    editItem.value = { ...item, totalCost }; // Pass a COPY of the item to the form
    isAddDialogOpen.value = true;
};

// Catches the emitted UPDATE data and overwrites the existing table row
const handleUpdateItem = (updatedProduct: AddForm) => {
    if (editIndex.value > -1) {
        // Replace the old item with the newly edited one at the same index
        items.value[editIndex.value] = updatedProduct;
    }
    isAddDialogOpen.value = false;
};

// Deletes a specific item from the drafts array
const deleteDraft = (item: AddForm) => {
    const index = items.value.indexOf(item);
    if (index > -1) {
        items.value.splice(index, 1);
    }
};
</script>
