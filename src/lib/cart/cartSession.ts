const CART_SESSION_KEY = 'unique_cart_session'

export function getOrCreateCartSessionId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = localStorage.getItem(CART_SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(CART_SESSION_KEY, id)
  }
  return id
}
