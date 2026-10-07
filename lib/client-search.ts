import type { Client } from '@/types';

export function matchesClientSearch(client: Pick<Client, 'name' | 'company' | 'email' | 'phone'>, search: string) {
  const term = search.trim().toLowerCase();
  return !term || [client.name, client.company || '', client.email, client.phone].some((value) => value.toLowerCase().includes(term));
}
