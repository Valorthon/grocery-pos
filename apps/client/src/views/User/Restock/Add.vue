<template>
    <PageCard title="Restock Draft">
        <template #icon>
            <Truck class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton size="sm" @click="openAddDialog">
                <Plus class="w-4 h-4" />
                Add Product
            </BaseButton>
            <BaseButton
                size="sm"
                variant="outline"
                @click="isSaveDialogOpen = true"
            >
                <Save class="w-4 h-4" />
                Save
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
        >
            <BaseInput
                v-model="search"
                label="Search restocked products..."
                clearable
                class="md:col-span-3"
            />
            <div class="flex items-end">
                <BaseButton
                    variant="outline"
                    size="sm"
                    block
                    @click="items = []"
                >
                    <Trash2 class="w-4 h-4" />
                    Clear Drafts
                </BaseButton>
            </div>
        </div>

        <div
            v-if="filteredItems.length === 0"
            class="py-16 text-center text-slate-400 text-sm"
        >
            No new products added yet. Click "Add Product" to start.
        </div>
        <div v-else class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
                <thead>
                    <tr
                        class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"
                    >
                        <th class="py-2.5 px-5">Name</th>
                        <th class="py-2.5 px-5 text-right">Quantity</th>
                        <th class="py-2.5 px-5 text-right">Unit Cost</th>
                        <th class="py-2.5 px-5 text-right">Total Cost</th>
                        <th class="py-2.5 px-5 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr
                        v-for="item in filteredItems"
                        :key="item.EAN ?? item.name"
                    >
                        <td class="py-3 px-5 font-medium">{{ item.name }}</td>
                        <td class="py-3 px-5 text-right">
                            {{ item.quantity }}
                        </td>
                        <td class="py-3 px-5 text-right">
                            ₱{{ (item.unitCost ?? 0).toLocaleString() }}
                        </td>
                        <td class="py-3 px-5 text-right font-bold">
                            ₱{{
                                (
                                    (item.unitCost ?? 0) * (item.quantity ?? 0)
                                ).toLocaleString()
                            }}
                        </td>
                        <td class="py-3 px-5">
                            <div class="flex justify-end gap-1">
                                <button
                                    type="button"
                                    class="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-primary-50"
                                    @click="editDraft(item)"
                                >
                                    <Pencil class="w-4 h-4" />
                                </button>
                                <button
                                    type="button"
                                    class="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"
                                    @click="deleteDraft(item)"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </PageCard>

    <RestockAddDialog
        v-model="isAddDialogOpen"
        :item="editItem"
        @add="handleNewItem"
        @update="handleUpdateItem"
    />

    <RestockSaveDialog v-model="isSaveDialogOpen" @save="saveToDB" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Pencil, Plus, Save, Trash2, Truck } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import RestockAddDialog from '@/components/User/Restock/AddDialog.vue';
import RestockSaveDialog from '@/components/User/Restock/SaveDialog.vue';
import { AddForm, SaveForm } from '@/components/User/Restock/dto';
import { Color, useUIStore } from '@/stores/ui';
import { isAxiosError } from 'axios';

const isAddDialogOpen = ref(false);
const isSaveDialogOpen = ref(false);
const search = ref('');
const items = ref<AddForm[]>([]);
const editItem = ref<AddForm>();
const editIndex = ref(-1);

const uiStore = useUIStore();
const router = useRouter();

const filteredItems = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return items.value;
    return items.value.filter(
        (i) =>
            i.name?.toLowerCase().includes(q) ||
            i.EAN?.toLowerCase().includes(q),
    );
});

const saveToDB = async (saveForm: SaveForm) => {
    try {
        const restockDetails = items.value.map((item: AddForm) => {
            const result: Record<string, unknown> = {};

            if (item.isNewProduct) {
                result.newProduct = {
                    EAN: item.EAN,
                    name: item.name,
                    price: item.price,
                };
            } else {
                result.product = item.product;
            }

            result.quantity = item.quantity;
            result.unitCost = item.unitCost;
            return result;
        });

        await api.post('/restocks', {
            restockDetails,
            description: saveForm?.description,
        });

        isSaveDialogOpen.value = false;
        router.push({ name: 'Restocks' });
        uiStore.queueMessage(Color.SUCCESS, 'Restock saved.');
    } catch (error) {
        if (isAxiosError(error)) {
            uiStore.queueMessage(
                Color.ERROR,
                error?.response?.data?.message ?? 'Error saving. Try again.',
            );
        }
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
    editIndex.value = items.value.indexOf(item);
    editItem.value = { ...item };
    isAddDialogOpen.value = true;
};

const handleUpdateItem = (updatedProduct: AddForm) => {
    if (editIndex.value > -1) {
        items.value[editIndex.value] = updatedProduct;
    }
    isAddDialogOpen.value = false;
};

const deleteDraft = (item: AddForm) => {
    const index = items.value.indexOf(item);
    if (index > -1) {
        items.value.splice(index, 1);
    }
};
</script>
