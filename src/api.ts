const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

export type SessionUser = { id: string; email: string; firstName: string; lastName: string; role: 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN' }

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body as T
}

export function login(email: string, password: string) {
  return request<{ token: string; user: SessionUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function register(input: { email: string; password: string; firstName: string; lastName: string; role: SessionUser['role']; city: string; country: string; position?: string }) {
  return request<{ token: string; user: SessionUser }>('/auth/register', { method: 'POST', body: JSON.stringify(input) })
}
