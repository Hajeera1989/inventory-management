<template>
  <div class="restocking">
    <div class="page-header">
      <h2>{{ t('restocking.title') }}</h2>
      <p>{{ t('restocking.description') }}</p>
    </div>

    <div v-if="loading" class="loading">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else>
      <div v-if="successMessage" class="success-banner">{{ successMessage }}</div>

      <div class="card budget-card">
        <div class="budget-header">
          <label for="budget-slider" class="budget-label">
            {{ t('restocking.budget') }}: <strong>{{ currencySymbol }}{{ budget.toLocaleString() }}</strong>
          </label>
        </div>
        <input
          id="budget-slider"
          type="range"
          min="10000"
          max="100000"
          step="1000"
          v-model.number="budget"
          class="budget-slider"
        />
        <div class="budget-range-labels">
          <span>{{ currencySymbol }}10,000</span>
          <span>{{ currencySymbol }}100,000</span>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card info">
          <div class="stat-label">{{ t('restocking.selectedItems') }}</div>
          <div class="stat-value">{{ selectedItems.length }}</div>
        </div>
        <div :class="['stat-card', isOverBudget ? 'danger' : 'success']">
          <div class="stat-label">{{ t('restocking.budgetUsed') }}</div>
          <div class="stat-value">{{ currencySymbol }}{{ totalCost.toLocaleString() }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ t('restocking.budgetRemaining') }}</div>
          <div class="stat-value">{{ currencySymbol }}{{ budgetRemaining.toLocaleString() }}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">{{ t('demand.demandForecasts') }}</h3>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>{{ t('restocking.table.select') }}</th>
                <th>{{ t('restocking.table.sku') }}</th>
                <th>{{ t('restocking.table.itemName') }}</th>
                <th>{{ t('restocking.table.unitCost') }}</th>
                <th>{{ t('restocking.table.forecastedDemand') }}</th>
                <th>{{ t('restocking.table.lineTotal') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in rankedItems" :key="item.item_sku">
                <td>
                  <input
                    type="checkbox"
                    :checked="selectedSkus.has(item.item_sku)"
                    @change="toggleItem(item.item_sku)"
                  />
                </td>
                <td><strong>{{ item.item_sku }}</strong></td>
                <td>{{ item.item_name }}</td>
                <td>{{ currencySymbol }}{{ item.unit_cost.toFixed(2) }}</td>
                <td>{{ item.forecasted_demand }}</td>
                <td>{{ currencySymbol }}{{ (item.unit_cost * item.forecasted_demand).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="place-order-bar">
        <div v-if="isOverBudget" class="warning-text">{{ t('restocking.budgetExceeded') }}</div>
        <div v-else-if="selectedItems.length === 0" class="warning-text">{{ t('restocking.noItemsSelected') }}</div>
        <button
          class="place-order-btn"
          :disabled="!canPlaceOrder"
          @click="placeOrder"
        >
          {{ t('restocking.placeOrder') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { useI18n } from '../composables/useI18n'
import { useRestockingOrders } from '../composables/useRestockingOrders'

export default {
  name: 'Restocking',
  setup() {
    const { t, currentCurrency } = useI18n()
    const { addSubmittedOrder } = useRestockingOrders()

    const currencySymbol = computed(() => {
      return currentCurrency.value === 'JPY' ? '¥' : '$'
    })

    const loading = ref(true)
    const error = ref(null)
    const successMessage = ref(null)

    const forecasts = ref([])
    const inventoryItems = ref([])
    const budget = ref(50000)
    const selectedSkus = ref(new Set())

    const inventoryBySku = computed(() => {
      const map = new Map()
      inventoryItems.value.forEach(item => map.set(item.sku, item))
      return map
    })

    // Combine demand forecasts with inventory unit cost, ranked by highest demand first.
    // NOTE: some demand forecast SKUs have no matching inventory record in the mock
    // data, so unit cost falls back to 0 for those rows instead of hiding them.
    const rankedItems = computed(() => {
      return forecasts.value
        .map(forecast => {
          const invItem = inventoryBySku.value.get(forecast.item_sku)
          return {
            ...forecast,
            unit_cost: invItem ? invItem.unit_cost : 0
          }
        })
        .sort((a, b) => b.forecasted_demand - a.forecasted_demand)
    })

    const selectedItems = computed(() => {
      return rankedItems.value.filter(item => selectedSkus.value.has(item.item_sku))
    })

    const totalCost = computed(() => {
      return selectedItems.value.reduce((sum, item) => sum + item.unit_cost * item.forecasted_demand, 0)
    })

    const budgetRemaining = computed(() => {
      return budget.value - totalCost.value
    })

    const isOverBudget = computed(() => totalCost.value > budget.value)

    const canPlaceOrder = computed(() => {
      return selectedItems.value.length > 0 && !isOverBudget.value
    })

    const toggleItem = (sku) => {
      const updated = new Set(selectedSkus.value)
      if (updated.has(sku)) {
        updated.delete(sku)
      } else {
        updated.add(sku)
      }
      selectedSkus.value = updated
    }

    const loadData = async () => {
      loading.value = true
      error.value = null
      try {
        const [forecastsData, inventoryData] = await Promise.all([
          api.getDemandForecasts(),
          api.getInventory()
        ])
        forecasts.value = forecastsData
        inventoryItems.value = inventoryData
      } catch (err) {
        error.value = 'Failed to load demand forecasts: ' + err.message
        console.error(err)
      } finally {
        loading.value = false
      }
    }

    const placeOrder = async () => {
      if (!canPlaceOrder.value) return

      const orderDate = new Date()
      const expectedDelivery = new Date(orderDate)
      expectedDelivery.setDate(expectedDelivery.getDate() + 7)

      const orderItems = selectedItems.value.map(item => ({
        sku: item.item_sku,
        name: item.item_name,
        quantity: item.forecasted_demand,
        unit_price: item.unit_cost
      }))

      const orderId = `ORD-RESTOCK-${Date.now()}`

      const order = {
        order_id: orderId,
        order_number: orderId,
        items: orderItems,
        status: 'Submitted',
        order_date: orderDate.toISOString(),
        expected_delivery: expectedDelivery.toISOString(),
        total_value: totalCost.value,
        warehouse: 'Internal Restock',
        category: 'Restocking',
        lead_time_days: 7
      }

      try {
        const result = await api.submitRestockingOrder(order)
        addSubmittedOrder(result && result.order_id ? result : order)

        successMessage.value = t('restocking.successMessage', { orderId })

        // Reset form
        selectedSkus.value = new Set()
        budget.value = 50000

        setTimeout(() => {
          successMessage.value = null
        }, 5000)
      } catch (err) {
        error.value = 'Failed to submit restocking order: ' + err.message
        console.error(err)
      }
    }

    onMounted(loadData)

    return {
      t,
      currencySymbol,
      loading,
      error,
      successMessage,
      budget,
      rankedItems,
      selectedSkus,
      selectedItems,
      totalCost,
      budgetRemaining,
      isOverBudget,
      canPlaceOrder,
      toggleItem,
      placeOrder
    }
  }
}
</script>

<style scoped>
.budget-card {
  padding: 1.5rem;
}

.budget-header {
  margin-bottom: 0.75rem;
}

.budget-label {
  font-size: 0.938rem;
  color: #0f172a;
}

.budget-slider {
  width: 100%;
  accent-color: #2563eb;
}

.budget-range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 0.375rem;
}

.success-banner {
  background: #d1fae5;
  border: 1px solid #a7f3d0;
  color: #065f46;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.25rem;
  font-size: 0.938rem;
  font-weight: 500;
}

.place-order-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1rem 0;
}

.warning-text {
  color: #dc2626;
  font-size: 0.875rem;
  font-weight: 500;
}

.place-order-btn {
  background: #2563eb;
  color: white;
  border: none;
  padding: 0.75rem 1.75rem;
  border-radius: 8px;
  font-size: 0.938rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease;
}

.place-order-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.place-order-btn:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}
</style>
