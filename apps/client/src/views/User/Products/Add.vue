<template>
    <v-card elevation="2" class="rounded-lg border">
        <v-card-title class="d-flex align-center px-4 py-3 bg-grey-lighten-4">
            <v-icon
                icon="mdi-format-list-bulleted"
                color="amber-darken-2"
                class="me-2"
            />
            <span class="text-subtitle-1 font-weight-bold"
                >New Products Draft</span
            >
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
                    @click="saveToDB"
                >
                    Save All
                </v-btn>
            </div>
        </v-card-title>

        <v-divider />

        <v-card-text class="bg-grey-lighten-5 pt-4">
            <v-row align="center">
                <v-col cols="12" md="6">
                    <v-text-field
                        v-model="search"
                        label="Search drafted products..."
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
        <add-product-dialog
            v-bind="editItem"
            :item="editItem"
            @close="isAddDialogOpen = false"
            @add="handleNewProduct"
            @update="updateDraft"
        />
    </v-dialog>
</template>

<script setup lang="ts">
import api from '@/axios';
import AddProductDialog from '@/components/User/Product/AddDialog.vue';
import { Color, useUIStore } from '@/stores/ui';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const isAddDialogOpen = ref(false);
const uiStore = useUIStore();

const limit = ref(5);
const search = ref('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const items = ref<any[]>([]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editItem = ref<Record<string, any>>({});
const editIndex = ref(-1);

const headers = ref([
    { title: 'EAN', key: 'EAN', align: 'start' as const, sortable: true },
    { title: 'Name', key: 'name', align: 'start' as const, sortable: true },
    { title: 'Price', key: 'price', align: 'start' as const, sortable: true },
    {
        title: 'Actions',
        key: 'actions',
        align: 'end' as const,
        sortable: false,
    },
]);

const router = useRouter();

const saveToDB = async () => {
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, 'No products to save');
        return;
    }

    try {
        await api.post('/products/bulk', {
            newProducts: items.value,
        });
    } catch (err: unknown) {
        const error = err as {
            status?: number;
            response?: {
                data: { message: { property: string; msg: string }[] };
            };
        };
        const status = error.status;
        let messages: string[] = [];

        switch (status) {
            case 400: {
                const responseMessages = error.response?.data.message ?? [];
                responseMessages.forEach((message) => {
                    messages.push(`${message.property} ${message.msg}`);
                });

                break;
            }
            default:
                messages.push('Error saving products. Please try again');
        }

        messages.forEach((message) =>
            uiStore.queueMessage(Color.ERROR, message),
        );

        return;
    }

    router.push({
        name: 'Products',
    });
    uiStore.queueMessage(Color.SUCCESS, 'Products saved');
};

const openAddDialog = () => {
    editItem.value = {};
    editIndex.value = -1;
    isAddDialogOpen.value = true;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleNewProduct = async (newProduct: any) => {
    items.value.push(newProduct);
    isAddDialogOpen.value = false;
    uiStore.queueMessage(Color.SUCCESS, 'Product added');
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editDraft = (item: any) => {
    editIndex.value = items.value.indexOf(item);
    editItem.value = { ...item };
    isAddDialogOpen.value = true;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateDraft = (updatedProduct: any) => {
    if (editIndex.value > -1) {
        items.value[editIndex.value] = updatedProduct;
    }
    isAddDialogOpen.value = false;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deleteDraft = (item: any) => {
    const index = items.value.indexOf(item);
    if (index > -1) {
        items.value.splice(index, 1);
    }
};
</script>
