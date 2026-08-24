import { ref } from 'vue'

// Shared restocking orders state (singleton pattern), persisted to localStorage
// so submitted orders survive reloads and are visible across views.
const STORAGE_KEY = 'restocking-orders'

const loadStoredOrders = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (err) {
    console.error('Failed to parse stored restocking orders:', err)
    return []
  }
}

const submittedOrders = ref(loadStoredOrders())

export function useRestockingOrders() {
  const addSubmittedOrder = (order) => {
    submittedOrders.value.unshift(order)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(submittedOrders.value))
  }

  return {
    submittedOrders,
    addSubmittedOrder
  }
}
