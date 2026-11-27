export interface User {
  id: string;
  email: string;
  plan: 'free' | 'pro';
}

/** The signed-in user, from the session cookie set by the backend. */
export function currentUser(): User {
  const raw = document.cookie.split('; ').find((c) => c.startsWith('session='))?.slice('session='.length);
  return raw ? (JSON.parse(decodeURIComponent(raw)) as User) : { id: 'guest', email: '', plan: 'free' };
}
