<template>
    <!-- Any click on the page gives the focus back to the scan box (#22). -->
    <div
        class="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-slate-100 text-slate-900"
        @click="sticky.onPageClick"
    >
        <!-- LEFT: scan input + live ticket (+ the tender footer below lg) -->
        <div
            class="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-white"
        >
            <div class="p-4 sm:p-5 bg-white shrink-0 border-b border-slate-200">
                <div
                    class="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-100"
                >
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span
                                v-if="shiftStore.activeShift"
                                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold"
                            >
                                <span>Shift Active</span>
                            </span>
                            <span
                                v-else
                                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold"
                            >
                                <AlertCircle
                                    class="w-3.5 h-3.5 text-amber-600"
                                />
                                <span>No Active Shift</span>
                            </span>
                        </div>
                        <h1
                            class="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1"
                        >
                            Checkout Register
                        </h1>
                    </div>

                    <div class="flex items-center gap-2">
                        <template v-if="shiftStore.activeShift">
                            <button
                                type="button"
                                class="min-h-11 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition-colors focus-ring"
                                title="Add change when drawer coins or small bills run low"
                                @click="
                                    shiftStore.drawerAction =
                                        DrawerMovementType.CASH_IN
                                "
                            >
                                <ArrowDownLeft
                                    class="w-3.5 h-3.5 text-emerald-600"
                                />
                                <span>+ Cash In</span>
                            </button>

                            <button
                                type="button"
                                class="min-h-11 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-xs font-bold flex items-center gap-1.5 transition-colors focus-ring"
                                title="Drop excess cash safely to the back office safe"
                                @click="
                                    shiftStore.drawerAction =
                                        DrawerMovementType.CASH_DROP
                                "
                            >
                                <ArrowUpRight
                                    class="w-3.5 h-3.5 text-amber-600"
                                />
                                <span>- Cash Drop</span>
                            </button>

                            <button
                                type="button"
                                class="min-h-11 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-extrabold flex items-center gap-1.5 transition-colors shadow-2xs focus-ring"
                                title="Count physical cash in drawer, generate Z-Read report"
                                @click="shiftStore.shiftOutOpen = true"
                            >
                                <Calculator class="w-3.5 h-3.5 text-rose-600" />
                                <span>End Shift</span>
                            </button>
                        </template>
                    </div>
                </div>

                <form
                    class="mt-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center"
                    @submit.prevent="onScanSubmit"
                >
                    <div
                        class="flex items-center bg-slate-50 border border-slate-300 rounded-xl pl-3 pr-1 py-1 shrink-0"
                    >
                        <span
                            class="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2"
                            >Qty:</span
                        >
                        <select
                            v-model.number="scanMultiplier"
                            aria-label="Quantity per scan"
                            class="min-h-11 min-w-11 px-1 bg-transparent text-slate-900 font-extrabold text-sm cursor-pointer rounded focus-ring"
                            @change="onMultiplierChange"
                        >
                            <option v-for="q in qtyOptions" :key="q" :value="q">
                                {{ q }}x
                            </option>
                        </select>
                    </div>

                    <div class="relative flex-1">
                        <div
                            class="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-slate-400"
                        >
                            <Barcode class="w-5 h-5 text-slate-600" />
                        </div>
                        <input
                            ref="scanInput"
                            v-model="searchQuery"
                            :disabled="isTicketLocked"
                            type="text"
                            placeholder="Scan barcode, enter EAN, or search item..."
                            data-testid="scan-input"
                            aria-label="Scan barcode or search items"
                            :aria-keyshortcuts="REGISTER_KEYS.SCAN"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-controls="product-matches"
                            :aria-expanded="search.matches.value.length > 0"
                            :aria-activedescendant="
                                search.highlighted.value === -1
                                    ? undefined
                                    : `product-match-${search.highlighted.value}`
                            "
                            class="w-full min-h-14 pl-11 pr-48 py-3 bg-slate-50 text-slate-900 placeholder-slate-400 text-sm font-mono font-bold rounded-xl border border-slate-300 focus:border-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900/10 focus:outline-none transition-all"
                            @input="onSearchChange"
                            @keydown.down.prevent="search.move(1)"
                            @keydown.up.prevent="search.move(-1)"
                            @keydown.esc="search.highlighted.value = -1"
                        />
                        <div
                            class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1"
                        >
                            <button
                                v-if="searchQuery"
                                type="button"
                                aria-label="Clear search"
                                class="min-h-11 min-w-11 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg focus-ring"
                                @click="clearQuery"
                            >
                                <X class="w-4 h-4" aria-hidden="true" />
                            </button>
                            <KeyHint>{{ REGISTER_KEYS.SCAN }}</KeyHint>
                            <button
                                type="submit"
                                :disabled="isTicketLocked"
                                class="min-h-11 min-w-11 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase rounded-lg shadow-2xs transition-colors active:scale-[0.98] focus-ring"
                            >
                                Enter / Scan
                            </button>
                        </div>
                    </div>
                </form>

                <!--
                    The multiplier applies to the next scan only (decision
                    2026-09-25, #23), whether set with the Qty picker or
                    typed as "12*".
                -->
                <div role="status" aria-live="polite">
                    <p
                        v-if="nextScanQty > 1"
                        data-testid="multiplier-badge"
                        class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-sm font-extrabold"
                    >
                        ×{{ nextScanQty }} on next scan
                    </p>
                </div>

                <!--
                    Scan results are announced (#23): a success politely and
                    it fades; an error assertively and it stays until the
                    next scan. Both regions are always present, so a screen
                    reader hears what appears in them.
                -->
                <div role="status" aria-live="polite" data-testid="scan-status">
                    <div
                        v-if="scanFeedback?.type === 'success'"
                        class="mt-2.5 p-2.5 rounded-xl flex items-center gap-2 text-sm font-bold bg-emerald-50 border border-emerald-200 text-emerald-800"
                    >
                        <CheckCircle2
                            class="w-4 h-4 text-emerald-600 shrink-0"
                            aria-hidden="true"
                        />
                        <span>{{ scanFeedback.message }}</span>
                    </div>
                </div>
                <div
                    role="alert"
                    aria-live="assertive"
                    data-testid="scan-alert"
                >
                    <div
                        v-if="scanFeedback?.type === 'error'"
                        class="mt-2.5 p-2.5 rounded-xl flex items-center gap-2 text-sm font-bold bg-red-50 border border-red-200 text-red-800"
                    >
                        <AlertCircle
                            class="w-4 h-4 text-red-600 shrink-0"
                            aria-hidden="true"
                        />
                        <span>{{ scanFeedback.message }}</span>
                    </div>
                </div>
            </div>

            <!-- Live matches -->
            <div
                v-if="searchQuery.trim().length > 0"
                class="bg-slate-50 border-b border-slate-200 p-4 shadow-inner max-h-72 overflow-y-auto z-20"
            >
                <div class="flex items-center justify-between mb-2">
                    <div
                        class="flex items-center gap-1.5 text-slate-700 font-bold text-xs uppercase tracking-wider"
                    >
                        <Search class="w-3.5 h-3.5" />
                        <span
                            >Matching Items ({{
                                search.matches.value.length
                            }})</span
                        >
                    </div>
                    <span class="text-xs text-slate-500"
                        >Click an item, or pick with ↑/↓ and press Enter</span
                    >
                </div>

                <div
                    v-if="search.error.value"
                    data-testid="search-error"
                    role="alert"
                    class="py-3 px-3 flex items-center justify-center gap-2 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold"
                >
                    <AlertCircle class="w-4 h-4 text-red-600 shrink-0" />
                    <span
                        >Couldn't search products:
                        {{ search.error.value }}</span
                    >
                </div>
                <div
                    v-else-if="search.matches.value.length === 0"
                    data-testid="search-empty"
                    class="py-4 text-center text-slate-500 text-xs font-semibold"
                >
                    <template v-if="search.settled.value">
                        No item matching "{{ searchTerm }}". Check barcode
                        number or search by name.
                    </template>
                    <template v-else>Searching…</template>
                </div>
                <div
                    v-else
                    id="product-matches"
                    role="listbox"
                    data-testid="search-matches"
                    class="grid grid-cols-1 sm:grid-cols-2 gap-2 transition-opacity"
                    :class="{ 'opacity-50': !search.settled.value }"
                    :aria-busy="!search.settled.value"
                >
                    <button
                        v-for="(m, i) in search.matches.value"
                        :id="`product-match-${i}`"
                        :key="m.product"
                        type="button"
                        role="option"
                        data-testid="search-match"
                        :aria-selected="i === search.highlighted.value"
                        :disabled="isTicketLocked"
                        class="p-3 bg-white border rounded-xl hover:border-slate-800 hover:shadow-xs transition-all flex items-center justify-between text-left group focus-ring"
                        :class="
                            i === search.highlighted.value
                                ? 'border-slate-900 ring-2 ring-slate-900/20'
                                : 'border-slate-200'
                        "
                        @click="selectMatch(m, nextScanQty)"
                    >
                        <div>
                            <h4
                                class="text-xs sm:text-sm font-bold text-slate-900 line-clamp-1"
                            >
                                {{ m.name }}
                            </h4>
                            <p class="text-xs font-mono text-slate-500 mt-0.5">
                                EAN: {{ m.EAN }}
                            </p>
                        </div>
                        <span
                            class="text-xs font-bold text-slate-600 group-hover:text-slate-900 pl-3 shrink-0"
                        >
                            Add
                        </span>
                    </button>
                </div>
            </div>

            <!-- Ticket table -->
            <div
                class="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 flex flex-col justify-between"
            >
                <div
                    class="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col h-full"
                >
                    <div
                        class="px-5 py-3.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between"
                    >
                        <div class="flex items-center gap-2">
                            <ShoppingBag class="w-4 h-4 text-slate-700" />
                            <h2
                                class="text-xs sm:text-sm font-extrabold text-slate-900 uppercase tracking-wide"
                            >
                                Active Register Ticket
                            </h2>
                        </div>
                        <div class="flex items-center gap-3">
                            <span
                                class="bg-slate-200/80 text-slate-800 text-xs font-bold px-2.5 py-0.5 rounded-full"
                            >
                                {{ cartStore.totalUnits }} Units
                            </span>
                            <button
                                v-if="cartStore.items.length"
                                type="button"
                                :disabled="isTicketLocked"
                                class="min-h-11 text-xs font-bold text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors focus-ring"
                                @click="voidTicket"
                            >
                                Void Ticket
                            </button>
                        </div>
                    </div>

                    <div
                        v-if="cartStore.items.length === 0"
                        class="py-20 px-6 text-center text-slate-400 flex-1 flex flex-col items-center justify-center"
                    >
                        <div
                            class="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center mb-3"
                        >
                            <Barcode class="w-7 h-7" />
                        </div>
                        <h3 class="text-base font-bold text-slate-800">
                            Register Ready
                        </h3>
                        <p
                            class="text-xs sm:text-sm text-slate-500 max-w-sm mt-1 leading-relaxed"
                        >
                            Scan a barcode, enter a EAN code, or search an item
                            above to ring up products.
                        </p>
                    </div>

                    <div v-else class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr
                                    class="border-b border-slate-200 bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider"
                                >
                                    <th class="py-2.5 px-4 w-10 text-center">
                                        #
                                    </th>
                                    <th class="py-2.5 px-4">
                                        Item Description
                                    </th>
                                    <th class="py-2.5 px-4 font-mono">EAN</th>
                                    <th class="py-2.5 px-4 text-right">
                                        Price
                                    </th>
                                    <th class="py-2.5 px-4 text-center">
                                        Quantity
                                    </th>
                                    <th class="py-2.5 px-4 text-right">
                                        Line Total
                                    </th>
                                    <th class="py-2.5 px-4 text-center w-14">
                                        Void
                                    </th>
                                </tr>
                            </thead>
                            <tbody
                                class="divide-y divide-slate-100 text-slate-800 text-xs sm:text-sm"
                            >
                                <!--
                                    A line is selected by scanning it or
                                    clicking it (#23): F4 edits its
                                    quantity, Delete removes it (with Undo).
                                -->
                                <tr
                                    v-for="(item, index) in cartStore.items"
                                    :key="item.product"
                                    :ref="
                                        (el) =>
                                            setLineEl(
                                                item.product,
                                                el as HTMLElement | null,
                                            )
                                    "
                                    tabindex="-1"
                                    data-ticket-line
                                    :data-product="item.product"
                                    :data-testid="`ticket-line-${index}`"
                                    :aria-current="
                                        selectedLine === item.product
                                            ? 'true'
                                            : undefined
                                    "
                                    class="transition-colors outline-none focus:ring-2 focus:ring-inset focus:ring-slate-900/30"
                                    :class="
                                        selectedLine === item.product
                                            ? 'bg-sky-50'
                                            : 'hover:bg-slate-50/80'
                                    "
                                    @click="onLineClick(item.product, $event)"
                                    @focusin="selectedLine = item.product"
                                    @keydown.up.self.prevent="moveSelection(-1)"
                                    @keydown.down.self.prevent="
                                        moveSelection(1)
                                    "
                                >
                                    <td
                                        class="py-3 px-4 text-center font-bold text-slate-400"
                                    >
                                        {{ index + 1 }}
                                    </td>
                                    <td class="py-3 px-4">
                                        <div
                                            class="font-bold text-slate-900 text-sm"
                                        >
                                            {{ item.name }}
                                        </div>
                                    </td>
                                    <td
                                        class="py-3 px-4 font-mono text-xs text-slate-500"
                                    >
                                        {{ item.EAN }}
                                    </td>
                                    <td
                                        class="py-3 px-4 text-right font-medium text-slate-600"
                                    >
                                        {{ currency(item.unitPrice) }}
                                    </td>
                                    <td class="py-3 px-4 text-center">
                                        <div
                                            class="inline-flex items-center bg-white border border-slate-300 rounded-lg p-0.5 shadow-2xs"
                                        >
                                            <button
                                                type="button"
                                                :disabled="isTicketLocked"
                                                :aria-label="`One less ${item.name}`"
                                                class="w-11 h-11 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-ring"
                                                @click="decrement(item)"
                                            >
                                                <Minus
                                                    class="w-4 h-4"
                                                    aria-hidden="true"
                                                />
                                            </button>
                                            <input
                                                :ref="
                                                    (el) =>
                                                        setQtyEl(
                                                            item.product,
                                                            el as HTMLInputElement | null,
                                                        )
                                                "
                                                type="text"
                                                inputmode="numeric"
                                                autocomplete="off"
                                                :value="
                                                    qtyDrafts[item.product] ??
                                                    String(item.quantity)
                                                "
                                                :disabled="isTicketLocked"
                                                :aria-label="`Quantity of ${item.name}`"
                                                :aria-keyshortcuts="
                                                    REGISTER_KEYS.LINE_QUANTITY
                                                "
                                                :aria-invalid="
                                                    !!qtyErrors[item.product]
                                                "
                                                :aria-describedby="
                                                    qtyErrors[item.product]
                                                        ? `qty-error-${index}`
                                                        : undefined
                                                "
                                                data-testid="line-quantity"
                                                class="w-14 h-11 text-center font-bold text-slate-900 text-sm rounded border focus:outline-none focus:border-slate-800"
                                                :class="
                                                    qtyErrors[item.product]
                                                        ? 'border-red-400 bg-red-50'
                                                        : 'border-transparent'
                                                "
                                                @focus="
                                                    selectedLine = item.product
                                                "
                                                @input="
                                                    onQtyInput(
                                                        item.product,
                                                        $event,
                                                    )
                                                "
                                                @change="
                                                    commitQuantity(item.product)
                                                "
                                                @keydown.enter.prevent="
                                                    onQtyEnter(item.product)
                                                "
                                                @keydown.esc.prevent.stop="
                                                    cancelQuantity(item.product)
                                                "
                                            />
                                            <button
                                                type="button"
                                                :disabled="isTicketLocked"
                                                :aria-label="`One more ${item.name}`"
                                                class="w-11 h-11 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-ring"
                                                @click="increment(item)"
                                            >
                                                <Plus
                                                    class="w-4 h-4"
                                                    aria-hidden="true"
                                                />
                                            </button>
                                        </div>
                                        <p
                                            v-if="qtyErrors[item.product]"
                                            :id="`qty-error-${index}`"
                                            data-testid="line-quantity-error"
                                            class="mt-1 text-xs font-semibold text-red-600"
                                        >
                                            {{ qtyErrors[item.product] }}
                                        </p>
                                    </td>
                                    <td
                                        class="py-3 px-4 text-right font-bold text-slate-900"
                                    >
                                        {{
                                            currency(
                                                item.unitPrice * item.quantity,
                                            )
                                        }}
                                    </td>
                                    <td class="py-3 px-4 text-center">
                                        <button
                                            type="button"
                                            :disabled="isTicketLocked"
                                            :aria-label="`Remove ${item.name}`"
                                            :aria-keyshortcuts="
                                                REGISTER_KEYS.REMOVE_LINE
                                            "
                                            class="min-h-11 min-w-11 inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors focus-ring"
                                            @click="removeLine(item.product)"
                                        >
                                            <Trash2
                                                class="w-4 h-4"
                                                aria-hidden="true"
                                            />
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!--
                        A removed line can be put back for a few seconds
                        (decision 2026-09-25, #23).
                    -->
                    <div role="status" aria-live="polite" class="mt-auto">
                        <div
                            v-if="undo"
                            data-testid="undo-bar"
                            class="m-3 p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-3 text-sm font-semibold"
                        >
                            <span
                                >Removed {{ undo.item.quantity }}×
                                {{ undo.item.name }}</span
                            >
                            <button
                                type="button"
                                :disabled="isTicketLocked"
                                class="min-h-11 px-4 py-2 rounded-lg bg-white text-slate-900 text-sm font-extrabold hover:bg-slate-100 focus-ring"
                                @click="undoRemove"
                            >
                                Undo
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!--
                Below lg (product decision 2026-09-25, #26): the total and
                a button that opens the tender panel as a sheet over the
                ticket. The ticket above takes the rest and scrolls.
            -->
            <div
                v-if="!isLarge"
                data-testid="tender-footer"
                class="shrink-0 border-t border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-2px_8px_rgba(15,23,42,0.06)]"
            >
                <div class="min-w-0">
                    <p
                        class="text-xs font-bold uppercase tracking-wider text-slate-500"
                    >
                        Amount Due · {{ cartStore.totalUnits }} Units
                    </p>
                    <p
                        data-testid="footer-total"
                        class="text-2xl font-black text-slate-900 tracking-tight truncate"
                    >
                        {{ currency(total) }}
                    </p>
                </div>
                <button
                    type="button"
                    data-testid="open-tender"
                    aria-haspopup="dialog"
                    :aria-expanded="tender.isSheet.value"
                    aria-controls="tender-panel"
                    class="min-h-11 min-w-11 px-5 py-3 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white rounded-xl font-extrabold text-base flex items-center justify-center gap-2 shadow-xs transition-all focus-ring shrink-0"
                    @click="tender.show()"
                >
                    <CreditCard class="w-5 h-5" aria-hidden="true" />
                    <span>Tender</span>
                </button>
            </div>
        </div>

        <!--
            RIGHT: the tender panel. From lg up it sits beside the ticket
            (the teleport is off, the wrapper is display: contents). Below
            lg it lives under <body> as a sheet on the modal stack, shown
            from the footer's Tender button (#26).
        -->
        <Teleport to="body" :disabled="isLarge">
            <div
                ref="tenderRoot"
                data-testid="tender-root"
                :class="
                    isLarge
                        ? 'contents'
                        : tender.isSheet.value
                          ? 'fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm'
                          : 'hidden'
                "
                @mousedown.self="tender.hide()"
            >
                <div
                    id="tender-panel"
                    ref="tenderPanel"
                    data-testid="tender-panel"
                    :role="isLarge ? undefined : 'dialog'"
                    :aria-modal="isLarge ? undefined : 'true'"
                    :aria-label="isLarge ? undefined : 'Tender'"
                    :tabindex="isLarge ? undefined : -1"
                    class="w-full lg:w-[400px] bg-white lg:border-l border-slate-200 flex flex-col justify-between shrink-0 shadow-xs z-30 max-h-[90vh] overflow-y-auto rounded-t-2xl lg:max-h-none lg:overflow-visible lg:rounded-none focus:outline-none"
                >
                    <div
                        v-if="!isLarge"
                        class="flex items-center justify-between px-6 pt-4"
                    >
                        <h2
                            class="text-base font-extrabold text-slate-900 uppercase tracking-wide"
                        >
                            Tender
                        </h2>
                        <button
                            type="button"
                            aria-label="Back to ticket"
                            data-testid="close-tender"
                            class="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-ring"
                            @click="tender.hide()"
                        >
                            <X class="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>
                    <div class="p-6 space-y-4">
                        <div
                            class="flex items-center justify-between text-xs sm:text-sm"
                        >
                            <button
                                type="button"
                                class="min-h-11 text-slate-600 font-bold hover:text-slate-900 flex items-center gap-1.5 underline-offset-2 hover:underline focus-ring rounded"
                                :aria-expanded="showDiscount"
                                aria-controls="discount-options"
                                :aria-keyshortcuts="REGISTER_KEYS.DISCOUNT"
                                @click="showDiscount = !showDiscount"
                            >
                                <Percent class="w-3.5 h-3.5 text-slate-500" />
                                {{
                                    discountLabel
                                        ? `Discount Applied (${discountLabel})`
                                        : '+ Apply Discount'
                                }}
                                <KeyHint>{{ REGISTER_KEYS.DISCOUNT }}</KeyHint>
                            </button>
                            <span
                                v-if="discountAmount > 0"
                                class="text-emerald-600 font-extrabold text-sm"
                            >
                                -{{ currency(discountAmount) }}
                            </span>
                        </div>

                        <div
                            v-if="showDiscount"
                            id="discount-options"
                            ref="discountOptionsEl"
                            role="group"
                            aria-label="Discount"
                            class="flex flex-wrap items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200"
                        >
                            <span class="text-xs font-bold text-slate-500"
                                >Discount:</span
                            >
                            <button
                                v-for="d in discountOptions"
                                :key="d"
                                type="button"
                                :disabled="isTicketLocked"
                                :aria-pressed="discountChoice === d"
                                class="min-h-11 min-w-11 px-3 py-2 rounded-lg text-sm font-bold transition-colors active:scale-[0.98] focus-ring"
                                :class="
                                    discountChoice === d
                                        ? 'bg-slate-900 text-white'
                                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                "
                                @click="applyDiscount(d)"
                            >
                                {{ d === 0 ? 'None' : `${d}%` }}
                            </button>
                            <!-- A fixed peso amount (#52 follow-up, #23). -->
                            <button
                                type="button"
                                :disabled="isTicketLocked"
                                :aria-pressed="
                                    discountChoice === DiscountType.FIXED
                                "
                                class="min-h-11 min-w-11 px-3 py-2 rounded-lg text-sm font-bold transition-colors active:scale-[0.98] focus-ring"
                                :class="
                                    discountChoice === DiscountType.FIXED
                                        ? 'bg-slate-900 text-white'
                                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                "
                                @click="applyDiscount(DiscountType.FIXED)"
                            >
                                ₱ Amount
                            </button>
                        </div>

                        <div
                            v-if="discountChoice === DiscountType.FIXED"
                            class="space-y-1"
                        >
                            <label
                                for="discount-amount"
                                class="block text-xs font-bold text-slate-500"
                                >Discount amount (₱)</label
                            >
                            <input
                                id="discount-amount"
                                ref="fixedInput"
                                v-model="fixedText"
                                :disabled="isTicketLocked"
                                type="text"
                                inputmode="decimal"
                                autocomplete="off"
                                placeholder="0.00"
                                :aria-invalid="!!fixedErrorShown"
                                :aria-describedby="
                                    fixedErrorShown
                                        ? 'discount-amount-error'
                                        : undefined
                                "
                                class="w-full min-h-11 px-3 py-2 rounded-xl border bg-white text-sm font-semibold focus:outline-none focus:border-slate-800"
                                :class="
                                    fixedErrorShown
                                        ? 'border-red-300'
                                        : 'border-slate-300'
                                "
                            />
                            <p
                                v-if="fixedErrorShown"
                                id="discount-amount-error"
                                data-testid="discount-amount-error"
                                class="text-xs font-semibold text-red-600"
                            >
                                {{ fixedErrorShown }}
                            </p>
                        </div>

                        <div v-if="discountChoice !== 0" class="space-y-1">
                            <label
                                for="discount-reason"
                                class="block text-xs font-bold text-slate-500"
                                >Discount reason (required)</label
                            >
                            <input
                                id="discount-reason"
                                ref="reasonInput"
                                v-model="discountReason"
                                :disabled="isTicketLocked"
                                type="text"
                                :maxlength="STRING_LIMITS.REASON"
                                placeholder="e.g. loyalty card, damaged packaging"
                                class="w-full min-h-11 px-3 py-2 rounded-xl border bg-white text-sm font-semibold focus:outline-none focus:border-slate-800"
                                :class="
                                    needsReason
                                        ? 'border-red-300'
                                        : 'border-slate-300'
                                "
                            />
                        </div>

                        <div
                            class="space-y-2.5 text-slate-600 text-xs sm:text-sm pt-1"
                        >
                            <div class="flex justify-between font-medium">
                                <span class="text-slate-500"
                                    >Subtotal ({{
                                        cartStore.totalUnits
                                    }}
                                    Items)</span
                                >
                                <span class="text-slate-900 font-bold">{{
                                    currency(subtotal)
                                }}</span>
                            </div>
                            <div
                                v-if="discountAmount > 0"
                                class="flex justify-between text-emerald-600 font-semibold"
                            >
                                <span>Discount ({{ discountLabel }})</span>
                                <span>-{{ currency(discountAmount) }}</span>
                            </div>
                        </div>

                        <div
                            class="p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-2xs mt-3"
                        >
                            <span
                                class="text-xs font-black uppercase tracking-wider text-slate-500"
                            >
                                Amount Due
                            </span>
                            <div
                                class="flex items-baseline justify-between mt-1.5"
                            >
                                <span
                                    class="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight"
                                >
                                    {{ currency(total) }}
                                </span>
                                <span
                                    class="text-xs font-bold text-slate-700 bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs"
                                >
                                    {{ cartStore.totalUnits }} Units
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="p-6 pt-0 space-y-3">
                        <button
                            type="button"
                            class="w-full py-3.5 px-5 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-xs transition-all focus-ring"
                            :disabled="!canCheckout || isTicketLocked"
                            :aria-keyshortcuts="REGISTER_KEYS.CHARGE"
                            @click="openCheckout()"
                        >
                            <CreditCard class="w-5 h-5" />
                            <span>Tender & Charge ({{ currency(total) }})</span>
                            <ArrowRight class="w-4 h-4 ml-1" />
                            <KeyHint tone="dark">{{
                                REGISTER_KEYS.CHARGE
                            }}</KeyHint>
                        </button>

                        <div class="grid grid-cols-1 gap-2">
                            <button
                                type="button"
                                class="min-h-11 py-2.5 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center justify-center gap-1 transition-colors active:scale-[0.98] focus-ring"
                                :disabled="!canCheckout || isTicketLocked"
                                @click="openCheckout(PaymentType.SPLIT)"
                            >
                                <Split class="w-3.5 h-3.5 text-emerald-600" />
                                <span>Split Payment</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Teleport>

        <CheckoutModal
            v-model="isCheckoutOpen"
            :total="total"
            :initial-method="checkoutMethod"
            :submit="submitSale"
        />

        <ConfirmDialog :request="confirmRequest" @answer="answerConfirm" />

        <ReceiptModal
            v-model="isReceiptOpen"
            :receipt="receipt"
            :notice="receiptNotice"
            @new-sale="onNewSale"
            @scan="onReceiptScan"
        />
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    shallowRef,
    useTemplateRef,
    watch,
} from 'vue';
import {
    AlertCircle,
    ArrowDownLeft,
    ArrowRight,
    ArrowUpRight,
    Barcode,
    Calculator,
    CheckCircle2,
    CreditCard,
    Minus,
    Percent,
    Plus,
    Search,
    ShoppingBag,
    Split,
    Trash2,
    X,
} from '@lucide/vue';
import api from '@/axios';
import { type CartItem, TICKET_AMOUNT_MAX, useCartStore } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import { apiErrorCode } from '@/utils/api-error';
import { Color, useUIStore } from '@/stores/ui';
import KeyHint from '@/components/ui/KeyHint.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import CheckoutModal from '@/components/User/Sales/CheckoutModal.vue';
import ReceiptModal from '@/components/User/Sales/ReceiptModal.vue';
import type { PaymentRequest } from '@/components/User/Sales/types';
import {
    fixedDiscountError,
    paymentLabel,
    previewSale,
} from '@/components/User/Sales/checkout';
import {
    isRejectedSale,
    saleErrorMessage,
    useSaleCheckout,
} from '@/components/User/Sales/sale-submission';
import {
    isBarcode,
    type Match,
    parseScan,
    useProductSearch,
} from '@/components/User/Sales/product-search';
import {
    centavosToPesoInput,
    formatCurrency,
    parsePesos,
} from '@/utils/currency';
import { integerError } from '@/utils/rules';
import { toSaleTicket } from '@/utils/payloads';
import {
    REGISTER_KEYS,
    useRegisterShortcuts,
} from '@/composables/useRegisterShortcuts';
import { useStickyFocus } from '@/composables/useStickyFocus';
import { useIsLarge } from '@/composables/useMediaQuery';
import { useTenderSheet } from '@/composables/useTenderSheet';
import { useConfirm } from '@/composables/useConfirm';
import {
    DiscountType,
    type DiscountInput,
    DrawerMovementType,
    ErrorCode,
    PaymentType,
    type ProductView,
    type Receipt,
    STRING_LIMITS,
} from '@grocery-pos/contracts';

/** How long a removed line can be put back (decision 2026-09-25, #23). */
const UNDO_MS = 5000;
/** How long a scan success stays; an error stays until the next scan. */
const SUCCESS_MS = 2500;

const PRICES_CHANGED_NOTICE =
    'Prices changed since scanning; the receipt shows the charged amounts.';

const cartStore = useCartStore();
const uiStore = useUIStore();
const shiftStore = useShiftStore();

const scanInput = ref<HTMLInputElement | null>(null);
/** Side by side from lg up; below lg the tender panel is a sheet (#26). */
const isLarge = useIsLarge();
const tender = useTenderSheet(
    isLarge,
    useTemplateRef<HTMLElement>('tenderRoot'),
    useTemplateRef<HTMLElement>('tenderPanel'),
);
const reasonInput = ref<HTMLInputElement | null>(null);
const fixedInput = ref<HTMLInputElement | null>(null);
const discountOptionsEl = ref<HTMLElement | null>(null);
// A ticket line the cashier clicked keeps the focus, so Delete can remove
// it; a printable key typed there still goes to the scan box.
const sticky = useStickyFocus(() => scanInput.value, {
    keepOnClick: (el) => el.matches('[data-ticket-line]'),
    holdsFocus: (el) => tender.holdsFocus(el),
});
const searchQuery = ref('');
const scanMultiplier = ref(1);
const search = useProductSearch(
    async (name, signal) =>
        (
            await api.get<Match[]>('/products/matches', {
                params: { name },
                signal,
            })
        ).data,
    () => searchTerm.value,
);
/** What the live search looks for: the input minus any `<qty>*` prefix. */
const searchTerm = computed(
    () => parseScan(searchQuery.value, scanMultiplier.value).query,
);
/** The quantity the next scan adds: a typed `12*` wins over the picker. */
const nextScanQty = computed(
    () => parseScan(searchQuery.value, scanMultiplier.value).qty,
);
const scanFeedback = ref<{ type: 'success' | 'error'; message: string } | null>(
    null,
);
const isCheckoutOpen = ref(false);
const isReceiptOpen = ref(false);
const checkoutMethod = ref<PaymentType>(PaymentType.CASH);

// The server's response: the receipt and drawer read its totals, never the
// preview below.
const receipt = ref<Receipt | null>(null);
/** Shown on the receipt when the sale had already been recorded earlier. */
const receiptNotice = ref<string | null>(null);

const qtyOptions = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24];
const discountOptions = [0, 5, 10, 15, 20];

// ---- Discount: kept with the cart, so it survives leaving the page and a
// refresh (#23). A FIXED value is centavos; 0 means not typed yet.

/** The picked option: 0 (none), a percent, or FIXED. */
const discountChoice = computed<number | DiscountType.FIXED>(() => {
    const d = cartStore.discount;
    if (!d) return 0;
    return d.type === DiscountType.FIXED ? DiscountType.FIXED : d.value;
});
const showDiscount = ref(cartStore.discount !== null);
/** The typed fixed amount, in pesos. */
const fixedText = ref(
    cartStore.discount?.type === DiscountType.FIXED && cartStore.discount.value
        ? centavosToPesoInput(cartStore.discount.value)
        : '',
);
const fixedError = computed(() =>
    discountChoice.value === DiscountType.FIXED
        ? fixedDiscountError(fixedText.value, cartStore.subtotal)
        : '',
);
/** Shown once something is typed: an untouched field is only "required". */
const fixedErrorShown = computed(() =>
    fixedText.value.trim() ? fixedError.value : '',
);

watch(fixedText, (text) => {
    const d = cartStore.discount;
    if (d?.type !== DiscountType.FIXED) return;
    const centavos = parsePesos(text);
    cartStore.setDiscount({
        ...d,
        value: centavos !== null && centavos > 0 ? centavos : 0,
    });
});

// The discount changed outside this page (another tab, #23 review): show
// it. Typing here round-trips through the store and changes nothing.
watch(
    () => cartStore.discount,
    (d, before) => {
        if (d && !before) showDiscount.value = true;
        if (d?.type !== DiscountType.FIXED) return;
        const typed = parsePesos(fixedText.value);
        if ((typed !== null && typed > 0 ? typed : 0) !== d.value) {
            fixedText.value = d.value ? centavosToPesoInput(d.value) : '';
        }
    },
    { deep: true },
);

const discountReason = computed({
    get: () => cartStore.discount?.reason ?? '',
    set: (reason: string) => {
        const d = cartStore.discount;
        if (d) cartStore.setDiscount({ ...d, reason });
    },
});

const discountRequest = computed<DiscountInput | null>(() => {
    const d = cartStore.discount;
    return d ? { type: d.type, value: d.value, reason: d.reason.trim() } : null;
});
const discountLabel = computed(() => {
    const d = cartStore.discount;
    if (!d || d.value <= 0) return '';
    return d.type === DiscountType.PERCENT
        ? `${d.value}%`
        : formatCurrency(d.value);
});
// Preview for display and tendering only; the server computes the charge.
const preview = computed(() =>
    previewSale(cartStore.subtotal, discountRequest.value),
);
const subtotal = computed(() => preview.value.subtotal);
const discountAmount = computed(() => preview.value.discountAmount);
const total = computed(() => preview.value.total);
const needsReason = computed(
    () => discountRequest.value !== null && !discountRequest.value.reason,
);

// ---- Ticket lines (#23)

/** The selected line's product: scanned last, or clicked. */
const selectedLine = ref<string | null>(null);
/** Quantities being typed, by product, until they are committed. */
const qtyDrafts = reactive<Record<string, string>>({});
const lineEls = new Map<string, HTMLElement>();
const qtyEls = new Map<string, HTMLInputElement>();

/** The typed quantity as the rules see it: a number when it is one. */
function typedQuantity(text: string): unknown {
    const trimmed = text.trim();
    return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** Why a typed quantity is refused (`@IsInt() @Min(1)`), or ''. */
function quantityError(product: string, text: string): string {
    const value = typedQuantity(text);
    if (!cartStore.items.some((i) => i.product === product)) return '';
    const error = integerError(value, { min: 1 });
    if (error) return error;
    const item = cartStore.items.find((i) => i.product === product);
    // A line gone (e.g. removed in another tab) has nothing to check.
    if (!item) return '';
    const max = cartStore.maxQuantity(product, item.unitPrice);
    return (value as number) > max
        ? `At most ${max}: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}`
        : '';
}

const qtyErrors = computed<Record<string, string>>(() =>
    Object.fromEntries(
        Object.entries(qtyDrafts)
            .map(([product, text]): [string, string] => [
                product,
                quantityError(product, text),
            ])
            .filter(([, error]) => error),
    ),
);

const canCheckout = computed(
    () =>
        cartStore.items.length > 0 &&
        !needsReason.value &&
        !fixedError.value &&
        Object.keys(qtyErrors.value).length === 0 &&
        preview.value.isChargeable,
);

function setLineEl(product: string, el: HTMLElement | null) {
    if (el) lineEls.set(product, el);
    else lineEls.delete(product);
}

function setQtyEl(product: string, el: HTMLInputElement | null) {
    if (el) qtyEls.set(product, el);
    else qtyEls.delete(product);
}

function onLineClick(product: string, event: MouseEvent) {
    selectedLine.value = product;
    // A click on the row itself (not its buttons or quantity) takes the
    // focus, so Delete removes it.
    const target = event.target as HTMLElement | null;
    if (!target?.closest('button, input')) {
        lineEls.get(product)?.focus({ preventScroll: true });
    }
}

function moveSelection(delta: number) {
    const items = cartStore.items;
    if (!items.length) return;
    const at = items.findIndex((i) => i.product === selectedLine.value);
    const next = Math.min(Math.max(at + delta, 0), items.length - 1);
    selectedLine.value = items[next].product;
    lineEls.get(items[next].product)?.focus({ preventScroll: true });
}

function onQtyInput(product: string, event: Event) {
    qtyDrafts[product] = (event.target as HTMLInputElement).value;
}

/** Applies a typed quantity; false (and the error shown) when refused. */
function commitQuantity(product: string): boolean {
    const text = qtyDrafts[product];
    if (text === undefined) return true;
    if (quantityError(product, text)) return false;
    cartStore.setQuantity(product, Number(text.trim()));
    delete qtyDrafts[product];
    return true;
}

function onQtyEnter(product: string) {
    if (commitQuantity(product)) scanInput.value?.focus();
}

/** Escape: back to the line's quantity, and the focus to the line. */
function cancelQuantity(product: string) {
    delete qtyDrafts[product];
    const qty = qtyEls.get(product);
    const item = cartStore.items.find((i) => i.product === product);
    if (qty && item) qty.value = String(item.quantity);
    lineEls.get(product)?.focus({ preventScroll: true });
}

/** F4: the selected line's quantity, else the last line's. */
function focusLineQuantity() {
    const items = cartStore.items;
    if (!items.length || isTicketLocked.value) return;
    const product = items.some((i) => i.product === selectedLine.value)
        ? selectedLine.value!
        : items[items.length - 1].product;
    selectedLine.value = product;
    const qty = qtyEls.get(product);
    qty?.focus();
    qty?.select();
}

function increment(item: CartItem) {
    selectedLine.value = item.product;
    delete qtyDrafts[item.product];
    cartStore.setQuantity(item.product, item.quantity + 1);
}

function decrement(item: CartItem) {
    selectedLine.value = item.product;
    delete qtyDrafts[item.product];
    if (item.quantity <= 1) removeLine(item.product);
    else cartStore.setQuantity(item.product, item.quantity - 1);
}

// ---- Line removal with Undo (decision 2026-09-25, #23)

const undo = shallowRef<{ item: CartItem; index: number } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

function dismissUndo() {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = undefined;
    undo.value = null;
}

/** Removes a line at once; it can be put back for UNDO_MS. */
function removeLine(product: string) {
    if (cartStore.locked) return;
    const hadFocus = lineEls.get(product)?.contains(document.activeElement);
    const removed = cartStore.remove(product);
    if (!removed) return;
    delete qtyDrafts[product];

    dismissUndo();
    undo.value = removed;
    undoTimer = setTimeout(dismissUndo, UNDO_MS);

    // The selection moves to the line that took its place (or the one
    // before), so Delete can go on removing.
    const items = cartStore.items;
    const next = items[removed.index] ?? items[removed.index - 1] ?? null;
    selectedLine.value = next?.product ?? null;
    if (hadFocus) {
        void nextTick(() => {
            const el = next && lineEls.get(next.product);
            if (el) el.focus({ preventScroll: true });
            else scanInput.value?.focus();
        });
    }
}

/**
 * Delete: only with the focus on a ticket line or one of its buttons, so
 * it never removes a line from the discount, the Qty picker or nowhere.
 */
function removeSelected() {
    const line =
        document.activeElement?.closest<HTMLElement>('[data-ticket-line]');
    // The line the focus is on, which focusing it also selected.
    const product = line?.dataset.product;
    if (product) removeLine(product);
}

function undoRemove() {
    const removed = undo.value;
    dismissUndo();
    if (!removed) return;
    if (cartStore.restore(removed.item, removed.index)) {
        selectedLine.value = removed.item.product;
    } else if (
        !cartStore.items.some((i) => i.product === removed.item.product)
    ) {
        uiStore.queueMessage(
            Color.ERROR,
            `Couldn't put back ${removed.item.quantity}x ${removed.item.name}: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}.`,
        );
    }
    scanInput.value?.focus();
}

/**
 * Lines can go without this page removing them: another tab's sale, void
 * or edit (#23 review). What the page kept for them goes too: a typed
 * quantity (it would hold the charge with no field to show why), the
 * selection and a pending Undo.
 */
watch(
    () => cartStore.items.map((i) => i.product),
    (products) => {
        const onTicket = new Set(products);
        for (const product of Object.keys(qtyDrafts)) {
            if (!onTicket.has(product)) delete qtyDrafts[product];
        }
        if (selectedLine.value && !onTicket.has(selectedLine.value)) {
            selectedLine.value = null;
        }
    },
);
// Another tab replaced the basket: an Undo from before would put a line
// back into a ticket it no longer belongs to.
watch(() => cartStore.remoteChanges, dismissUndo);

// ---- Scanning

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

function currency(value: number): string {
    return formatCurrency(value);
}

function showFeedback(type: 'success' | 'error', message: string) {
    scanFeedback.value = { type, message };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = undefined;
    if (type === 'success') {
        feedbackTimer = setTimeout(() => {
            scanFeedback.value = null;
        }, SUCCESS_MS);
    }
}

/** A new scan starts: the last one's message goes. */
function clearFeedback() {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = undefined;
    scanFeedback.value = null;
}

function cancelPendingSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = undefined;
}

/**
 * Clears the input after an item is added, but only if it still holds the
 * text that was submitted: a scanner can start the next barcode while this
 * lookup is in flight, and those digits must survive. The multiplier was
 * for this scan only (decision 2026-09-25, #23): back to 1.
 */
function resetQuery(submitted: string) {
    scanMultiplier.value = 1;
    scanInput.value?.focus();
    if (searchQuery.value !== submitted) return;
    cancelPendingSearch();
    search.reset();
    searchQuery.value = '';
}

/**
 * A multiplier was picked: back to the scan box, always (issue #22). A
 * select keeps its focus otherwise, and a scan's digits would then act as
 * type-ahead on it (changing the multiplier) instead of being scanned.
 * Arrowing through a closed select therefore moves one step per visit;
 * Alt+↓ or Space opens the list, which commits one pick with Enter, and
 * typing a number on it (e.g. "6") picks that entry directly.
 */
function onMultiplierChange() {
    scanInput.value?.focus();
}

function clearQuery() {
    cancelPendingSearch();
    search.reset();
    searchQuery.value = '';
    scanInput.value?.focus();
}

function onSearchChange() {
    cancelPendingSearch();
    // A highlight picked for the previous text must not ride along to Enter.
    search.highlighted.value = -1;
    const term = searchTerm.value;
    if (!term) {
        search.reset();
        return;
    }
    searchTimer = setTimeout(() => {
        searchTimer = undefined;
        void search.search(term);
    }, 250);
}

// The register's own match list keeps the highlighted option in view (#23).
watch(
    () => search.highlighted.value,
    async (index) => {
        if (index < 0) return;
        await nextTick();
        document
            .getElementById(`product-match-${index}`)
            ?.scrollIntoView?.({ block: 'nearest' });
    },
);

/**
 * Enter / the Scan button. In order:
 * 1. a highlighted match (picked with the arrow keys) is added;
 * 2. a complete barcode (EAN-13, UPC-A or EAN-8 with a valid check
 *    digit, `isBarcode`) is looked up exactly, as a scanner expects;
 * 3. otherwise the input is searched now, and a single match of a *name*
 *    is added straight away. A digits-only fragment is never auto-added,
 *    even with one match: it may be the tail of a scan that lost its first
 *    digits, or a short number that happens to hit one product;
 * 4. every other outcome (a digit fragment, no match, several matches, a
 *    failed search) gets a message, and the cashier picks from the list.
 * Nothing happens while the ticket is locked for checkout.
 */
async function onScanSubmit() {
    if (cartStore.locked) return;
    const submitted = searchQuery.value;
    const { qty, query } = parseScan(submitted, scanMultiplier.value);
    if (!query) return;
    clearFeedback();

    const picked = search.highlightedMatch();
    if (picked) {
        await selectMatch(picked, qty, submitted);
        return;
    }

    if (isBarcode(query)) {
        await lookUpBarcode(query, qty, submitted);
        return;
    }

    cancelPendingSearch();
    const found = await search.search(query);
    // The input changed, was cleared, or a newer search (a second Enter)
    // took over: that one reports instead.
    if (searchTerm.value !== query || !search.settled.value) return;
    // Superseded (null without an error): the newer search reports.
    if (found === null && !search.error.value) return;

    if (found === null) {
        showFeedback(
            'error',
            `Couldn't search products: ${search.error.value}`,
        );
    } else if (found.length === 0) {
        showFeedback('error', `No item matching "${query}"`);
    } else if (found.length === 1 && !/^\d+$/.test(query)) {
        await selectMatch(found[0], qty, submitted);
    } else {
        const count =
            found.length === 1
                ? '1 item matches'
                : `${found.length} items match`;
        showFeedback(
            'error',
            `${count} "${query}": pick it with ↓ and Enter, or click it`,
        );
    }
}

async function lookUpBarcode(EAN: string, qty: number, submitted: string) {
    try {
        const res = await api.get<ProductView>(
            `/products/${encodeURIComponent(EAN)}`,
        );
        addProduct(res.data, qty, submitted);
    } catch (error) {
        if (apiErrorCode(error) === ErrorCode.PRODUCT_NOT_FOUND) {
            showFeedback('error', `Barcode "${EAN}" not found`);
        } else {
            showFeedback('error', 'Could not look up that code');
        }
    }
}

async function selectMatch(
    match: Match,
    qty: number,
    submitted = searchQuery.value,
) {
    if (cartStore.locked) return;
    clearFeedback();
    try {
        const res = await api.get<ProductView>(
            `/products/${encodeURIComponent(match.EAN)}`,
        );
        addProduct(res.data, qty, submitted);
    } catch {
        showFeedback('error', `"${match.name}" could not be added`);
    }
}

function addProduct(product: ProductView, quantity: number, submitted: string) {
    if (cartStore.locked) {
        showFeedback('error', 'Wait for the sale to finish recording');
        return;
    }
    const added = cartStore.add(
        {
            product: product._id,
            EAN: product.EAN,
            name: product.name,
            unitPrice: product.price,
        },
        quantity,
    );
    if (!added) {
        // Nothing was added: the multiplier and the text stay for a retry.
        showFeedback(
            'error',
            `Can't add ${quantity}x ${product.name}: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}`,
        );
        return;
    }
    // Rung up again: the removed line is not put back on top of it.
    if (undo.value?.item.product === product._id) dismissUndo();
    selectedLine.value = product._id;
    showFeedback(
        'success',
        `Scanned: ${quantity > 1 ? `${quantity}x ` : ''}${product.name}`,
    );
    resetQuery(submitted);
}

// ---- Discount actions

/** Resets the discount's on-page state; the cart holds the discount. */
function resetDiscountUi() {
    fixedText.value = '';
    showDiscount.value = false;
}

function applyDiscount(choice: number | DiscountType.FIXED) {
    if (cartStore.locked) return;
    if (choice === 0) {
        cartStore.setDiscount(null);
        resetDiscountUi();
        return;
    }
    const reason = cartStore.discount?.reason ?? '';
    if (choice === DiscountType.FIXED) {
        const centavos = parsePesos(fixedText.value);
        cartStore.setDiscount({
            type: DiscountType.FIXED,
            value: centavos !== null && centavos > 0 ? centavos : 0,
            reason,
        });
        void focusField(fixedInput);
        return;
    }
    cartStore.setDiscount({
        type: DiscountType.PERCENT,
        value: choice,
        reason,
    });
    // The reason is required: take the cashier straight to it.
    if (!reason.trim()) void focusField(reasonInput);
}

async function focusField(field: typeof reasonInput) {
    await nextTick();
    field.value?.focus();
}

// ---- Void Ticket (decision 2026-09-25, #23: it asks first)

const {
    request: confirmRequest,
    confirm,
    answer: answerConfirm,
} = useConfirm();

async function voidTicket() {
    if (cartStore.locked || !cartStore.items.length) return;
    const units = cartStore.totalUnits;
    const ok = await confirm({
        title: 'Void Ticket',
        message: `Void this ticket of ${units} ${units === 1 ? 'item' : 'items'}?`,
        confirmLabel: 'Void Ticket',
        cancelLabel: 'Keep Ticket',
        danger: true,
    });
    if (!ok || cartStore.locked) return;
    cartStore.clear();
    resetDiscountUi();
    dismissUndo();
    for (const product of Object.keys(qtyDrafts)) delete qtyDrafts[product];
    selectedLine.value = null;
    // An identical next ticket must not replay a sale this one may have
    // recorded before its response was lost.
    checkout.discardKey();
}

// ---- Checkout

function openCheckout(method: PaymentType = PaymentType.CASH) {
    // A quantity still being typed (F9 from its field) counts first; the
    // checkout must tender the ticket as it will be sent.
    const typing = Object.keys(qtyDrafts);
    if (!typing.map(commitQuantity).every(Boolean) || !canCheckout.value) {
        return;
    }
    checkoutMethod.value = method;
    isCheckoutOpen.value = true;
}

const checkout = useSaleCheckout({
    cart: cartStore,
    ticket: () => toSaleTicket(cartStore.items, discountRequest.value),
    post: async (body) => (await api.post<Receipt>('/sales', body)).data,
    // Saved with the basket (#23 review): a retry after a refresh or crash
    // mid-sale reuses the key, so the server replays the recorded sale.
    attemptStore: {
        get: () => cartStore.attempt,
        set: (attempt) => cartStore.setAttempt(attempt),
    },
});

/** True while `POST /sales` is in flight: the ticket cannot be edited. */
const isTicketLocked = computed(() => cartStore.locked);

// Nothing on the ticket may be undone or typed over once it is being sold.
watch(isTicketLocked, (locked) => {
    if (locked) dismissUndo();
});

/**
 * Called by the checkout modal, which stays open until this settles. A
 * rejection carries the message the modal shows inline.
 */
async function submitSale(payment: PaymentRequest) {
    // What the cashier tendered against, priced when the items were scanned.
    const previewTotal = total.value;
    const outcome = await checkout.submit(payment).catch(explainFailure);
    receipt.value = outcome.receipt;
    receiptNotice.value = outcome.alreadyRecorded
        ? `This sale was already recorded with its original payment (${paymentLabel(outcome.receipt.paymentType)}). Settle change from this receipt, not the amount just entered.`
        : outcome.receipt.totalAmount !== previewTotal
          ? PRICES_CHANGED_NOTICE
          : null;
    resetDiscountUi();
    dismissUndo();
    for (const product of Object.keys(qtyDrafts)) delete qtyDrafts[product];
    selectedLine.value = null;
    // The ticket is sold: back to it (an empty one) under the receipt.
    tender.hide();
    isReceiptOpen.value = true;
}

/** Rejects with the cashier-facing reason a sale failed. */
async function explainFailure(error: unknown): Promise<never> {
    let message = saleErrorMessage(error);
    // No open shift on the server (e.g. an admin force-closed it): nothing
    // was recorded. Drop the local shift; the layout then sends the
    // cashier to open a new one, with the ticket kept in the cart.
    if (apiErrorCode(error) === ErrorCode.SHIFT_NOT_OPEN) {
        shiftStore.shiftClosedElsewhere();
        throw new Error(message);
    }
    // A 400 means nothing was recorded. The usual cause is a price that
    // changed since the item was scanned, so the preview total the tenders
    // were built from is stale: refresh it for the retry.
    if (isRejectedSale(error) && (await refreshCartPrices())) {
        message += ' Prices have changed and the total is updated.';
    }
    throw new Error(message);
}

/** Re-reads each cart line's price; true if any changed. */
async function refreshCartPrices(): Promise<boolean> {
    try {
        const products = await Promise.all(
            cartStore.items.map(
                async (item) =>
                    (
                        await api.get<ProductView>(
                            `/products/${encodeURIComponent(item.EAN)}`,
                        )
                    ).data,
            ),
        );
        const changed = products.some(
            (p) =>
                cartStore.items.find((item) => item.product === p._id)
                    ?.unitPrice !== p.price,
        );
        cartStore.setUnitPrices(new Map(products.map((p) => [p._id, p.price])));
        return changed;
    } catch {
        return false;
    }
}

function onNewSale() {
    isReceiptOpen.value = false;
    receipt.value = null;
    receiptNotice.value = null;
    scanInput.value?.focus();
}

/**
 * The ticket is behind the tender sheet (below lg, #26): close it first,
 * so the focus can go to the scan box or a line.
 */
async function backToTicket() {
    if (!tender.isSheet.value) return;
    tender.hide();
    await nextTick();
}

/**
 * The register's keys (issues #22, #23). Off while a modal is open; the
 * checkout answers Enter and Escape itself. Delete never fires in a text
 * field (it deletes text there): it removes the selected line when the
 * focus is on the line or one of its buttons.
 *
 * Below lg (#26) they also work while the tender sheet is on top (not
 * under a dialog): F2 and F4 close it and go to the ticket; F8 and F9
 * open it first when it is closed, then do what they do at lg (F9 then
 * opens the checkout over it). Delete does nothing in the sheet: no line
 * has the focus there.
 */
useRegisterShortcuts(
    {
        [REGISTER_KEYS.SCAN]: async () => {
            await backToTicket();
            scanInput.value?.focus();
            scanInput.value?.select();
        },
        [REGISTER_KEYS.DISCOUNT]: async () => {
            await tender.show();
            showDiscount.value = true;
            await nextTick();
            const options = [
                ...(discountOptionsEl.value?.querySelectorAll('button') ?? []),
            ];
            (
                options.find(
                    (b) => b.getAttribute('aria-pressed') === 'true',
                ) ?? options[0]
            )?.focus();
        },
        [REGISTER_KEYS.CHARGE]: async () => {
            if (canCheckout.value && !isTicketLocked.value) {
                await tender.show();
                openCheckout();
            } else if (needsReason.value) {
                await tender.show();
                void focusField(reasonInput);
            }
        },
        [REGISTER_KEYS.LINE_QUANTITY]: async () => {
            await backToTicket();
            focusLineQuantity();
        },
        [REGISTER_KEYS.REMOVE_LINE]: {
            run: removeSelected,
            whileTyping: false,
        },
    },
    { activeWhile: tender.isTop },
);

/**
 * A scan typed while the receipt was up (issue #22): the receipt closes,
 * the next sale starts, and the code goes through the scan box's own flow
 * as if it had been scanned there.
 */
function onReceiptScan(code: string) {
    onNewSale();
    searchQuery.value = code;
    void onScanSubmit();
}

onMounted(() => {
    scanInput.value?.focus();
});

onBeforeUnmount(() => {
    cancelPendingSearch();
    search.cancel();
    if (feedbackTimer) clearTimeout(feedbackTimer);
    dismissUndo();
});
</script>
