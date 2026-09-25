<template>
    <PageCard title="New Products Draft">
        <template #icon>
            <List class="w-5 h-5 text-primary-600" />
        </template>
        <template #actions>
            <BaseButton size="sm" @click="openAddDialog">
                <Plus class="w-4 h-4" />
                Add Product
            </BaseButton>
            <BaseButton size="sm" variant="outline" @click="saveToDB">
                <Save class="w-4 h-4" />
                Save All
            </BaseButton>
        </template>

        <div
            class="px-5 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3"
        >
            <BaseInput
                v-model="search"
                label="Search drafted products..."
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
                        <th class="py-2.5 px-5">EAN</th>
                        <th class="py-2.5 px-5">Name</th>
                        <th class="py-2.5 px-5 text-right">Price</th>
                        <th class="py-2.5 px-5 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr v-for="item in filteredItems" :key="item.EAN">
                        <td class="py-3 px-5">
                            <span
                                v-if="item.autoGenerateEAN"
                                class="text-slate-400 italic"
                                >[Auto-Generated]</span
                            >
                            <span v-else>{{ item.EAN }}</span>
                        </td>
                        <td class="py-3 px-5">{{ item.name }}</td>
                        <td class="py-3 px-5 text-right">
                            {{ formatCurrency(item.price ?? 0) }}
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

    <AddProductDialog
        v-model="isAddDialogOpen"
        :item="editItem"
        @add="handleNewProduct"
        @update="updateDraft"
    />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { List, Pencil, Plus, Save, Trash2 } from '@lucide/vue';
import api from '@/axios';
import PageCard from '@/components/ui/PageCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import AddProductDialog from '@/components/User/Product/AddDialog.vue';
import { Color, useUIStore } from '@/stores/ui';
import { formatCurrency } from '@/utils/currency';
import { apiErrorMessages } from '@/utils/api-error';
import { toNewProductsBody, type ProductDraft } from '@/utils/payloads';

const isAddDialogOpen = ref(false);
const uiStore = useUIStore();
const search = ref('');
const items = ref<ProductDraft[]>([]);
const editItem = ref<Partial<ProductDraft>>({});
const editIndex = ref(-1);
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

const saveToDB = async () => {
    if (items.value.length === 0) {
        uiStore.queueMessage(Color.ERROR, 'No products to save');
        return;
    }

    try {
        await api.post('/products/bulk', toNewProductsBody(items.value));
    } catch (err: unknown) {
        uiStore.queueMessage(
            Color.ERROR,
            apiErrorMessages(err, 'Error saving products. Please try again'),
        );
        return;
    }

    router.push({ name: 'Products' });
    uiStore.queueMessage(Color.SUCCESS, 'Products saved');
};

const openAddDialog = () => {
    editItem.value = {};
    editIndex.value = -1;
    isAddDialogOpen.value = true;
};

const handleNewProduct = async (newProduct: ProductDraft) => {
    items.value.push(newProduct);
    isAddDialogOpen.value = false;
    uiStore.queueMessage(Color.SUCCESS, 'Product added');
};

const editDraft = (item: ProductDraft) => {
    editIndex.value = items.value.indexOf(item);
    editItem.value = { ...item };
    isAddDialogOpen.value = true;
};

const updateDraft = (updatedProduct: ProductDraft) => {
    if (editIndex.value > -1) {
        items.value[editIndex.value] = updatedProduct;
    }
    isAddDialogOpen.value = false;
};

const deleteDraft = (item: ProductDraft) => {
    const index = items.value.indexOf(item);
    if (index > -1) {
        items.value.splice(index, 1);
    }
};
</script>
