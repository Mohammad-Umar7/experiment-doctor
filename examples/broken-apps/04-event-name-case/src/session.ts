export function getSession(): { userId: string } {
  return JSON.parse(localStorage.getItem('session') ?? '{"userId":"guest"}');
}
