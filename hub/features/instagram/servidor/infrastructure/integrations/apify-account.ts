export interface ApifyAccount {
  username: string;
  usedUsd: number;
  limitUsd: number;
  cycleEndsAt: string;
}

export class ApifyAccountError extends Error {}

/** Lê a conta e o consumo do ciclo mensal do Apify (valida o token de quebra). */
export async function fetchApifyAccount(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<ApifyAccount> {
  const get = async (path: string) => {
    let response: Response;
    try {
      response = await fetchFn(`https://api.apify.com/v2/${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new ApifyAccountError('Sem resposta do Apify.');
    }
    if (response.status === 401 || response.status === 403)
      throw new ApifyAccountError('O token do Apify foi recusado.');
    if (!response.ok) throw new ApifyAccountError(`O Apify respondeu ${response.status}.`);
    return ((await response.json()) as { data: Record<string, unknown> }).data;
  };

  const [me, limits] = await Promise.all([get('users/me'), get('users/me/limits')]);
  const current = (limits.current ?? {}) as { monthlyUsageUsd?: number };
  const max = (limits.limits ?? {}) as { maxMonthlyUsageUsd?: number };
  const cycle = (limits.monthlyUsageCycle ?? {}) as { endAt?: string };
  return {
    username: String(me.username ?? ''),
    usedUsd: Math.max(0, Number(current.monthlyUsageUsd ?? 0)),
    limitUsd: Math.max(0, Number(max.maxMonthlyUsageUsd ?? 0)),
    cycleEndsAt: cycle.endAt ?? new Date(0).toISOString(),
  };
}
